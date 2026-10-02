/** Discover/validate configured tools without executing them or calling any model. */

import { configuredMcpTools } from '../src/agent/tools/mcp';
import { createRegistry } from '../src/agent/tools/registry';
import { db, pool } from '../src/db/client';

const external = await configuredMcpTools();
try {
  const tools = [...createRegistry(db), ...external.tools];
  if (new Set(tools.map((tool) => tool.spec.name)).size !== tools.length)
    throw new Error('Duplicate tool aliases');
  console.table(tools.map(({ spec }) => ({ name: spec.name, risk: spec.risk, scenario: spec.scenario })));
} finally {
  await external.close();
  await pool.end();
}
