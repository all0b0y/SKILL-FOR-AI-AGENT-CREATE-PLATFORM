/**
 * Record/replay for model calls. A cassette entry is keyed by sha256 of (model id, prompt,
 * tools, settings), so any prompt or tool-description change misses the cassette and the case
 * goes red until it is re-recorded — the eval can never pass on a stale response.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';

/** Replay is offline and fails on a missing recording; record/live may call the configured provider after caller consent checks. */
export type Mode = 'replay' | 'record' | 'live';
type Entry = {
  content: LanguageModelV4GenerateResult['content'];
  finishReason: LanguageModelV4GenerateResult['finishReason'];
  usage: LanguageModelV4GenerateResult['usage'];
};

class CassetteMiss extends Error {
  constructor(readonly key: string) {
    super(`no recording for this model call (key ${key.slice(0, 12)}). Run: pnpm evals:record --case <id>`);
  }
}

const VOLATILE_KEYS = new Set(['approvalId', 'signature']);

/** Stable key: options minus transport-only fields (abort signal, headers) and per-run ids. */
export function callKey(modelId: string, options: LanguageModelV4CallOptions): string {
  const {
    abortSignal: _a,
    headers: _h,
    ...rest
  } = options as LanguageModelV4CallOptions & { abortSignal?: unknown; headers?: unknown };
  // Approval ids and their HMAC signatures are random per run; they must not change the key.
  const stable = JSON.stringify([modelId, rest], (k, v) => (VOLATILE_KEYS.has(k) ? undefined : v));
  return createHash('sha256').update(stable).digest('hex');
}

/** Load keyed model responses from disk and keep new recordings in memory until save. save writes only when dirty; replay never automatically replaces a missing entry. */
export class Cassette {
  private entries: Record<string, Entry>;
  private dirty = false;
  constructor(private readonly path: string) {
    this.entries = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Entry>) : {};
  }
  get(key: string): Entry | undefined {
    return this.entries[key];
  }
  set(key: string, entry: Entry): void {
    this.entries[key] = entry;
    this.dirty = true;
  }
  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.entries, null, 2)}\n`);
  }
}

function toStream(e: Entry): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  e.content.forEach((c, i) => {
    if (c.type === 'text') {
      parts.push(
        { type: 'text-start', id: `t${i}` },
        { type: 'text-delta', id: `t${i}`, delta: c.text },
        { type: 'text-end', id: `t${i}` },
      );
    } else if (c.type === 'tool-call') parts.push(c);
  });
  parts.push({ type: 'finish', usage: e.usage, finishReason: e.finishReason });
  return parts;
}

/**
 * Wrap a model. `replay` answers only from the cassette (throws CassetteMiss); `record` calls
 * the real model and stores the answer; `live` calls the real model without storing.
 */
export function withCassette(model: LanguageModelV4, cassette: Cassette, mode: Mode): LanguageModelV4 {
  const generate = async (options: LanguageModelV4CallOptions): Promise<Entry> => {
    const key = callKey(`${model.provider}/${model.modelId}`, options);
    if (mode === 'replay') {
      const hit = cassette.get(key);
      if (!hit) throw new CassetteMiss(key);
      return hit;
    }
    const r = await model.doGenerate(options);
    const entry: Entry = { content: r.content, finishReason: r.finishReason, usage: r.usage };
    if (mode === 'record') cassette.set(key, entry);
    return entry;
  };
  return {
    specificationVersion: 'v4',
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options) => ({ ...(await generate(options)), warnings: [] }),
    doStream: async (options) => ({
      stream: simulateReadableStream({ chunks: toStream(await generate(options)), chunkDelayInMs: null }),
    }),
  };
}
