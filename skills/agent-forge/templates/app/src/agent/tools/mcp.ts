/** Operator-configured MCP allowlist. No server or tool is enabled implicitly. */
import { readFileSync } from 'node:fs';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { z } from 'zod';
import { operationId } from '@/lib/operation-id';
import { asUntrusted } from '../guardrails';
import { defineTool, type RegisteredTool } from './define';

const AllowedTool = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    remoteName: z.string().min(1),
    risk: z.enum(['read', 'write', 'destructive']),
    scenario: z.string().trim().min(1),
    description: z.string().trim().min(1),
    idempotencyArgument: z.string().min(1).optional(),
  })
  .refine(
    (tool) => tool.risk === 'read' || Boolean(tool.idempotencyArgument),
    'Write MCP tools require a provider-supported idempotencyArgument',
  );
/** Validate an explicit server/tool allowlist, secure endpoints and provider-supported idempotency arguments for side effects. Header values are resolved from environment variable names, not stored here. */
export const McpConfig = z.object({
  servers: z
    .array(
      z.object({
        url: z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              !url.username &&
              !url.password &&
              (url.protocol === 'https:' ||
                (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
            );
          }, 'MCP requires HTTPS or local HTTP, without URL credentials'),
        headersFromEnv: z.record(z.string(), z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default({}),
        tools: z.array(AllowedTool).min(1),
      }),
    )
    .max(10),
});

type Client = Pick<MCPClient, 'listTools' | 'callTool' | 'close'>;
/** Discover configured servers and wrap only allowlisted remote tools in the shared native contract. Return tools plus a close function the caller must invoke; close opened clients if discovery fails. */
export async function openMcpTools(
  config: z.infer<typeof McpConfig>,
  connect: (config: Parameters<typeof createMCPClient>[0]) => Promise<Client> = createMCPClient,
) {
  const clients: Client[] = [];
  const tools: RegisteredTool[] = [];
  const names = new Set<string>();
  const close = async () => {
    await Promise.all(clients.map((client) => client.close()));
  };
  try {
    for (const server of McpConfig.parse(config).servers) {
      const headers = Object.fromEntries(
        Object.entries(server.headersFromEnv).map(([header, variable]) => {
          const value = process.env[variable];
          if (!value) throw new Error(`Missing MCP header environment variable: ${variable}`);
          return [header, value];
        }),
      );
      const client = await connect({ transport: { type: 'http', url: server.url, headers } });
      clients.push(client);
      const definitions = new Map<string, Awaited<ReturnType<MCPClient['listTools']>>['tools'][number]>();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { params: { cursor } } : undefined);
        for (const tool of page.tools) definitions.set(tool.name, tool);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('MCP pagination cursor repeated');
        if (cursor) cursors.add(cursor);
        if (cursors.size > 100) throw new Error('MCP discovery page limit exceeded');
      } while (cursor);
      for (const allowed of server.tools) {
        if (names.has(allowed.name)) throw new Error(`Duplicate MCP alias: ${allowed.name}`);
        names.add(allowed.name);
        const definition = definitions.get(allowed.remoteName);
        if (!definition) throw new Error(`Allowlisted MCP tool unavailable: ${allowed.name}`);
        tools.push(
          defineTool({
            ...allowed,
            input: z.fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
            timeoutMs: 10_000,
            // External write providers may not implement idempotency: never auto-retry them.
            retries: allowed.risk === 'read' ? 1 : 0,
            execute: async (input, ctx) => {
              const result = await client.callTool({
                name: allowed.remoteName,
                arguments: {
                  ...(input as Record<string, unknown>),
                  ...(allowed.idempotencyArgument
                    ? { [allowed.idempotencyArgument]: operationId(ctx.userId, ctx.runId, ctx.toolCallId) }
                    : {}),
                },
              });
              if (result.isError) throw new Error(`MCP tool ${allowed.name} failed`);
              return asUntrusted(`mcp:${allowed.name}`, JSON.stringify(result));
            },
          }),
        );
      }
    }
    return { tools, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Open the operator-selected AF_MCP_CONFIG file, or an empty allowlist when unset. Invalid files/configuration fail rather than silently enabling or substituting tools. */
export function configuredMcpTools() {
  const file = process.env.AF_MCP_CONFIG;
  return openMcpTools(file ? McpConfig.parse(JSON.parse(readFileSync(file, 'utf8'))) : { servers: [] });
}
