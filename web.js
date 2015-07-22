'use strict';

var AsyncWebApi = require('./async-webapi');

var server = AsyncWebApi().build();

server.listen(1234);
