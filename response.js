'use strict';

var chalk = require('chalk');

function Response() {
  this._headers = {};
  this._status = 200;
}

Response.prototype.setHeader = function (name, value) {
  this._headers[name] = value;
  return this;
};

Response.prototype.setStatus = function (status) {
  this._status = status;
  return this;
};

Response.prototype.setBody = function (body) {
  this._body = body;
  return this;
};

Response.prototype.write = function (response) {
  if (process.env.DEBUG) {
    if (this._status >= 500 && this._status < 600) {
      console.log(chalk.red(" <- " + (this._body && this._body.error ? this._body.error : this._status)));
    } else if (this._status >= 400 && this._status < 500) {
      console.log(chalk.yellow(" <- " + this._status));
    } else if (this._status >= 300 && this._status < 400) {
      console.log(chalk.gray(" <- " + this._status));
    } else if (this._status >= 200 && this._status < 300) {
      console.log(chalk.cyan(" <- " + this._status));
    }
  }

  if (this._body) {
    this.setHeader("Content-Type", "application/json; charset=utf-8");
  }

  response.writeHead(this._status, this._headers);

  if (this._body) {
    response.end(JSON.stringify(this._body));
  } else {
    response.end();
  }
};

module.exports = Response;
