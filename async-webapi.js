'use strict';

var Router = require('./router'),
    Response = require('./response'),
    Q = require('q'),
    chalk = require('chalk');

if (process.env.DEBUG) {
  Q.longStackSupport = true;
}

function getDataPromise (request) {
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
        .setHeader("Cache-Control", CACHE_SETTING)
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
    "Root",
    function (request, state) {
      return request.method === "GET" && request.url === "/";
    },
    function (request, response, state) {
      response
          .setBody(app.getRootListing !== undefined ? app.getRootListing(state) : ["/commands", "/events"])
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "Event Stream Root - No Events",
    function (request, state) {
      var first = app.getFirstEventId(state);
      return request.method === "GET" && request.url === "/events" && (first === undefined || first === null);
    },
    function (request, response, state) {
      response
          .setStatus(204)
      ;
    }
  ));

  // TODO: factor-out calls to app.methods() so that they're called only once-per-request
  this._router.addStrategy(new Router.Strategy(
    "Event Stream Root - With Event",
    function (request, state) {
      var first = app.getFirstEventId(state);
      return request.method === "GET" && request.url === "/events" && (first !== undefined && first !== null);
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
    "Event Specified",
    function (request, state) {
      return request.method === "GET" && request.url.substr(0, 8) === "/events/";
    },
    function (request, response, state) {
      var id = request.url.substr(8),
          ev = app.getEvent(state, id);

      if (!ev) {
        doError(response, 404, "Not Found", "The event you're looking for doesn't exist");
        return;
      }

      if (ev.next) {
        doCache(response);
      }

      var out = {
        type: ev.type,
        message: ev.message,
      };

      if (ev.next) {
        out.next = "/events/" + ev.next;
      }

      response
          .setBody(out)
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "Commands",
    function (request, state) {
      return request.method === "GET" && request.url === "/commands";
    },
    function (request, response, state) {
      response
          .setBody(app.getListOfCommands(state))
      ;
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "Invalid Command with non-POST HTTP method",
    function (request, state) {
      return request.url.substr(0, 10) === "/commands/" && request.method !== "POST" && request.method !== "OPTIONS";
    },
    function (request, response, state) {
      response
          .setHeader("Allow", "POST (application/json)")
      ;

      doError(response, 405, "Method Not Allowed", "Only POST is allowed");
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "Invalid Command with non-JSON POST",
    function (request, state) {
      return request.method === "POST" && request.url.substr(0, 10) === "/commands/" && request.headers["content-type"] !== "application/json; charset=utf-8";
    },
    function (request, response, state) {
      response
          .setHeader("Allow", "POST (application/json)")
      ;

      doError(response, 406, "Not Acceptable", "Only 'Content-Type: application/json; charset=utf-8' is accepted");
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "Valid Command",
    function (request, state) {
      return request.method === "POST" && request.url.substr(0, 10) === "/commands/" && request.headers["content-type"] === "application/json; charset=utf-8";
    },
    function (request, response, state) {
      var command = request.url.substr(10);

      if (app.getListOfCommands(state).indexOf(command) === -1) {
        doError(response, 404, "Not Found", "The command you're looking for doesn't exist");
        return;
      }

      return this.getDataPromise()
          .then(function (message) {
            app.executeCommand(state, command, message);
            response
                .setStatus(204)
            ;
          });
    }
  ));

  this._router.addStrategy(new Router.Strategy(
    "CORS Preflight",
    function (request, state) {
      return request.method === "OPTIONS";
    },
    function (request, response, state) {
      response
          .setStatus(204)
      ;
    }
  ));

  var appSuppliedStrategies = app.getRoutingStrategies !== undefined ? app.getRoutingStrategies() : [];
  for (var i = 0; i < appSuppliedStrategies.length; i++) {
    this._router.addStrategy(appSuppliedStrategies[i]);
  }
}

// TODO: is a build method really needed? consider whether this object-with-hooks method is better than a builder, and pick a way instead of mixing like this
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
          .setHeader("Access-Control-Allow-Origin", (self._app.getCorsOrigin ? self._app.getCorsOrigin(state) : "*"))
          .setHeader("Access-Control-Allow-Headers", (self._app.getCorsAllowedHeaders ? self._app.getCorsAllowedHeaders(state) : []).join(", "))
      ;

      var strategyContext = {
        getDataPromise: function () { return getDataPromise(req); },
      };
      Object.freeze(strategyContext);

      Q.fcall(router.execute.bind(router), strategyContext, req, response, state)
          .catch(function (err) {
            if (process.env.DEBUG) {
              console.log("Promise-catch:");
              console.log((err.stack).replace(/^/mg, chalk.red(" !! ")));
            }
            // TODO: managing these states via exceptions is not great, at least use custom exception types?
            if (err.message.indexOf("No strategies match request") === 0) {
              // TODO: this.doError() would be nice
              doError(response, 404, "Not Found");
            } else if (err.message.indexOf("Supplied JSON is invalid") !== -1) {
              doError(response, 406, "Not Acceptable", "JSON Parsing Error", err);
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
        console.log("Framework-catch:");
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
      });

      res.end(JSON.stringify(body));
    }
  };
};

module.exports = ApiBuilder;
