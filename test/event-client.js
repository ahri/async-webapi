'use strict';

var expect = require('chai').expect,
    EventClient = require('../event-client'),
    request = require('supertest');

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
  var client;

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

    client = new EventClient('/events', transition, dummyServer.http(), 0, 0, 0);
  });

  it('should traverse all events up to the head', function (done) {
    var dummyServer = new DummyServer([
      [null, '/events', 302, {location: '/events/1'}, {}],
      [null, '/events/1', 200, {}, {next: '/events/2'}],
      [null, '/events/2', 200, {}, {message: "at head"}],
    ]);

    var calls = 0;
    var transition = function (uri, status, headers, body) {
      if (body.message === "at head") {
        if (calls++ === 0) {
          done();
        }
      }
    };

    client = new EventClient('/events', transition, dummyServer.http(), 0, 0, 0);
  });

  describe('under server error conditions', function () {
    it('should do even longer polling', function (done) {
      var calls = 0;
      var http = {
        get: function (uri, callback) {
          callback(null, uri, 501, {}, {});
          calls++;

          if (calls === 1) {
            done();
          }
        }
      };

      // NB. the short and long poll times will fail the 2s duration test. Bit flakey...
      client = new EventClient('/events', function () {}, http, 5000, 5000, 0);
    });
  });

  describe('under exception conditions', function () {
    it('should do even longer polling', function (done) {
      var calls = 0;
      var http = {
        get: function (uri, callback) {
          callback(new Error("the world is burning"), null, null, null, null);
          calls++;

          if (calls === 1) {
            done();
          }
        }
      };

      // NB. the short and long poll times will fail the 2s duration test. Bit flakey...
      client = new EventClient('/events', function () {}, http, 5000, 5000, 0);
    });
  });
});
