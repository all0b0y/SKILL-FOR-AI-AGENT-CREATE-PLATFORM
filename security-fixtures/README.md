# Security fixtures (dev-only)

Literal adversarial inputs used to regression-test the app template's prompt-injection handling. They live **outside** `skills/` on purpose: skill installers such as Hermes scan every file in a skill package and quarantine skills containing injection text, even when it is test data. Keeping the fixtures here lets the shipped skills install cleanly without weakening or hiding the scanner's findings.

This directory is not part of the exported plugin (`scripts/export-package.mjs` only ships `skills/`, `hooks/`, `.claude-plugin/` and a few root documents), and `tests/export-package.test.mjs` asserts that.

## Contents

| Path | Used by |
| --- | --- |
| `prompt-injection.json` | `templates/app/tests/security-fixtures.test.ts` — run-level checks: no tool call, no ticket or fact written, refusal text for read-only profiles |
| `evals/cases/*.yaml` | `templates/app/src/evals/cli.ts` — merged into the eval suite as adversarial cases with deterministic graders |

The app template finds this directory by walking up from its working directory, or uses `AF_SECURITY_FIXTURES`. A configured path that is missing fails loudly. In a generated product there is no such directory, and the product keeps its own adversarial cases in `evals/cases/` as the evals phase instructs.

Do not move these files back into `skills/`, and do not obfuscate their text to get past a scanner.
