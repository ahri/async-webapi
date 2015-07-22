'use strict';

var chalk = require('chalk');

function Response() {
  var _headers = {},
      _status = 200,
      _body;

  function setHeader(name, value) {
    _headers[name] = value;
    return this;
  }

  return {
    setHeader: setHeader,

    setStatus: function setStatus(status) {
      _status = status;
      return this;
    },

    setBody: function setBody(body) {
      _body = body;
      return this;
    },

    write: function write(response) {
      if (process.env.DEBUG) {
        if (_status >= 500 && _status < 600) {
          console.log(chalk.red(" <- " + (_body && _body.error ? _body.error : _status)));
        } else if (_status >= 400 && _status < 500) {
          console.log(chalk.yellow(" <- " + _status));
        } else if (_status >= 300 && _status < 400) {
          console.log(chalk.gray(" <- " + _status));
        } else if (_status >= 200 && _status < 300) {
          console.log(chalk.cyan(" <- " + _status));
        }
      }

      if (_body) {
        setHeader("Content-Type", "application/json; charset=utf-8");
        setHeader("X-Content-Type-Options", "nosniff");
      }

      response.writeHead(_status, _headers);

      if (_body) {
        response.end(JSON.stringify(_body));
      } else {
        response.end();
      }
    },
  };
}

module.exports = Response;
