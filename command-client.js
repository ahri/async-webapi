'use strict';

function CommandClient(repo, http, backoff, platform) {
  if (repo === undefined) {
    // TODO: consider defaulting to browser impl
    throw new Error("Provide a repo");
  }

  if (http === undefined) {
    throw new Error("Provide an http client implementation");
  }

  if (backoff === undefined) {
    backoff = {
      serverErrorIncrease: function (time) { return time + 5000; },
      clientErrorIncrease: function (time) { return time + 10000; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
    };
  }

  if (platform === undefined) {
    platform = {
      setTimeout: function() { setTimeout.apply(null, arguments); },
      console: console,
    };
  }

  var disabled = false,
      busy = false;

  function exhaustQueue(delay) {
    var firstCommand = repo.getFirst();

    if (!firstCommand) {
      busy = false;
      return;
    }

    delay = delay || 0;
    busy = true;

    function normalState() {
      repo.removeFirst();
      platform.setTimeout(exhaustQueue, 0);
    }

    function errorState(increaseFunc, callback) {
      var newDelay = increaseFunc(delay);

      platform.setTimeout(callback.bind(null, newDelay), 0);

      platform.setTimeout(exhaustQueue.bind(null, newDelay), newDelay);
    }

    function callback(err, uri, status, headers, body) {
      if (err) {
        platform.console.error(err);
        errorState(backoff.clientErrorIncrease, backoff.clientErrorCallback);
      } else if (status >= 200 && status < 300) {
        normalState();
      } else if (status >= 500 && status < 600) {
        platform.console.error(body);
        errorState(backoff.serverErrorIncrease, backoff.serverErrorCallback);
      } else {
        platform.console.error(body);
        throw new Error("Unexpected response: uri=" + uri + ", status=" + status + ", headers=" + headers + ", body=" + body);
      }
    }

    http.post(firstCommand.cmd, firstCommand.data, callback);
  }

  return {
    disable: function disable() {
      disabled = true;
    },

    exec: function exec(cmd, data) {
      repo.add(cmd, data);

      if (disabled || busy) {
        return;
      }

      exhaustQueue();
    },
  };
}

module.exports = CommandClient;
