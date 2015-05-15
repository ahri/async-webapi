'use strict';

var expect = require('chai').expect,
    EventClient = require('../event-client');

function DummyServer(responses)
{
  this._responses = responses;
  this._current = 0;
}

DummyServer.prototype.http = function () {
  var self = this;

  return {
    get: function (uri, callback) {
      callback.apply(null, self._responses[self._current]);

      if (self._current < self._responses.length - 1) {
        self._current++;
      }
    }
  };
};

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
    client.disable();
  });

  it('should call a transition callback when moving from /events to /events/1', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {message: "at head"}],
    ]);

    var transition = function (err, type, message) {
      done();
    };

    client = new EventClient('/events', transition, dummyServer.http(), backoff, platform);
  });

  it('should traverse all events up to the head', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {message: "foo", next: '/events/2'}],
      [null, '/events/2', 200, {}, {message: "at head"}],
    ]);

    var calls = 0;
    var transition = function (err, type, message) {
      if (message === "at head") {
        if (calls++ === 0) {
          done();
        }
      }
    };

    client = new EventClient('/events', transition, dummyServer.http(), backoff, platform);
  });

  it('should poll normally if it receives a 204 - there are no events', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 204, {}, {}],
      [null, '/events', 200, {}, {next: '/events/1'}],
      [null, '/events/1', 200, {}, {message: "at head"}], // NB. transition call happens when we move to here
    ]);

    var transition = function (err, type, message) { done(); };

    client = new EventClient('/events', transition, dummyServer.http(), backoff, platform);
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

      client = new EventClient('/events', function (err, type, message) {}, http, backoff, platform);
    });
  });

  describe('under exception conditions', function () {
    it('should do even longer polling', function (done) {
      var calls = 0;
      var http = {
        get: function (uri, callback) {
          if (calls === 0) {
            calls++;
            callback(new Error("the world is burning"), null, null, null, null);
          }
        }
      };

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(delay).to.equal(3);
        done();
      };

      client = new EventClient('/events', function (err, type, message) {}, http, backoff, platform);
    });
  });

  describe('edge cases', function () {
    it.skip('https required should kill off the client', function (done) {
      var dummyServer = new DummyServer([
        [new Error("https required"), '/events', 403, {}, {}],
      ]);

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(err.message).to.equal("https required");
        done();
      };

      new EventClient('/events', function (err, type, message) {}, dummyServer.http(), backoff, platform);
    });

    it.skip('authentication required should kill off the client', function (done) {
      var dummyServer = new DummyServer([
        [new Error("unauthorized"), '/events', 401, {}, {}],
      ]);

      backoff.clientErrorCallback = function (uri, err, delay) {
        expect(err.message).to.equal("unauthorized");
        done();
      };

      new EventClient('/events', function (err, type, message) {}, dummyServer.http(), backoff, platform);
    });
  });
});
