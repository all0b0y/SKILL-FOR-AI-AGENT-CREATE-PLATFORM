---
name: agent-forge-ui
description: Use when /agent-forge routes to the ui phase, or `af status` shows ui open or stale. Applies the agent UX pattern catalog, brand tokens and motion, then proves it with Playwright, axe and Lighthouse.
license: MIT
---

# agent-forge · ui

The interface earns trust by making the agent's work visible and controllable. Mode is **Operate**: the user is in a task; familiarity beats novelty, motion explains state.

`af` = `node "${CLAUDE_SKILL_DIR}/../agent-forge/scripts/af.mjs"`.

## Pattern catalog

Every screen from the spec's `## ui` is assembled from these; each exists in the template under `src/components/agent/`.

| Pattern | Contract |
|---|---|
| Streaming reply | text appears as it streams; citations render as distinct links to their source (UI-01, UI-06) |
| Tool card | one collapsible card per tool call: name, arguments, result summary, status (UI-02) |
| Approval | blocks the run; shows the exact action and a preview of what changes; Approve / Reject with reason; keyboard reachable (UI-03) |
| Run timeline | steps in order with duration and status, from the trace table |
| States | loading (skeleton), empty (teaches the next action), error (names problem + recovery), retry, cancel (UI-04) |
| Cost meter | steps used / max and cost / budget, live (UI-05) |
| Background notice | runs survive navigation; the user is told when one finishes or needs approval (UI-07) |

## Steps

1. **Tokens.** Set colour, radius, type scale and motion tokens in `src/app/globals.css` (`@theme`) from the spec's tone and accent. One sans family; restrained palette with one accent for primary actions and state. Done when no component holds a raw colour value (`pnpm ui:tokens-check`).
2. **Screens.** Compose each spec screen from the catalog; delete template screens the spec does not list. Done when every spec screen has a route and a Playwright scenario in `e2e/`.
3. **Motion.** 100–150 ms feedback, 150–300 ms state changes, 300–500 ms overlays; exits faster than entrances; `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals. Motion conveys state only. Every animation has a `prefers-reduced-motion` path that keeps meaning (opacity/colour) without movement. Done when the reduced-motion Playwright project passes.
4. **Gates.** `pnpm af:ui-gate`: Playwright scenarios on desktop and mobile with screenshots, axe with zero serious/critical violations, Lighthouse performance and accessibility ≥ 90 on the chat route. Done when green.
5. **Design review.** Open the screenshots in `test-results/screens/` and review them against [references/design-review.md](references/design-review.md) in one batched pass; fix everything found in one batch; re-run the gate once. Done when the checklist has no open item.
6. **Close.** `af close ui`. Done when it prints `Closed "ui"`; the app is complete — tell the user how to run it (`docker compose up`).
