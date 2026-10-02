import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { McpConfig, openMcpTools } from '@/agent/tools/mcp';

test('MCP HTTP discovery exposes only allowlisted tools and executes through the shared contract', async () => {
  const called: string[] = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const rpc = JSON.parse(body);
      if (rpc.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      let result: unknown;
      if (rpc.method === 'initialize')
        result = {
          protocolVersion: rpc.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'test', version: '1' },
        };
      else if (rpc.method === 'tools/list')
        result = {
          tools: ['lookup', 'dangerous'].map((name) => ({
            name,
            description: 'untrusted server description',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          })),
        };
      else if (rpc.method === 'tools/call') {
        called.push(rpc.params.name);
        result = { content: [{ type: 'text', text: 'local test result' }] };
      } else result = {};
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing MCP address');
  const registry = await openMcpTools(
    McpConfig.parse({
      servers: [
        {
          url: `http://127.0.0.1:${address.port}/mcp`,
          tools: [
            {
              name: 'research_lookup',
              remoteName: 'lookup',
              risk: 'read',
              scenario: 'look up approved source',
              description: 'Search the approved corpus',
            },
          ],
        },
      ],
    }),
  );
  try {
    expect(registry.tools.map((t) => t.spec.name)).toEqual(['research_lookup']);
    const tool = registry.tools[0];
    if (!tool) throw new Error('Tool missing');
    expect(tool.spec.description).not.toContain('untrusted server description');
    expect(tool.spec.input.safeParse({ query: 1 }).success).toBe(false);
    const built = tool.build({
      userId: 'test',
      runId: 'test',
      recall: async () => undefined,
      remember: async () => {},
      span: (_name, fn) => fn(),
    });
    const result = await built.execute?.({ query: 'source' } as never, {
      toolCallId: 'c1',
      messages: [],
      context: {} as never,
    });
    expect(String(result)).toContain('<untrusted_data');
    expect(called).toEqual(['lookup']);
  } finally {
    await registry.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('MCP defaults to no tools and rejects insecure remote endpoints', async () => {
  const empty = await openMcpTools({ servers: [] });
  expect(empty.tools).toEqual([]);
  await empty.close();
  expect(McpConfig.safeParse({ servers: [{ url: 'http://external.example/mcp', tools: [] }] }).success).toBe(
    false,
  );
});
