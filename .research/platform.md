# Claude Code plugin / skill / hook / marketplace formats — precise reference for `agent-forge`

Scope: what `agent-forge` (a Claude Code plugin with a user-invoked router
skill `/agent-forge`, phase skills `grill`/`architect`/`build`/`evals`/`ui`,
scripts, and 5 hooks — `phase-gate`, `typecheck-lint`, `secret-guard`,
`paid-call-guard`, `destructive-guard` — also installable via `npx skills
add` and runnable under Hermes, where hooks don't fire) can rely on.

Compiled by fetching the raw `.md` form of each doc page directly
(`https://code.claude.com/docs/en/<page>.md`, which bypasses the JS app
shell and returns the full page as markdown — `https://code.claude.com/docs/llms.txt`
is the index of every page and its `.md` URL), plus the Agent Skills spec,
the `npx skills` CLI README, and local example repos. The `claude` CLI
v2.1.281 is installed locally; `claude plugin validate` was actually run
against a scratch plugin (see §5) — not just read about.

Doc URLs (canonical `code.claude.com`; `docs.anthropic.com/en/docs/claude-code/...`
and `docs.claude.com` mirror the same content):
- Plugins overview: https://code.claude.com/docs/en/plugins/overview
- Create a plugin: https://code.claude.com/docs/en/plugins/create
- Add components to a plugin: https://code.claude.com/docs/en/plugins/components
- Plugin manifest reference: https://code.claude.com/docs/en/plugins/manifest-reference
- Marketplace reference: https://code.claude.com/docs/en/plugins/marketplace-reference
- Create a marketplace: https://code.claude.com/docs/en/plugins/create-marketplace
- Plugin commands reference (CLI): https://code.claude.com/docs/en/plugins/cli-reference
- Plugin loading reference: https://code.claude.com/docs/en/plugins/loading
- Extend Claude with skills: https://code.claude.com/docs/en/skills
- Hooks reference: https://code.claude.com/docs/en/hooks
- Hooks guide (quickstart): https://code.claude.com/docs/en/hooks-guide
- Settings reference: https://code.claude.com/docs/en/settings-reference
- Subagents: https://code.claude.com/docs/en/sub-agents
- Agent Skills open standard: https://agentskills.io/specification
- `npx skills` CLI: https://github.com/vercel-labs/skills (README; forks
  `antfu/skills-cli` and `natemoo-re/skills` track the same behavior)

Local examples inspected under `.research/upstream/`: `anthropics_skills`
(has `spec/` pointer to agentskills.io + `template/SKILL.md`),
`mattpocock_skills` (`.claude-plugin/plugin.json` + `marketplace.json`),
`obra_superpowers` (`hooks/hooks.json`, multi-runtime `.claude-plugin`/
`.cursor-plugin`/`.codex-plugin`/etc.), `pbakaus_impeccable/plugin`
(`hooks/hooks.json` with `SessionStart`/`PostToolUse`/`Stop`),
`multica-ai_andrej-karpathy-skills`, `vercel-labs_agent-skills/skills.sh.json`.

Verified locally: `claude --version` → `2.1.281 (Claude Code)`;
`claude plugin validate ./test-plugin` and `--strict --json` both ran
successfully against a scratch plugin (manifest + one `skills/hello/SKILL.md`)
built from the docs' own quickstart example.

---

## 1. Plugin directory layout, `plugin.json`, discovery, env vars

### 1.1 Directory layout

A plugin is a self-contained directory. The only "manifest" file, if you
want metadata at all, is `.claude-plugin/plugin.json`; without it Claude
Code still loads whatever it finds in the **standard layout**, naming the
plugin from the marketplace entry or the `--plugin-dir` directory name.
Everything else lives at the plugin root, never inside `.claude-plugin/`.

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # optional manifest (metadata, userConfig, overrides)
├── skills/                  # one <name>/SKILL.md per skill (preferred; default scan)
│   └── review/SKILL.md
├── commands/                 # flat .md command files (legacy format; skills/ preferred for new plugins)
├── agents/                   # subagent .md files (frontmatter = name/description/model/...; body = system prompt)
├── hooks/
│   └── hooks.json            # plugin hook config, optional top-level "description" field
├── scripts/                  # convention only — referenced by path, not auto-discovered
├── output-styles/
├── themes/
├── workflows/                 # dynamic-workflow .js files
├── bin/                       # put on PATH while the plugin is enabled
├── .mcp.json                  # MCP servers
├── .lsp.json                  # LSP servers
└── settings.json              # only `agent` and `subagentStatusLine` keys take effect; rest dropped
```

Nuance for a single-skill plugin root: *"If a plugin has no `skills/`
directory and no `skills` manifest field, a `SKILL.md` at the plugin root
is loaded as a single skill. Set the frontmatter `name` field to control the
skill's invocation name. Without it, Claude Code falls back to the install
directory name, which for marketplace-installed plugins is a version string
that changes on every update."* (plugins-reference / plugins/components).
agent-forge ships a router skill *and* several phase skills, so put all of
them under `skills/` (including the router) rather than relying on this
plugin-root fallback for any of them.

Claude Code does **not** load a `CLAUDE.md` at the plugin root as project
context, and `claude plugin validate` actively warns `CLAUDE.md at the
plugin root is not loaded as project context`. Standing instructions must
be a skill, never a root CLAUDE.md.

### 1.2 `plugin.json` fields

Only `name` is required. Full field table (manifest-reference):

| Field | Type | Notes |
|---|---|---|
| `$schema` | string | editor-only, ignored at load |
| `name` | string | **required**. kebab-case, no spaces/`@`/`:`/path separators/control or bidi chars. Every component is namespaced under it (`agent-forge:grill`) |
| `displayName` | string | UI label shown instead of `name` |
| `version` | string | not semver-checked; setting it pins users to that version until you bump it. A `command`-source plugin, or one from a claude.ai-hosted marketplace, isn't pinned by this field |
| `description` | string | shown in `/plugin` |
| `author` | object | `{name (required), email?, url?}` |
| `homepage` | string | must parse as a URL or the plugin **fails to load** |
| `repository` | string | not validated |
| `license` | string | SPDX id, e.g. `MIT` |
| `keywords` | string[] | discovery tags |
| `metadata` | object | free-form, Claude Code ignores it (requires v2.1.222+) |
| `defaultEnabled` | boolean | default `true`; a plugin another enabled plugin depends on starts enabled regardless |
| `dependencies` | string[] \| object[] | plugins that must be enabled; entries `"name"`, `"name@marketplace"`, or `{name, marketplace?, version?}` |
| `settings` | object | only `agent` and `subagentStatusLine` take effect; everything else dropped at load. A `settings.json` file at plugin root takes precedence over this key |
| `userConfig` | object | values Claude Code prompts the user for on enable |
| `channels` | array of objects | message channels bound to an MCP server |
| `skills` | path \| path[] | directories to scan for skills; **adds to** the default `skills/` scan, doesn't replace it; `"."` means plugin root |
| `commands` | path \| path[] \| object | object map form: `{name: {source\|content, description?, argumentHint?, model?, allowedTools?}}` — exactly one of `source`/`content` per entry |
| `agents` | path \| path[] | `.md` files only, no directories; **replaces** default `agents/` scan |
| `hooks` | path \| object \| array | `.json` file(s) and/or inline hook objects (same shape as `settings.json` `hooks`); **merged with** `hooks/hooks.json` when that file exists |
| `mcpServers` | path \| object \| array | `.json` configs, `.mcpb`/`.dxt` bundles, or inline configs; merged with `.mcp.json`; a later-declared server name replaces an earlier one |
| `lspServers` | path \| object \| array | merged with `.lsp.json` |
| `outputStyles` | path \| path[] | **replaces** default `output-styles/` scan |
| `workflows` | path \| path[] | **replaces** default `workflows/` scan |
| `experimental.themes` / `.monitors` / `.evals` | — | container keys; shape may still change |

Unrecognized **top-level** keys are silently stripped — `claude plugin
validate` reports it as a warning only, the plugin still loads.
Unrecognized keys **inside** a `userConfig` option, a `channels` entry, an
`lspServers` config, or a `monitors` entry are a **hard error** — those
nested objects are strict and the plugin doesn't load.

### 1.3 Discovery

- Skills/commands/agents/hooks/MCP/LSP are **automatically discovered** once
  the plugin is installed/enabled, from the standard layout or the manifest
  paths above.
- Plugin skills are namespaced `/<plugin-name>:<skill-name>`, where
  `<skill-name>` is the skill's frontmatter `name` if set, else its
  directory name — e.g. `agent-forge/skills/grill/SKILL.md` → `/agent-forge:grill`.
  If the frontmatter `name` already starts with the plugin's own prefix,
  Claude Code does **not** double it, **on v2.1.246 or later**; v2.1.216
  through v2.1.245 had a bug that doubled the prefix in that case. Don't
  rely on either behavior without testing against the installed version;
  simplest is to never prefix `name:` with the plugin name yourself.
- Plugin agents are namespaced `plugin-name:agent-name`, invoked via
  `@agent-<name>` or as an `Agent` tool's `subagent_type`.
- Plugin hooks merge with user/project `settings.json` hooks and with any
  `hooks` field in `plugin.json` — they are additive, not a replacement.

### 1.4 `${CLAUDE_PLUGIN_ROOT}` and other path/env variables

Three path variables, substituted as `${NAME}` in specific fields only
(manifest-reference, "Environment variables"):

| Variable | Resolves to | Use for |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | absolute path of the plugin's **installed** version — changes on every update; never persist state there | scripts/binaries/config bundled with the plugin |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/<id>/`, created on first reference, **survives updates** (`<id>` = plugin identifier with non-alnum/`_`/`-` chars replaced by `-`) | installed deps (`node_modules`), generated files, caches |
| `${CLAUDE_PROJECT_DIR}` | project root where the session started | project-local scripts |

Where each resolves / is exported as a process env var:

| Component | `${...}` resolves in | Exported to process env |
|---|---|---|
| Hook commands | anywhere in `command`, `args` | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_OPTION_<KEY>` (one per declared `userConfig` option) |
| Monitor commands | `command` | not exported |
| MCP stdio servers | `command`, `args`, `env` | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` |
| MCP http/sse/ws servers | `url`, `headers`, `headersHelper` | n/a |
| LSP servers | `command`, `args`, `env`, `workspaceFolder` | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` |
| Skill/command/agent markdown body | anywhere in the body (text substitution, not an env var there) | n/a |

**Not present** in the env of commands Claude runs via the Bash tool itself
(main session or subagent) — only in hook/MCP/LSP child processes. Inside
skill markdown bodies and `allowed-tools` Bash rules, the additional
substitutions `${CLAUDE_SKILL_DIR}` (the individual skill's own
subdirectory, not the plugin root) and `${CLAUDE_PROJECT_DIR}` are also
available; plugin skills get `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`
there too.

Quoting rule: **shell-form** hooks (no `args` array) must wrap
`${CLAUDE_PLUGIN_ROOT}` in double quotes so a path containing spaces stays
one argument — `claude plugin validate` warns if you don't (unless
`shell: "powershell"`). **Exec-form** hooks (`args` present) pass each
`args` element as one argument already, no quoting needed; on Windows,
`.cmd`/`.bat` shims (npm/npx/eslint bin shims) aren't real executables and
must be run via `node <script.js>` in exec form, or via shell form by name.

---

## 2. `marketplace.json` format and install commands

### 2.1 File location and required fields

Save at `.claude-plugin/marketplace.json`. The directory **containing**
`.claude-plugin/` is the marketplace root, and every relative plugin
`source` resolves from that root, not from inside `.claude-plugin/`.
Required top-level keys: `name`, `owner`, `plugins`.

```json
{
  "name": "agent-forge-marketplace",
  "owner": { "name": "Your Name", "email": "you@example.com" },
  "description": "agent-forge plugin marketplace",
  "plugins": [
    {
      "name": "agent-forge",
      "source": "./",
      "description": "Phased agent-building workflow: grill → architect → build → evals → ui"
    }
  ]
}
```

Full top-level field table (marketplace-reference):

| Field | Type | Notes |
|---|---|---|
| `name` | string | **required**; letters/digits/`.`/`_`/`-`, starts with letter/digit, no `..`; forms the `@marketplace` suffix of every installed plugin id. A list of official/community names is **reserved** (`claude-code-plugins`, `claude-community`, `agent-skills`, etc., plus near-spellings of them) — pick something unambiguous like `agent-forge-marketplace` |
| `owner` | object | **required**; `{name (required), email?, url?}` |
| `plugins` | array | **required**; each entry validated independently — one bad entry doesn't fail the whole marketplace |
| `$schema` | string | editor only, ignored at load |
| `description` | string | shown to users; validator warns if missing |
| `version` | string | marketplace manifest version |
| `metadata.description` / `metadata.version` | string | alternate location for the two fields above |
| `metadata.pluginRoot` | string | directory bare (no `./`) plugin-source names resolve under (v2.1.239+) |
| `forceRemoveDeletedPlugins` | boolean | when `true`, removing a plugin from `plugins` uninstalls it on users' machines |
| `allowCrossMarketplaceDependenciesOn` | string[] | marketplaces whose plugins may satisfy this marketplace's plugins' dependencies |
| `renames` | object | former-plugin-name → new-name map (or `null` for "removed") |

### 2.2 Plugin entry fields

Each `plugins[]` entry needs `name` and `source`; it also accepts every
`plugin.json` field from §1.2 (for inlining metadata directly into the
marketplace file). Entry-only / overriding fields: `category`, `tags`,
`strict` (default `true`), `relevance`, `defaultEnabled` (entry value takes
precedence over the plugin's own `plugin.json`), `displayName`, `metadata`,
`headers`, `headersHelper`.

**Strict mode** (`strict`, default `true`) governs what happens when a
fetched plugin has its own `plugin.json` **and** the marketplace entry also
sets one of the six component fields (`commands`, `agents`, `skills`,
`hooks`, `outputStyles`, `themes`):

| `strict` | `plugin.json` present | entry sets component fields | Result |
|---|---|---|---|
| any | no | any | the entry itself is the manifest |
| `true` (default) | yes | any | `plugin.json` is authoritative; entry's component fields are **appended** to it, except `hooks`, whose matchers **replace** the manifest's per event |
| `false` | yes | none | `plugin.json` is the manifest, same as `true` |
| `false` | yes | one or more | **conflict — plugin fails to load**: `Plugin <name> has conflicting manifests: both plugin.json and marketplace entry specify components` |

Simplest for agent-forge: keep `plugin.json` as the sole component
declaration and leave the marketplace entry to `name` + `source` (+ display
fields), avoiding strict-mode conflicts entirely.

### 2.3 Plugin source types

| Type | Fields | Notes |
|---|---|---|
| Relative path | the string itself | must start with `./` (or be a bare name resolved under `metadata.pluginRoot`); `.` means the marketplace root itself; `..` fails validation |
| `github` | `repo` (`owner/repo`), `ref?`, `sha?` | |
| `url` | `url`, `ref?`, `sha?` | any git repo by URL (`https://`, `http://`, `file://`, `git@`), no `owner/repo` shorthand here |
| `git-subdir` | `url`, `path`, `ref?`, `sha?` | one subdirectory of another repo, fetched as a sparse partial clone |
| `npm` | `package`, `version?`, `registry?` | fetched via your npm client; install scripts never run, deps not auto-installed during fetch |
| `archive` | `url`, `sha256` | zip over HTTPS (v2.1.224+) |
| `command` | `command`, `timeout?`, `mode?` | a directory path **printed by a command** Claude Code runs on the user's machine, with a confirmation prompt (v2.1.229+) |

### 2.4 Install commands

```bash
# register a marketplace (local path, git repo, owner/repo, or hosted marketplace.json URL)
claude plugin marketplace add ./my-marketplace
claude plugin marketplace add your-org/your-marketplace --scope project
/plugin marketplace add ./my-marketplace          # inside an interactive session

# install a plugin from an added marketplace
claude plugin install agent-forge@agent-forge-marketplace --scope project
/plugin install agent-forge@agent-forge-marketplace

# lifecycle
claude plugin list
claude plugin enable agent-forge
claude plugin disable agent-forge
claude plugin update agent-forge
claude plugin uninstall agent-forge

# load a plugin for one local session, no marketplace needed (the dev loop)
claude --plugin-dir ./agent-forge
```

`-s/--scope` is `user` (default) / `project` / `local`. `--config
key=value` sets a declared `userConfig` option (repeatable).
`-y/--yes` accepts a marketplace `command`-source install prompt
non-interactively. `--json` on `install`/`enable`/`disable`/`update` prints
one JSON result object as the **last line** of stdout (earlier lines may be
a shown command).

---

## 3. SKILL.md frontmatter — Claude Code fields and the Agent Skills spec

### 3.1 Agent Skills open standard (agentskills.io/specification)

Directory shape (minimum):
```
skill-name/
├── SKILL.md          # required
├── scripts/          # optional, executable code
├── references/       # optional, docs loaded on demand
└── assets/           # optional, templates/static resources
```

Spec-defined frontmatter — **this is the exact portable subset** usable
outside Claude Code (claude.ai skill uploads, the Skills API,
`package_skill.py` from `anthropics/skills`):

| Field | Required | Constraints |
|---|---|---|
| `name` | yes | max 64 chars; `a-z0-9-` only (unicode lowercase alphanumeric + hyphen); no leading/trailing hyphen; no `--`; **must match the parent directory name** |
| `description` | yes | max 1024 chars, non-empty; describes what + when to use |
| `license` | no | license name or a reference to a bundled license file |
| `compatibility` | no | max 500 chars; environment requirements (product, system packages, network access) |
| `metadata` | no | map of string → string |
| `allowed-tools` | no | space-separated pre-approved tools (marked **Experimental** in the spec) |

Spec recommendation: keep `SKILL.md` under **500 lines** / **<5,000 tokens**
of body; push detail into `references/`. Progressive disclosure has three
tiers: metadata (~100 tokens, always loaded), instructions (full body,
loaded on activation), resources (loaded as needed). Validate a standalone
skill with `skills-ref validate ./my-skill` (`github.com/agentskills/agentskills`).

### 3.2 Claude Code's frontmatter superset

Claude Code accepts every spec field **plus** these extensions (skills doc,
"Frontmatter reference"; field names are case-sensitive, hyphenated, and an
unrecognized field name is silently ignored, not an error):

| Field | Default | Description |
|---|---|---|
| `name` | directory name | command name shown in `/` menu; in a plugin skill, replaces only the **last segment** after the plugin namespace prefix |
| `description` | first non-empty body line if omitted | combined with `when_to_use`, **truncated at 1,536 characters** in the skill listing — put the key use case first |
| `when_to_use` | — | extra trigger phrases/example requests, appended to `description`, counts toward the same 1,536-char cap |
| `argument-hint` | — | autocomplete hint, e.g. `[phase]` or `[issue-number]` |
| `arguments` | — | named positional args for `$name` substitution (space-separated string or YAML list) |
| `disable-model-invocation` | `false` | **user-only** invocation — Claude can't trigger it, and it's also excluded from subagent preloading and from firing via a scheduled task. Use for anything with side effects you must gate manually, e.g. a `build` phase skill you don't want Claude auto-triggering |
| `user-invocable` | `true` | set `false` to hide from `/` menu entirely — Claude-only, for background knowledge that isn't a meaningful user action |
| `allowed-tools` | — | space/comma-separated string or YAML list; tools pre-approved **only for the turn that invokes the skill** — the grant clears on your next message |
| `disallowed-tools` | — | tools removed from the pool while the skill is active; clears on next message; can't remove `EndConversation` while any other tool remains |
| `model` | inherit session model | override for the rest of the current turn only; with `context: fork` sets the forked subagent's model instead |
| `effort` | inherit | `low`/`medium`/`high`/`xhigh`/`max`, model-dependent |
| `context` | — | `fork` runs the skill as its own subagent — see §3.4 |
| `agent` | `general-purpose` | subagent type to use with `context: fork` (built-in `Explore`/`Plan`/`general-purpose` or any custom `.claude/agents/` subagent) |
| `background` | `true` | only with `context: fork`; `false` blocks the invoking turn until the forked subagent's result comes back, instead of running it as a background task (requires v2.1.218+) |
| `hooks` | — | hook config, same shape as `settings.json` `hooks`; registered when the skill is invoked, stays active for the **rest of the session** — see §4.6 |
| `paths` | — | glob(s) (comma-string or YAML list) restricting when Claude auto-loads the skill, same format as CLAUDE.md path-specific rules |
| `shell` | `bash` | shell for inline `` !`command` `` blocks in the skill body (`bash` or `powershell`) |
| `metadata` | — | free-form map for your own tooling; Claude Code never reads it |
| `license`, `compatibility` | — | accepted, not acted on by Claude Code — pure pass-through for spec compliance |

Booleans accept `yes/no/on/off/1/0` (any letter case) in addition to
`true`/`false`, as of v2.1.218; before that, only `true`/`false` parsed.

**Hard constraint if agent-forge's skills are ever packaged for claude.ai /
the Skills API / `package_skill.py`**: only the six spec fields (`name`,
`description`, `license`, `compatibility`, `metadata`, `allowed-tools`)
are allowed there. Any other field — `argument-hint`, `context`,
`disable-model-invocation`, etc. — makes packaging **fail with a hard
error**, verbatim from the docs:
```
Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed
properties are: allowed-tools, compatibility, description, license,
metadata, name
```
Inside Claude Code proper (standalone or plugin-shipped skills) every field
in the table above works regardless of this restriction — it only bites on
that specific export path.

### 3.3 Namespacing of plugin skills

`agent-forge/skills/grill/SKILL.md` → `/agent-forge:grill`. Setting
`name: interview` in that file changes only the final segment:
`/agent-forge:interview` — the plugin prefix is never dropped. A plugin-root
single-file `SKILL.md` (no `skills/` dir, no `skills` manifest key) becomes
`/agent-forge:<name-or-dirname>` the same way; give it an explicit `name:`
or it inherits the install/cache directory name, which changes on every
marketplace update (see §1.1).

### 3.4 How one skill invokes another skill

There is no first-class "import"/"call" primitive between skills. The
documented mechanisms:

1. **Plain re-invocation**: any skill's body can instruct Claude to run
   `/agent-forge:build` (etc.) as an ordinary slash command — this is just
   Claude choosing to call the Skill tool again, still gated by the target
   skill's own `disable-model-invocation`/`user-invocable` flags. A router
   skill's body is typically exactly this: conditional dispatch instructions
   ("if no PRD exists yet, invoke `/agent-forge:grill`; otherwise proceed to
   the next phase whose artifact is missing").
2. **`context: fork`**: a skill with `context: fork` (+ optional `agent:`)
   runs as its **own subagent**, receiving the SKILL.md body as its entire
   prompt with **no access to the parent conversation**. Runs in the
   background by default; `background: false` blocks and returns the result
   inline. This is the mechanism for a phase skill that should execute
   isolated from the router's context (e.g. `build` running as a subagent so
   its tool-call noise doesn't bloat the router's context window).
3. **Content persistence, not a call stack**: once invoked, a skill's
   rendered body stays in context for the rest of the session (re-invoking
   with an identical render is deduped to an "already loaded" note; changed
   arguments or dynamic content re-appends the full body). A router
   "handing off" to a phase skill is sequential skill-loading in the same
   conversation, not a nested call that returns.
4. **Session-scoped hooks from frontmatter** (§4.6): a skill can register
   its own hooks for the rest of the session — the closest thing to one
   skill "configuring behavior" that persists into later skills' turns,
   e.g. `grill` could install a guard hook that stays active through
   `architect`/`build`.

No skill-to-skill parameter-passing API exists beyond `$ARGUMENTS`/`$name`
substitution at invocation time. Cross-phase state for agent-forge has to
live in files on disk (a PRD/spec/eval-report artifact) that the next phase
skill's body tells Claude to read — this is also exactly what the
`phase-gate` hook should check for (§4.8).

---

## 4. Hooks

### 4.1 Event catalog

Per session: `SessionStart`, `SessionEnd`. Per turn: `UserPromptSubmit`,
`Stop`, `StopFailure`. Per tool call: `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`,
`PostToolBatch`. Other standalone events: `Setup`, `UserPromptExpansion`,
`Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`,
`TaskCreated`, `TaskCompleted`, `TeammateIdle`, `InstructionsLoaded`,
`ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`,
`WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`,
`PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult`.
agent-forge's five hooks need only **`PreToolUse`** (phase-gate,
secret-guard, paid-call-guard, destructive-guard) and **`PostToolUse`**
(typecheck-lint).

### 4.2 `hooks.json` schema

Plugin form, at `hooks/hooks.json`:
```json
{
  "description": "agent-forge guard hooks",
  "hooks": {
    "<EventName>": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh", "args": [] }
        ]
      }
    ]
  }
}
```
Three nesting levels: event name → array of matcher groups → array of hook
handlers. All matching handlers across every group/source run in parallel.
A plugin's `hooks/hooks.json` is merged with (not replacing) any `hooks`
field set directly in `plugin.json`, and with user/project `settings.json`
hooks.

Hook handler `type`s: `command` (shell command — the only type agent-forge
needs), `http` (POST to a URL, same JSON in/out contract), `mcp_tool` (call
an MCP tool), `prompt` (single-turn LLM eval), `agent` (spawn a subagent;
experimental). Common handler fields: `type`, `if` (permission-rule string,
tool-event-only filter, best-effort — never a hard security boundary on its
own), `timeout` (seconds; default 600 for `command`/`http`/`mcp_tool`),
`statusMessage`, `once` (skill-frontmatter hooks only).

### 4.3 Matcher syntax

- `"*"`, `""`, or omitted → matches every occurrence of the event.
- String containing only letters/digits/`_`/`-`/spaces/`,`/`|` → exact
  match, or a `|`/`,`-separated list of exact matches, e.g. `"Bash"`,
  `"Edit|Write"`, `"Edit, Write"`.
- Any other character present → unanchored JavaScript regex (tested with
  `RegExp.prototype.test`, so `"Edit.*"` also matches `NotebookEdit` — anchor
  with `^...$` for whole-string match), e.g. `"mcp__memory__.*"`,
  `"^Notebook"`.
- `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PermissionRequest`/`PermissionDenied`
  match on `tool_name`. MCP tool names follow `mcp__<server>__<tool>`; append
  `.*` to match every tool from a server (`mcp__memory` alone is an exact
  match and matches **nothing** — must be `mcp__memory__.*`). A
  plugin-bundled MCP server's tools are scoped as
  `mcp__plugin_<plugin-name>_<server-name>__<tool>`.
- `FileChanged` and `StopFailure` use a **narrower** exact-match charset
  (letters/digits/`_`/`|` only — a hyphen/space/comma pushes them onto the
  regex path, and only `|` separates alternatives there).
- Per-handler finer filtering via `if` (tool events only): permission-rule
  syntax against the tool name **and** arguments together, e.g.
  `"Bash(rm *)"`, `"Edit(*.ts)"`. `if` holds exactly **one** rule — no
  `&&`/`||`/list syntax; use a separate handler per condition. Bash `if`
  patterns are evaluated against each subcommand, including inside `$()`
  and backticks, with leading `VAR=value` assignments stripped — but when
  Claude Code can't determine which commands a Bash input runs, it runs your
  hook **regardless** of the pattern, so `if` is best-effort and must never
  be the sole gate for something security-critical (use it to narrow which
  handler spawns, then have the handler itself make the real decision).

### 4.4 JSON on stdin — fields relevant to agent-forge's hooks

**Common fields on every event**: `session_id`, `prompt_id`,
`transcript_path`, `cwd`, `scratchpad_dir?`, `permission_mode`
(`"default"`/`"plan"`/`"acceptEdits"`/`"auto"`/`"dontAsk"`/`"bypassPermissions"`),
`effort?`, `hook_event_name`; plus `agent_id`/`agent_type` when firing
inside a subagent.

**`PreToolUse`** (fires after Claude builds tool params, before execution;
matches any tool name except `EndConversation`; doesn't fire for files
referenced with `@` in the prompt — those bypass tool calls entirely):
```json
{
  "session_id": "abc123", "cwd": "/repo", "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /tmp/build", "description": "...", "timeout": 120000, "run_in_background": false },
  "tool_use_id": "toolu_01..."
}
```
For `Write`/`Edit`/`Read`: `tool_input.file_path` is always **absolute**,
with the platform's native separators (backslashes on Windows, even under
Git Bash) — normalize separators before matching a `/src/`-style substring,
never anchor with `^` since the path is absolute.

**`PostToolUse`** (fires only after a tool call **succeeds**; same matcher
values as `PreToolUse`; doesn't fire for a `Bash`-rewritten file unless you
also match `Bash` — use `FileChanged` for "any writer" semantics instead):
```json
{
  "hook_event_name": "PostToolUse", "tool_name": "Write",
  "tool_input": { "file_path": "/repo/src/x.ts", "content": "..." },
  "tool_response": { "filePath": "/repo/src/x.ts", "type": "create" },
  "tool_use_id": "toolu_01...", "duration_ms": 12
}
```

**`UserPromptSubmit`**: adds `prompt` (pasted-text placeholders expanded
inline), `session_title?`. **`Stop`**: adds `stop_hook_active`,
`last_assistant_message`, `background_tasks[]`, `session_crons[]`; an
**8-consecutive-continuation cap** applies — after 8 blocking continuations
in a row Claude Code overrides the next block and ends the turn
(raise via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).

### 4.5 Exit codes and JSON output

- **Exit 0**: success. Stdout is logged to debug only for most events; for
  `UserPromptSubmit`/`UserPromptExpansion`/`SessionStart`/`PostModelSwitch`
  plain-text stdout is injected directly into Claude's context.
- **Exit 2**: **the one blocking signal JSON can't override** — even a JSON
  `permissionDecision: "allow"` loses to exit 2. What it blocks depends on
  the event: `PreToolUse` blocks the tool call; `UserPromptSubmit` blocks
  the prompt; `PostToolUse`/`PostToolUseFailure` **can't block** (the tool
  already ran) — exit 2 there just surfaces stderr to Claude.
- **Any other exit code**: doesn't block on its own. A parsed,
  schema-valid JSON object on stdout decides the outcome regardless of exit
  code (except exit 2's hard block). Claude Code treats exit code **1** as
  non-blocking without valid JSON, even though 1 is the conventional Unix
  failure code — **use `exit 2`** for a hard policy gate, never rely on
  non-zero alone.
- Stdout-is-JSON detection: starts with `{` **and** ends with `}` → parsed
  as JSON (with a special case for several JSON-looking lines that are
  really plain text); anything else → plain text.
- `additionalContext`/`systemMessage`/`initialUserMessage` and plain stdout
  are each capped at **10,000 characters**; over the cap, Claude Code writes
  the text to a session-dir file and hands Claude only the file path plus a
  2,000-character preview (Claude is not told to go read the file).

**Universal JSON fields** (every event): `continue` (bool, default `true` —
`false` stops Claude entirely, takes precedence over every other decision
field), `stopReason`, `suppressOutput` (documented no-op), `systemMessage`,
`terminalSequence` (allowlisted OSC escape codes only, for desktop
notifications — not relevant to agent-forge's guard hooks).

**Decision-control fields for the two events agent-forge's hooks use**:

| Event | Pattern | Key fields |
|---|---|---|
| `PreToolUse` | `hookSpecificOutput` | `permissionDecision`: `"allow"` \| `"deny"` \| `"ask"` \| `"defer"`; `permissionDecisionReason` (shown to Claude on `deny`, to the user only on `ask`); `updatedInput` (replaces the tool's entire input object before it runs); `additionalContext` |
| `PostToolUse` | top-level `decision`/`reason` + `hookSpecificOutput` | `decision: "block"` (attaches `reason` next to the tool result — Claude still sees the **original** output too, unless you also set `updatedToolOutput`); `additionalContext`; `updatedToolOutput` (replaces what Claude sees — does **not** undo the already-executed side effect); `classifierContext` (auto-mode classifier only, v2.1.236+) |

`PreToolUse` precedence when multiple hooks return different decisions:
`deny` > `defer` > `ask` > `allow`. A hook that blocks by exiting 2 is
treated the same as a JSON `"deny"` (PreToolUse) — Claude sees the stderr
text as the reason.

**Important deprecation**: `PreToolUse` used to accept top-level
`decision`/`reason` (values `"approve"`/`"block"`, auto-mapped to
`"allow"`/`"deny"`) — that form still works but is deprecated. Write new
hooks with `hookSpecificOutput.permissionDecision` as shown above.
`PostToolUse`/`Stop` still use the top-level `decision`/`reason` form as
their *current*, non-deprecated format — don't "fix" those to match
`PreToolUse`'s newer shape.

### 4.6 Hooks defined in skill/subagent frontmatter

```yaml
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```
Registered the moment the skill is invoked (by user or Claude) and stay
active for the **rest of the session**, including turns after the skill's
own turn — not just that one turn. Add `once: true` on a handler to have
Claude Code remove it after its first successful run (only honored for
skill-frontmatter hooks; ignored in settings files and agent frontmatter).
Subagent-frontmatter hooks instead run only while that subagent executes and
are removed when it finishes; a `Stop` hook defined there is converted to
`SubagentStop`. This mechanism is Claude-Code-only — not something a Hermes
skill runner executes (§7).

### 4.7 Minimal working examples

**PreToolUse Bash guard** — model for `secret-guard` / `paid-call-guard` /
`destructive-guard`:

`hooks/hooks.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/destructive-guard.sh", "args": [] }
        ]
      }
    ]
  }
}
```

`scripts/destructive-guard.sh`:
```bash
#!/bin/bash
input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command')

if echo "$command" | grep -Eq 'rm +-rf|git +push +--force|drop +table'; then
  jq -n --arg reason "Destructive command blocked by agent-forge destructive-guard. Use a scoped delete, git revert, or a migration with a down-step instead." \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
else
  exit 0
fi
```
Exiting 2 with a stderr message also blocks (Claude sees the stderr as the
denial reason), but the JSON form is preferable here because it lets the
hook also propose the alternative the task spec calls for
(`permissionDecisionReason`), and because exit codes alone can't attach
structured reasoning the way `hookSpecificOutput` can.

**PostToolUse Edit|Write check** — model for `typecheck-lint`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/typecheck-lint.sh", "args": [], "timeout": 120 }
        ]
      }
    ]
  }
}
```
```bash
#!/bin/bash
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

case "$file_path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

errors=$(cd "$(dirname "$file_path")" && npx tsc --noEmit 2>&1; npx eslint "$file_path" 2>&1)
if [ -n "$errors" ]; then
  jq -n --arg r "$errors" '{decision: "block", reason: $r}'
else
  exit 0
fi
```
`PostToolUse` `decision: "block"` does **not** undo the edit — the file is
already on disk. It only attaches `reason` to the tool result so Claude
sees the tsc/lint errors and can issue a follow-up `Edit` to fix them. This
is exactly the semantics the task spec asks for ("run tsc --noEmit + linter
and return errors to the agent"), not a revert mechanism.

### 4.8 `phase-gate` design note (no built-in "phase" event exists)

Claude Code has no event named "phase transition" — `phase-gate` has to be
implemented as a `PreToolUse` hook (matcher `"Write|Edit|Bash"`, or just
`"Bash"` if the artifact check is itself delegated to a script) that:
1. reads the project's phase-state file (e.g. a `.agent-forge/state.json`
   that each phase skill writes on completion, after validating its own
   artifact),
2. if the incoming tool call looks like writing **application code**
   (`tool_input.file_path` outside `.agent-forge/`, or a `Bash` command
   invoking a build/test tool) while the current phase's artifact hasn't
   validated yet,
3. returns `permissionDecision: "deny"` with a reason naming the missing
   artifact and the skill that produces it (e.g. "run `/agent-forge:architect`
   first — no validated architecture doc found at `.agent-forge/architecture.md`").

### 4.9 Timeouts

Defaults: 600s for `command`/`http`/`mcp_tool`; lowered to 30s on
`UserPromptSubmit`/`PreModelSwitch`/`PostModelSwitch`, 10s on
`MessageDisplay`. **A timed-out `PreToolUse` command hook does not block** —
its output is discarded and the call proceeds through the normal permission
flow, so a slow `typecheck-lint`/`phase-gate` script **fails open**, not
closed. Set an explicit, generous `timeout` on each handler (e.g. 60–120s
for `tsc --noEmit` on a real project) instead of depending on the 600s
default to silently cover it, and design the guard scripts to exit fast on
the common "nothing to check" path (file extension doesn't match, etc.)
before doing anything slow.

---

## 5. `claude plugin validate` — confirmed working locally

```bash
claude plugin validate ./agent-forge             # human-readable
claude plugin validate ./agent-forge --strict    # warnings → errors (CI)
claude plugin validate ./agent-forge --json      # machine-readable report
```

Actually run against `claude 2.1.281` on a scratch plugin
(`{name, description, version, author}` manifest + one
`skills/hello/SKILL.md` with `name`/`description` frontmatter):

```
$ claude plugin validate ./test-plugin
Validating plugin manifest: /.../test-plugin/.claude-plugin/plugin.json
✔ Validation passed
```
```
$ claude plugin validate ./test-plugin --strict --json
{
  "success": true,
  "strict": true,
  "target": ".../test-plugin/.claude-plugin/plugin.json",
  "manifest": { "file": "...plugin.json", "type": "plugin", "errors": [], "warnings": [], "notes": [] },
  "contents": []
}
```

Exit codes: `0` = `Validation passed` / `Validation passed with warnings`;
`1` = `Validation failed`, or (under `--strict`) a warning treated as a
failure; `2` = the validator itself errored (e.g. unreadable path) — nothing
is written to stdout on `2`, only stderr.

Given a **directory**, Claude Code picks what to validate in this order:
`.claude-plugin/marketplace.json` → `.claude-plugin/plugin.json` →
component files chosen by directory name (a dir literally named `skills`,
`agents`, or `commands`; or `.claude` containing those three; requires
v2.1.233+ for the no-manifest component-only path). It does **not** read a
root-level `SKILL.md` during plugin validation, nor a plugin's hook/MCP/skill
files when run against a **marketplace** directory — validate each plugin
directory on its own for that. It doesn't follow symlinked `skills`/`agents`/
`commands` directories (warns that nothing inside was read) or symlinked
entries inside them (skips + warns per directory how many it skipped).

There's no separate "hooks validate" subcommand — malformed hook JSON
surfaces either as a manifest-validation warning/error (bad shape for the
`hooks` field) or silently drops that one handler at runtime; test hooks by
actually firing them in a session, not just by validating.

For CI: use `--json` and check `.success`; add `--strict` to also fail on
things the runtime otherwise tolerates (missing `version`/`description`/
`author`, a non-kebab-case `name`, unrecognized top-level manifest keys).

---

## 6. `npx skills add` behavior (vercel-labs/skills, skills.sh)

### 6.1 What it reads

Given a source — GitHub `owner/repo` shorthand, a full GitHub/GitLab/Azure
Repos URL, a direct path to one skill inside a repo
(`.../tree/main/skills/<name>`), any other git URL, or a local path — the
CLI searches these locations inside the resolved repo/path for skills (each
a directory containing a `SKILL.md`):

- the repo root itself, if it directly has a `SKILL.md`
- `skills/`, `skills/.curated/`, `skills/.experimental/`, `skills/.system/`
- `.agents/skills/`, `.agent/skills/`
- every agent-specific skills directory it recognizes, including
  `.claude/skills/` (Claude Code), `.cursor/skills/`, `.codex/skills/`,
  `.windsurf/skills/`, `.opencode/skills/`, `.goose/skills/`, and ~30 more
  (Amp, Antigravity, Augment, Cline, CodeBuddy, Continue, Crush, Droid,
  Gemini CLI, GitHub Copilot, Junie, Kilo Code, Kiro CLI, Kode, MCPJam, Mux,
  OpenHands, Pi, Qoder, Qwen Code, Roo Code, Trae, Zencoder, Neovate, Pochi,
  Moltbot/OpenClaw, …)
- if none of those have anything, it falls back to a **recursive search**
  of the whole repo for any `SKILL.md`

Each `SKILL.md` must carry YAML frontmatter with `name` and `description`
(the same two required Agent Skills spec fields) to be recognized as
installable. A `skills.sh.json` at the repo root (present in
`vercel-labs_agent-skills` as groupings metadata for the skills.sh discovery
site) is purely an optional **catalog/grouping** file for that website — it
is not required for `npx skills add` to find and install skills, and
agent-forge doesn't need one unless curated groupings on skills.sh matter to
you.

### 6.2 How it installs, per target agent

```bash
npx skills add owner/agent-forge-repo                       # interactive: pick skills + agents
npx skills add owner/agent-forge-repo --skill agent-forge    # install specific skill(s) by name
npx skills add owner/agent-forge-repo -a claude-code          # target one agent explicitly
npx skills add owner/agent-forge-repo -g                      # install to the global/user dir, not project
npx skills add owner/agent-forge-repo --all -y                 # non-interactive, every skill to every agent
```

Interactively it offers **Symlink** (recommended — single source of truth,
updates propagate) or **Copy** (independent per-agent copies, for targets
without symlink support) as the installation method. Resulting layout, a
subset of the full per-agent table in the README:

| Agent | Project path | Global path |
|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |
| Codex | `.codex/skills/` | `~/.codex/skills/` |
| Cursor | `.cursor/skills/` | `~/.cursor/skills/` |
| … 25+ more agents | `.<agent>/skills/` | agent-specific |

**No "Hermes" entry exists in the CLI's supported-agent table** — checked
the full README list (Amp, Antigravity, Augment, Claude Code, Cline,
CodeBuddy, Codex, Continue, Crush, Cursor, Droid, Gemini CLI, GitHub
Copilot, Goose, Junie, Kilo Code, Kiro CLI, Kode, MCPJam, Mux, OpenCode,
OpenHands, Pi, Qoder, Qwen Code, Roo Code, Trae, Windsurf, Zencoder,
Neovate, Pochi, Moltbot, OpenClaw — no Hermes). Passing an `--agent` value
it doesn't recognize is not something I executed against the live CLI (no
network `npx` run in this task); treat as **unverified** whether it errors
outright or silently skips that target. Practically: `npx skills add` wires
Claude Code (and the other ~30 listed agents) automatically; it is **not**
the install path for Hermes.

For agent-forge to be `npx skills add`-installable at all for Claude Code
users, the repo only needs valid `SKILL.md` files under a scanned path —
the plugin's own `skills/` directory (§1.1) already satisfies this, no
extra manifest required.

### 6.3 Other CLI commands (context, not required for agent-forge's build)

`npx skills list` (installed skills, alias `ls`), `npx skills find [query]`
(search skills.sh), `npx skills remove [skills]`, `npx skills update
[skills]`, `npx skills check` (check for updates without applying),
`npx skills init [name]` (scaffold a `SKILL.md` template), `npx skills use
<source>` (one-off: resolves the source the same way as `add`, writes the
skill to a temp dir, prints a ready-to-paste prompt to stdout, or — with
`--agent <name>` — starts that supported agent interactively with the
generated prompt already loaded). Env vars: `INSTALL_INTERNAL_SKILLS`,
`DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `GITHUB_TOKEN`/`GH_TOKEN` (explicit auth
for private-repo API calls; otherwise it falls back to the system's git
credential helper / `gh` CLI / SSH).

---

## 7. Hermes-specific consequence for agent-forge (operational note, not from Claude docs)

Claude Code hooks (§4) are a Claude-Code-only runtime mechanism — there is
no documented equivalent event system in Hermes, and `npx skills add` has no
Hermes target (§6.2). Per the task's own framing, under Hermes the five
guard/gate scripts (`phase-gate.sh`, `typecheck-lint.sh`, `secret-guard.sh`,
`paid-call-guard.sh`, `destructive-guard.sh`) must be **invoked explicitly as
a step** by the Hermes-side skill's instructions (the SKILL.md body tells
the agent: "before writing application code, run
`${CLAUDE_SKILL_DIR}/scripts/phase-gate.sh` and stop if it exits non-zero")
rather than registered declaratively via `hooks.json`. Practical
consequence for how the 5 scripts should be written: keep each one's CLI
contract agent-runtime-agnostic — read the same JSON-on-stdin shape Claude
Code hooks pass (§4.4) where that's convenient, or accept equivalent CLI
flags/args; always produce a clear pass/fail **exit code** plus a
human-readable reason on stderr/stdout — so the one script body serves both
the `hooks/hooks.json` wiring (Claude Code, automatic) and a documented
manual-invocation step (Hermes, or any other runtime the `skills` CLI
targets that also lacks a hook system).

---

## Unverified / needs runtime confirmation

- Whether a plugin-root skill directory literally named `agent-forge` inside
  a plugin also named `agent-forge` triggers the documented (v2.1.246+)
  no-double-prefix rule to produce `/agent-forge` rather than
  `/agent-forge:agent-forge` — not exercised against a real install; test
  before relying on it, or sidestep by using a distinct `name:` per skill
  (e.g. `router`) so the question never matters.
- Exact behavior of `npx skills add` when given an `--agent` value it
  doesn't recognize (e.g. literally `-a hermes`) — inferred from the
  README's fixed agent table, not executed (would require a live network
  `npx` install, not run in this task).
- Whether `claude plugin eval` (surfaced in `claude plugin --help` and the
  CLI reference: reads `evals/**/case.yaml` or `prompt.md`+`graders/*.md`)
  is something agent-forge's `evals` phase skill should produce artifacts
  for, or is an unrelated Claude-Code-internal testing feature — noted as
  existing but not read in depth or exercised here;
  https://code.claude.com/docs/en/plugin-evals is the page to check before
  finalizing the `evals` phase skill's artifact format.
- The precise interaction between a skill's own frontmatter `hooks:` (§4.6)
  and a plugin's `hooks/hooks.json` when both match the same event+tool
  (e.g. does the skill-scoped copy add to, or shadow, the plugin-wide one).
  The docs state generally that hook entries "merge across settings levels
  rather than replacing each other" (hooks.md, "Hook locations") and that
  plugin hooks "merge with your user and project hooks" — by the same logic
  this document treats skill-frontmatter hooks as **additive** to
  plugin-wide hooks (all matching handlers run), but no worked example
  combining all three sources (settings, plugin, skill frontmatter) for the
  same event appears in the docs, so this is inference, not a quoted rule.
