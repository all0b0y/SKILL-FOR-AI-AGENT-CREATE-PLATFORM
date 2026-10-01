# ARCHITECTURE

<!--
Written during /agent-forge architect, in English. Section ids and keys are read by
`af validate-architecture`; it cross-checks them against AGENT_SPEC.md.
-->

## rung

Rung: <1 single-call | 2 workflow | 3 agent | 4 multi-agent>
Pattern: <for rung 2: chaining | routing | parallelization | evaluator-optimizer; else ->
Why-not-lower: <one sentence: what the rung below cannot do for this case>
Multi-agent-justification: <rung 4 only: parallel breadth | context overflow | tool overload, plus the eval failure that proved it>

## tools

| name | source | risk | approval | timeout-ms | retries |
|---|---|---|---|---|---|
| <same names as AGENT_SPEC tools> | <native \| mcp:server> | <read \| write \| destructive> | <yes \| no> | <int> | <int> |

## models

| role | model | why |
|---|---|---|
| main | <baseline model from spec> | baseline until model-bench |

## memory

| kind | enabled | storage |
|---|---|---|
| working | <yes \| no> | messages table + compaction |
| knowledge | <yes \| no> | pgvector + tsvector hybrid |
| facts | <yes \| no> | facts table via remember tool |

## limits

Max-steps: <same as spec>
Max-cost-usd-per-run: <same as spec>
Failure-threshold: <same as spec>

## guardrails

| layer | enabled | mechanism |
|---|---|---|
| structure | yes | untrusted content wrapped as data; least privilege; approval for write/destructive |
| deterministic | yes | length limits; secret/PII masking; Zod + business-rule argument checks |
| limits | yes | step, token and cost ceilings per run |
| classifier | <yes \| no> | <only when spec risks.Classifier is on> |

## runs

Surfaces: <same as spec>
Queue: pg-boss
Idempotency: <how webhook/cron duplicates are deduplicated>

## identity

Adapter: <local \| trusted-header>
