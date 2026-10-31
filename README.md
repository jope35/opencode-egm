# opencode-egm

An OpenCode plugin for the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (EGM).

It registers the 7 upstream EGM skills and the 9 EGM personas, plus an optional `egm` primary agent that carries the Elephant guardrails. The reviewer personas are read-only: they cannot edit files or spawn other agents. The synthesizer can spawn reviewers only. The bootstrap orchestrator is the one documented writer, because it generates README files.

## Install

```sh
opencode plugin add github:<owner>/opencode-egm
```

The GitHub owner is not decided yet. Until it is, install from a local checkout or a git URL:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-egm"]
}
```

To give every Goldfish reviewer a fixed model, use the object form:

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
the default for the nine personas. Use `options.models` to route one persona
at a time; `egm` sets the primary agent:

```jsonc
{
  "plugins": [
    {
      "package": "github:<owner>/opencode-egm",
      "options": {
        "model": "anthropic/claude-sonnet-5-5",
        "models": {
          "egm-zoom-out": "openai/gpt-5",
          "egm-design": "anthropic/claude-opus-4-5"
        }
      }
    }
  ]
}
```

A malformed model or an unknown persona key fails setup. Without an option,
each persona inherits the parent session's model.

Each EGM persona session appends a JSON line to
`.egm/review-ledger.jsonl` with its model, duration, tokens, cost and
finding-marker count. Set `"ledger": false` to disable it or `"ledger":
"path/to/file.jsonl"` to move it.

## Use

- Load a skill with `@egm-review` or `skill({ id: "egm-review" })`.
- Let the Elephant session call `subagent` with an `egm-*` persona. Reviewers run in fresh context.
- Reports go to the working directory, or to the directory named by `EGM artifact directory:` in `AGENTS.md`.
- The synthesizer and bootstrap swarm paths need `experimental.subagent_depth: 2`. The default direct-dispatch flow works at depth 1.

## Development

```sh
bun install --frozen-lockfile
bun test
bunx tsc --noEmit
bun scripts/sync-upstream.mjs --check
```

The sync script re-pulls `google/elephant-goldfish-model` at the pinned commit into `vendor/`, applies `patches/opencode.patch`, validates every vendored frontmatter block, and writes `vendor/manifest.json` with the parsed skills and personas. The plugin loads that manifest at setup; there is no YAML parser, directory scan or path rewrite at runtime. `--check` fails on any byte drift, including the manifest.

The end-to-end test needs a model credential and is skipped by default:

```sh
OPENCODE_E2E=1 OPENCODE_E2E_MODEL=anthropic/claude-sonnet-5-5 bun test test/e2e.test.ts
```

The install smoke test checks the git install path in an isolated home:

```sh
OPENCODE_INSTALL_TEST=1 bun test test/install.test.ts
```
