---
spec-version: 1
language: <language of the interview, e.g. ru>
---

# AGENT_SPEC

<!--
Single source of truth for what is being built. Written during /agent-forge grill,
in the user's language. Section ids (the first word after `##`) and field keys stay
in English: `validate-spec` reads them. Prose and values may be in any language.
A value of `default: <value>` marks an accepted default instead of a user answer.
-->

## case

<!-- One paragraph: where the agent works, for whom, on a concrete example. -->

## resources

| resource | status | details |
|---|---|---|
| <API / data source / memory / service / budget> | <have \| none> | <what exactly> |

## goal

Metric: <how success is measured>
Target: <numeric target>

## users

Users: <who triggers the agent>
Surfaces: <comma list of: chat, cron, webhook>

## tools

| name | source | risk | scenario |
|---|---|---|---|
| <tool_name> | <native \| mcp:server> | <read \| write \| destructive> | <user scenario that needs it> |

## rejected-tools

| name | reason |
|---|---|

## autonomy

Max-steps: <integer 1-100>
Failure-threshold: <consecutive failures before escalating to a human>

## memory

| kind | enabled | reason |
|---|---|---|
| working | <yes \| no> | <why> |
| knowledge | <yes \| no> | <why> |
| facts | <yes \| no> | <why> |

## risks

Untrusted-sources: <comma list, or none>
Classifier: <off \| on: reason>

## budget

Baseline-model: <strong model id used until model-bench runs>
Max-cost-usd-per-run: <number>
Target-latency-ms: <first-token latency target>

## evals

| id | input | expected |
|---|---|---|
| <case-1> | <real user input> | <observable expected behaviour> |

## deployment

Target: <docker \| vercel>
Identity: <local \| trusted-header>

## ui

Screens: <comma list>
Tone: <brand tone in a few words>
Accent: <one CSS color or default>

## gap-sweep

| item | status | note |
|---|---|---|
