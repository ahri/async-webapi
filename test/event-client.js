'use strict';

var expect = require('chai').expect,
    EventClient = require('../event-client');

function DummyServer(responses) {
  var current = 0;

  return {
    http: function http() {
      return {
        get: function (uri, callback) {
          callback.apply(null, responses[current]);

          if (current < responses.length - 1) {
            current++;
          }
        }
      };
    },
  };
}

describe('The Event Client', function () {
  var client, backoff, platform;

  beforeEach(function () {
    backoff = {
      serverErrorIncrease: function (time) { return time + 2; },
      clientErrorIncrease: function (time) { return time + 3; },
      waitingIncrease: function (time) { return 1; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
      waitingCallback: function () {},
    };

    platform = {
      setTimeout: function (f, t) {
        return setTimeout(f, 0);
      },
      console: {
        error: function () {},
      },
    };
  });

  afterEach(function () {
    (function hackUntilIDeleteThisInFavourOfWebsockets() { // TODO
      if (client !== undefined) {
        client.disable();
        return;
      }

      setTimeout(hackUntilIDeleteThisInFavourOfWebsockets, 0);
    })();
  });

  it('should call a transition callback when moving from /events to /events/1', function (done) {
    var dummyServer = DummyServer([
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {type: 'foo', message: "at head"}],
    ]);

    var transition = function (type, message) {
      done();
    };

    client = EventClient('/events', transition, dummyServer.http(), backoff, undefined, platform);
  });

  it('should traverse all events up to the head', function (done) {
    var dummyServer = DummyServer([
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {type: 'foo', message: "foo", next: '/events/2'}],
      [null, '/events/2', 200, {}, {type: 'foo', message: "at head"}],
    ]);

    var calls = 0;
    var transition = function (type, message) {
      if (message === "at head") {
        if (calls++ === 0) {
          done();
        }
      }
    };

    client = EventClient('/events', transition, dummyServer.http(), backoff, undefined, platform);
  });

  it('should poll normally if it receives a 204 - there are no events', function (done) {
    var dummyServer = DummyServer([
      [null, '/events', 204, {}, {}],
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {type: 'foo', message: "at head"}], // NB. transition call happens when we move to here
    ]);

    var transition = function (type, message) { done(); };

    client = EventClient('/events', transition, dummyServer.http(), backoff, undefined, platform);
  });

  describe('under server error conditions', function () {
    it('should do even longer polling', function (done) {
      var calls = 0;
      var http = {
        get: function (uri, callback) {
          if (calls === 0) {
            calls++;
            callback(null, uri, 501, {}, {});
          }
        }
      };

      backoff.serverErrorCallback = function (uri, err, delay) {
        expect(delay).to.equal(2);
        done();
      };

      client = EventClient('/events', function (type, message) {}, http, backoff, undefined, platform);
    });
  });

  describe('under exception conditions', function () {
    it('should do even longer polling', function (done) {
      var calls = 0;
      var http = {
        get: function (uri, callback) {
          if (calls === 0) {
            calls++;
            callback(Error("the world is burning"), null, null, null, null);
          }
        }
      };

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(delay).to.equal(3);
        done();
      };

      client = EventClient('/events', function (type, message) {}, http, backoff, undefined, platform);
    });
  });

  describe('edge cases', function () {
    it.skip('https required should kill off the client', function (done) {
      var dummyServer = DummyServer([
        [Error("https required"), '/events', 403, {}, {}],
      ]);

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(err.message).to.equal("https required");
        done();
      };

      EventClient('/events', function (err, type, message) {}, dummyServer.http(), backoff, undefined, platform);
    });

    it.skip('authentication required should kill off the client', function (done) {
      var dummyServer = DummyServer([
        [Error("unauthorized"), '/events', 401, {}, {}],
      ]);

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(err.message).to.equal("unauthorized");
        done();
      };

      EventClient('/events', function (err, type, message) {}, dummyServer.http(), backoff, undefined, platform);
    });
  });

  describe('persistance', function () {
    it('should pick up where it left off', function (done) {
      var place;
      var repo = {
        transitionedTo: function (uri) {
          place = uri;
        },

        latest: function () {
          return place;
        }
      };

      var dummyServer = DummyServer([
        [null, '/events', 204, {}, {}],
        [null, '/events', 200, {}, {next: '/events/1'}],
        [null, '/events/1', 200, {}, {type: 'foo', message: "at head"}], // NB. transition call happens when we move to here
      ]);

      var transition = function (type, message) {
        client.disable();

        // should do http req for 1 straight away, otherwise fail
        var http = {
          get: function (uri, callback) {
            expect(uri).to.equal("/events/1");
            done();
          },
        };

        expect(place).to.equal('/events/1');

        // should be at 1
        client = EventClient('/events', transition, http, backoff, repo, platform);
      };

      client = EventClient('/events', transition, dummyServer.http(), backoff, repo, platform);
    });
  });
});
