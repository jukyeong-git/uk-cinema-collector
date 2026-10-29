# Failure-only logging

Routine successful and skipped summaries are quiet. Failed and partial records remain structured and retain safe HTTP status diagnostics. A subsequent complete record for the same country, city, component, operation and provider emits one recovery record with failure count and first failure time. Recovery tracking is bounded and process-local, so a cold start clears it. Planned skips do not signal recovery.

This policy does not change requests, retries, storage, Lambda platform logs, or log subscriptions. Application errors remain visible.
