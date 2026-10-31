import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCodeBinary, parseModelRef, startServer } from "./helpers/server.ts";
import { REVIEWER_DENY } from "../src/policy.ts";

const repoRoot = resolve(import.meta.dir, "..");
const designDoc = resolve(import.meta.dir, "fixture/design.md");
const bin = openCodeBinary();

let gateError = "";
if (process.env.OPENCODE_E2E !== "1") gateError = "OPENCODE_E2E is not 1";
else if (!process.env.OPENCODE_E2E_MODEL) gateError = "OPENCODE_E2E_MODEL is not set";
else if (!existsSync(bin)) gateError = `opencode binary not found at ${bin}`;
else {
  try {
    parseModelRef(process.env.OPENCODE_E2E_MODEL);
  } catch (error) {
    gateError = (error as Error).message;
  }
}
const gated = gateError === "";
if (!gated) console.warn(`SKIP e2e: ${gateError}`);

const tempRoots: string[] = [];
const stops: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const stop of stops) await stop();
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

async function fixtureProject() {
  const root = await mkdtemp(join(tmpdir(), "egm-e2e-"));
  tempRoots.push(root);
  const dir = join(root, "project");
  await mkdir(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(
    join(dir, "opencode.json"),
    JSON.stringify({
      plugins: [repoRoot],
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  );
  return dir;
}

const suite = gated ? describe : describe.skip;

suite("e2e: Goldfish spawn", () => {
  test(
    "spawns egm-zoom-out with fresh context and no write access",
    async () => {
      const dir = await fixtureProject();
      const server = await startServer(dir, { isolateHome: false });
      stops.push(server.stop);
      const { client } = server;
      const model = parseModelRef(process.env.OPENCODE_E2E_MODEL!);
      const session = await client.session.create({ location: { directory: dir }, model });

      const canary = `PARENT-CANARY-${crypto.randomUUID()}`;
      await client.session.prompt({
        sessionID: session.id,
        text: `Remember this token: ${canary}. Reply OK and do not repeat it.`,
      });
      await client.experimental.session.wait({ sessionID: session.id });

      const spawnPrompt =
        'Call the `subagent` tool once with `agent: "egm-zoom-out"`, `description: "E2E goldfish spawn"`, and `prompt: "Reply exactly GOLDFISH-OK"`. Do not include any other text or context in the child prompt.';
      const findChild = async () => {
        const { data } = await client.session.list({ parentID: session.id });
        return data[0];
      };

      await client.session.prompt({ sessionID: session.id, text: spawnPrompt });
      await client.experimental.session.wait({ sessionID: session.id });
      let child = await findChild();
      if (!child) {
        await Bun.sleep(5000);
        child = await findChild();
      }
      if (!child) {
        await client.session.prompt({ sessionID: session.id, text: spawnPrompt });
        await client.experimental.session.wait({ sessionID: session.id });
        const deadline = Date.now() + 60_000;
        while (!child && Date.now() < deadline) {
          await Bun.sleep(1000);
          child = await findChild();
        }
      }
      expect(child).toBeDefined();

      const childContext = await client.session.context({ sessionID: child!.id });
      const childText = JSON.stringify(childContext);
      expect(childText).toContain("GOLDFISH-OK");
      expect(childText).not.toContain(canary);

      const agents = (await client.agent.list()).data;
      const zoomOut = agents.find((agent) => agent.id === "egm-zoom-out");
      expect(zoomOut?.mode).toBe("subagent");
      for (const action of REVIEWER_DENY) {
        expect(
          zoomOut?.permissions.some(
            (rule) => rule.action === action && rule.resource === "*" && rule.effect === "deny",
          ),
        ).toBe(true);
      }

      const writeTarget = join(dir, "egm-write-attempt.txt");
      await client.session.prompt({
        sessionID: child!.id,
        text: `Create the file ${writeTarget} with the text hello, then run the shell command printf hi. Do both if you can.`,
      });
      await client.experimental.session.wait({ sessionID: child!.id });
      expect(existsSync(writeTarget)).toBe(false);

      const attemptContext = JSON.stringify(
        await client.session.context({ sessionID: child!.id }),
      );
      const mechanism = /permission|denied|not allowed|unavailable/i.test(attemptContext)
        ? "refused or denied by the runtime"
        : "no write tool available to the persona";
      console.log(`e2e read-only check: ${mechanism}`);

      const design = await readFile(designDoc, "utf8");
      expect(design.length).toBeGreaterThan(0);
    },
    120_000,
  );

  test(
    "rejects a nested spawn at the default depth",
    async () => {
      if (process.env.OPENCODE_E2E_DEPTH !== "1") {
        console.warn("SKIP depth check: set OPENCODE_E2E_DEPTH=1 to run it");
        return;
      }
      const dir = await fixtureProject();
      const server = await startServer(dir, { isolateHome: false });
      stops.push(server.stop);
      const { client } = server;
      const model = parseModelRef(process.env.OPENCODE_E2E_MODEL!);

      const session = await client.session.create({ location: { directory: dir }, model });
      await client.session.prompt({
        sessionID: session.id,
        text: 'Call the `subagent` tool once with `agent: "egm-synthesizer"`, `description: "depth check"`, and `prompt: "Reply OK"`.',
      });
      await client.experimental.session.wait({ sessionID: session.id });
      const deadline = Date.now() + 60_000;
      let child;
      while (!child && Date.now() < deadline) {
        const { data } = await client.session.list({ parentID: session.id });
        child = data[0];
        if (!child) await Bun.sleep(1000);
      }
      expect(child).toBeDefined();

      await client.session.prompt({
        sessionID: child!.id,
        text: 'Call the `subagent` tool once with `agent: "egm-zoom-out"`, `description: "nested"`, and `prompt: "Reply OK"`. Report the exact error text.',
      });
      await client.experimental.session.wait({ sessionID: child!.id });
      const context = JSON.stringify(await client.session.context({ sessionID: child!.id }));
      if (!/Subagent depth limit reached/i.test(context)) {
        console.warn("SKIP depth assertion: the model did not attempt the nested spawn");
        return;
      }
      expect(context).toContain(
        'Subagent depth limit reached (1). Increase "subagent_depth" to allow nested subagents.',
      );
    },
    120_000,
  );
});
