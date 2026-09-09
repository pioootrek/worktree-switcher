# Controller resource acceptance

The final implementation (`8a0d5d0`, including merged PR #20 / `c331a13`)
passes all three full resource measurements. The retained-memory negative
control fails both memory checks as expected. Check, build, integration, UI and
real browser E2E verification pass on this implementation; the memory-budget
rework is complete. The broader owner-workflow feature remains open.

## Measured outcome

All RSS values below are MiB; CPU is a percentage of one logical core.

| Run | Bare Node | Empty | 3 stopped | 3 running | After 30 switches | Growth | Post-cycle CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before 1 | 59.4 | 69.4 | 71.0 | 111.1 | 171.4 | 60.25 | 2.75% |
| Before 2 | 59.3 | 69.1 | 71.0 | 110.2 | 166.7 | 56.47 | 2.23% |
| Before 3 | 59.6 | 69.1 | 71.2 | 111.9 | 169.1 | 57.15 | 1.87% |
| After 1 | 59.4 | 69.1 | 71.1 | 94.1 | 109.8 | 15.75 | 1.32% |
| After 2 | 59.2 | 69.2 | 71.0 | 93.6 | 122.4 | 28.75 | 1.37% |
| After 3 | 59.4 | 69.1 | 70.9 | 93.7 | 109.9 | 16.12 | 1.30% |

The original controller fails the candidate 96 MiB active-overhead and 32 MiB
growth gates in all three runs. Both limits were frozen before the full baseline
and remained unchanged through the final measurement. All final runs pass.
Worst final growth is 28.75 MiB, leaving 3.25 MiB of margin; RSS varies between
runs, so this is a finite-workload acceptance result, not a long-session leak
proof. The other smallest margins are 20.20 MiB for stopped overhead, 32.84 MiB
for active overhead, 0.47 percentage points for stopped CPU, and 3.59 percentage
points for running CPU. Final tails retain exactly 400 lines per project;
resource history has 10 points, below the 60-point bound.

The full before and after runs take 709.5 and 708.4 seconds respectively. Each
final run records 99 observed descendant identities; all controller shutdowns
are graceful and no verified owned live descendant survives. Cleanup is checked
using PID plus process start ticks, never port occupancy alone.

## Why these criteria

Use [the canonical procedure](../../../resource-budget.md) rather than the
historical absolute 50 MiB target. Bare Node itself measures roughly 59 MiB on
this host/runtime. A same-host baseline difference measures incremental cost
without charging the application for the runtime floor. Separate stopped and
active criteria account for the five-second process-group resource sampler.

The initial short calibration had exploratory 64 MiB overhead, 24 MiB growth
and 2% CPU limits; it failed and is retained in `calibration.json`. The current
32/96 MiB overhead, 32 MiB growth and 0.5%/5% CPU criteria were then selected for
full measurement. Stopped overhead is around 12 MiB and running overhead after
fixes reaches 63.16 MiB; the budgets allow variation while still detecting the
original repeated-workload footprint. They were not raised to pass failed full
runs. The 15-second settling and 30-second observation window covers three plus
six normal sampler periods; three fresh controllers provide repeatability.
The earlier 60/120-second proposal remains historical, not a second active gate.

## Changes supported by the investigation

- Linux process scans use eight workers and reuse one 8 KiB buffer per worker
  for stat/status records. Short reads are accumulated; descriptors close on
  every path. Oversized records are skipped like unavailable process samples.
- Disk logs batch already queued lines into writes of up to 64 KiB, except a
  single larger line. This removes per-line promise chains while preserving
  timestamps, line order, rotation boundaries, errors and close/finish flushing.

Bounding concurrency alone (`67f2e63`) failed all three runs, with post-cycle
RSS of 171.5, 159.8 and 166.8 MiB (`concurrency-only.json`). Reusing procfs buffers
(`d4586e8`) improved pre-cycle RSS but still failed the short 30-switch trial
at 91.5/150.0 MiB (`buffer-calibration.json`). These were incomplete fixes.

A separate diagnostic then ran three consecutive 30-switch batches, settling
5 seconds and observing 10 seconds each. RSS was 92.6 MiB before the batches,
then 151.9, 154.6 and 211.4 MiB. Final V8 heap capacity was 145.6 MiB with 32.9 MiB
used, so the result indicates allocation/heap growth rather than proving that
all resident memory remains live (`plateau-diagnostic.json`). Temporarily
replacing only the disk writer with `nullLogWriter`, using shorter 2/5-second
windows, yielded 91.3 MiB then 106.8, 110.3 and 124.0 MiB. This diagnostic
(`no-disk-log-diagnostic.json`) is not production acceptance: normal disk
logging was restored before implementing batching. Temporary diagnostic code
was removed. No forced GC or runtime/host limits were introduced.

With batching and normal logging restored, the short calibration passes at
91.0/107.2 MiB (`batch-calibration.json`), followed by the three passing full
runs above. All exploratory reports remain explicitly noncanonical.

## Reproduction and verification

Run sequentially from the source checkout:

```sh
pnpm check
pnpm build
pnpm bench:resources --report /tmp/switcher-resources-final.json
pnpm bench:resources --runs 1 --negative-control --report /tmp/switcher-resources-negative.json
pnpm test:integration
pnpm test:ui
pnpm test:e2e
```

Environment: Linux x64, Node v24.19.0, pnpm 11.22.0. Raw reports retain kernel,
CPU, load, source revision/fingerprint, bundle/script hashes, sample parameters,
all raw samples, individual checks and cleanup. The final measurement's
`workingTreeDirty` flag reflects draft documentation/evidence; all measured
production sources, benchmark scripts and metric tests were committed at
`8a0d5d0`. PR #20 was incorporated before the final build and measurement.

Passed sequentially: `pnpm check` (239 application tests plus 3 metric tests),
`pnpm build`, the three-run canonical resource gate, `pnpm test:integration`
(11 tests, 70.7 seconds), `pnpm test:ui` (5 tests, 15.9 seconds) and
`pnpm test:e2e` (2 real-controller browser tests, 7.5 seconds). The expected
negative-control failure was separately verified before integration/browser
runs. Documentation formatting/validation and `git diff --check` also pass.
The negative run takes 236.3 seconds and uses the same bundle hash. Touching and
retaining 128 MiB raises final RSS to 250.0 MiB: active overhead is 190.72 MiB
against 96 MiB, and post-cycle growth is 156.15 MiB against 32 MiB. The process
returns exit code 1 for those two checks, with graceful cleanup and no fixture
error (`negative-control.json`). The resource-worker
regression test fails against the original sampler with 120 concurrent reads
(`regression-before.txt`). The log regression fails against the original writer
with 2,001 disk writes instead of fewer than 10 (`log-batch-regression-before.txt`).
The fixed test retains all 2,001 ordered lines, including a line enqueued during
an active write. Existing rotation/failure/close tests also pass.

## Scope of the evidence

The HTTP and MCP listeners are enabled, but no browser/SSE or MCP client is
connected during measurement. The controller, real SQLite, three Git repositories,
six worktrees and owned Node processes are isolated fixtures. Driver, browser
and managed-server resources are excluded. Each full run uses 30 switches and
60,000 log lines of 129 bytes, with 15-second settling and 30-second sampling
per phase. Peaks cover those observation windows, not instantaneous burst peaks.

Runtime log tails and resource history have fixed bounds. Disk batching does
not add a byte cap or backpressure for a producer that continuously outruns the
disk; a sustained slow-sink stress test and overflow policy remain separate
work. This gate does not claim that case or indefinite memory stability.

No installed controller, development server, systemd limit, swap policy, guard
or watchdog was changed. The owner's real workflow remains separate evidence
under `FEAT-20260829-multi-project-worktree-switching`; that item stays open.
