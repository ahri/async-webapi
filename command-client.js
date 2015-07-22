'use strict';

function CommandClient(localApp, repo, http, backoff, platform) {
  if (localApp === undefined) {
    throw Error("Provide an app");
  }

  if (repo === undefined) {
    // TODO: consider defaulting to browser impl
    throw Error("Provide a repo");
  }

  if (http === undefined) {
    throw Error("Provide an http client implementation");
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
      platform.setTimeout(function () {
        exhaustQueue();
      }, 0);
    }

    function errorState(increaseFunc, callback) {
      var newDelay = increaseFunc(delay);

      platform.setTimeout(function () {
        callback(newDelay);
      }, 0);

      platform.setTimeout(function () {
        exhaustQueue(newDelay);
      }, newDelay);
    }

    function callback(err, uri, status, headers, body) {
      if (err) {
        platform.console.error(err);
        errorState(backoff.clientErrorIncrease, backoff.clientErrorCallback);
      } else if (status >= 500 && status < 600) {
        platform.console.error(body);
        errorState(backoff.serverErrorIncrease, backoff.serverErrorCallback);
      } else if (status >= 200 && status < 300) {
        normalState();
      } else {
        platform.console.error(body);
        throw Error("Unexpected response: uri=" + uri + ", status=" + status + ", headers=" + headers + ", body=" + body);
      }
    }

    http.post(firstCommand.cmd, firstCommand.data, callback);
  }

  function callLocalQueueNetwork(cmd, data) {
    var cmdFunc = localApp[cmd];
    if (cmdFunc === undefined) {
      throw Error("Command " + cmd + " does not exist");
    }
    cmdFunc.call(localApp, data);
    repo.add(cmd, data);
  }

  return {
    disable: function disable() {
      disabled = true;
    },

    callLocalQueueNetwork: callLocalQueueNetwork,

    exec: function exec(cmd, data) {
      callLocalQueueNetwork(cmd, data);

      if (disabled || busy) {
        return;
      }

      platform.setTimeout(function () { exhaustQueue(); }, 0);
    },
  };
}

module.exports = CommandClient;
