'use strict';

let expect = require('chai').expect,
    CommandClient = require('../command-client');

describe('The CommandClient class', function () {
  var commandClient, localApp, storage, readModel, writeModel, http, backoff, platform;

  beforeEach(function () {
    let cmds = {};

    localApp = {
      foo: function () {},
      xyz: function () {},
    };
    readModel = {
      getFirst: function () {
        return cmds.first;
      }
    },
    writeModel = {
      add: function (cmd, data) {
        if (cmds.last === undefined) {
          cmds.first = {
            cmd: cmd,
            data: data,
          };
          cmds.last = cmds.first;
        } else {
          cmds.last.next = {
            cmd: cmd,
            data: data,
          };
        }
      },
      removeFirst: function () {
        cmds.first = cmds.first.next;
        if (cmds.first === undefined) {
          cmds.last = undefined;
        }
      },
    };
    http = {
      post: function (uri, data, callback) {
        callback(null, uri, 200, {}, {});
      }
    };
    backoff = {
      timeMs: 1,
      serverErrorIncrease: function (time) { return time * 2; },
      clientErrorIncrease: function (time) { return time * 2; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
    };
    platform = {
      setTimeout: function (f, t) {
        return setTimeout(f, 0);
      },
    };
    commandClient = new CommandClient(localApp, readModel, writeModel, http, backoff, platform);
  });

  it('should store the command', function (done) {
    let writeModelAdd = writeModel.add;

    writeModel.add = function (cmd, data) {
      writeModelAdd.call(writeModel, cmd, data);
      if (cmd === "foo" && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should pass command to the local app', function (done) {
    localApp.foo = function (data) {
      if (data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should post a command', function (done) {
    http.post = function (uri, data) {
      if (uri === '/foo' && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should post two commands in order', function (done) {
    writeModel.add('foo', 'bar');

    let httpPost = http.post,
        calledFirst = false;

    http.post = function (uri, data, callback) {
      if (uri === '/foo' && data === "bar") {
        calledFirst = true;
      }
      if (calledFirst && uri === '/xyz' && data === "123") {
        done();
      }

      httpPost.call(http, uri, data, callback);
    };

    commandClient.exec("xyz", "123");
  });

  it('should remove the command', function (done) {
    let writeModelRemoveFirst = writeModel.removeFirst;
    writeModel.removeFirst = function () {
      writeModelRemoveFirst.call(writeModel);
      done();
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
