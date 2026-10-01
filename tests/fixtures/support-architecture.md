# ARCHITECTURE

## rung

Rung: 3
Pattern: -
Why-not-lower: a fixed workflow cannot decide when to search again, answer, or escalate within one conversation.

## tools

| name | source | risk | approval | timeout-ms | retries |
|---|---|---|---|---|---|
| kb_search | native | read | no | 3000 | 2 |
| ticket_create | native | write | yes | 5000 | 1 |
| remember | native | write | yes | 1000 | 0 |

## models

| role | model | why |
|---|---|---|
| main | anthropic/claude-opus-5 | baseline until model-bench |

## memory

| kind | enabled | storage |
|---|---|---|
| working | yes | messages table + compaction |
| knowledge | yes | pgvector + tsvector hybrid |
| facts | yes | facts table via remember tool |

## limits

Max-steps: 8
Max-cost-usd-per-run: 0.05
Failure-threshold: 2

## guardrails

| layer | enabled | mechanism |
|---|---|---|
| structure | yes | untrusted content as data |
| deterministic | yes | masking, zod |
| limits | yes | ceilings |
| classifier | no | spec says off |

## runs

Surfaces: chat
Queue: pg-boss
Idempotency: chat message id as pg-boss singletonKey

## identity

Adapter: trusted-header
