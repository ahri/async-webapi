# Async-WebAPI

NodeJS web interface for CQRS-ES-style applications, with strict error handling
and very few requirements on your application.

_NOT PRODUCTION-READY!_

There are a couple of expections it makes of your application;

1. Commands take a single parameter which will be supplied with the POST-body
   (TODO: consider sanitizing first!)

2. Events, where appropriate, will provide the ID for the next event, and will
   be of the form:
   {
    id: 123,
    message: "arbitrary JS object for your consumption",
    next: 124
   }
