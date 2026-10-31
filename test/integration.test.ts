import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCodeBinary, startServer } from "./helpers/server.ts";
import {
  BOOTSTRAP_ORCHESTRATOR_DENY,
  BOOTSTRAP_ORCHESTRATOR_IDS,
  ORCHESTRATOR_IDS,
  REVIEWER_DENY,
  REVIEWER_IDS,
  SYNTHESIZER_DENY,
  SYNTHESIZER_IDS,
} from "../src/policy.ts";

const repoRoot = resolve(import.meta.dir, "..");
const vendorRoot = join(repoRoot, "vendor");
const bin = openCodeBinary();
const hasBinary = existsSync(bin);

const REVIEWERS = REVIEWER_IDS;
const ORCHESTRATORS = ORCHESTRATOR_IDS;
const MARKERS = [
  "CLAUDE_PLUGIN_ROOT",
  "docs/codex.md",
  "docs/claude.md",
  "invoke_subagent",
  "spawn_agent",
];

const tempRoots: string[] = [];
const stops: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const stop of stops) await stop();
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

async function makeProject(config: unknown) {
  const root = await mkdtemp(join(tmpdir(), "egm-int-"));
  tempRoots.push(root);
  const dir = join(root, "project");
  await mkdir(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(join(dir, "opencode.json"), JSON.stringify(config));
  return dir;
}

async function boot(dir: string) {
  const server = await startServer(dir);
  stops.push(server.stop);
  return server;
}

function hasDeny(agent: { permissions: Array<{ action: string; resource: string; effect: string }> }, action: string) {
  return agent.permissions.some(
    (rule) => rule.action === action && rule.resource === "*" && rule.effect === "deny",
  );
}

const suite = hasBinary ? describe : describe.skip;
if (!hasBinary) {
  console.warn(`SKIP integration: opencode binary not found at ${bin}`);
}

suite("integration: installed OpenCode server", () => {
  test(
    "registers 7 skills and 10 agents with absolute paths and patched content",
    async () => {
      const dir = await makeProject({ plugins: [repoRoot] });
      const { client } = await boot(dir);

      const skills = (await client.skill.list()).data.filter((skill) => skill.id.startsWith("egm-"));
      expect(skills.map((skill) => skill.id).sort()).toEqual(
        [
          "egm-brainstorm",
          "egm-draft",
          "egm-review",
          "egm-review-loop",
          "egm-resolve",
          "egm-drift-report",
          "egm-bootstrap",
        ].sort(),
      );
      for (const skill of skills) {
        expect(skill.path.startsWith("/")).toBe(true);
        expect(skill.autoinvoke).toBe(false);
        expect(skill.content).toContain(`${vendorRoot}/docs/opencode.md`);
        for (const marker of MARKERS) expect(skill.content).not.toContain(marker);
        const relative = skill.content.split("resources/document_standards").length - 1;
        const absolute = skill.content.split(
          `${vendorRoot}/resources/document_standards`,
        ).length - 1;
        expect(absolute).toBe(relative);
      }

      const agents = (await client.agent.list()).data;
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      for (const id of [...REVIEWERS, ...ORCHESTRATORS]) {
        const agent = byId.get(id);
        expect(agent).toBeDefined();
        expect(agent!.mode).toBe("subagent");
        expect(agent!.model ?? null).toBeNull();
      }
      for (const id of REVIEWERS) {
        for (const action of REVIEWER_DENY) expect(hasDeny(byId.get(id)!, action)).toBe(true);
      }
      for (const id of SYNTHESIZER_IDS) {
        for (const action of SYNTHESIZER_DENY) expect(hasDeny(byId.get(id)!, action)).toBe(true);
        expect(hasDeny(byId.get(id)!, "subagent")).toBe(false);
      }
      for (const id of BOOTSTRAP_ORCHESTRATOR_IDS) {
        for (const action of BOOTSTRAP_ORCHESTRATOR_DENY) {
          expect(hasDeny(byId.get(id)!, action)).toBe(true);
        }
        expect(hasDeny(byId.get(id)!, "edit")).toBe(false);
        expect(hasDeny(byId.get(id)!, "shell")).toBe(false);
        expect(hasDeny(byId.get(id)!, "subagent")).toBe(false);
      }
      expect(byId.get("egm")?.mode).toBe("primary");

      const session = await client.session.create({ location: { directory: dir } });
      await client.experimental.session.skill({ sessionID: session.id, id: "egm-drift-report" });
      const context = await client.session.context({ sessionID: session.id });
      const skillMessage = context.find(
        (message) => message.type === "skill" && message.skill === "egm-drift-report",
      ) as { type: "skill"; text: string } | undefined;
      expect(skillMessage).toBeDefined();
      expect(skillMessage!.text).toContain("In OpenCode");
      for (const marker of MARKERS) expect(skillMessage!.text).not.toContain(marker);
    },
    60_000,
  );

  test(
    "applies options.model as a Model.Ref to every persona",
    async () => {
      const dir = await makeProject({
        plugins: [
          { package: repoRoot, options: { model: "anthropic/claude-sonnet-5-5" } },
        ],
      });
      const { client } = await boot(dir);
      const agents = (await client.agent.list()).data;
      for (const id of [...REVIEWERS, ...ORCHESTRATORS]) {
        const agent = agents.find((candidate) => candidate.id === id);
        expect(agent?.model).toMatchObject({
          providerID: "anthropic",
          id: "claude-sonnet-5-5",
        });
      }
    },
    60_000,
  );

  test(
    "applies per-persona models over the default",
    async () => {
      const dir = await makeProject({
        plugins: [
          {
            package: repoRoot,
            options: {
              model: "anthropic/default",
              models: { "egm-zoom-out": "openai/gpt-5" },
            },
          },
        ],
      });
      const { client } = await boot(dir);
      const agents = (await client.agent.list()).data;
      expect(agents.find((agent) => agent.id === "egm-zoom-out")?.model).toMatchObject({
        providerID: "openai",
        id: "gpt-5",
      });
      expect(agents.find((agent) => agent.id === "egm-comprehension")?.model).toMatchObject({
        providerID: "anthropic",
        id: "default",
      });
    },
    60_000,
  );

  test(
    "keeps the plugin deny rules under a global allow-all",
    async () => {
      const dir = await makeProject({
        plugins: [repoRoot],
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      });
      const { client } = await boot(dir);
      const agents = (await client.agent.list()).data;
      for (const id of REVIEWERS) {
        const agent = agents.find((candidate) => candidate.id === id)!;
        for (const action of REVIEWER_DENY) expect(hasDeny(agent, action)).toBe(true);
      }
      for (const id of SYNTHESIZER_IDS) {
        const agent = agents.find((candidate) => candidate.id === id)!;
        for (const action of SYNTHESIZER_DENY) expect(hasDeny(agent, action)).toBe(true);
        expect(hasDeny(agent, "subagent")).toBe(false);
      }
      for (const id of BOOTSTRAP_ORCHESTRATOR_IDS) {
        const agent = agents.find((candidate) => candidate.id === id)!;
        for (const action of BOOTSTRAP_ORCHESTRATOR_DENY) {
          expect(hasDeny(agent, action)).toBe(true);
        }
        expect(hasDeny(agent, "edit")).toBe(false);
      }
    },
    60_000,
  );
});
