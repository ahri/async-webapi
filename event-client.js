function AsyncPoller(strategy, http) {
  this._strategy = strategy;
  this._http = http;
  this._enabled = true;
}

AsyncPoller.prototype.poll = function (uri, delay, callback) {
  if (!this._enabled) {
    return;
  }

  (function close(self) {
    setTimeout(function () {
      self._http.get(uri, function (err, uri, status, headers, body) {
        if (callback) {
          setImmediate(function () { callback(uri, status, headers, body); });
        }
        self._strategy.exec(err, uri, status, headers, body);
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

Strategy.prototype.exec = function (err, uri, status, headers, body) {
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

  this._strategies[candidate].exec(err, uri, status, headers, body);
};

Strategy.prototype.add = function (strategy) {
  this._strategies.push(strategy);
};

function EventClient(initialuri, transitionCall, http, shortPoll, longPoll, longerPoll) {
  var strategy = new Strategy(function argsToObj(args) {
        return "{err: " + args[0] +
               ", uri: " + args[1] +
               ", status: " + args[2] +
               ", headers: " + JSON.stringify(args[3]) +
               ", body: " + JSON.stringify(args[4]) + "}";
      });
      asyncPoller = new AsyncPoller(strategy, http);

  if (shortPoll === undefined) {
    shortPoll = 0;
  }

  if (longPoll === undefined) {
    longPoll = 5000;
  }

  if (longerPoll === undefined) {
    longerPoll = 30000;
  }

  this._asyncPoller = asyncPoller;

  if (!initialuri) {
    throw new Error('Must pass in initial uri');
  }

  if (!transitionCall || !transitionCall.call) {
    throw new Error('Must pass in transition call');
  }

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 404;
    },
    exec: function strat404(err, uri, status, headers, body) {
      asyncPoller.poll(uri, longPoll);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 302;
    },
    exec: function strat302(err, uri, status, headers, body) {
      asyncPoller.poll(headers['location'], shortPoll, transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.next === undefined;
    },
    exec: function strat200NoNext(err, uri, status, headers, body) {
      asyncPoller.poll(uri, longPoll);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status === 200 && body.next !== undefined;
    },
    exec: function strat200WithNext(err, uri, status, headers, body) {
      asyncPoller.poll(body.next, longPoll, transitionCall);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return status >= 500 && status < 600;
    },
    exec: function stratServerErr(err, uri, status, headers, body) {
      asyncPoller.poll(uri, longerPoll);
    }
  });

  strategy.add({
    canHandle: function (err, uri, status, headers, body) {
      return err !== null && err !== undefined;
    },
    exec: function stratClientErr(err, uri, status, headers, body) {
      asyncPoller.poll(uri, longerPoll);
    }
  });

  asyncPoller.poll(initialuri, 0);
}

EventClient.prototype.disable = function () {
  this._asyncPoller.disable();
};

module.exports = EventClient;
