# EGM on OpenCode

This guide bridges the Elephant-Goldfish Model (EGM) text to OpenCode. The
EGM skills in `<vendor>/skills/` are harness-neutral after the OpenCode
patch. This file names the OpenCode tools they rely on.

## The `subagent` tool

Goldfish run in a fresh context with no conversation history. The parent
session spawns one with OpenCode's `subagent` tool:

```text
subagent({
  agent: "egm-zoom-out",
  description: "Review stage 1",
  prompt: "<the stage prompt, verbatim>",
  background: false,
  model: "<optional provider/model[#variant]>"
})
```

- `agent` is one of the registered persona IDs: `egm-comprehension`,
  `egm-design`, `egm-structural`, `egm-style`, `egm-zoom-out`,
  `egm-implementation-readiness`, `egm-codebase-details`,
  `egm-synthesizer`, `egm-bootstrap-orchestrator`.
- `prompt` is the only text that crosses over. The child gets no parent
  history, no parent messages, and no parent canary.
- `background: true` starts the child asynchronously. Leave it false when
  the next step needs the report.
- `model` overrides the persona model for that one spawn.

Without a plugin-level model option, each persona inherits the parent
session's model. To give every Goldfish a fixed model, register the plugin
in object form:

```jsonc
{
  "plugins": [
    {
      "package": "github:<owner>/opencode-egm",
      "options": { "model": "anthropic/claude-sonnet-5-5" }
    }
  ]
}
```

`options.model` accepts `provider/model` with an optional `#variant` and is
the default for the nine EGM personas. `options.models` overrides one
persona at a time (keys are persona IDs; `egm` sets the primary agent):

```jsonc
{
  "options": {
    "model": "anthropic/claude-sonnet-5-5",
    "models": {
      "egm-zoom-out": "openai/gpt-5",
      "egm": "anthropic/claude-opus-4-5"
    }
  }
}
```

The plugin rejects a malformed value or an unknown persona key during
setup.

## Review ledger

Every EGM persona session that goes idle appends one JSON line to
`.egm/review-ledger.jsonl` in the project directory. A record contains the
parent session, persona, model, outcome, start and idle times, duration,
token usage, cost, and the number of 🔴/🟡/🟢 finding markers in the
session context. The Elephant session itself is recorded too.

Set `"ledger": false` to disable it, or `"ledger": "path/to/file.jsonl"` to
move it. The ledger is best-effort: a write failure is logged and never
breaks a review.

## Nesting depth

OpenCode limits subagent nesting with `experimental.subagent_depth`, which
defaults to 1. At depth 1 a child cannot spawn another child. Use direct
dispatch: the Elephant session spawns each reviewer itself, one `subagent`
call per persona and stage.

`egm-synthesizer` may spawn reviewer personas only. `egm-bootstrap-orchestrator`
may spawn itself only. Any other target is denied, so an orchestrator cannot
launder write access through a general-purpose agent. Bootstrap is a
documented writer: it has `edit` and `shell` for READMEs and verification.
The synthesizer stays read-only.

A bootstrap tree with more than 5 directories needs the swarm path, and
that path needs depth 2:

```jsonc
{
  "experimental": { "subagent_depth": 2 }
}
```

Without depth 2, use the direct-execution path and run the bootstrap
partition by partition, one directory subtree per turn. The plugin never
sets `subagent_depth` itself.

## The `skill` tool

Load an EGM skill by ID:

```text
skill({ id: "egm-review" })
```

The user can also type `@egm-review`. The skills set
`disable-model-invocation: true`, so they stay out of the model's
advertised skill list but remain loadable by ID or mention. That matches
the user-driven EGM flow. A skill may load another skill in the same
thread, for example `egm-review` loading `egm-review-loop`.

## The `question` tool

The single-question gates use OpenCode's `question` tool: one question,
labeled options, one selection. The upstream procedure pauses at each gate
and waits for the answer. Do not batch several gate questions into one
turn.

## Artifact directory

Reports go to the working directory by default. To redirect them, add this
line to `AGENTS.md`:

```text
EGM artifact directory: .dev/docs
```

OpenCode reads `AGENTS.md`, so the upstream rule works unchanged.

## Paths in registered content

The guide you are reading lives at `<vendor>/docs/opencode.md`. The vendor
root is the parent of `docs/`. `scripts/sync-upstream.mjs` parses every
vendored skill and persona once and writes `vendor/manifest.json`. The
manifest stores the body with a `{{VENDOR_ROOT}}` token for `agents/`,
`resources/`, `docs/harnesses.md` and this guide. At setup the plugin
replaces that token with the installed package path and registers the
content directly: there is no YAML parser, directory scan or path rewrite
at runtime.

That is why a skill can tell a Goldfish to read `agents/comprehension.md`
and the child finds the file even though its working directory is the
project. Persona system prompts get the same treatment; a reviewer reading
`resources/document_standards/zoom-out-standard.md` resolves it inside the
package, not inside the user's project.

If the manifest is missing or does not contain the expected seven skills
and nine personas, setup fails loudly. Run `bun run sync` after changing
the vendored content.

## Reviewer and orchestrator capabilities

Reviewers are read-only by capability, not by a deny list. The plugin's
`evaluate` hook allows `read`, `glob`, `grep`, `skill`, `question` and
`external_directory`; everything else is denied, including `edit`, `shell`,
`subagent`, `webfetch`, `websearch`, `execute`, `experimental_image_generate`,
and every MCP action (`<server>_<tool>`). A new action in a later OpenCode
release is denied by default.

Agent rules still carry the visible denies for the known side effects, so a
global allow-all cannot widen them. A user's global **deny** remains final:
the hook never turns a deny into an allow.

The synthesizer is read-only and may spawn reviewer personas only. The
bootstrap orchestrator is the one writer: it needs `edit` and `shell` for
README files and verification, and may spawn only itself. It is not a
reviewer, so it is not part of the read-only guarantee.

## The `egm` primary agent

Select `egm` as the primary agent to start an Elephant session with the
guardrails already in the system prompt. The normal session works too: the
guardrails are the same. The plugin does not change `default_agent`.
