'use strict';
/* jslint esnext: true, noyield: true */

let koa = require('koa'),
    mount = require('koa-mount'),
    logger = require('koa-logger'),
    body = require('koa-parse-json');

function *errHandler(next) {
  try {
    yield *next;
  } catch (ex) {
    this.status = 500;

    try {
      ex.message = JSON.parse(ex.message);
    } catch (p_ex) {
      // ignore exception; message can stay as it was
    }

    this.body = {
      error: "500 - Internal Server Error",
    };

    if (process.env.DEBUG) {
      this.body.message = ex.message;
      this.body.stack = ex.stack.split("\n").slice(1);
    }
  }
}

function *onlyHttps(next) {
  // TODO: normally we wouldn't get forwarded protocol stuff
  /* jslint validthis: true */
  if (this.header['x-forwarded-proto'] !== 'https') {
    this.status = 403;
    this.body = {
      error: "403 - Forbidden",
      detail: "HTTPS must be used with this API.",
    };

    return;
  }

  yield *next;
}

function sendCorsHeaders(allowedHeaderNames) {
  return function *sendCorsHeaders(next) {
    /* jslint validthis: true */
    this.set('Access-Control-Allow-Origin', '*');
    this.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    this.set('Access-Control-Allow-Headers', allowedHeaderNames.join(', '));
    yield *next;
  };
}

function *corsPreflight(next) {
  /* jslint validthis: true */
  if (this.method === 'OPTIONS' && this.header['access-control-request-method'] !== undefined) {
    this.body = "Yup, that's cool.";
    return;
  }

  yield *next;
}

function *notCached(next) {
  /* jslint validthis: true */
  this.set('cache-control', 'public, max-age=0, no-cache, no-store');
  yield *next;
}

function cache(context) {
  context.set('cache-control', 'public, max-age=31536000');
}

function *onlyOutputJson(next) {
  yield *next;

  /* jslint validthis: true */
  if (this.body === undefined) {
    return;
  }

  if (this.type !== 'application/json') {
    throw new Error(JSON.stringify({
      message: "Server tried to output something other than application/json",
      detail: {
        status: this.status,
        type: this.type,
        path: this.path,
        query: this.query,
        body: this.body,
      }
    }));
  }
}

function *requireJsonPost(next) {
  /* jslint validthis: true */
  if (this.request.method !== 'POST') {
    doError(this, 405, "Method Not Allowed", "Only POST is allowed");
    this.set('Allow', 'POST (application/json)');
    return;
  }

  if (this.header['content-type'] !== 'application/json') {
    doError(this, 406, "Not Acceptable", "Only 'Content-Type: application/json' is accepted");
    this.set('Allow', 'POST (application/json)');
    return;
  }

  yield *next;
}

function doError(context, code, name, detail) {
  context.status = code;
  context.body = {
    error: code + " - " + name,
  };

  if (detail) {
    context.body.detail = detail;
  }
}

function do404(context) {
  doError(context, 404, "Missing", "The item you're looking for doesn't exist");
}

function AsyncWebApi(appFacade) {
  if (appFacade === undefined) {
    throw new Error("Provide an appFacade");
  }

  this._appFacade = appFacade;

  this._rootApp = koa();
  this._commandsApp = koa();
  this._eventsApp = koa();

  this._appsCallbacks = [];
  this._apps = [];

  this._corsAllowedHeaderNames = ['Content-Type'];

  this.withApp('commands', this._commandsApp);
  this.withApp('events', this._eventsApp);
}

AsyncWebApi.prototype.withApp = function (name, app) {
  this._apps.push({
    name: name,
    app: app,
  });
};

AsyncWebApi.prototype.withAppsCallback = function (appsCallback) {
  this._appsCallbacks.push(appsCallback);
  return this;
};

AsyncWebApi.prototype.withAllowedCorsHeaders = function (headerNames) {
  this._corsAllowedHeaderNames = this._corsAllowedHeaderNames.concat(headerNames);
  return this;
};

AsyncWebApi.prototype._executeAppsCallbacks = function () {
  for (let i = 0; i < this._appsCallbacks.length; i++) {
    this._appsCallbacks[i](Object.freeze({
      root: this._rootApp,
      commands: this._commandsApp,
      events: this._eventsApp,
    }));
  }
};

AsyncWebApi.prototype._mountAppsAtRoot = function () {
  for (let i = 0; i < this._apps.length; i++) {
    this._rootApp.use(mount('/' + this._apps[i].name, this._apps[i].app));
  }
};

AsyncWebApi.prototype._configureRootIndex = function () {
  this._rootApp.use(function *(next) {
    if (this.path === '/err') {
      throw new Error("test");
    }

    this.body = ['/commands', '/events'];

    yield *next;
  });
};

AsyncWebApi.prototype._configureCommandsForDomain = function () {
  let self = this;

  function commandPassthrough(commandName) {
    let cmd = koa();

    self._commandsApp.use(mount('/' + commandName, cmd));
    cmd.use(body());
    cmd.use(requireJsonPost);
    cmd.use(function *() {
      self._appFacade.executeCommand(this, commandName, this.request.body);
      this.status = 204;
    });
  }

  let commands = this._appFacade.getListOfCommands();

  for (let i = 0; i < commands.length; i++) {
    commandPassthrough(commands[i]);
  }

  this._commandsApp.use(function *() {
    if (this.path !== "/") {
      do404(this);
      return;
    }

    this.body = commands.map(function (command) {
      return '/commands/' + command; }
    );
  });
};

AsyncWebApi.prototype._configureEvents = function () {
  let self = this;

  this._eventsApp.use(function *() {
    const EVENTS_PREFIX='/events';

    if (this.path === "/") {
      let first = self._appFacade.getFirstEventId(this);
      if (first === undefined) {
        this.status = 204;
      } else {
        this.status = 200;
        this.body = {
          next: EVENTS_PREFIX + '/' + first
        };
      }

      return;
    }

    let match = /^\/(.+)/.exec(this.path);

    let ev = self._appFacade.getEvent(this, match[1]);

    if (ev === undefined) {
      do404(this);
      return;
    }

    if (ev.next) {
      if (!process.env.DEBUG) {
        cache(this);
      }
      this.body = {
        type: ev.type,
        message: ev.message,
        next: EVENTS_PREFIX + '/' + ev.next,
      };
    } else {
      this.body = ev;
    }
  });
};

AsyncWebApi.prototype.build = function factory() {
  if (process.env.DEBUG) {
    this._rootApp.use(logger());
  }
  this._rootApp.use(sendCorsHeaders(this._corsAllowedHeaderNames));
  this._rootApp.use(corsPreflight);

  this._rootApp.use(notCached);
  this._rootApp.use(errHandler);
  // this._rootApp.use(onlyOutputJson);
  // this._rootApp.use(onlyHttps);

  this._executeAppsCallbacks();
  this._mountAppsAtRoot();
  this._configureRootIndex();
  this._configureCommandsForDomain();
  this._configureEvents();

  return this._rootApp;
};

AsyncWebApi.do404 = do404;

module.exports = AsyncWebApi;
