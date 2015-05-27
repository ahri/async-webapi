'use strict';

var Router = require('./router'),
    Response = require('./response'),
    Q = require('q'),
    chalk = require('chalk');

if (process.env.DEBUG) {
  Q.longStackSupport = true;
}

function doError(response, code, name, detail, err) {
  var body = {
    error: code + " - " + name,
  };

  if (process.env.DEBUG) {
    if (detail) {
      body.detail = detail;
    }

    if (err) {
      console.log(chalk.red(" !! ") + err);

      body.message = err.message;
      body.stack = err.stack.split("\n").slice(1);
    }
  }

  response
    .setStatus(code)
    .setBody(body)
  ;
}

function ApiBuilder(app) {
  var CACHE_SETTING = process.env.DEBUG ?
    "public, max-age=0, no-cache, no-store" :
    "public, max-age=31536000";

  function doCache(response) {
    response
        .setHeader("Cache-Control", CACHE_SETTING);
    ;
  }

  var missing = ["initRequestState", "getListOfCommands", "executeCommand", "getFirstEventId", "getEvent"]
    .map(function (method) {
      return [method, app[method] === undefined];
    })
    .filter(function (methodDoesNotExist) {
      return methodDoesNotExist[1];
    })
    .map(function (methodDoesNotExist) {
      return methodDoesNotExist[0];
    })
    .join(", ")
  ;

  if (missing !== "") {
    throw new Error("App is missing methods: " + missing);
  }

  this._app = app;
  this._router = new Router();

  this._router.addStrategy(new Router.Strategy(
    "root",
    function (request, state) {
      return request.url === "/";
    },
    function (request, response, state) {
      response
          .setBody(["/commands", "/events"])
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "event stream - no events",
    function (request, state) {
      var first = app.getFirstEventId(state);
      return request.url === "/events" && (first === undefined || first === null);
    },
    function (request, response, state) {
      response
          .setStatus(204)
      ;
    }
  ));

  // TODO: factor-out calls to app.methods() so that they're called only once-per-request
  this._router.addStrategy(new Router.Strategy(
    "event stream - with event",
    function (request, state) {
      var first = app.getFirstEventId(state);
      return request.url === "/events" && (first !== undefined && first !== null);
    },
    function (request, response, state) {
      response
          .setStatus(200)
          .setBody({
            next: "/events/" + app.getFirstEventId(state)
          })
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "event specified",
    function (request, state) {
      return request.url.substr(0, 8) === "/events/";
    },
    function (request, response, state) {
      var id = request.url.substr(8),
          ev = app.getEvent(state, id);

      if (!ev) {
        doError(response, 404, "Missing", "The item you're looking for doesn't exist");
        return;
      }

      if (ev.next) {
        doCache(response);
      }

      response
          .setBody({
            type: ev.type,
            message: ev.message,
            next: "/events/" + ev.next
          })
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "commands",
    function (request, state) {
      return request.url === "/commands";
    },
    function (request, response, state) {
      response
          .setBody(app.getListOfCommands())
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "commands with non-POST HTTP method",
    function (request, state) {
      return request.url.substr(0, 10) === "/commands/" && request.method !== "POST";
    },
    function (request, response, state) {
      response
          .setHeader("Allow", "POST (application/json)")
      ;

      doError(response, 405, "Method Not Allowed", "Only POST is allowed");
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "commands with non-JSON POSTs",
    function (request, state) {
      return request.url.substr(0, 10) === "/commands/" && request.method === "POST" && request.headers["content-type"] !== "application/json; charset=utf-8";
    },
    function (request, response, state) {
      response
          .setHeader("Allow", "POST (application/json)")
      ;

      doError(response, 406, "Not Acceptable", "Only 'Content-Type: application/json; charset=utf-8' is accepted");
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "commands with JSON POSTs",
    function (request, state) {
      return request.url.substr(0, 10) === "/commands/" && request.method === "POST" && request.headers["content-type"] === "application/json; charset=utf-8";
    },
    function (request, response, state) {
      var command = request.url.substr(10);

      if (app.getListOfCommands().indexOf(command) === -1) {
        doError(response, 404, "Missing", "The item you're looking for doesn't exist");
        return;
      }

      return this.getDataPromise()
          .then(function (message) {
            app.executeCommand(command, message);
            response
                .setStatus(204)
            ;
          });
    }
  ));

  var appSuppliedStrategies = app.getRoutingStrategies !== undefined ? app.getRoutingStrategies() : [];
  for (var i = 0; i < appSuppliedStrategies.length; i++) {
    this._router.addStrategy(appSuppliedStrategies[i]);
  }
}

ApiBuilder.prototype.build = function () {
  var router = this._router;
  var self = this;

  return function (req, res) {
    try {
      var state = self._app.initRequestState(req) || {};
      Object.freeze(state);

      var response = new Response();
      response
          .setHeader("Cache-Control", "public, max-age=0, no-cache, no-store")
          .setHeader("Access-Control-Allow-Origin", "*")
      ;

      router
          .execute(req, response, state)
          .catch(function (err) {
            if (err.message.indexOf("Supplied JSON is invalid") !== -1) {
              doError(response, 406, "Internal Server Error", "JSON Parsing Error", err);
            } else {
              doError(response, 500, "Internal Server Error", "Routing error", err);
            }
          })
          .finally(function () {
            response.write(res);
          })
          .done()
      ;

    } catch (err) {
      if (process.env.DEBUG) {
        console.log((err.stack).replace(/^/mg, chalk.red(" !! ")));
      }

      // NB. this is hard-coded on purpose, in order to avoid errors
      // incurred during refactoring
      var body = {
        error: "500 - Internal Server Error"
      };

      if (process.env.DEBUG) {
        body.message = err.message;
        body.stack = err.stack.split("\n").slice(1);
      }

      res.writeHead(500, {
        "Cache-Control": "public, max-age=0, no-cache, no-store",
        "Content-Type": "application/json; charset=utf-8",
      })

      res.end(JSON.stringify(body));
    }
  };
};

module.exports = ApiBuilder;
