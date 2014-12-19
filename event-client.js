function AsyncPoller(platform, strategy, http) {
  this._platform = platform;
  this._strategy = strategy;
  this._http = http;
  this._enabled = true;
}

AsyncPoller.prototype.poll = function (uri, delay, callback) {
  if (!this._enabled) {
    return;
  }

  (function close(self) {
    self._platform.setTimeout(function () {
      self._http.get(uri, function (err, uri, status, headers, body) {
        if (callback) {
          self._platform.setTimeout(function () { callback(uri, status, headers, body); }, 0);
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

function EventClient(initialUri, transitionCall, http, backoff, platform) {
  if (initialUri === undefined) {
    throw new Error("Provide an initial uri");
  }

  if (transitionCall === undefined) {
    throw new Error("Provide a transition callback");
  }

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
               ", uri: " + args[1] +
               ", status: " + args[2] +
               ", headers: " + JSON.stringify(args[3]) +
               ", body: " + JSON.stringify(args[4]) + "}";
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
      if (backoff.clientErrorCallback) {
        platform.setTimeout(function () { backoff.clientErrorCallback(uri, delay); }, 0);
      }

      asyncPoller.poll(uri, backoff.clientErrorIncrease(delay));
    }
  });

  asyncPoller.poll(initialUri, 0);
}

EventClient.prototype.disable = function () {
  this._asyncPoller.disable();
};

module.exports = EventClient;
