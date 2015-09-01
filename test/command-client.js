'use strict';

var expect = require('chai').expect,
    CommandClient = require('../command-client');

describe('The CommandClient class', function () {
  var commandClient, storage, repo, http, backoff, platform;

  beforeEach(function () {
    var cmds = {};

    repo = {
      getFirst: function () {
        return cmds.first;
      },
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
      serverErrorIncrease: function (time) { return (time + 1) * 2; },
      clientErrorIncrease: function (time) { return (time + 1) * 2; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
    };
    platform = {
      setTimeout: function (f, t) {
        return setTimeout(f, 0);
      },
      console: {
        error: function () {},
      },
    };

    commandClient = CommandClient(repo, http, backoff, platform);
  });

  it('should store the command', function (done) {
    var repoAdd = repo.add;

    repo.add = function (cmd, data) {
      repoAdd.call(repo, cmd, data);
      if (cmd === "foo" && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should post a command', function (done) {
    http.post = function (uri, data, callback) {
      callback(null, uri, 204, {}, {});

      if (uri === 'foo' && data === "bar") {
        done();
      }
    };

    commandClient.exec("foo", "bar");
  });

  it('should post two commands in order', function (done) {
    var httpPost = http.post,
        calledFirst = false;

    http.post = function (uri, data, callback) {
      console.log(uri, data);
      if (uri === 'foo' && data === "bar") {
        calledFirst = true;
      }
      if (calledFirst && uri === 'xyz' && data === "123") {
        done();
      }

      httpPost(uri, data, callback);
    };

    commandClient.exec('foo', 'bar');
    commandClient.exec("xyz", "123");
  });

  it('should remove the command', function (done) {
    var repoRemoveFirst = repo.removeFirst;
    repo.removeFirst = function () {
      repoRemoveFirst.call(repo);
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
      backoff.serverErrorIncrease = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }

        return (currentTimeMs + 1) * 2;
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
      backoff.serverErrorIncrease = function (currentTimeMs) { return (currentTimeMs+1)*2; };
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
          callback(Error("no net connection"), null, null, null, null);
        } else {
          done();
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should use the backoff to determine backoff time increase at each error', function (done) {
      backoff.clientErrorIncrease = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }

        return (currentTimeMs + 1) * 2;
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(Error("no net connection"), null, null, null, null);
        }
      };

      commandClient.exec("foo", "bar");
    });

    it('should call the backoff callback letting it know the current backoff time', function (done) {
      backoff.clientErrorIncrease = function (currentTimeMs) { return (currentTimeMs+1)*2; };
      backoff.clientErrorCallback = function (currentTimeMs) {
        if (currentTimeMs === 2) {
          done();
        }
      };

      var call = 0;
      http.post = function(uri, data, callback) {
        call++;
        if (call <= 2) {
          callback(Error("no net connection"), null, null, null, null);
        }
      };

      commandClient.exec("foo", "bar");
    });
  });

  describe('backoff behaviour', function () {
    it('upon client error, should immediately back off, using the correct value in its call to the setTimeout platform method', function () {
      http.post = function(uri, data, callback) {
        callback(Error("blah"), null, null, null, null);
      };

      backoff.clientErrorIncrease = function (currentTimeMs) { return (currentTimeMs+1)*10; };

      var calls = 0;
      platform.setTimeout = function (f, t) {
        calls++;
        if (calls === 3) { // initial, err callback, delay
          expect(t).to.equal(10);
        }

        if (calls === 5) { // err callback, delay
          expect(t).to.equal(110);
          platform.setTimeout = function () {}; // not interested in executing past this point
        }

        setTimeout(f, 0);
      };

      commandClient.exec("foo", "bar");
    });
  });
});
