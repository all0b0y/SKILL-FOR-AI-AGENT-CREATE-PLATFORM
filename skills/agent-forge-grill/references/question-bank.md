# Question bank — the ten dimensions

Options are listed with the default recommendation first. Adapt wording to the case and the user's language; keep the options closed. The `→` line is what goes into `AGENT_SPEC.md`.

## goal

- **Metric** — "How will we know the agent works?" A) share of requests resolved without a human ★ B) time saved per task C) accuracy against a reference answer D) other (one line).
- **Target** — "What number counts as success for the metric?" Offer three concrete values from the case.
→ `Metric:`, `Target:`

## users

- **Users** — "Who triggers the agent?" A) end customers B) internal staff C) a system (no human) D) several of these.
- **Surfaces** — "How is it triggered?" A) chat ★ B) on a schedule (cron) C) by a webhook from another system D) combination.
→ `Users:`, `Surfaces:` (comma list of chat, cron, webhook)

## tools

For each capability in the case: "Does the agent need to <capability> for <scenario>?" A) yes, read-only ★ B) yes, it changes data (write) C) yes, irreversible (destructive) D) no — goes to rejected-tools.
Then: "Is this our own code or an existing MCP server?" A) native (we write it) ★ B) MCP server `<name>` (only listed tools are enabled).
Name tools in snake_case; when tools come from more than one service, prefix with the service (`helpdesk_ticket_create`).
→ one row per tool in `## tools`; declined ones in `## rejected-tools`

## autonomy

- **Max-steps** — "How many steps may one run take before it stops and reports?" A) 8 ★ for chat B) 20 for research-style tasks C) 50 for long background jobs.
- **Failure-threshold** — "After how many consecutive tool failures should it hand over to a human?" A) 2 ★ B) 3.
- Approval for write/destructive tools is fixed (always on); ask only whether a *read* tool also needs approval when it touches sensitive data.
→ `Max-steps:`, `Failure-threshold:`

## memory

One question per kind, each A) yes B) no, with the reason:
- **working** — conversation within one session (almost always yes).
- **knowledge** — searchable documents (RAG with citations).
- **facts** — remembered facts about a user/customer across sessions, deletable on request.
→ table rows `working`, `knowledge`, `facts`

## risks

- **Untrusted-sources** — "Which content does the agent read that someone else could write?" (web pages, emails, uploaded files, tickets, third-party tool output). List them, or `none`.
- **Classifier** — "Do you need an extra model check of inputs/outputs (e.g. toxicity in a public chat)?" A) off ★ — structural guardrails cover most cases B) on: <the risk>.
→ `Untrusted-sources:`, `Classifier:`

## budget

- **Baseline-model** — look up the strongest available model for the user's provider and propose it ★; the user confirms.
- **Max-cost-usd-per-run** — "Upper cost limit for one run?" Offer three values from the case's economics.
- **Target-latency-ms** — "How fast must the first words appear?" A) 1500 for chat ★ B) 5000 C) not important (background) → 60000.
→ `Baseline-model:`, `Max-cost-usd-per-run:`, `Target-latency-ms:`

## evals

"Give me a real request the agent will get, and what a correct reaction looks like." Repeat until 5–10 pairs. Prompt for coverage: a typical case, an edge case, a case the agent must refuse or escalate, a case where data is missing.
→ table rows `id | input | expected`

## deployment

- **Target** — A) Docker Compose: app + Postgres + worker, anywhere ★ B) Vercel — only for chat-only agents with short runs.
- **Identity** — "Who is in front of the app?" A) `trusted-header`: an existing login/proxy passes the user id ★ for anything on a network B) `local`: single user on this machine (binds 127.0.0.1).
→ `Target:`, `Identity:`

## ui

- **Screens** — A) chat + approvals + runs (operator console) ★ B) chat only C) runs + approvals only (background agent).
- **Tone** — offer three tone pairs that fit the case (e.g. calm/precise, warm/friendly, bold/energetic).
- **Accent** — A) default ★ B) brand color (hex).
→ `Screens:`, `Tone:`, `Accent:`
