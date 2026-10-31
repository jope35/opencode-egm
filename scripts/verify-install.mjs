#!/usr/bin/env bun
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/client";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const bin =
  process.env.OPENCODE_BIN ?? Bun.which("opencode") ?? "/home/joost/.opencode/bin/opencode";

function branchName() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "HEAD";
  }
}

const spec =
  process.env.OPENCODE_PLUGIN_SPEC ??
  `git+file://${repoRoot}#${branchName()}`;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "egm-install-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: project });

  const password = crypto.randomUUID();
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_PASSWORD;
  env.OPENCODE_SERVER_PASSWORD = password;

  let child;
  try {
    console.log(`installing ${spec}`);
    execFileSync(bin, ["plugin", "add", spec], { cwd: project, env, stdio: "inherit" });

    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    child = spawn(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: project,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", () => {});

    const client = OpenCode.make({
      baseUrl: url,
      headers: {
        Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      },
    });

    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await client.server.info();
        ready = true;
        break;
      } catch {
        await Bun.sleep(250);
      }
    }
    if (!ready) throw new Error(`server did not start\n${stderr}`);

    let skills = [];
    let agents = [];
    while (Date.now() < deadline) {
      skills = (await client.skill.list()).data.filter((skill) => skill.id.startsWith("egm-"));
      agents = (await client.agent.list()).data.filter(
        (agent) => agent.id === "egm" || agent.id.startsWith("egm-"),
      );
      if (skills.length === 7 && agents.length === 10) break;
      await Bun.sleep(500);
    }

    if (skills.length !== 7) throw new Error(`expected 7 egm skills, got ${skills.length}`);
    if (agents.length !== 10) throw new Error(`expected 10 egm agents, got ${agents.length}`);
    console.log(`installed: 7 skills, 10 agents (${spec})`);
  } finally {
    child?.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
