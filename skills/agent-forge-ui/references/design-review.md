# Design review checklist

One batched pass over the desktop and mobile screenshots in `test-results/screens/`. Every item is a yes/no question; a "no" is fixed before the gate re-runs.

The visual quality floor is Impeccable's, vendored verbatim: apply every check under **Verify** and every default under **Refuse** in [craft-floor](../vendor/impeccable/craft-floor.md), and the Operate-mode rules in [operate](../vendor/impeccable/operate.md).

Agent-specific checks on top of that floor:

- Can a first-time user tell, within one glance, whether the agent is thinking, calling a tool, waiting for approval, done, or failed?
- Does the approval view show exactly what will change (target, values) before the user confirms?
- Is every tool card collapsed by default once finished, with its result summary still visible?
- Does every error message name the problem and the next action (retry, edit, contact)?
- Are cost and step counters visible during a run without competing with the answer?
- Do citations read as links to sources, visually distinct from the agent's own words?
- On mobile, are Approve/Reject and Stop reachable with a thumb (44×44 px targets) without horizontal scroll?
- With reduced motion on, is every state change still visible?
