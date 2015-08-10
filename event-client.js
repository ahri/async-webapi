'use strict';

function AsyncPoller(platform, strategy, http) {
  var enabled = true;

  return {
    poll: function poll(uri, delay, callback) {
      platform.setTimeout(function () {
        if (!enabled) {
          return;
        }

        http.get(uri, function (err, uri, status, headers, body) {
          if (callback) {
            platform.setTimeout(function () { callback(err, uri, status, headers, body); }, 0);
          }
          strategy.exec(err, delay, uri, status, headers, body);
        });
      }, delay);
    },

    disable: function disable() {
      enabled = false;
    },
  };
}

function Strategy(debug) {
  debug = debug || function (args) {
    return "the provided arguments";
  };

  var strategies = [];

  return {
    exec: function exec(err, delay, uri, status, headers, body) {
      var candidate = null;
      for (var i = 0; i < strategies.length; i++) {
        if (!strategies[i].canHandle(err, uri, status, headers, body)) {
          continue;
        }

        if (candidate !== null) {
          throw Error("Only one strategy is allowed to handle a set of data, but candidates " + candidate + " and " + i + " both handle: " + debug(arguments));
        }

        candidate = i;
      }

      if (candidate === null) {
        throw Error("No strategy can handle: " + debug(arguments));
      }

      strategies[candidate].exec(err, delay, uri, status, headers, body);
    },

    add: function add(strategy) {
      strategies.push(strategy);
    },
  };
}

function NullRepo() {
  return {
    transitionedTo: function (uri) {},
    latest: function () {},
  };
}

function EventClient(initialUri, eventCallback, http, backoff, repo, platform) {
  if (initialUri === undefined) {
    throw Error("Provide an initial uri");
  }

  if (eventCallback === undefined || eventCallback.call === undefined || eventCallback.length !== 2) {
    throw Error("Provide an event callback with 2 params: eventType, eventMessage");
  }

  if (http === undefined) {
    throw Error("Provide an http interface");
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

  repo = repo || NullRepo();

  if (platform === undefined) {
    platform = {
      setTimeout: function() { setTimeout.apply(null, arguments); },
      console: console,
    };
  }

  var strategy = Strategy(function argsToObj(args) {
    return "{err: " + args[0] +
           //", delay: " + args[1] + // omitted because canHandle doesn't inspect it
           ", uri: " + args[2] +
           ", status: " + args[3] +
           ", headers: " + JSON.stringify(args[4]) +
           ", body: " + JSON.stringify(args[5]) + "}";
  });

  function transitionCall(err, uri, status, headers, body) {
    if (status !== 200) {
      throw Error("Did not expect non-200 transition");
    }

    if (body.type === undefined || body.message === undefined) {
      throw Error("Expected both type and message to be set in body");
    }

    repo.transitionedTo(uri);

    eventCallback(body.type, body.message);
  }

  var asyncPoller = AsyncPoller(platform, strategy, http);

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

  var latest = repo.latest();
  if (latest) {
    initialUri = latest;
  }

  asyncPoller.poll(initialUri, 0);

  return {
    disable: function disable() {
      asyncPoller.disable();
    },
  };
}

module.exports = EventClient;
