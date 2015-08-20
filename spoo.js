'use strict';

var Router = require('./router'),
    Response = require('./response'),
    Q = require('q'),
    chalk = require('chalk');

if (process.env.DEBUG) {
  Q.longStackSupport = true;
}

function dataPromise (request) {
  var deferred = Q.defer();
  if (!request || !request.on) {
    deferred.reject(Error("Pass a request"));
    return deferred.promise;
  }

  var body = "";
  request.on("data", function (chunk) {
    body += chunk.toString();
  });

  request.on("end", function () {
    try {
      var message = Object.freeze(JSON.parse(body));
      deferred.resolve(message);
    } catch (err) {
      deferred.reject(Error("Only 'Content-Type: application/json; charset=utf-8' is accepted. Supplied JSON is invalid" + (process.env.DEBUG ? ": " + err.message + " in: " + body : ".")));
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
      if (process.env.DEBUG >= 2) {
        console.log((err.stack).replace(/^/mg, chalk.red(" !! ")));
      } else {
        console.log(chalk.red(" !! ") + err);
      }

      body.message = err.message;
      body.stack = err.stack.split("\n").slice(1);
    }
  }

  if (process.env.DEBUG >= 2 && detail) {
    console.log(chalk.red(" << ") + detail);
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

  var missing = ["initRequestState", "commands", "executeCommand", "firstEventId", "eventForId"]
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
    throw Error("App is missing methods: " + missing);
  }

  var router = Router();

  router.addStrategy(Router.Strategy(
    "Root",
    function (request, state) {
      return request.method === "GET" && request.url === "/";
    },
    function (request, response, state) {
      response
          .setBody(app.rootListing !== undefined ? app.rootListing(state) : ["/commands", "/events"])
      ;
    }
  ));

  router.addStrategy(Router.Strategy(
    "Event Stream Root - No Events",
    function (request, state) {
      var first = app.firstEventId(state);
      return request.method === "GET" && request.url === "/events" && (first === undefined || first === null);
    },
    function (request, response, state) {
      response
          .setStatus(204)
      ;
    }
  ));

  // TODO: factor-out calls to app.methods() so that they're called only once-per-request
  router.addStrategy(Router.Strategy(
    "Event Stream Root - With Event",
    function (request, state) {
      var first = app.firstEventId(state);
      return request.method === "GET" && request.url === "/events" && (first !== undefined && first !== null);
    },
    function (request, response, state) {
      response
          .setStatus(200)
          .setBody({
            next: "/events/" + app.firstEventId(state)
          })
      ;
    }
  ));

  router.addStrategy(Router.Strategy(
    "Event Specified",
    function (request, state) {
      return request.method === "GET" && request.url.substr(0, 8) === "/events/";
    },
    function (request, response, state) {
      var id = request.url.substr(8),
          ev = app.eventForId(state, id);

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

  router.addStrategy(Router.Strategy(
    "Commands",
    function (request, state) {
      return request.method === "GET" && request.url === "/commands";
    },
    function (request, response, state) {
      response
          .setBody(app.commands(state))
      ;
    }
  ));

  router.addStrategy(Router.Strategy(
    "Invalid Command - non-POST HTTP method",
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

  router.addStrategy(Router.Strategy(
    "Invalid Command - non-JSON POST",
    function (request, state) {
      return request.method === "POST" && request.url.substr(0, 10) === "/commands/" && request.headers["content-length"] > 0 && (request.headers["content-type"] === undefined || request.headers["content-type"].toLowerCase() !== "application/json; charset=utf-8");
    },
    function (request, response, state) {
      response
          .setHeader("Allow", "POST (application/json)")
      ;

      doError(response, 406, "Not Acceptable", "Only 'Content-Type: application/json; charset=utf-8' is accepted, you sent " + request.headers["content-type"]);
    }
  ));

  router.addStrategy(Router.Strategy(
    "Valid Command",
    function (request, state) {
      return request.method === "POST" && request.url.substr(0, 10) === "/commands/" && (!request.headers["content-length"] || (request.headers["content-type"] !== undefined && request.headers["content-type"].toLowerCase() === "application/json; charset=utf-8"));
    },
    function (request, response, state) {
      var command = request.url.substr(10);

      if (!(command in app.commands(state))) {
        doError(response, 404, "Not Found", "The command you're looking for doesn't exist");
        return;
      }

      var exec = function (message) {
        app.executeCommand(state, command, message, request.headers['x-client-id'], request.headers['x-command-id']);

        response
            .setStatus(204)
        ;
      };

      if (!request.headers['content-length']) {
        var message = Object.freeze({});

        exec(message);
        return;
      }

      return this.dataPromise()
          .then(exec);
    }
  ));

  router.addStrategy(Router.Strategy(
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

  var appSuppliedStrategies = app.routingStrategies !== undefined ? app.routingStrategies() : [];
  for (var i = 0; i < appSuppliedStrategies.length; i++) {
    router.addStrategy(appSuppliedStrategies[i]);
  }

  return {
    // TODO: is a build method really needed? consider whether this object-with-hooks method is better than a builder, and pick a way instead of mixing like this
    build: function build() {
      return function (req, res) {
        try {
          var state = Object.freeze(app.initRequestState(req, res) || {});

          var response = Response();
          response
              .setHeader("Cache-Control", "public, max-age=0, no-cache, no-store")
              .setHeader("Access-Control-Allow-Origin", (app.corsOrigin ? app.corsOrigin(state) : ""))
              .setHeader("Access-Control-Allow-Headers", (app.corsAllowedHeaders ? app.corsAllowedHeaders(state) : ["Content-Type"]).join(", "))
          ;

          var strategyContext = Object.freeze({
            dataPromise: function () { return dataPromise(req); },
          });

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
    },
  };
}

module.exports = ApiBuilder;
