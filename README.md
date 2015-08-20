# Spoo
> the most delicious food in the galaxy

NodeJS web framework to support CQRS-ES-style applications, with strict error
handling and very few requirements on your application.

_NOT PRODUCTION-READY!_

There are a couple of expections it makes of your application;

1. Commands take a single "message" parameter which will be supplied with the
   POST-body

2. Events, where appropriate, will provide the ID for the next event, and will
   be of the form:
   {
     id: 123,
     message: "arbitrary JS value for your consumption",
     next: 124
   }
