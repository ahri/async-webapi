'use strict';

var chalk = require('chalk');

function Strategy (name, filter, logic) {
  if (!name) {
    throw new Error("Supply a name");
  }

  if (!filter || !filter.call) {
    throw new Error("Supply a filter function");
  }

  if (!logic || !logic.call) {
    throw new Error("Supply a logic function");
  }

  this.name = name;
  this.filter = filter;
  this.logic = logic;

  return Object.freeze(this);
}

function debugSummary(request, state) {
  return request.url;
}

function Router() {
  this._strategies = [];
}

Router.Strategy = Strategy;

Router.prototype.addStrategy = function (strategy) {
  for (var i = 0; i < this._strategies.length; i++) {
    if (this._strategies[i].name === strategy.name) {
      throw new Error("Duplicate strategies exist for name: " + strategy.name);
    }
  }

  this._strategies.push(strategy);
};

Router.prototype.execute = function (context, request, response, state) {
  var i;

  if (process.env.DEBUG) {
    var space = " ";
    for (i = 0; i < 6 - request.method.length; i++) {
      space += " ";
    }
    console.log(chalk.green(" -> [" + request.method + "]") + space + request.url);
  }

  var accepting = [];

  for (i = 0; i < this._strategies.length; i++) {
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
        " matched " + debugSummary(request, state));
  }

  if (process.env.DEBUG) {
    console.log(chalk.blue(" ~?") + " routing to: " + accepting[0].name);
  }

  return accepting[0].logic.call(context, request, response, state);
};

module.exports = Router;
