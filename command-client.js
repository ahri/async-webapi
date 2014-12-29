'use strict';

function CommandClient(localApp, readModel, writeModel, http, backoff, platform) {
  if (localApp === undefined) {
    throw new Error("Provide an app");
  }

  if (readModel === undefined) {
    // TODO: consider defaulting to browser impl
    throw new Error("Provide a read model");
  }

  if (writeModel === undefined) {
    // TODO: consider defaulting to browser impl
    throw new Error("Provide a write model");
  }

  if (http === undefined) {
    throw new Error("Provide an http client implementation");
  }

  if (backoff === undefined) {
    backoff = {
      timeMs: 1,
      serverErrorIncrease: function (time) { return time * 2; },
      clientErrorIncrease: function (time) { return time * 2; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
    };
  }

  if (platform === undefined) {
    platform = {
      setTimeout: setTimeout,
      console: console,
    };
  }

  this._disabled = false;
  this._localApp = localApp;
  this._readModel = readModel;
  this._writeModel = writeModel;
  this._http = http;
  this._backoff = backoff;
  this._platform = platform;

  this._lockedWaitingForErrorStateResolution = false;

  this._sync = function (cmd, backoffTimeMs) {
    if (this._disabled) {
      return;
    }

    if (this._lockedWaitingForErrorStateResolution) {
      return;
    }

    this._lockedWaitingForErrorStateResolution = true;

    var self = this;

    function normalState() {
      self._writeModel.removeFirst();
      self._lockedWaitingForErrorStateResolution = false;
    }

    function errorState(increaseFunc, callback) {
      var newBackoffTimeMs = increaseFunc(backoffTimeMs);
      platform.setTimeout(function () {
        self._lockedWaitingForErrorStateResolution = false;
        self._sync(self._readModel.getFirst(), newBackoffTimeMs);
      }, newBackoffTimeMs);

      platform.setTimeout((function () {
        callback(backoffTimeMs);
      })(), 0);
    }

    function callback(err, uri, status, headers, body) {
      if (err) {
        platform.console.error(err);
        errorState(self._backoff.clientErrorIncrease, self._backoff.clientErrorCallback);
      } else if (status >= 500 && status < 600) {
        platform.console.error(body);
        errorState(self._backoff.serverErrorIncrease, self._backoff.serverErrorCallback);
      } else if (status == 200) {
        normalState();
      } else {
        platform.console.error(body);
        throw new Error("Unexpected response: uri=" + uri + ", status=" + status + ", headers=" + headers + ", body=" + body);
      }
    };

    this._http.post(cmd.cmd, cmd.data, callback);
  };
}

CommandClient.prototype.disable = function () {
  this._disabled = true;
}

CommandClient.prototype.exec = function (cmd, data) {
  var cmdFunc = this._localApp[cmd];
  if (cmdFunc === undefined) {
    throw new Error("Command " + cmd + " does not exist");
  }
  cmdFunc.call(this._localApp, data);
  this._writeModel.add(cmd, data);

  var self = this;
  this._platform.setTimeout(function () {
    while (true) {
      var firstCommand = self._readModel.getFirst();
      if (!firstCommand || self._lockedWaitingForErrorStateResolution) {
        break;
      }

      self._sync(firstCommand, self._backoff.timeMs);
    }
  }, 0);
};

module.exports = CommandClient;
