# UI review — offline reference

## Scope and verdict

Reviewed the shipped support chat, approval, recovery navigation and trace detail using the Impeccable audit/craft-floor workflow. This is a functional agent workspace, not a marketing page: the dominant content is the answer/approval payload, and the composer is the persistent primary action. The restrained, shared light/dark tokens are an intentional template baseline. A generated product still needs its own approved brand/content decisions.

**Assessment: 8/10 for offline template readiness, not production or WCAG certification.** No unresolved stop-ship issue was observed in the reviewed states after the fixes below. Physical-device, screen-reader and real provider/content acceptance remain separate. Automated results are not substituted for those checks.

## Findings and disposition

| Finding | Severity | Evidence and correction |
| --- | --- | --- |
| An uncertain delivery could be located in Runs but its exact conversation could not be reopened | High | Red browser test for the missing recovery link; owned `runDetail` now supplies status and an Open conversation link; the test restores the exact single saved turn |
| Narrow 320px layout failed at 200% text size | High | Send became obstructed; a later geometry assertion measured 338px document width. Wrapping navigation/usage rows, a shrinkable composer input and wrapped message text now retain a 320px document width |
| A long unbroken approval payload forced the page to 6,611px wide | High | Red geometry regression; single-column narrow approval details and a `minmax(0,1fr)` wide-layout value column preserve the exact payload without clipping it |
| Controls fell below the project's 44px touch floor | Medium | Measured navigation 32px, tool disclosure 36px and approval note 38px. Minimum heights were corrected; browser assertions cover those controls |
| Trace rows followed insertion/completion order, producing negative `+-…ms` offsets | Medium | Observed in the actual mobile screenshot and reproduced by a red browser assertion. The owned trace query now orders by start time plus stable ID; individual span status also has a screen-reader label |

All listed changes had a failing regression before their implementation and a passing affected browser run afterward. The style changes preserve the existing palette, typography, radius and spacing vocabulary rather than introduce a new design system.

## Review coverage

- **Accessibility:** semantic main/navigation, explicit message/note labels, keyboard approval flow, visible action hierarchy, text status alongside decorative markers, axe scans of empty chat, restored trace, long text and pending approval. This does not substitute for a manual screen-reader session.
- **Responsive behavior:** desktop/mobile projects, explicit 320px width with 200% root text, a 4,000-character unbroken user message and a long approval payload. No horizontal overflow in those regression cases. Text-size testing is not a claim about every browser's full-page zoom behavior.
- **Theming:** actual light desktop and dark mobile empty states visually inspected; source uses semantic color tokens and system color-scheme selection. Decorative status pulse respects reduced motion; approval motion uses the reduced-motion hook.
- **Visual hierarchy:** approval action and exact payload are grouped, Approve is primary and Reject is secondary; ordinary messages do not compete with controls. The initial state supplies concrete policy-question suggestions. Trace detail separates run identity/status, recovery and time/cost rows.
- **Recovery/content:** lost POST, approval and stop acknowledgements plus SSE reconnect have real-server/mock-worker regressions in `e2e/network.spec.ts`. Uncertain submission is explicitly described as in-memory only; reload recovery uses Runs and owned server history, not a false promise of browser persistence.
- **Performance:** `e2e/performance.spec.ts` enforces initial JavaScript and offline submission-to-render ceilings; `PERFORMANCE.md` documents comparable-baseline checks and their limits. Real-model TTFT is not measured by these tests.
- **Anti-pattern scan:** the installed Impeccable source detector returned an empty issue array. That was only a lint signal: the runtime problems above were found through actual geometry, screenshots and interaction, not dismissed because the detector was green.

## Evidence and reproduction

```sh
pnpm build
pnpm exec playwright test e2e/ui-audit.spec.ts
pnpm exec playwright test e2e/chat.spec.ts e2e/lifecycle.spec.ts e2e/network.spec.ts
```

The audit suite has 12 desktop/mobile checks. Its durable local screenshots are `.agent-forge/ui-review/{desktop,mobile}/{empty-light,empty-dark,approval,long-text,run-detail}.png`; they survive subsequent Playwright suites. Actual images inspected include the empty light/dark states, mobile approval, mobile run detail and the visible viewport of long text at 200%. Screenshots of long content show the viewport, not a claim that all offscreen content was visually inspected. Failed-run traces remain in Playwright's normal `test-results` until the next run.

The full offline UI gate before the final trace-order fix passed 34 browser checks and three Lighthouse runs at performance 99, accessibility 100, best practices 96 and SEO 100. Later focused checks passed the added approval-note and trace-order regressions. Use the latest gate logs for final-tree totals; these measurements are local Chromium results, not universal performance guarantees.
