'use strict';
/* jslint esnext: true */

let request = require('supertest'),
    expect = require('chai').expect,
    AsyncWebApi = require('../async-webapi');

function ReqPrimer(app) {
  let self = this;

  self._app = app;

  // some defaults
  self._expectJson = true;
  self._expectBody = true;
  self._secure = true;
  self._expectCached = false;
  self._expectStatus = 200;

  self.notJson = function () {
    self._expectJson = false;
    return self;
  };

  self.noContent = function () {
    self._expectBody = false;
    return self;
  };

  self.insecure = function () {
    self._secure = false;
    return self;
  };

  self.expectCached = function () {
    self._expectCached = true;
    return self;
  };

  self.expectStatus = function (status) {
    self._expectStatus = status;
    return self;
  };

  self._query = function (func, query) {
    let result = func(query);

    // from client
    result.set('Accept', 'application/json');

    // from proxy
    if (self._secure) {
      result.set('X-Forwarded-Proto', 'https');
    }

    // general expectations
    if (self._expectJson) {
      result.expect(function (res) {
        if (res.header['content-type'] !== 'application/json; charset=utf-8') {
          return "expected 'Content-Type: application/json; charset=utf-8', got " + res.header['content-type'];
        }
      });
    } else {
      result.expect(function (res) {
        if (res.header['content-type'] !== undefined) {
          return "Content-Type header should not be present, it was set to " + res.header['content-type'] + ", detail: " + JSON.stringify(res.body);
        }
      });
    }

    if (!self._expectBody) {
      result.expect('');
      // result.expect(function (res) {
      //   if (res.body && res.body !== {}) {
      //     // TODO: get rid of headers
      //     return "Empty body expected, but got: " + JSON.stringify(res.body);
      //   }
      // });
    }

    if (self._expectCached && !process.env.DEBUG) {
      result.expect('cache-control', 'public, max-age=31536000');
    } else {
      result.expect('cache-control', 'public, max-age=0, no-cache, no-store');
    }

    result.expect(function (res) {
      if (res.status !== self._expectStatus) {
        return "expected " + self._expectStatus + ", got " + res.status + ", detail: " + JSON.stringify(res.body);
      }
    });

    /*// Error passthrough
    result.expect(function (res) {
      if (res.body.error !== undefined) {
        return res.body.error + ": " res.body.message + "\n" + err.stack;
      }
    });*/

    return result;
  };

  self.get = function(query) {
    return self._query(self._app.get, query);
  };

  self.post = function(query) {
    return self._query(self._app.post, query);
  };
}

describe("For an app", function () {
  let appProvider;
  beforeEach(function () {
    appProvider = {
      getListOfCommands: function () { return []; },
      executeCommand: function (req, command, message) {
        console.log('actually executing', command);
      },
      getFirstEventId: function (req) {},
      getEvent: function (req, eventId) {},
    };
  });

  describe('The API', function () {
    let app;

    beforeEach(function () {
      app = new ReqPrimer(request(new AsyncWebApi(appProvider)
        .build().listen()
      ));
    });

    it('should respond with a more extensive listing at / with an API key', function (done) {
      app
        .get('/')
        .expect([
          '/commands',
          '/events',
        ])
        .end(done);
    });

    describe('should be secure, requiring X-Forwarded-Proto of https, returning 403 for', function () {
      let interestingEndpoints = ['/', '/services', '/commands', '/events'];
      for (let i = 0; i < interestingEndpoints.length; i++) {
        it.skip(interestingEndpoints[i], function (done) {
          app
            .insecure()
            .expectStatus(403)
            .get(interestingEndpoints[i])
            .end(done);
        });
      }
    });

    it('should error at /err for test purposes', function (done) {
      app
        .expectStatus(500)
        .get('/err')
        .expect(function (res) {
          if (!process.env.DEBUG) {
            expect(res.body).to.deep.equal({
              error: "500 - Internal Server Error",
            });
          } else {
            if (res.body.message !== 'test') {
              return "Test exception appears to be a genuine exception! Got: " + res.body.message;
            }

            if (res.body.stack.length < 1) {
              return "Expected a stack trace of length 1 or more.";
            }
          }
        })
        .end(done);
    });
  });

  describe('The event stream', function () {
    let app;

    beforeEach(function () {
      app = new ReqPrimer(request(new AsyncWebApi(appProvider)
        .build().listen()
      ));
    });

    it('should 204 when there are no events but /events is queried', function (done) {
      app
        .notJson()
        .expectStatus(204)
        .get('/events')
        .end(done);
    });

    describe('when there are events', function () {
      it('should forward to the earliest event from /events', function (done) {
        let firstEventId = "foo";
        appProvider.getFirstEventId = function (req) {
          return firstEventId;
        };

        app
          .expectStatus(200)
          .get('/events')
          .expect({
            next: '/events/' + firstEventId,
          })
          .end(done);
      });

      describe('tail', function () {
        it('should have events pointing to the next event', function (done) {
          let event = {
            type: 'test',
            message: "event message",
            next: 'bar',
          };

          appProvider.getEvent = function (req, eventId) {
            return event;
          };

          app
            .expectCached()
            .get('/events/foo')
            .expect({
              type: event.type,
              message: event.message,
              next: '/events/' + event.next,
            })
            .end(done);
        });

        it('should be infinitely cached', function (done) {
          let event = {
            type: 'test',
            message: "event message",
            next: 'bar',
          };

          appProvider.getEvent = function (req, eventId) {
            return event;
          };

          app
            .expectCached()
            .get('/events/foo')
            .end(done);
        });
      });

      describe('head', function () {
        it('should not be cached', function (done) {
          let event = {
            type: 'test',
            message: "event message",
          };

          appProvider.getEvent = function (req, eventId) {
            return event;
          };

          app
            .get('/events/foo')
            .end(done);
        });

        // ETag: hashed-lastmodified+id??
        // Last-Modified
      });

      describe('general behaviour', function () {
        it('should 404 whe given a non-existent event ID', function (done) {
          app
            .expectStatus(404)
            .get('/events/blah')
            .end(done);
        });
      });
    });
  });

  describe('The commands', function () {
    let uid = 'abc123', app, users, pubsub, eventStore, userIndex;

    beforeEach(function () {
      appProvider.getListOfCommands = function () {
        return ['foo', 'bar', 'baz'];
      };

      app = new ReqPrimer(request(new AsyncWebApi(appProvider)
        .build().listen()
      ));
    });

    it.skip('idempotency in commands');

    describe('should describe command', function () {
      let assertCommandIsDescribed = function (cmd, done) {
        app
          .get('/commands')
          .expect(function (res) {
            if (res.body.indexOf('/commands/' + cmd) === -1) {
              return cmd + " is not set";
            }
          })
          .end(done);
      };

      let commands = ["foo", "bar", "baz"];

      for (let i = 0; i < commands.length; i++) {
        let cmd = commands[i];
        (function (cmd) {
          it(cmd, function (done) {
            assertCommandIsDescribed(cmd, done);
          });
        })(cmd);
      }
    });

    describe('http method usage', function () {
      it('should not allow GET for commands', function (done) {
        app
          .expectStatus(405)
          .get('/commands/foo')
          .expect('Allow', 'POST (application/json)')
          .end(done);
      });

      it('should not allow non-JSON POSTs for commands', function (done) {
        app
          .expectStatus(406)
          .post('/commands/foo')
          .expect('Allow', 'POST (application/json)')
          .end(done);
      });

      it('should not receive content from POST for commands', function (done) {
        app
          .expectStatus(204)
          .notJson()
          .noContent()
          .post('/commands/foo')
          .send({id: 'blah', name: 'foo'})
          .set('Content-Type', 'application/json')
          .end(done);
      });

      it('should 404 for unknown commands', function (done) {
        app
          .expectStatus(404)
          .post('/commands/nonExistentCommand')
          .send({foo: 'bar'})
          .set('Content-Type', 'application/json')
          .end(done);
      });
    });
  });
});
