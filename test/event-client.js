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
      timeMs: 1,
      serverErrorIncrease: function (time) { return time * 2; },
      clientErrorIncrease: function (time) { return time * 2; },
      waitingIncrease: function (time) { return 1; },
      serverErrorCallback: function () {},
      clientErrorCallback: function () {},
      waitingCallback: function () {},
    };

    platform = {
      setTimeout: function (f, t) {
        return setTimeout(f, 0);
      },
    };
  });

  afterEach(function () {
    client.disable();
  });

  it('should call a transition callback when moving from /events to /events/1', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 302, {location: '/events/1'}, {}],
      [null, '/events/1', 200, {}, {}],
    ]);

    var transition = function () {
      done();
    };

    client = new EventClient('/events', transition, dummyServer.http(), backoff, platform);
  });

  it('should traverse all events up to the head', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 302, {location: '/events/1'}, {}],
      [null, '/events/1', 200, {}, {next: '/events/2'}],
      [null, '/events/2', 200, {}, {message: "at head"}],
    ]);

    var calls = 0;
    var transition = function (type, message) {
      if (message === "at head") {
        if (calls++ === 0) {
          done();
        }
      }
    };

    client = new EventClient('/events', transition, dummyServer.http(), backoff, platform);
  });

  it('should poll normally if it receives a 400 - there are no events', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 400, {}, {}],
      [null, '/events', 302, {location: '/events/1'}, {}],
      [null, '/events/1', 200, {}, {}], // NB. transition call happens when we move to here
    ]);

    var transition = function () { done(); };

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

      backoff.serverErrorCallback = function () {
        done();
      };

      client = new EventClient('/events', function () {}, http, backoff, platform);
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

      backoff.clientErrorCallback = function () {
        done();
      };

      client = new EventClient('/events', function () {}, http, backoff, platform);
    });
  });
});
