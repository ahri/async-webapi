'use strict';

var http = require('http'),
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
  };
}

function ReqPrimer(api) {
  // some defaults
  var _expectJson = true,
      _expectBody = true,
      _secure = true,
      _expectCached = false,
      _expectStatus = 200;

  function _query(func, query) {
    var result = func(query);

    // from client
    result.set('Accept', 'application/json');

    // from proxy
    if (_secure) {
      result.set('X-Forwarded-Proto', 'https');
    }

    // general expectations
    if (_expectJson) {
      result.expect(function (res) {
        if (res.header['content-type'] !== 'application/json; charset=utf-8') {
          return "expected 'Content-Type: application/json; charset=utf-8', got " + res.header['content-type'];
        }
        if (res.header['x-content-type-options'] !== 'nosniff') {
          return "expected 'X-Content-Type-Options: nosniff', got " + res.header['x-content-type-options'];
        }
      });
    } else {
      result.expect(function (res) {
        if (res.header['content-type'] !== undefined) {
          return "Content-Type header should not be present, it was set to " + res.header['content-type'] + ", detail: " + JSON.stringify(res.body);
        }
      });
    }

    if (!_expectBody) {
      result.expect('');
      // result.expect(function (res) {
      //   if (res.body && res.body !== {}) {
      //     return "Empty body expected, but got: " + JSON.stringify(res.body);
      //   }
      // });
    }

    if (_expectCached && !process.env.DEBUG) {
      result.expect('cache-control', 'public, max-age=31536000');
    } else {
      result.expect('cache-control', 'public, max-age=0, no-cache, no-store');
    }

    result.expect(function (res) {
      if (res.status !== _expectStatus) {
        return "expected " + _expectStatus + ", got " + res.status + ", detail: " + JSON.stringify(res.body);
      }
    });

    /*// Error passthrough
    result.expect(function (res) {
      if (res.body.error !== undefined) {
        return res.body.error + ": " res.body.message + "\n" + err.stack;
      }
    });*/

    return result;
  }

  return {
    notJson: function notJson() {
      _expectJson = false;
      return this;
    },

    noContent: function noContent() {
      _expectBody = false;
      return this;
    },

    insecure: function insecure() {
      _secure = false;
      return this;
    },

    expectCached: function expectCached() {
      _expectCached = true;
      return this;
    },

    expectStatus: function expectStatus(status) {
      _expectStatus = status;
      return this;
    },

    get: function get(query) {
      return _query(api.get, query);
    },

    post: function post(query) {
      return _query(api.post, query);
    },

    options: function options(query) {
      return _query(api.options, query);
    },
  };
}

function buildApi(app) {
  return ReqPrimer(request(http.createServer(AsyncWebApi(app)
    .build()).listen()
  ));
}

[1, 0].forEach(function (debug) {
  process.env.DEBUG = debug;

  describe("With DEBUG=" + process.env.DEBUG, function () {
    describe("for an api", function () {
      var app;
      beforeEach(function () {
        app = {
          initRequestState: function (state) {},
          commands: function (state) { return {}; },
          executeCommand: function (state, command, message) {},
          firstEventId: function (state) {},
          eventForId: function (state, id) {},
        };
      });

      describe('the framework', function () {
        var api;

        beforeEach(function () {
          api = buildApi(app);
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
          var interestingEndpoints = ['/', '/services', '/commands', '/events'];
          for (var i = 0; i < interestingEndpoints.length; i++) {
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
        var api;

        beforeEach(function () {
          api = buildApi(app);
        });

        it('should 204 when there are no events but /events is queried', function (done) {
          app.firstEventId = function () { return null; };

          api
            .notJson()
            .expectStatus(204)
            .get('/events')
            .end(done);
        });

        describe('when there are events', function () {
          it('should forward to the earliest event from /events', function (done) {
            var firstEventId = "foo";
            app.firstEventId = function (req) {
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
              var event = {
                type: 'test',
                message: "event message",
                next: 'bar',
              };

              app.eventForId = function (req, eventId) {
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
              var event = {
                type: 'test',
                message: "event message",
                next: 'bar',
              };

              app.eventForId = function (req, eventId) {
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
              var event = {
                type: 'test',
                message: "event message",
              };

              app.eventForId = function (req, eventId) {
                return event;
              };

              api
                .get('/events/foo')
                .expect({
                    type: "test",
                    message: "event message",
                })
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
        var uid = 'abc123', api, users, pubsub, eventStore, userIndex;

        beforeEach(function () {
          app.commands = function (state) {
            return {'foo': "", 'bar': "", 'baz': ""};
          };

          api = buildApi(app);
        });

        it.skip('idempotency in commands');

        describe('should describe command', function () {
          var assertCommandIsDescribed = function (cmd, done) {
            api
              .get('/commands')
              .expect(function (res) {
                if (!(cmd in res.body)) {
                  return cmd + " is not set";
                }
              })
              .end(done);
          };

          var commands = ["foo", "bar", "baz"];

          for (var i = 0; i < commands.length; i++) {
            var cmd = commands[i];
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
              .send({foo:1})
              .expect('Allow', 'POST (application/json)')
              .end(done);
          });

          it('should allow content-less POSTs', function (done) {
            app.executeCommand = function (state, command, message) {
              if (command === "foo" && (typeof message) === "object" && JSON.stringify(message) === "{}") {
                done();
              }
            };

            api
              .expectStatus(204)
              .notJson()
              .noContent()
              .post('/commands/foo')
              .send('')
              .end(function () {});
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

        it('should execute commands', function (done) {
          var data = {
            foo: "bar",
            baz: "qux"
          };

          var executeCommandError;

          app.commands = function (state) { return {"foo": ""}; };
          app.executeCommand = function (state, cmd, message) {
            if (cmd !== "foo") {
              executeCommandError = "cmd should be 'foo', but is '" + cmd + "'";
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
          app.commands = function (state) { return {"foo": ""}; };

          api
            .expectStatus(406)
            .post('/commands/foo')
            .send('{"foo": blah"')
            .set('Content-Type', 'application/json; charset=utf-8')
            .end(done);
        });

        it('should error on misbehaving app', function (done) {
          app.commands = function (state) { return {"foo": ""}; };
          app.executeCommand = function () {
            throw Error("misbehaving");
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
          app.routingStrategies = function () {
            return [
              Router.Strategy(
                  "sync",
                  function (request, state) {
                    return request.url === "/sync";
                  },
                  function (request, response, state) {
                    response
                      .setStatus(202)
                      .setBody({
                        my: "custom data"
                      });
                  }
              ),
              Router.Strategy(
                  "broken",
                  function (request, state) {
                    return request.url === "/broken";
                  },
                  function (request, response, state) {
                    throw Error("broken at runtime");
                  }
              ),
              Router.Strategy(
                  "messing with this",
                  function (request, state) {
                    return request.url === "/messing_with_this";
                  },
                  function (request, response, state) {
                    this.foo = "bar";
                  }
              ),
              Router.Strategy(
                  "reflect",
                  function (request, state) {
                    return request.url === "/reflect";
                  },
                  function (request, response, state) {
                    return this.dataPromise()
                        .then(function (data) {
                          response
                              .setBody(data)
                          ;
                        });
                  }
              ),
              Router.Strategy(
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

          api = buildApi(app);
        });

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

        it('should error on strategy that tries to modify its state via "this"', function (done) {
          api
            .expectStatus(500)
            .get('/messing_with_this')
            .expect(checkForErr("Can't add property foo, object is not extensible"))
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
          };

          app.firstEventId = function (state) {
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
              user: users[request.headers.uid]
            };
          };

          app.firstEventId = function (state) {
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

      describe('with custom config', function () {
        it('should allow the application to specify a custom CORS origin', function (done) {
          app.initRequestState = function () { return { origin: "Custom" }; };
          app.corsOrigin = function (state) { return state.origin; };
          buildApi(app)
            .get("/")
            .expect("Access-Control-Allow-Origin", "Custom")
            .end(done);
        });

        it('should allow the application to specify custom CORS headers', function (done) {
          app.initRequestState = function () { return { header: "Custom" }; };
          app.corsAllowedHeaders = function (state) { return ["X-" + state.header]; };
          buildApi(app)
            .get("/")
            .expect("Access-Control-Allow-Headers", "X-Custom")
            .end(done);
        });

        it('should allow the application to configure the listings at the root', function (done) {
          app.initRequestState = function () { return {root: 1}; };
          app.rootListing = function (state) { return [state.root]; };
          buildApi(app)
            .get("/")
            .expect([1])
            .end(done);
        });
      });

      describe('optional IDs', function () {
        var api;

        beforeEach(function () {
          api = buildApi(app);
        });

        it('should pass along an (optional) client ID sent in headers', function (done) {
          var clientId = 'abc123';

          app.commands = function () { return {'foo': ""}; };
          app.executeCommand = function (state, command, message, passedClientId) {
            if (command === "foo" && passedClientId === clientId) {
              done();
            }
          };

          api
            .expectStatus(204)
            .notJson()
            .noContent()
            .post('/commands/foo')
            .set('X-Client-ID', clientId)
            .set('Content-Type', 'application/json; charset=utf-8')
            .send({})
            .expect('')
            .end(function () {});
        });

        it('should pass along an (optional) command ID sent in headers', function (done) {
          var commandId = 'abc123';

          app.commands = function () { return {'foo': ""}; };
          app.executeCommand = function (state, command, message, passedClientId, passedCommandId) {
            if (command === "foo" && passedCommandId === commandId) {
              done();
            }
          };

          api
            .expectStatus(204)
            .notJson()
            .noContent()
            .post('/commands/foo')
            .set('X-Command-ID', commandId)
            .set('Content-Type', 'application/json; charset=utf-8')
            .send({})
            .expect('')
            .end(function () {});
        });
      });

      describe('CORS', function () {
        var api;

        beforeEach(function () {
          api = buildApi(app);
        });

        it('should default to allow all CORS origins', function (done) {
          api
            .get('/')
            .expect('Access-Control-Allow-Origin', '')
            .end(done);
        });

        it('should default to allow Content-Type header via CORS', function (done) {
          api
            .get('/')
            .expect('Access-Control-Allow-Headers', 'Content-Type')
            .end(done);
        });

        describe('global preflight response', function () {
          ["/", "/commands", "/commands/foo", "/events", "/events/0"].forEach(function (url) {
            it('should be appropriate at ' + url, function (done) {
              api
                .expectStatus(204)
                .noContent()
                .notJson()
                .options(url)
                .set("Access-Control-Request-Method", "GET")
                .set("Access-Control-Request-Headers", "x-apikey")
                .end(done);
            });
          });
        });
      });
    });
  });

});
