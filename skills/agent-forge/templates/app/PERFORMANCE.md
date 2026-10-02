# Performance acceptance

## What is measured

`pnpm bench` measures reciprocal-rank fusion of 20,000 candidates and context-window selection over 10,000 messages. Each path has 10 warmups and 40 samples. `pnpm exec playwright test e2e/performance.spec.ts` measures the cold initial page's external JavaScript, normalized to gzip level 9, and the nearest-rank p95 of 20 first-turn submission-to-render samples per browser project.

Browser latency includes the real local queue, database, mock worker, transport and rendering. It is **not** live-model TTFT, a mobile CPU/network simulation, or proof of retrieval quality. The JavaScript metric includes scripts downloaded during the initial navigation; it is not the production server's actual compressed transfer size.

Checked-in `performance-budgets.json` defines absolute ceilings:

| Metric | Ceiling |
| --- | --- |
| RRF p95 | 100 ms |
| Context-window p95 | 50 ms |
| Initial JavaScript (gzip-9) | 262,144 bytes |
| First rendered text p95 (offline) | 5,000 ms |

Changes to these ceilings require a recorded reason; increasing one solely to hide a regression is not acceptance.

## Baselines

Reports are `.agent-forge/benchmarks.json` and `.agent-forge/ui-performance-{desktop,mobile}.json`. `acceptance.comparison` is `not-checked` when no baseline was supplied. Passing absolute ceilings must not be described as passing a regression comparison.

To propose a baseline, first run the build and UI gates, inspect the reports and their complete sample arrays, then copy them into a **separate** candidate directory. Preserve the generating revision and verification evidence alongside that directory. Do not silently promote the newest report, overwrite an accepted baseline, or select the fastest repeated run. A qualified runner should retain its accepted baseline outside the mutable report paths.

```sh
# Use a reviewed baseline directory for THIS runner, not the report output directory.
AF_BENCH_BASELINE=/path/to/reviewed/hot-paths.json pnpm bench
AF_UI_BASELINE_DIR=/path/to/reviewed pnpm exec playwright test e2e/performance.spec.ts
```

The browser baseline directory must contain `desktop.json` and `mobile.json`. A requested file that is missing, invalid, or aliases its output path fails instead of falling back to absolute-only checking. Symbolic links to the output are also rejected.

Compatibility requires matching report version, workload, metric names and environment fingerprint: OS/release, architecture, Node, CPU description/count and memory; browser reports also include Chromium version, project, reference and transport. Run on an otherwise idle qualified runner. A changed runtime, browser or workload requires a newly reviewed baseline, not a comparison against unrelated measurements.

Any measured metric above its absolute ceiling or **more than 20%** above its compatible baseline fails. Exactly 20% is allowed. The comparison never writes the supplied baseline. Both normal reports and comparison outcomes remain available for review.

CI can enforce regression checks by supplying the two baseline environment variables to its gates. The default portable workflow has no universally comparable baseline and enforces absolute ceilings only; its `not-checked` result is intentional and is not a release certificate. Production provider/network latency needs a separately authorized, representative acceptance run.
