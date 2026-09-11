# Packaged service and upgrade trial harness design

Date: 2026-09-11. Applies after the global-prefix package smoke passes.
Status: executable contract for delivery slices 3–5; implementation and real
service evidence remain pending.

## Isolation and invocation

Run the lifecycle harness only as a dedicated disposable Linux user in a fresh
VM or container with a real systemd user manager. It must never target the
developer's installed controller, default data/state directories, npm prefix,
or existing service definition. The runner supplies absolute paths and digests:

```text
node package-lifecycle-trial.mjs
  --candidate <candidate.tgz> --candidate-sha256 <digest>
  --old <old-fixture.tgz> --old-sha256 <digest>
  --prefix <empty user-owned directory>
  --data-dir <empty directory> --state-dir <empty directory>
  --report <absolute JSON path>
```

Before mutation the harness verifies both digests, the dedicated UID, writable
empty prefix/data/state paths, absence of a Worktree Switcher service definition,
no live singleton owner, and free selected ports. A failed preflight performs no
installation. The harness never enables linger, uses sudo, installs operating-
system packages, deletes data, or kills a process based only on port occupancy.

Every child process gets an allowlisted environment and a bounded timeout. Output
is redacted before entering the report. The runner records the candidate and old
package versions, full source SHAs and digests, OS/architecture, Node/npm versions,
native SQLite load, service-manager version, durations, exit status, and whether
cleanup was graceful. The tarballs and pre-upgrade backup are retained outside
the report; credentials, pairing URLs, service-access content and raw logs are not.

## Fixture and phases

The old fixture is a retained, separately checksummed package built from an exact
commit. It is not described as a published release. Its controller registers two
committed Git fixtures, creates environment and test profiles, records a completed
test, retains representative audit/history rows, and establishes a persistent MCP
token. A same-schema old/candidate pair separates path/service replacement from
migration behavior; a second fixture starts at the oldest supported schema.

The harness runs these phases in order and stops at the first unsafe boundary:

1. Install the candidate into a prefix containing spaces. Exercise service
   install, status, restart, open through a fake browser recorder, stop and a
   repeated idempotent install. Confirm the definition points only at the installed
   Node/CLI/dashboard paths. An unavailable user manager must yield a bounded,
   actionable error and leave no definition.
2. Install and populate the same-schema old fixture. Record service arguments and
   controller/test idle state, create a SQLite API backup, stop cleanly, replace
   the package, and refresh with every recorded option. Verify schema integrity,
   fixture records, dashboard assets, MCP identity/token continuity and the actual
   candidate version before accepting the upgrade.
3. Repeat from the migration fixture. Capture schema version and integrity before
   and after exactly one candidate start. Verify all representative records and
   that a new browser token is produced without changing the persistent MCP token.
4. Inject, one at a time, an npm replacement failure, definition-refresh failure,
   controller startup failure, and migration failure. Each injection has a named
   boundary and must prove the failed controller is stopped before recovery. The
   old artifact is run only after the matching pre-upgrade database/configuration
   backup is restored. Preserve a copy of failed state and report that later writes
   would be discarded by restoration.
5. Uninstall the service twice, then remove the package. Confirm no owned process
   or enabled definition survives while database, credentials, configuration and
   logs remain. Reinstall the candidate and confirm the preserved configuration.
6. Connect one real MCP client using private runtime configuration, list the exact
   fixture worktree, claim/start/status/stop/release it, and remove the fixture
   project. Record only tool names and sanitized outcomes.

Occupied dashboard, MCP and project ports; a live singleton; queued/running jobs;
and an old definition pointing into a removed checkout or Node version-manager
path are explicit negative scenarios. They must not stop unrelated processes,
start a second database owner, or silently drop configured service options.

## Report contract and implementation seams

The JSON report has `schemaVersion`, `candidate`, `oldFixture`, `environment`,
`preflight`, ordered `phases`, `faults`, `retainedState`, `cleanup`, and `manualSteps`.
Every phase contains start/end timestamps, command category (never secret arguments),
outcome, bounded diagnostic summary and evidence assertions. Overall success
requires every required phase, zero forced cleanup, a disabled/absent service after
removal, and preservation of the explicitly listed state paths.

Implement the driver with Node built-ins and the installed public CLI. Keep service
manager execution behind an adapter so unit tests can inject failures, but run the
acceptance path against real systemd. Database population and inspection use public
CLI/API/MCP operations plus a narrow read-only SQLite evidence probe; backup uses
the product's SQLite backup API once exposed. Until that API and migration fixture
exist, the upgrade phase must report `blocked`, never substitute a live-file copy or
claim rollback evidence.
