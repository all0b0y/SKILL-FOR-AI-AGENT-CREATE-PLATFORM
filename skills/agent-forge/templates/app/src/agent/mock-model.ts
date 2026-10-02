/**
 * Scripted offline model for the reference support agent. It makes the tracer bullet, unit
 * tests, e2e tests and the evals gate run with no network and no cost. Behaviour:
 * - injection-looking or empty request → refuses, calls no tool;
 * - a damaged/broken item → asks to create a ticket (needs approval);
 * - otherwise → searches the knowledge base once, then answers citing the first source.
 */
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import type { Reference } from '@/reference';

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

type Message = LanguageModelV4CallOptions['prompt'][number];

function textOf(m: Message | undefined): string {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join(' ');
}

function lastToolOutput(prompt: Message[]): { toolName: string; text: string; denied: boolean } | null {
  const last = prompt.at(-1);
  if (last?.role !== 'tool') return null;
  for (const part of last.content) {
    if (part.type === 'tool-result') {
      const o = part.output;
      if (o.type === 'execution-denied') return { toolName: part.toolName, text: '', denied: true };
      const text = o.type === 'text' || o.type === 'error-text' ? o.value : JSON.stringify(o);
      return { toolName: part.toolName, text, denied: false };
    }
  }
  return null;
}

const INJECTION = /ignore (all|previous)|игнорируй|system prompt|создай \d+ тикет|create \d+ tickets/i;
const BROKEN = /broken|damaged|сломан|разбит|поврежд|брак/i;

/** Decide the next content for a prompt. Pure, so tests can call it directly. */
function scriptedTurn(prompt: Message[], reference: Reference): LanguageModelV4Content[] {
  const tool = lastToolOutput(prompt);
  const lastUser = [...prompt].reverse().find((m) => m.role === 'user');
  const question = textOf(lastUser);
  if (
    prompt.some(
      (message) => message.role === 'system' && textOf(message).startsWith('Compress conversation data'),
    )
  ) {
    // Offline compaction fixture: source excerpts, not a claim of semantic summarization quality.
    const source = question.match(
      /<untrusted_data source="older-messages">\n([\s\S]*?)\n<\/untrusted_data>/,
    )?.[1];
    const rows = source
      ? (JSON.parse(source) as Array<{ id: number; message: { role: string; content: unknown } }>)
      : [];
    const excerpts = rows
      .map(
        (row) =>
          `[message ${row.id}, ${row.message.role}] ${JSON.stringify(row.message.content).slice(0, 200)}`,
      )
      .join('\n');
    return [
      { type: 'text', text: `Offline source excerpts (not a semantic summary):\n${excerpts}`.slice(0, 6000) },
    ];
  }
  if (reference !== 'support') {
    if (!question.trim() || INJECTION.test(question))
      return [
        {
          type: 'text',
          text: 'I only report evidence from the configured sources; I cannot perform that action.',
        },
      ];
    if (tool) {
      const excerpts = [
        ...tool.text.matchAll(
          /<untrusted_data source="kb:([^"]+)">\n#[^\n]*\n([\s\S]*?)\n<\/untrusted_data>/g,
        ),
      ]
        .filter((match) => !INJECTION.test(match[2] ?? ''))
        .map((match) => `${(match[2] ?? '').trim()} [${match[1]}]`);
      return [
        {
          type: 'text',
          text: excerpts.length
            ? `${reference === 'background' ? 'Scheduled evidence digest' : 'Source comparison'}\n${excerpts.join('\n\n')}`
            : 'No reliable sources found for this request. No external action was taken.',
        },
      ];
    }
    return [
      {
        type: 'tool-call',
        toolCallId: `call_${prompt.length}`,
        toolName: 'kb_search',
        input: JSON.stringify({ query: question.slice(0, 200) }),
      },
    ];
  }
  if (tool) {
    if (tool.denied)
      return [
        {
          type: 'text',
          text:
            tool.toolName === 'ticket_create'
              ? 'Understood — I did not create a ticket. Anything else I can help with?'
              : 'Understood — I did not change your saved preferences.',
        },
      ];
    if (tool.toolName === 'ticket_create') {
      return [{ type: 'text', text: 'I created a support ticket; an operator will contact you.' }];
    }
    if (tool.toolName === 'remember' || tool.toolName === 'forget') {
      const output = JSON.parse(tool.text) as { saved?: string; removed?: boolean };
      return [
        {
          type: 'text',
          text: output.saved
            ? 'I saved your preference.'
            : output.removed
              ? 'I removed the saved preference. Past transcripts are unchanged.'
              : 'No saved preference was changed.',
        },
      ];
    }
    const first = tool.text.match(
      /<untrusted_data source="kb:([^"]+)">\n#[^\n]*\n([\s\S]*?)\n<\/untrusted_data>/,
    );
    return [
      {
        type: 'text',
        text: first
          ? `${(first[2] ?? '')
              .trim()
              .split(/(?<=\.)\s/)
              .slice(0, 2)
              .join(' ')} [${first[1]}]`
          : 'I could not find this in our knowledge base. I can create a support ticket if you want.',
      },
    ];
  }
  if (!question.trim() || INJECTION.test(question)) {
    return [{ type: 'text', text: 'I can only help with questions about your orders and our policies.' }];
  }
  const call = (toolName: string, input: object): LanguageModelV4Content => ({
    type: 'tool-call',
    toolCallId: `call_${prompt.length}`,
    toolName,
    input: JSON.stringify(input),
  });
  // Explicit offline fixture commands; real-model understanding is evaluated separately.
  const remember = question.match(/^remember:\s*(.{3,300})$/is);
  if (remember) return [call('remember', { fact: remember[1] })];
  const forget = question.match(/^forget fact ([a-f0-9-]+):\s*(.{3,300})$/is);
  if (forget) return [call('forget', { factId: forget[1], fact: forget[2] })];
  if (BROKEN.test(question)) {
    return [call('ticket_create', { subject: 'Damaged item received', details: question.slice(0, 500) })];
  }
  return [call('kb_search', { query: question.slice(0, 200) })];
}

function generate(options: LanguageModelV4CallOptions, reference: Reference): LanguageModelV4GenerateResult {
  const content = scriptedTurn(options.prompt, reference);
  const toolCall = content.some((c) => c.type === 'tool-call');
  return {
    content,
    finishReason: { unified: toolCall ? 'tool-calls' : 'stop', raw: undefined },
    usage: usage(100, 20),
    warnings: [],
  };
}

function toStream(result: LanguageModelV4GenerateResult): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  result.content.forEach((c, i) => {
    if (c.type === 'text') {
      const id = `t${i}`;
      parts.push({ type: 'text-start', id });
      for (const word of c.text.match(/\S+\s*/g) ?? []) parts.push({ type: 'text-delta', id, delta: word });
      parts.push({ type: 'text-end', id });
    } else if (c.type === 'tool-call') {
      parts.push(c);
    }
  });
  parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason });
  return parts;
}

/** Construct the offline reference model with deterministic scenario logic and optional stream delay. This test double makes no provider call and cannot establish model quality. */
export function mockSupportModel(chunkDelayInMs = 15, reference: Reference = 'support'): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: 'mock',
    supportedUrls: {},
    doGenerate: async (options) => generate(options, reference),
    doStream: async (options) => ({
      stream: simulateReadableStream({ chunks: toStream(generate(options, reference)), chunkDelayInMs }),
    }),
  };
}
