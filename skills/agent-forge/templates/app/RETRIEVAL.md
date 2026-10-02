# Retrieval: offline and semantic providers

`AF_EMBEDDING_MODEL=hash` is a deterministic, local **test baseline**, not a semantic model. Production semantic retrieval is opt-in through OpenAI's embeddings endpoint, with `text-embedding-3-small` or `text-embedding-3-large` and explicitly requested 256-dimensional vectors. No embedding request uses the language-model provider's API key or pricing.

## Explicit activation

Keep API keys in a local secret store / `.env.local`, never source control or a report. Before a paid run, obtain the user's approval and configure:

- `AF_EMBEDDING_MODEL`: one of the supported OpenAI model IDs.
- `OPENAI_API_KEY`: the embedding provider credential.
- `AF_ALLOW_PAID_EMBEDDINGS=1`: separate, explicit spending consent.
- `AF_EMBEDDING_USD_PER_MILLION`: a positive operator-verified current input-token price, in USD per million. There is deliberately no guessed or stale bundled price.
- `AF_EMBEDDING_INGEST_BUDGET_USD`: a finite positive ceiling for one ingestion invocation. Default `0` forbids spending.
- `AF_EMBEDDING_ACCEPT_BUDGET_USD`: a separate ceiling for a manually approved quality-check invocation. Default `0` forbids spending.
- `AF_RETRIEVAL_MAX_DISTANCE`: cosine-distance ceiling, default `0.8`, calibrated on the real corpus before production. This baseline default is not a proven production threshold.

Then run `pnpm db:migrate` and `pnpm kb:ingest` with the selected configuration. Web and worker processes must use the same embedding configuration. Docker Compose passes these settings through `.env.local` to both processes. Ingestion calculates each source's vectors before taking a transaction, then replaces that source atomically; a provider failure does not erase that source. The budget is per invocation, not a lifetime spending cap.

## Compatibility and integrity

Every chunk stores `embedding_profile`, including provider, model and dimensions. Existing rows migrate to `hash-v1:256`. Both vector and full-text candidate queries filter by the active profile, so switching model never compares unrelated vector spaces. Re-ingest **every source** after changing model; old-profile rows are invisible, not an automatic fallback. Similarity thresholds also need recalibration after a model change.

The adapter uses a fixed HTTPS API endpoint, a five-second deadline and no retry. It requires valid response model, exact dimensions, finite nonzero vectors, bounded token usage and one returned vector. HTTP errors do not expose the response body. Empty/oversized inputs are rejected before network work. It has no arbitrary URL option, and does not transmit a user ID, conversation ID or prior transcript.

Before network work, the runtime reserves the maximum embedding input cost against the **same per-run cost limit** used by generation and persists the reservation. Parallel tools cannot oversubscribe the remaining budget. A successful response reconciles that reservation with actual usage. A network, parse or persistence failure retains a conservative reservation because a failed response is not evidence of an unbilled request. Thus displayed run cost can be an upper bound after an embedding failure. Ingestion/check commands use the same reservation logic with their own ceilings.

`AF_ALLOW_PAID_CALLS` governs language-model evals; it does not authorize embeddings. Offline replay rejects semantic embedding configuration rather than making a hidden provider call. Browser/Compose reference gates explicitly force hash mode and disable paid calls.

## What is and is not tested

`tests/embedding-provider.test.ts` uses an injected HTTP transport fixture to test consent, requests, response validation and errors. `tests/embedding-budget.test.ts` checks parallel reservations, reconciliation and uncertain outcomes. `tests/semantic-retrieval.test.ts` uses fixed vectors to check profile isolation, vector-only retrieval and durable runtime cost accounting. Those tests prove software contracts, **not provider availability or semantic relevance**.

After separate spending approval, `pnpm retrieval:accept` exercises synthetic paraphrases and an out-of-scope question against an already semantically ingested corpus. It refuses hash mode and writes `.agent-forge/retrieval-checks.json` with top-source hits, abstention and cost. It must pass without hiding failed cases or changing expectations to fit output. This small smoke is not a substitute for the user's approved retrieval cases, held-out cases or real-model grounded-answer evaluation. No paid semantic quality result is claimed until that command and the actual product evals have run.

Provider API contract: <https://platform.openai.com/docs/api-reference/embeddings/create>.
