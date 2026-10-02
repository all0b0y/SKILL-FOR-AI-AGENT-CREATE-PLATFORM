// Spawned by tests/approval.test.mjs inside a pseudo-terminal: proves the interactive approval path
// writes a signed record when the user types the phase name, and refuses anything else.
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState, markClosed, status, writeState } from '../../skills/agent-forge/scripts/lib/state.mjs';

const root = mkdtempSync(join(tmpdir(), 'af-tty-'));
writeState(root, emptyState());
writeFileSync(join(root, '.agent-forge', 'AGENT_SPEC.md'), readFileSync(process.argv[2], 'utf8'));
try {
  // Real approval path; only the agent-ancestor probe is out of scope here (it is unit-tested).
  markClosed(root, 'grill', new Date(), { approve: undefined, ancestor: () => null });
  console.log(`RESULT ${status(root).phases[0].status}`);
} catch (error) {
  console.log(`RESULT refused: ${error.message.split('.')[0]}`);
}
