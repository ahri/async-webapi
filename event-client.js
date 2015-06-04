'use strict';

function AsyncPoller(platform, strategy, http) {
  this._platform = platform;
  this._strategy = strategy;
  this._http = http;
  this._enabled = true;
}

AsyncPoller.prototype.poll = function (uri, delay, callback) {
  var self = this;

  this._platform.setTimeout(function () {
    if (!self._enabled) {
      return;
    }

    self._http.get(uri, function (err, uri, status, headers, body) {
      if (callback) {
        self._platform.setTimeout(function () { callback(err, uri, status, headers, body); }, 0);
      }
      self._strategy.exec(err, delay, uri, status, headers, body);
    });
  }, delay);
};

AsyncPoller.prototype.disable = function () {
  this._enabled = false;
};

function Strategy(debug) {
  this._debug = debug || function (args) {
    return "the provided arguments";
  };

  this._strategies = [];
}

Strategy.prototype.exec = function (err, delay, uri, status, headers, body) {
  var candidate = null;
  for (var i = 0; i < this._strategies.length; i++) {
    if (!this._strategies[i].canHandle(err, uri, status, headers, body)) {
      continue;
    }

    if (candidate !== null) {
      throw new Error("Only one strategy is allowed to handle a set of data, but candidates " + candidate + " and " + i + " both handle: " + this._debug(arguments));
    }

    candidate = i;
  }

  if (candidate === null) {
    throw new Error("No strategy can handle: " + this._debug(arguments));
  }

  this._strategies[candidate].exec(err, delay, uri, status, headers, body);
};

Strategy.prototype.add = function (strategy) {
  this._strategies.push(strategy);
};

function EventClient(initialUri, eventCallback, http, backoff, platform) {
  if (initialUri === undefined) {
    throw new Error("Provide an initial uri");
  }

  if (eventCallback === undefined || eventCallback.call === undefined || eventCallback.length !== 2) {
    throw new Error("Provide an event callback with 2 params: eventType, eventMessage");
  }

  if (http === undefined) {
    throw new Error("Provide an http interface");
  }

  if (backoff === undefined) {
    backoff = {
      serverErrorIncrease: function (time) { return time + 5000; },
      clientErrorIncrease: function (time) { return time + 10000; },
      waitingIncrease: function (time) { return 500; }, // NB. this is static
      serverErrorCallback: function (uri, err, delay) { platform.console.log("Server error polling " + uri + ", waiting " + delay + "ms"); },
      clientErrorCallback: function (uri, err, delay) { platform.console.log("Client error polling " + uri + ", waiting " + delay + "ms"); },
      waitingCallback: function () {},
    };
  }

  if (platform === undefined) {
    platform = {
      setTimeout: function() { setTimeout.apply(null, arguments); },
      console: console,
    };
  }

  var strategy = new Strategy(function argsToObj(args) {
    return "{err: " + args[0] +
           //", delay: " + args[1] + // omitted because canHandle doesn't inspect it
           ", uri: " + args[2] +
           ", status: " + args[3] +
           ", headers: " + JSON.stringify(args[4]) +
           ", body: " + JSON.stringify(args[5]) + "}";
  });

  var transitionCall = function (err, uri, status, headers, body) {
    if (status !== 200) {
      strategy.exec(err, 0, uri, status, headers, body);
    }

    if (body.type === undefined || body.message === undefined) {
      err = new Error("Expected both type and message to be set in body");
    }

    eventCallback(body.type, body.message);
  };

  var asyncPoller = new AsyncPoller(platform, strategy, http);
  this._asyncPoller = asyncPoller;

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 204;
    },
    exec: function strat204NoEventsYet(err, delay, uri, status, headers, body) {
      delay = backoff.waitingIncrease(delay);
      if (backoff.waitingCallback) {
        platform.setTimeout(function () { backoff.waitingCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, delay);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.message === undefined && body.next !== undefined;
    },
    exec: function strat200FirstEvent(err, delay, uri, status, headers, body) {
      asyncPoller.poll(body.next, backoff.waitingIncrease(delay), transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.message !== undefined && body.next === undefined;
    },
    exec: function strat200NoNext(err, delay, uri, status, headers, body) {
      if (backoff.waitingCallback) {
        platform.setTimeout(function () { backoff.waitingCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, backoff.waitingIncrease(delay));
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.message !== undefined && body.next !== undefined;
    },
    exec: function strat200WithNext(err, delay, uri, status, headers, body) {
      asyncPoller.poll(body.next, backoff.waitingIncrease(delay), transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status >= 500 && status < 600;
    },
    exec: function stratServerErr(err, delay, uri, status, headers, body) {
      delay = backoff.serverErrorIncrease(delay);
      if (backoff.serverErrorCallback) {
        platform.setTimeout(function () { backoff.serverErrorCallback(uri, err, delay); }, 0);
      }

      asyncPoller.poll(uri, delay);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return err !== undefined && err !== null;
    },
    exec: function stratClientErr(err, delay, uri, status, headers, body) {
      delay = backoff.clientErrorIncrease(delay);
      if (backoff.clientErrorCallback) {
        platform.setTimeout(function () { backoff.clientErrorCallback(uri, err, delay); }, 0);
      }

      asyncPoller.poll(uri, delay);
    }
  });

  asyncPoller.poll(initialUri, 0);
}

EventClient.prototype.disable = function () {
  this._asyncPoller.disable();
};

module.exports = EventClient;
