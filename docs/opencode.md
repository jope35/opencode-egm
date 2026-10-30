# EGM on OpenCode

This guide bridges the Elephant-Goldfish Model (EGM) text to OpenCode. The
EGM skills in `skills/` are harness-neutral after the OpenCode patch. This
file names the OpenCode tools they rely on.

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

Without a plugin-level `model` option, each persona inherits the parent
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

`options.model` accepts `provider/model` with an optional `#variant`. The
plugin rejects a malformed value during setup.

## Nesting depth

OpenCode limits subagent nesting with `experimental.subagent_depth`, which
defaults to 1. At depth 1 a child cannot spawn another child. Use direct
dispatch: the Elephant session spawns each reviewer itself, one `subagent`
call per persona and stage.

`egm-synthesizer` and `egm-bootstrap-orchestrator` keep the `subagent`
permission because they need nesting when the user raises the limit. They
still cannot edit files or run shell commands.

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

## Paths in registered skill content

The guide you are reading lives at `<vendor>/docs/opencode.md`. The vendor
root is the parent of `docs/`. The plugin resolves it from the installed
package, and every registered skill carries absolute vendor paths for
`agents/` and `resources/` references. That is why a skill can tell a
Goldfish to read `agents/comprehension.md` and the child finds the file
even though its working directory is the project.

A registered skill also carries the absolute path to this guide. Read it
first when a skill points you here.

## Read-only reviewers

The seven reviewer personas deny `edit`, `shell`, `subagent`, `webfetch`,
`websearch`, `browser`, `execute`, and `experimental_image_generate` on
`*`. The plugin enforces this with a permission hook as well as agent
rules, so a global allow-all rule cannot widen it. A reviewer reads the
design document and writes its report into the session; it does not change
the tree.

## The `egm` primary agent

Select `egm` as the primary agent to start an Elephant session with the
guardrails already in the system prompt. The normal session works too: the
guardrails are the same. The plugin does not change `default_agent`.
