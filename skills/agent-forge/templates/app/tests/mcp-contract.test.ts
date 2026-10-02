import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MCPClient } from '@ai-sdk/mcp';
import { expect, test, vi } from 'vitest';
import type { z } from 'zod';
import { configuredMcpTools, McpConfig, openMcpTools } from '@/agent/tools/mcp';

type Client = Pick<MCPClient, 'listTools' | 'callTool' | 'close'>;
const allowed = {
  name: 'external_lookup',
  remoteName: 'lookup',
  risk: 'read' as const,
  scenario: 'lookup',
  description: 'Approved lookup',
};
const definition = {
  name: 'lookup',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
};
function config(
  tools: z.input<typeof McpConfig>['servers'][number]['tools'] = [allowed],
  headersFromEnv = {},
) {
  return McpConfig.parse({ servers: [{ url: 'https://example.test/mcp', headersFromEnv, tools }] });
}
function client(overrides: Partial<Client> = {}): Client {
  return {
    listTools: async () => ({ tools: [definition] }),
    callTool: async () => ({ content: [{ type: 'text', text: 'fixture' }] }),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}
const ctx = {
  userId: 'u',
  runId: 'r',
  toolCallId: 'c',
  recall: async () => undefined,
  remember: async () => {},
  span: async <T>(_name: string, fn: () => Promise<T>) => fn(),
};

test('discovery fails closed on unavailable aliases, duplicate aliases and hostile pagination', async () => {
  const missing = client({ listTools: async () => ({ tools: [] }) });
  await expect(openMcpTools(config(), async () => missing)).rejects.toThrow(/unavailable/);
  expect(missing.close).toHaveBeenCalledOnce();
  await expect(openMcpTools(config([allowed, allowed]), async () => client())).rejects.toThrow(/Duplicate/);
  await expect(
    openMcpTools(config(), async () =>
      client({ listTools: async () => ({ tools: [], nextCursor: 'same' }) }),
    ),
  ).rejects.toThrow(/repeated/);
  let page = 0;
  await expect(
    openMcpTools(config(), async () =>
      client({ listTools: async () => ({ tools: [], nextCursor: String(++page) }) }),
    ),
  ).rejects.toThrow(/page limit/);
});

test('header references fail if missing and resolve without appearing in the registry', async () => {
  vi.stubEnv('AF_TEST_MCP_HEADER', undefined);
  try {
    await expect(
      openMcpTools(config([allowed], { authorization: 'AF_TEST_MCP_HEADER' }), async () => client()),
    ).rejects.toThrow(/Missing/);
    vi.stubEnv('AF_TEST_MCP_HEADER', 'test-only-header');
    const connect = vi.fn(async () => client());
    const tools = await openMcpTools(config([allowed], { authorization: 'AF_TEST_MCP_HEADER' }), connect);
    expect(connect).toHaveBeenCalledWith({
      transport: {
        type: 'http',
        url: 'https://example.test/mcp',
        headers: { authorization: 'test-only-header' },
      },
    });
    expect(JSON.stringify(tools.tools)).not.toContain('test-only-header');
    await tools.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

test('write adapters forward stable provider idempotency keys and never retry', async () => {
  const calls: unknown[] = [];
  const adapter = client({
    callTool: async (args) => {
      calls.push(args.arguments);
      return { content: [] };
    },
  });
  const registry = await openMcpTools(
    config([{ ...allowed, risk: 'write', idempotencyArgument: 'requestKey' }]),
    async () => adapter,
  );
  const tool = registry.tools[0];
  if (!tool) throw new Error('missing');
  expect(tool.spec.retries).toBe(0);
  await tool.spec.execute({ query: 'x' }, ctx);
  await tool.spec.execute({ query: 'x' }, ctx);
  expect(calls[0]).toEqual(calls[1]);
  await registry.close();
});

test('server error content is not leaked into actionable errors', async () => {
  const registry = await openMcpTools(config(), async () =>
    client({
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'private remote error' }] }),
    }),
  );
  await expect(registry.tools[0]?.spec.execute({}, ctx)).rejects.toThrow('MCP tool external_lookup failed');
  await registry.close();
});

test('operator config file can explicitly disable MCP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-mcp-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, '{"servers":[]}');
  vi.stubEnv('AF_MCP_CONFIG', file);
  try {
    const registry = await configuredMcpTools();
    expect(registry.tools).toEqual([]);
    await registry.close();
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true });
  }
});
