# Spoo
> Fah! Get that away from me. Spoo needs to age.

NodeJS web framework to support CQRS-ES-style applications, with strict error
handling and very few requirements on your application.

## _NOT PRODUCTION-READY!_

There are a couple of expections it makes of your application;

1. Commands take a single "message" parameter which will be supplied with the
   POST-body

2. Events, where appropriate, will provide the ID for the next event, and will
   be of the form:

    ```json
    {
      "id": 123,
      "message": "arbitrary JS value for your consumption",
      "next": 124
    }
    ```

## Release Notes

- 0.0.3
  - fix bug in command client that was causing duplicate commands to be sent
  - ignore test files in npm package

- 0.0.2
  - remove useless .build() method
  - remove concept of a local app

- 0.0.1 - first release
