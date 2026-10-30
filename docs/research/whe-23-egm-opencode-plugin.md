# WHE-23 Research: EGM inventory, how it works, and a one-line OpenCode plugin

Date: 2026-10-30 · Author: OpenChamber session (WHE-23) · Status: for review

Sources: Dave Rensin's essay "Elephants, Goldfish and the New Golden Age of Software
Engineering" (drensin.medium.com, Apr 2026), the Google Open Source Blog announcement
(2026-10-22), https://github.com/google/elephant-goldfish-model (Apache-2.0, ~6.5k stars),
its `docs/harnesses.md` / `docs/designs/architecture.md`, and the official OpenCode docs
(opencode.ai/docs + anomalyco/opencode source, queried 2026-10-30).

---

## 1. What the Elephant-Goldfish Model (EGM) is

EGM is a spec-driven development methodology for AI-assisted software, not a model in the
ML sense:

- **Elephant** = the context-rich, long-horizon main AI session. It holds project history,
  requirements and prior decisions, interviews the human, and drafts a design document.
  Rule: **no code is written in the Elephant**; it only produces the spec
  ("design is the new code").
- **Goldfish** = brand-new, zero-context sessions that get only the design doc (plus the
  files it references). They validate the spec from a blank slate, exposing the Elephant's
  blind spots. Three checks: **Comprehension** (can a fresh reader explain it back?),
  **Critic/antagonistic review** (what is missing, wrong, ambiguous?), **Implementation
  readiness** (are all file paths, signatures, test cases present and unambiguous?).
- **Human** owns trade-offs, approves the spec, and only then asks the agent to implement.

Lifecycle: `egm-brainstorm` (6-lens shootdown → `concepts_brief.md`) → `egm-draft`
(section-by-section spec → `docs/designs/<feature>.md`) → `egm-review` (Goldfish protocol,
5 stages) → `egm-resolve` (triage findings) → human PR review → implement →
`egm-drift-report` (spec vs. code drift). Plus `egm-bootstrap` (recursive README harvesting
to give the Elephant codebase context cheaply) and `egm-review-loop` (configurable review
groups).

## 2. Inventory of google/elephant-goldfish-model and its dependencies

| Path | Contents | Purpose |
| --- | --- | --- |
| `skills/` (7) | `egm-brainstorm`, `egm-draft`, `egm-review`, `egm-review-loop`, `egm-resolve`, `egm-bootstrap`, `egm-drift-report` — each a `SKILL.md` (Agent Skills format: `name`/`description`/`license` frontmatter + body) | The workflows. Orchestrate Elephant work and Goldfish subagent spawning. Skills read `agents/` and `resources/` at run time — installing `skills/` alone breaks EGM. |
| `agents/` (9 personas) | `comprehension`, `design_critic`, `implementation_readiness`, `zoom_out`, `structural`, `style`, `codebase_details`, `synthesizer`, `bootstrap_orchestrator` — markdown with `name`/`description` frontmatter | Stateless Goldfish reviewer system prompts. Reviewers are strictly read-only. `synthesizer` fans out the swarm and dedupes findings. |
| `resources/` | `document_standards/` (5 rubrics: feature-spec, heilmeier, implementation-readiness, re-implementation, zoom-out) + `execution_instructions.md` + README | Versioned evaluation rubrics the Goldfish reviewers load. |
| `docs/` | `getting_started.md`, `harnesses.md`, `claude.md`, `codex.md`, `faq.md`, `privacy.md`, `directory.md`, `designs/` (incl. `architecture.md`) | User guides and the architecture spec. `harnesses.md` is the per-harness install/delegation map. |
| `plugin.json` | Portable "Agent Plugins 1.0.0" manifest (name `egm`, v0.1.0) | Canonical plugin identity/metadata. |
| `.claude-plugin/` | `plugin.json` + `marketplace.json` + `agents/` adapters | Claude Code / Cowork manifest (agents listed explicitly; adapters wrap the shared personas). |
| `.codex-plugin/`, `.agents/plugins/` | Codex manifest; `marketplace.json` catalog pointing `source: "./"` | Codex / ChatGPT workspace import. Codex ships skills only; a general subagent reads the persona file. |
| `distributions/claude/` | Prebuilt bundle (skills, agents, resources, docs, plugin.json) | Ready-to-copy runtime bundle for Antigravity manual installs. |
| `scripts/` | `pack_plugin.py`, `prepare_release.py` | Python packaging/release tooling (dev-only). |
| `tests/` | pytest unit tests (manifest drift, skill contracts) + live integration fixtures; `TESTING.md` records per-harness test status | CI-verified; harness test record lives in `TESTING.md`. |
| `site/`, `assets/` | egm.dev marketing site, icons | Not needed at runtime. |
| `.github/` | CI workflows, PR template | Dev-only. |

**Dependencies:** runtime = **none** — the plugin is pure Markdown + JSON manifests; it uses
the host agent's own model, tools and permissions. Dev/CI only: Python (pytest,
`requirements-dev.txt`, packaging scripts) and GitHub Actions. License: Apache-2.0.
**Key structural insight:** one shared copy of `skills/` + `agents/` + `resources/`, with
thin per-harness manifests; no harness gets a fork of the skill text.

## 3. How the upstream plugin is installed today (per harness)

One line per harness (from `docs/harnesses.md`):

| Harness | Install |
| --- | --- |
| Antigravity CLI | `agy plugin install https://github.com/google/elephant-goldfish-model` |
| Claude Code | `claude plugin marketplace add google/elephant-goldfish-model && claude plugin install egm@egm` |
| Codex | `codex plugin marketplace add google/elephant-goldfish-model && codex plugin add egm@egm` |
| **omp** | `omp plugin marketplace add google/elephant-goldfish-model && omp plugin install egm@egm` |

Important: **"omp" is Oh My Pi** (github.com/can1357/oh-my-pi, a Pi fork — see upstream
issue #186), **not OpenCode**. Delegation map: Antigravity `invoke_subagent`, Claude
`Agent`/Task tool, Codex/ChatGPT native spawn tools (no named personas → general subagent
reads `agents/<file>.md`), omp `task` tool with named personas. A Goldfish review **requires
a fresh-context subagent tool**; if the harness has none, the skills stop rather than fake
a review in the same context.

**OpenCode is not yet an upstream-supported harness** — that is exactly what this project
(opencode-egm) should add.

## 4. OpenCode plugin mechanics (official docs, queried 2026-10-30)

- **One-line install:** `opencode plugin add github:owner/repo` (also npm names
  `@scope/pkg@ver`, full git URLs, `#branch`, `::path:subdir` selectors). It installs into
  the npm cache and appends the package to the global config's plugin list. Equivalent
  config one-liner in `opencode.json`: `"plugin": ["github:owner/repo"]` or
  `"plugin": ["opencode-egm"]`; local files also auto-load from `.opencode/plugins/` and
  `~/.config/opencode/plugins/`.
- **Package plugin shape:** a `package.json` with `exports` (`"."` → `src/index.ts`,
  optional `./tui`, `./rpc`); without exports it falls back to `index.ts`/`server.ts` at the
  package root. Entry module exports a `Plugin` function returning hooks (`tool`, `event`,
  **`config`**, ...).
- **`config` hook:** receives the live config object and mutates it in place — e.g.
  `cfg.agent["egm-comprehension"] = { description, mode: "subagent", ... }`, plus `mcp`,
  permissions. This is how a plugin registers agents.
- **Skills:** OpenCode natively supports the Agent Skills format. `SKILL.md` files are
  discovered under `<config-dir>/skill/` and `<config-dir>/skills/` (≤6 levels deep), and the
  top-level `"skills"` config field accepts **directory paths, `~/` paths, or http(s) URL
  sources**. A plugin can also add skills at runtime via `ctx.skill.transform(editor =>
  editor.add({...}))`. The agent invokes a skill with the `skill({ name })` tool. → EGM's
  `skills/*/SKILL.md` files are already in a compatible format.
- **Agents/subagents:** custom agents are markdown files in `.opencode/agents/*.md` or
  `~/.config/opencode/agents/` (frontmatter: `description`, `mode: subagent|primary|all`,
  `model`, `permissions` like `{ action: "edit", resource: "*", effect: "deny" }`; body =
  system prompt), or config `"agents"` entries. The built-in **`subagent` tool**
  (`subagent({ agent, description, prompt, background? })`) spawns a child session with
  **fresh context** — only `mode: subagent` agents qualify; parent `subagent` permissions
  gate which agents may be launched; default nesting depth is one.

## 5. Recommended deployment pattern for OpenCode

**Recommendation: one plugin package (`opencode-egm`) that registers EGM's skills and
persona agents; Elephant = the user's normal primary session; Goldfish = OpenCode subagents
spawned with the native `subagent` tool.** Do not build a wrapper "elephant agent" that
calls skills, and do not chain skill→skill.

Rationale, mapped to EGM's own architecture:

1. **Elephant = primary session, not a new agent.** In EGM the Elephant is simply the
   context-rich main session; wrapping it in a dedicated agent adds nothing and risks
   context loss. Optionally ship an `egm` *primary*-mode agent whose system prompt encodes
   the guardrails (no-code rule, artifact-first), for users who want to switch into it.
2. **Goldfish = `mode: subagent` agents + the `subagent` tool.** This is a 1:1 mapping of
   EGM's personas (`agents/*.md` → 9 OpenCode agents `egm-comprehension`, `egm-design-critic`,
   …). OpenCode child sessions start with fresh context, which is precisely the Goldfish
   requirement ("a review in the same context is not a Goldfish review"). Give reviewer
   agents read-only permissions (`edit`/`bash` deny) to match their "strictly read-only"
   mandate; the synthesizer may keep read-only too since it only writes reports via the
   Elephant. The plugin's `config` hook reads the bundled persona markdown (frontmatter
   `name`/`description` + body as `system`) and injects them as agents.
3. **Skills = OpenCode skills.** Bundle `skills/*/SKILL.md` and register them via the
   `"skills"` config field (directory source) or `ctx.skill.transform`. The model calls
   them with the `skill` tool (e.g. `skill({ name: "egm-review" })`). The skill bodies are
   already harness-agnostic ("spawn a subagent with your harness's subagent tool"); the
   OpenCode mapping is `subagent` tool + named persona agents, which the plugin provides.
4. **Nesting caveat:** OpenCode's default subagent nesting depth is one, but EGM's
   preferred path is review-skill → synthesizer subagent → reviewer subagents (depth 2).
   Use EGM's built-in **direct dispatch** fallback in OpenCode: the review skill spawns each
   reviewer persona directly (`subagent({ agent: "egm-comprehension", ... })`) instead of
   going through the synthesizer. Document this in a new `docs/opencode.md`.

**One-line install for users:**

```sh
opencode plugin add github:<owner>/opencode-egm
# or, once published to npm:
opencode plugin add opencode-egm
# config equivalent:
# { "plugin": ["github:<owner>/opencode-egm"] }
```

**Adaptation work items (from upstream repo → opencode-egm):**

1. Plugin package skeleton: `package.json` (name `opencode-egm`, `exports: { ".": "./src/index.ts" }`,
   dep `@opencode/plugin`) + `src/index.ts` whose `config` hook (a) appends the bundled
   `skills/` dir to `cfg.skills` and (b) injects the 9 personas from `agents/*.md` as
   `mode: "subagent"` agents with read-only permissions for reviewers.
2. Vendor `skills/`, `agents/`, `resources/document_standards/`, `docs/` from
   google/elephant-goldfish-model (Apache-2.0 — keep LICENSE/attribution).
3. Add `docs/opencode.md`: delegation table (subagent tool, agent IDs, direct-dispatch
   fallback for nesting depth 1), invocation via `skill` tool, artifact dir = working
   directory (already the EGM default), and replace `${CLAUDE_PLUGIN_ROOT}`-style references
   with the plugin root path.
4. Tests: mirror upstream's pytest contract tests where possible; add an OpenCode
   installation fixture (install from git URL, assert 7 skills + 9 agents register, run a
   dry `egm-review` with direct dispatch).
5. Upstream-contribute path: the cleanest long-term fix is adding OpenCode support to
   google/elephant-goldfish-model itself (a manifest + a row in `docs/harnesses.md`), since
   the repo's design goal is "one set of skills and personas, thin per-harness manifests".

## 6. Direct answers to the ticket's questions

- **How does EGM work?** Spec-driven development: a context-rich Elephant session drafts a
  design doc (no code), zero-context Goldfish subagent sessions stress-test it (comprehension,
  critic, readiness), the human approves, then code is written to the spec; drift-report
  keeps spec and code in sync. The open-source plugin automates this with 7 skills, 9
  reviewer personas and 5 rubrics; runtime deps: none (Markdown+JSON, host's own model/tools).
- **One-line install plugin in OpenCode?** Yes: `opencode plugin add github:<owner>/opencode-egm`
  (or npm). The package registers EGM's `SKILL.md` skills (native OpenCode skill discovery)
  and its personas as subagent-mode agents via the plugin `config` hook.
- **Deployment pattern?** Main agent = Elephant is the user's normal primary session (optionally
  a dedicated `egm` primary agent with guardrails); Goldfish models = the 9 personas registered
  as `mode: subagent` agents spawned via OpenCode's fresh-context `subagent` tool; skills
  orchestrate the lifecycle. Not a skill-calling-skills chain. Use direct dispatch (flat
  reviewer swarm) because OpenCode's default nesting depth is 1.
