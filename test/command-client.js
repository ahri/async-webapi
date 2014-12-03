'use strict';

let expect = require('chai').expect,
    CommandClient = require('../command-client');

// TODO: create builder that sorts out default read/write/backoff

describe('The CommandClient class', function () {
  var commandClient, localApp, storage, readModel, writeModel, http, backoff;

  beforeEach(function () {
    localApp = {
      foo: function () {},
    };
    readModel = {
      getFirstCommandId: function () {},
      getCommandFor: function () {},
      getDataFor: function () {},
    },
    writeModel = {
      save: function () {},
      removeId: function () {},
    };
    http = {
      post: function () {},
    };
    backoff = {
      initialTimeMs: 1,
      serverErrorIncrease: function (time) { return time * 2; },
      clientErrorIncrease: function (time) { return time * 2; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
    };
    commandClient = new CommandClient(localApp, readModel, writeModel, http, backoff);
  });

  it('should pass commands to the local app', function (done) {
    localApp.foo = function (data) {
      if (data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should store the command', function (done) {
    writeModel.save = function (id, cmd, data) {
      if (cmd === "foo" && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should post the command', function (done) {
    readModel.getCommandFor = function () { return "foo"; };
    readModel.getDataFor = function () { return "bar"; };

    http.post = function (uri, data) {
      if (uri === '/foo' && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  describe('under server error conditions', function () {
    it('should back off and re-call', function (done) {
      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call === 1) {
          callback(null, uri, 501, {}, {});
        } else {
          done();
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should use the backoff to determine backoff time increase at each error', function (done) {
      backoff.timeMs = 1;
      backoff.serverErrorIncrease = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }

        return currentTimeMs * 2;
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(null, uri, 501, {}, {});
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should call the backoff callback letting it know the current backoff time', function (done) {
      backoff.timeMs = 1;
      backoff.serverErrorIncrease = function (currentTimeMs) { return currentTimeMs*2; };
      backoff.serverErrorCallback = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(null, uri, 501, {}, {});
        }
      };

      commandClient.exec("foo", "bar");
    });
  });

  describe('under exception conditions', function () {
    it('should back off and re-call', function (done) {
      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call === 1) {
          callback(new Error("no net connection"), null, null, null, null);
        } else {
          done();
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should use the backoff to determine backoff time increase at each error', function (done) {
      backoff.timeMs = 1;
      backoff.clientErrorIncrease = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }

        return currentTimeMs * 2;
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(new Error("no net connection"), null, null, null, null);
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should call the backoff callback letting it know the current backoff time', function (done) {
      backoff.timeMs = 1;
      backoff.clientErrorIncrease = function (currentTimeMs) { return currentTimeMs*2; };
      backoff.clientErrorCallback = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(new Error("no net connection"), null, null, null, null);
        }
      };

      commandClient.exec("foo", "bar");
    });
  });
});
