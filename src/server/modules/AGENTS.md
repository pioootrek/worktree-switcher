# Application modules

`ControlService` constructs one `ProjectLifecycle` and passes it to runtime,
environments, and verification. Reuse that instance in additional use cases.
`RuntimeService.operateLocked` is the profile-restart port: its caller must
already hold the project lock. Calling the locking `operate` method from a
profile mutation would wait on its own lock.

Pending capacity spans the stop/update/start sequence of an active profile
change. Preserve its `finally` cleanup and the runtime's nested capacity checks.
The finite-job manager still owns queue execution and shutdown.

Import another module through its `index.ts`. Keep helpers private to their
module and test them nearby. See [module development](../../../docs/module-development.md)
for focused commands and the remaining facade responsibilities.
