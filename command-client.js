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

  this._disabled = false;
  this._localApp = localApp;
  this._readModel = readModel;
  this._writeModel = writeModel;
  this._http = http;
  this._backoff = backoff;
  this._platform = platform;
}

CommandClient.prototype._exhaustQueue = function (delay) {
  var firstCommand = this._readModel.getFirst();
  if (!firstCommand) {
    this._busy = false;
    return;
  }

  delay = delay || 0;
  this._busy = true;
  var self = this;

  function normalState() {
    self._writeModel.removeFirst();
    self._platform.setTimeout(function () {
      self._exhaustQueue();
    }, 0);
  }

  function errorState(increaseFunc, callback) {
    var newDelay = increaseFunc(delay);

    self._platform.setTimeout(function () {
      callback(newDelay);
    }, 0);

    self._platform.setTimeout(function () {
      self._exhaustQueue(newDelay);
    }, newDelay);
  }

  function callback(err, uri, status, headers, body) {
    if (err) {
      self._platform.console.error(err);
      errorState(self._backoff.clientErrorIncrease, self._backoff.clientErrorCallback);
    } else if (status >= 500 && status < 600) {
      self._platform.console.error(body);
      errorState(self._backoff.serverErrorIncrease, self._backoff.serverErrorCallback);
    } else if (status >= 200 && status < 300) {
      normalState();
    } else {
      self._platform.console.error(body);
      throw new Error("Unexpected response: uri=" + uri + ", status=" + status + ", headers=" + headers + ", body=" + body);
    }
  }

  this._http.post(firstCommand.cmd, firstCommand.data, callback);
};

CommandClient.prototype.disable = function () {
  this._disabled = true;
};

CommandClient.prototype.callLocalQueueNetwork = function (cmd, data) {
  var cmdFunc = this._localApp[cmd];
  if (cmdFunc === undefined) {
    throw new Error("Command " + cmd + " does not exist");
  }
  cmdFunc.call(this._localApp, data);
  this._writeModel.add(cmd, data);
};

CommandClient.prototype.exec = function (cmd, data) {
  this.callLocalQueueNetwork(cmd, data);

  if (this._disabled || this._busy) {
    return;
  }

  this._platform.setTimeout((function () { this._exhaustQueue.call(this); }).bind(this), 0);
};

module.exports = CommandClient;
