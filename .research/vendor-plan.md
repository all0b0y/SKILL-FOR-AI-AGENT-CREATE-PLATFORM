# Vendor plan (draft, 2026-10-01)

Upstream snapshots in `.research/upstream/` (gitignored), shallow clones:

| Repo | Commit | License |
|---|---|---|
| anthropics/skills | 8a1541c | Apache-2.0 per skill (docx/pdf/pptx/xlsx proprietary — excluded) |
| mattpocock/skills | d81f3a1 | MIT |
| obra/superpowers | 8ca22db | MIT |
| pbakaus/impeccable | c74755d | Apache-2.0 (+ NOTICE.md) |
| vercel-labs/agent-skills | 063bee9 | MIT |
| multica-ai/andrej-karpathy-skills | 2c60614 | MIT |

## What goes where

| Phase / area | Upstream source | Use |
|---|---|---|
| grill | mattpocock `grilling` | design tree, frontier, facts-are-mine/decisions-are-yours, done = frontier empty. Adapted to ONE closed question at a time (user preference) |
| grill | mattpocock `to-questionnaire` | one-idea-per-question rule, "why this matters" line |
| build | mattpocock `tdd` + `tests.md` | red→green, seams, vertical slices, anti-patterns (implementation-coupled, tautological, horizontal slicing) |
| build | karpathy-guidelines | Simplicity First, Surgical Changes, Goal-Driven Execution (Think Before Coding already = grill) |
| build | vercel `react-best-practices` (rules/) | selected perf rules (waterfalls, bundle, server components) |
| build | anthropic `mcp-builder` | tool design guidance for MCP-backed tools (check overlap with practices.md) |
| ui | impeccable `craft-floor`, `operate`, `animate`, `audit` | Operate-mode quality floor, motion timing table, reduced-motion rule, audit scoring |
| ui | anthropic `frontend-design`, `webapp-testing` | anti-generic aesthetics; Playwright recon pattern |
| ui | vercel `web-design-guidelines` → vercel-labs/web-interface-guidelines | vendor the rule text (check its license) instead of runtime fetch |
| maintainers (not shipped to runtime) | superpowers `testing-skills-with-subagents`, `verification-before-completion`; mattpocock `writing-for-agents` | pressure-testing method (RED baseline → GREEN → close loopholes), evidence-before-claims |

## Structural findings that change the design

1. **Router reach.** A router can only *hint* at user-invoked skills (mattpocock SKILL-MECHANICS). Phase skills must therefore be model-invoked with narrow descriptions ("Use when /agent-forge routes to phase X"), so the router can fire them and users can resume with `/agent-forge:grill`.
2. **Sequence hiding needs a context boundary.** An inline skill call leaves later steps in context. The router must load only the *current* phase (from `state.json`), and never inline the content of later phases.
3. **Upstream grilling changed** to frontier rounds (many questions per round). We keep one-question-at-a-time for closed questions — user preference, and closed choices stay unambiguous.
4. **Apache-2.0 content** (impeccable, anthropic skills) requires LICENSE copy + NOTICE + "modified" statement; `lint-skills` checks it.
5. impeccable already wires a design-detector hook (`PostToolUse Edit|Write`). We reuse the idea at phase close only (decision 12), not per edit.
