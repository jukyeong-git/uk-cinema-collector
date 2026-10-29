# Structured logging

`run_summary` records use schema version 1 and UTC ISO timestamps. Each carries level, country, city, component, operation, runId, status and durationMs. Status is `complete`, `partial`, `failed`, or `skipped`. Counts are included only when known. Existing phase and error diagnostics remain available. Completed run events are consolidated into `run_summary`; their previous event name is in `diagnostics.originalEvent`.

The logger in `src/logging/contract.ts` is vendored from the shared country logging contract; `scheduler/src/logging/contract.ts` is a second copy for the independently built Worker. Keep both copies aligned with the country repositories. Raw response bodies, HTML, credentials, booking data and personal identifiers must not be passed to logs. Sanitization is defense in depth; callers must select safe diagnostic fields.

The BFI and Science monitor summaries describe the whole invocation, while the scheduler summary describes dispatch only. Receiver acknowledgement and delivery are separate: a deferred notification is `partial`, and a rejected delivery is `failed`. GitHub Actions uses the code on `main`; the scheduler Worker requires its own deployment. Neither deployment is performed by local tests.
