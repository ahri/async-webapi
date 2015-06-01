'use strict';
/* jslint esnext: true */

// TODO: app should supply hooks for allowing/disallowing access to /commands and /events

let http = require('http'),
    request = require('supertest'),
    expect = require('chai').expect,
    AsyncWebApi = require('../async-webapi'),
    Router = require('../router');

function checkForErr(message) {
  return function (res) {
    if (!process.env.DEBUG) {
      expect(res.body).to.deep.equal({
        error: "500 - Internal Server Error",
      });
    } else {
      if (res.body.message !== message) {
        return "Test exception appears to be a genuine exception! Got: " + res.body.message;
      }

      if (res.body.stack.length < 1) {
        return "Expected a stack trace of length 1 or more.";
      }
    }
  }
}

function ReqPrimer(api) {
  let self = this;

  self._api = api;

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
    return self._query(self._api.get, query);
  };

  self.post = function(query) {
    return self._query(self._api.post, query);
  };
}

[1, 0].forEach(function (debug) {
  process.env.DEBUG = debug;

  describe("With DEBUG=" + process.env.DEBUG, function () {
    describe("for an api", function () {
      let app;
      beforeEach(function () {
        app = {
          initRequestState: function (state) {},
          getListOfCommands: function (state) { return []; },
          executeCommand: function (command, message, state) {},
          getFirstEventId: function (state) {},
          getEvent: function (state, id) {},
        };
      });

      describe('the framework', function () {
        let api;

        beforeEach(function () {
          api = new ReqPrimer(request(http.createServer(new AsyncWebApi(app)
            .build()).listen()
          ));
        });

        it('should give a 404 for non-existent stuff', function (done) {
          api
              .expectStatus(404)
              .get('/nonexistentstuff')
              .end(done);
        });

        it('should respond with a more extensive listing at / with an API key', function (done) {
          api
            .get('/')
            .send({foo: "bar"})
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
              api
                .insecure()
                .expectStatus(403)
                .get(interestingEndpoints[i])
                .end(done);
            });
          }
        });
      });

      describe('the event stream', function () {
        let api;

        beforeEach(function () {
          api = new ReqPrimer(request(http.createServer(new AsyncWebApi(app)
            .build()).listen()
          ));
        });

        it('should 204 when there are no events but /events is queried', function (done) {
          app.getFirstEventId = function () { return null; };

          api
            .notJson()
            .expectStatus(204)
            .get('/events')
            .end(done);
        });

        describe('when there are events', function () {
          it('should forward to the earliest event from /events', function (done) {
            let firstEventId = "foo";
            app.getFirstEventId = function (req) {
              return firstEventId;
            };

            api
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

              app.getEvent = function (req, eventId) {
                return event;
              };

              api
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

              app.getEvent = function (req, eventId) {
                return event;
              };

              api
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

              app.getEvent = function (req, eventId) {
                return event;
              };

              api
                .get('/events/foo')
                .end(done);
            });

            // ETag: hashed-lastmodified+id??
            // Last-Modified
          });

          describe('general behaviour', function () {
            it('should 404 whe given a non-existent event ID', function (done) {
              api
                .expectStatus(404)
                .get('/events/blah')
                .end(done);
            });
          });
        });
      });

      describe('the commands', function () {
        let uid = 'abc123', api, users, pubsub, eventStore, userIndex;

        beforeEach(function () {
          app.getListOfCommands = function (state) {
            return ['foo', 'bar', 'baz'];
          };

          api = new ReqPrimer(request(http.createServer(new AsyncWebApi(app)
            .build()).listen()
          ));
        });

        it.skip('idempotency in commands');

        describe('should describe command', function () {
          let assertCommandIsDescribed = function (cmd, done) {
            api
              .get('/commands')
              .expect(function (res) {
                if (res.body.indexOf(cmd) === -1) {
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
            api
              .expectStatus(405)
              .get('/commands/foo')
              .expect('Allow', 'POST (application/json)')
              .end(done);
          });

          it('should not allow non-JSON POSTs for commands', function (done) {
            api
              .expectStatus(406)
              .post('/commands/foo')
              .expect('Allow', 'POST (application/json)')
              .end(done);
          });

          it('should not receive content from POST for commands', function (done) {
            api
              .expectStatus(204)
              .notJson()
              .noContent()
              .post('/commands/foo')
              .send({id: 'blah', name: 'foo'})
              .set('Content-Type', 'application/json; charset=utf-8')
              .end(done);
          });

          it('should 404 for unknown commands', function (done) {
            api
              .expectStatus(404)
              .post('/commands/nonExistentCommand')
              .send({foo: 'bar'})
              .set('Content-Type', 'application/json; charset=utf-8')
              .end(done);
          });
        });

        it('should allow CORS', function (done) {
          api
            .get('/')
            .expect('Access-Control-Allow-Origin', '*')
            .end(done);
        });

        it('should execute commands', function (done) {
          var data = {
            foo: "bar",
            baz: "qux"
          };

          var executeCommandError;

          app.getListOfCommands = function (state) { return ["foo"]; }
          app.executeCommand = function (cmd, message) {
            if (cmd !== "foo") {
              executeCommandError = "cmd should be 'foo', but is '" + cmd + "'"
              return;
            }

            if (!message) {
              executeCommandError = "no message given: " + message;
              return;
            }

            if (message.foo !== data.foo || message.baz !== data.baz) {
              executeCommandError = "cmd.data should be {foo: 'bar', baz: 'qux'} but is: " + JSON.stringify(message);
              return;
            }
          };

          api
            .expectStatus(204)
            .notJson()
            .noContent()
            .post('/commands/foo')
            .send(data)
            .set('Content-Type', 'application/json; charset=utf-8')
            .expect(function (res) {
              return executeCommandError;
            })
            .end(done);
        });

        it('should error on bad JSON command messages', function (done) {
          app.getListOfCommands = function (state) { return ["foo"]; }

          api
            .expectStatus(406)
            .post('/commands/foo')
            .send('{"foo": blah"')
            .set('Content-Type', 'application/json; charset=utf-8')
            .end(done);
        });

        it('should error on misbehaving app', function (done) {
          app.getListOfCommands = function (state) { return ["foo"]; }
          app.executeCommand = function () {
            throw new Error("misbehaving");
          };

          api
            .expectStatus(500)
            .post('/commands/foo')
            .send('{}')
            .set('Content-Type', 'application/json; charset=utf-8')
            .expect(checkForErr("misbehaving"))
            .end(done);
        });
      });

      describe('with custom strategies', function () {
        var api;

        beforeEach(function () {
          app.getRoutingStrategies = function () {
            return [
              new Router.Strategy(
                  "sync",
                  function (request, state) {
                    return request.url === "/sync";
                  },
                  function (request, response, state) {
                    response
                      .setStatus(202)
                      .setBody({
                        my: "custom data"
                      })
                  }
              ),
              new Router.Strategy(
                  "broken",
                  function (request, state) {
                    return request.url === "/broken";
                  },
                  function (request, response, state) {
                    throw new Error("broken at runtime");
                  }
              ),
              new Router.Strategy(
                  "reflect",
                  function (request, state) {
                    return request.url === "/reflect";
                  },
                  function (request, response, state) {
                    return this.getDataPromise()
                        .then(function (data) {
                          response
                              .setBody(data);
                          ;
                        });
                  }
              ),
              new Router.Strategy(
                  "state",
                  function (request, state) {
                    return request.url === "/state";
                  },
                  function (request, response, state) {
                    response
                        .setBody(state)
                    ;
                  }
              ),
            ];
          };

          api = new ReqPrimer(request(http.createServer(new AsyncWebApi(app)
            .build()).listen()
          ));
        })

        it('should allow syncronous behaviour with a custom strategy', function (done) {
          api
            .expectStatus(202)
            .get('/sync')
            .expect({
              my: "custom data"
            })
            .end(done);
        });

        it('should reflect posted data back', function (done) {
          api
            .post('/reflect')
            .send({
              reflect: "this"
            })
            .expect({
              reflect: "this"
            })
            .end(done);
        });

        it('should error on misbehaving strategy', function (done) {
          api
            .expectStatus(500)
            .get('/broken')
            .expect(checkForErr("broken at runtime"))
            .end(done);
        });

        it('should be able to manipulate the request state and read it back', function (done) {
          app.initRequestState = function (request) {
            return { reqUrl: request.url };
          };

          api
            .get('/state')
            .expect({
              reqUrl: "/state"
            })
            .end(done);
        });

        it('should not allow state to be mutated after init', function (done) {
          app.initRequestState = function (request) {
            return { foo: "bar" };
          }

          app.getFirstEventId = function (state) {
            state.bar = "foo";
          };

          api
            .expectStatus(500)
            .get("/events")
            .expect(checkForErr("Can't add property bar, object is not extensible"))
            .end(done);
        });

        it('should be usable for a multi-user event stream', function (done) {
          var users = {
            foo: {
              events: ['a', 'b', 'c'],
            },
            bar: {},
          };

          app.initRequestState = function (request) {
            return {
              user: users[request.headers["uid"]]
            };
          }

          app.getFirstEventId = function (state) {
            if (state.user.events) {
              return 0;
            }
          };

          api
            .get("/events")
            .set("uid", "foo")
            .expect({
              next: "/events/0"
            })
            .end(done);
        });
      });
    });
  });
});
