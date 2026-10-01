# Gap sweep checklist

Read by `af validate-spec`: every `- **id**` below must appear in the `## gap-sweep`
table of `AGENT_SPEC.md` with status `answered` or `na`, plus a non-empty note.
Up to 3 extra rows with ids starting `custom-` cover risks specific to the case.

- **observability** — traces, cost and latency visible to an operator.
- **rate-limits** — upstream API limits, retries with backoff, behaviour when exhausted.
- **concurrency** — two runs touching the same record or customer at once.
- **provider-outage** — model provider down or slow; what the user sees.
- **data-retention** — what is stored, for how long, how a user deletes it; PII.
- **compliance** — legal or contractual constraints on data and actions.
- **runaway-loop** — step, token and cost ceilings; what happens when hit.
- **prompt-versioning** — who changes prompts and how a change is evaluated.
- **rollback** — how a bad release is reverted.
- **accessibility** — keyboard, screen reader, contrast, reduced motion.
- **mobile** — narrow screens and touch.
- **i18n** — languages of users, content and answers.
