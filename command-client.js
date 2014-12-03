'use strict';

var uuid = require('node-uuid');

function CommandClient(localApp, readModel, writeModel, http, backoff) {
  this._localApp = localApp;
  this._readModel = readModel;
  this._writeModel = writeModel;
  this._http = http;
  this._backoff = backoff;

  this._locked = false;

  this._sync = function (cmdId, backoffTimeMs) {
    if (cmdId === null) {
      return;
    }

    if (this._locked) {
      return;
    }

    this._locked = true;

    var cmd = this._readModel.getCommandFor(cmdId),
        data = this._readModel.getDataFor(cmdId);

    var self = this;

    function normalState() {
      self._writeModel.removeId(cmdId);
      self._locked = false;
    }

    function errorState(increaseFunc, callback) {
      setTimeout(function () {
        self._locked = false;
        self._sync(self._readModel.getFirstCommandId(), increaseFunc(backoffTimeMs));
      }, backoffTimeMs);

      setTimeout((function () {
        callback(backoffTimeMs);
      })(), 0);
    }

    function callback(err, uri, status, headers, body) {
      if (err) {
        errorState(self._backoff.clientErrorIncrease, self._backoff.clientErrorCallback);
      } else if (status >= 500 && status < 600) {
        errorState(self._backoff.serverErrorIncrease, self._backoff.serverErrorCallback);
      } else {
        normalState();
      }

      self._sync(self._readModel.getFirstCommandId(), self._backoff.timeMs);
    };

    this._http.post('/' + cmd, data, callback);
  };
}

CommandClient.prototype.exec = function (cmd, data) {
  this._localApp[cmd].call(this._localApp, data);
  this._writeModel.save(uuid.v4(), cmd, data);
  this._sync(this._readModel.getFirstCommandId(), this._backoff.timeMs);
};

module.exports = CommandClient;
