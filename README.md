# opencode-egm

An OpenCode plugin for the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (EGM).

It registers the 7 upstream EGM skills and the 9 reviewer personas, plus an optional `egm` primary agent that carries the Elephant guardrails. The reviewer personas are read-only: they cannot edit files or run shell commands.

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

`options.model` accepts `provider/model` with an optional `#variant`. Without it, each persona inherits the parent session's model.

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

The sync script re-pulls `google/elephant-goldfish-model` at the pinned commit into `vendor/`, applies `patches/opencode.patch`, and fails on any harness marker.

The end-to-end test needs a model credential and is skipped by default:

```sh
OPENCODE_E2E=1 OPENCODE_E2E_MODEL=anthropic/claude-sonnet-5-5 bun test test/e2e.test.ts
```

The install smoke test checks the git install path in an isolated home:

```sh
OPENCODE_INSTALL_TEST=1 bun test test/install.test.ts
```
