'use strict';

var AsyncWebApi = require('./async-webapi');

var server = new AsyncWebApi().build();

server.listen(1234);
