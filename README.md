# agent-forge

An interview-first toolkit for building an AI-agent web application—not just an agent prompt. It turns a concrete use case into a specification, a deliberately small architecture, a runnable app, evaluations and a measured interface.

**Status: pre-release.** Three explicit reference profiles are implemented: support, document researcher and scheduled document digest. Offline checks include browser acceptance, record/replay and real container-worker cron delivery. Hermes loading remains blocked by the security scan of adversarial fixtures; live-model quality and final release acceptance remain open. See [release acceptance](RELEASE.md). No published release is claimed here.

## What it provides

- **A short, structured interview:** resources, success criteria, tools, autonomy, data, risks, budget, evaluations, deployment and UI. Each tool must serve a named scenario.
- **Five gated phases:** grill → architect → build → evals → UI. Artifact hashes reopen stale phases when the specification changes.
- **Three runnable references:** support with confirmed writes, a read-only document researcher, and a separately scheduled source-backed digest.
- **Durable execution:** Postgres-backed queue, resumable event streams, cancellation, idempotent delivery, webhooks and opt-in schedules.
- **Explicit integrations:** native tools and allowlisted MCP tools share risk classes, schemas, timeouts and approval policy. OpenTelemetry writes to Postgres and optionally an OTLP collector.
- **Executable checks:** TypeScript, lint, unused-code checks, architecture boundaries, tests, record/replay evaluations, browser accessibility and Lighthouse.

It starts with the least complex design that can meet the specification: a model call, a workflow, one agent, then multiple agents only when evidence justifies them. Authentication is a separate product; the template supplies an identity adapter seam rather than another login system.

## How it works

```text
Your use case → interview → specification → architecture → app → evaluations → UI checks
                                           ↓
                                Next.js API → Postgres queue → worker → approved tools
                                     ↑                 ↓
                                  browser ← resumable events + traces
```

| Layer | Default |
|---|---|
| Application | TypeScript, Next.js App Router, React |
| Agent | Vercel AI SDK, explicit model selection |
| Data | Postgres, Drizzle, pgvector + full-text retrieval |
| Background work | pg-boss, separate worker process |
| Interface | Tailwind, AI Elements patterns, Motion |
| Observability | OpenTelemetry → Postgres; optional OTLP/HTTP |
| Deployment | Docker Compose; loopback-only publication by default |

## Use with Claude Code

Requires Node.js 22+ and a Claude Code version supporting plugins. From a source checkout:

```sh
claude plugin validate --strict .
node scripts/export-package.mjs .agent-forge-tmp/package
claude --plugin-dir "$PWD/.agent-forge-tmp/package"
```

In the session, invoke `/agent-forge:agent-forge`. The router starts or resumes the appropriate phase. It asks before decisions that need your input; phase artifacts remain in the generated project's `.agent-forge/` directory.

The exported directory is also a local marketplace:

```sh
claude plugin marketplace add /absolute/path/to/exported/package
claude plugin install agent-forge@agent-forge-marketplace
```

The exporter refuses to overwrite an existing destination. Choose a new directory for another export. It excludes local environment files, dependencies, generated output and test reports; keep the six skill directories together because phase skills share the core toolkit.

## Use with Hermes or another skills runtime

The six directories use the Agent Skills format, but **Hermes compatibility is currently blocked**: the installed runtime quarantines the core skill after scanning the bundled application's adversarial test fixtures and source. A successful directory listing or explicit CLI invocation does not establish skill loading. The five phase skills load, but the router does not; do not disable the scanner or remove security tests to claim compatibility.

The following is Hermes' documented project-local placement convention in the **target application's git checkout**, not a passing installation acceptance result:

```sh
mkdir -p .agents/skills
cp -R /absolute/path/to/exported/package/skills/agent-forge* .agents/skills/
hermes skills trust .
hermes
```

Invoke the `agent-forge` skill. Project-local skills require project trust. Do not copy a working template's `node_modules` or local configuration—use the clean export above. The package does not assume that `npx skills add` supports a Hermes target.

Claude plugin hooks are not automatically installed in other runtimes. The skills require explicit equivalents: `af check-write`, `af check-command`, typecheck and lint. Here `af` means `node /path/to/agent-forge/scripts/af.mjs`, not a globally installed command.

## Run the reference application

The application template is at [`skills/agent-forge/templates/app`](skills/agent-forge/templates/app). Copy it from a clean export to a new project, configure `.env.local` from its example, and use Node.js 22+ with the pnpm version pinned in its `package.json`.

```sh
pnpm install --frozen-lockfile
docker compose up --build -d
docker compose exec worker pnpm kb:ingest
```

Open `http://127.0.0.1:3000`. Compose applies migrations before starting web and worker. Its bundled database credentials are for loopback development, not a production secret-management setup.

The default `AF_MODEL=mock` is an explicitly scripted, offline support model. The hash embedder is also an offline fixture: neither demonstrates semantic retrieval or real-model quality. Configure and validate production model/embedding choices before using customer data.

- [Operator guide](skills/agent-forge/templates/app/OPERATIONS.md): deployment, schedules, MCP, telemetry and signed identity headers.
- [Verification guide](skills/agent-forge/templates/app/TESTING.md): disposable databases, checks, browser tests and isolated Compose acceptance.
- [Reference architecture](skills/agent-forge/templates/app/ARCHITECTURE.md): boundaries, tools, durability and limitations.
- [Reference profiles](skills/agent-forge/templates/app/REFERENCES.md): capabilities, deliberate omissions and offline acceptance.
- [Semantic retrieval](skills/agent-forge/templates/app/RETRIEVAL.md): consent, model isolation, cost accounting and manual quality checks.

## Safety and privacy

Write and destructive tools require human approval. Cancellation cannot undo an external action already in progress. Remote tools need their own idempotency support; a local receipt cache is not an exactly-once guarantee.

Trace export defaults to metadata, not conversation content. Transcripts remain application data in Postgres and need an operator-defined retention policy. Local identity is single-user and must not be published publicly. A trusted-header adapter requires a proxy that strips caller-supplied identity headers and signs both identity and roles.

Live evaluations, model benchmarking and paid provider calls require explicit consent. Record/replay is the default; passing mock checks is not evidence of real-model quality or security certification. Prompt hooks are guardrails, not an operating-system sandbox.

## Development

From the source checkout:

```sh
node scripts/lint-skills.mjs
node --test tests/*.test.mjs
claude plugin validate --strict .
```

Application checks live in the template's [verification guide](skills/agent-forge/templates/app/TESTING.md). Integration tests require a disposable database and explicit reset consent. `pnpm test:compose` instead creates its own temporary, offline deployment without pruning existing Docker volumes or images.

CI workflows are supplied for this repository and generated applications. They explicitly disable paid providers, use a disposable database and replay only the dev split; holdout checks remain a release operation. Workflow syntax is checked separately from whether a GitHub run has actually happened.

`node scripts/sync-upstream.mjs impeccable` stages the pinned originals and license for manual review without overwriting adapted vendor files. To review another revision, pass `--revision` with its full commit SHA, compare the staged content, preserve attribution, then update the vendor manifest deliberately.

The [release acceptance matrix](RELEASE.md) distinguishes tested implementation from unverified or blocked requirements. Synthetic fixtures do not substitute for approved interview cases, real-model evaluation or plugin pressure tests.

## License

[MIT](LICENSE). Vendored material keeps its own license and attribution alongside the relevant skill.
