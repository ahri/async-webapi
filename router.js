'use strict';

var chalk = require('chalk');

function Strategy (name, filter, logic) {
  if (!name) {
    throw Error("Supply a name");
  }

  if (!filter || !filter.call) {
    throw Error("Supply a filter function");
  }

  if (!logic || !logic.call) {
    throw Error("Supply a logic function");
  }

  return {
    name: name,
    filter: filter,
    logic: logic,
  };
}

function debugSummary(request, state) {
  return request.url;
}

function Router() {
  var strategies = [];

  return {
    addStrategy: function addStrategy(strategy) {
      for (var i = 0; i < strategies.length; i++) {
        if (strategies[i].name === strategy.name) {
          throw Error("Duplicate strategies exist for name: " + strategy.name);
        }
      }

      strategies.push(strategy);
    },

    execute: function execute(context, request, response, state) {
      var i;

      if (process.env.DEBUG) {
        var space = " ";
        for (i = 0; i < 6 - request.method.length; i++) {
          space += " ";
        }
        console.log(chalk.green(" -> [" + request.method + "]") + space + request.url);
      }

      var accepting = [];

      for (i = 0; i < strategies.length; i++) {
        var strategy = strategies[i];

        if (strategy.filter(request, state)) {
          accepting.push(strategy);
        }
      }

      if (accepting.length === 0) {
        throw Error("No strategies match request " + debugSummary(request));
      }

      if (accepting.length > 1) {
        throw Error("Only one strategy should match, but " +
            accepting.map(function (strategy) { return strategy.name; }).join(", ") +
            " matched " + debugSummary(request, state));
      }

      if (process.env.DEBUG) {
        console.log(chalk.blue(" ~? ") + accepting[0].name);
      }

      return accepting[0].logic.call(context, request, response, state);
    },
  };
}

Router.Strategy = Strategy;

module.exports = Router;
