'use strict';

var Q = require('q'),
    chalk = require('chalk');

function Strategy (name, filter, logic) {
  if (!name) {
    throw new Error("Supply a name");
  }

  if (!filter || !filter.call) {
    throw new Error("Supply a filter function")
  }

  if (!logic || !logic.call) {
    throw new Error("Supply a logic function")
  }

  this.name = name;
  this.filter = filter;
  this.logic = logic;

  return Object.freeze(this);
}

function debugSummary(request) {
  return request.url;
}

function Router() {
  this._strategies = [];
}

Router.Strategy = Strategy;

Router.getDataPromise = function (request) {
  var deferred = Q.defer();
  if (!request || !request.on) {
    deferred.reject(new Error("Pass a request"));
    return deferred.promise;
  }

  var body = "";
  request.on("data", function (chunk) {
    body += chunk.toString();
  });

  request.on("end", function () {
    try {
      deferred.resolve(JSON.parse(body));
    } catch (err) {
      deferred.reject(new Error("Only 'Content-Type: application/json; charset=utf-8' is accepted. Supplied JSON is invalid" + (process.env.DEBUG ? ": " + err.message : ".")));
    }
  });

  return deferred.promise;
};

Router.prototype.addStrategy = function (strategy) {
  for (var i = 0; i < this._strategies.length; i++) {
    if (this._strategies[i].name === strategy.name) {
      throw new Error("Duplicate strategies exist for name: " + strategy.name)
    }
  }

  this._strategies.push(strategy);
};

Router.prototype.execute = function (request, response, state) {
  if (process.env.DEBUG) {
    var space = " ";
    for (var i = 0; i < 6 - request.method.length; i++) {
      space += " ";
    }
    console.log(chalk.green(" -> [" + request.method + "]") + space + request.url);
  }

  var accepting = [];

  for (var i = 0; i < this._strategies.length; i++) {
    var strategy = this._strategies[i];

    if (strategy.filter(request, state)) {
      accepting.push(strategy);
    }
  }

  if (accepting.length === 0) {
    throw new Error("No strategies match request " + debugSummary(request));
  }

  if (accepting.length > 1) {
    throw new Error("Only one strategy should match, but " +
        accepting.map(function (strategy) { return strategy.name; }).join(", ") +
        " matched " + debugSummary(request));
  }

  if (process.env.DEBUG) {
    console.log(chalk.blue(" ~?") + " routing to: " + accepting[0].name)
  }

  var context = {
    getDataPromise: function () { return Router.getDataPromise(request); },
  };

  return Q.fcall(accepting[0].logic.bind(context), request, response, state);
};

module.exports = Router;
