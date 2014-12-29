function AsyncPoller(platform, strategy, http) {
  this._platform = platform;
  this._strategy = strategy;
  this._http = http;
  this._enabled = true;
}

AsyncPoller.prototype.poll = function (uri, delay, callback) {
  (function close(self) {
    self._platform.setTimeout(function () {
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
  })(this);
};

AsyncPoller.prototype.disable = function () {
  this._enabled = false;
}

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

  if (eventCallback === undefined || eventCallback.call === undefined || eventCallback.length !== 3) {
    throw new Error("Provide an event callback with 3 params: err, eventType, eventMessage");
  }

  var transitionCall = function (err, uri, status, headers, body) {
    // Assumption: we don't get called in case of error

    if (body.type === undefined || body.message === undefined) {
      err = new Error("Expected both type and message to be set in body");
    }

    eventCallback(null, body.type, body.message);
  };

  if (http === undefined) {
    http = {
      get: function (uri, callback) {
        var req = require('superagent');
        req
          .get(uri)
          .end(function (err, res) {
            callback(err, uri, res.status, res.headers, res.body);
          });
      },
    };
  }

  if (backoff === undefined) {
    backoff = {
      timeMs: 1,
      serverErrorIncrease: function (time) { return time * 2; },
      clientErrorIncrease: function (time) { return time * 2; },
      waitingIncrease: function (time) { return 30000; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
      waitingCallback: function () {},
    };
  }

  if (platform === undefined) {
    platform = {
      setTimeout: setTimeout,
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
      asyncPoller = new AsyncPoller(platform, strategy, http);

  this._asyncPoller = asyncPoller;

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 400;
    },
    exec: function strat400NoEventsYet(err, delay, uri, status, headers, body) {
      if (backoff.waitingCallback) {
        platform.setTimeout(function () { backoff.waitingCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, backoff.waitingIncrease(delay));
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 302;
    },
    exec: function strat302FirstEvent(err, delay, uri, status, headers, body) {
      asyncPoller.poll(headers['location'], backoff.timeMs, transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.next === undefined;
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
      return status === 200 && body.next !== undefined;
    },
    exec: function strat200WithNext(err, delay, uri, status, headers, body) {
      asyncPoller.poll(body.next, backoff.timeMs, transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status >= 500 && status < 600;
    },
    exec: function stratServerErr(err, delay, uri, status, headers, body) {
      platform.console.error(body);
      if (backoff.serverErrorCallback) {
        platform.setTimeout(function () { backoff.serverErrorCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, backoff.serverErrorIncrease(delay));
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return err !== null && err !== undefined;
    },
    exec: function stratClientErr(err, delay, uri, status, headers, body) {
      platform.console.error(err);
      if (backoff.clientErrorCallback) {
        platform.setTimeout(function () { backoff.clientErrorCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, backoff.clientErrorIncrease(delay));
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 403;
    },
    exec: function stratHttpsRequired(err, delay, uri, status, headers, body) {
      platform.console.error(body);
      if (backoff.clientErrorCallback) {
        platform.setTimeout(function () { backoff.clientErrorCallback(uri, delay); }, 0);
      }

      throw new Error("HTTPS required. Aborting.");
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 401;
    },
    exec: function stratUnauthenticated(err, delay, uri, status, headers, body) {
      platform.console.error(body);
      if (backoff.clientErrorCallback) {
        platform.setTimeout(function () { backoff.clientErrorCallback(uri, delay); }, 0);
      }

      throw new Error("Authentication required. Aborting.");
    }
  });

  asyncPoller.poll(initialUri, 0);
}

EventClient.prototype.disable = function () {
  this._asyncPoller.disable();
};

module.exports = EventClient;
