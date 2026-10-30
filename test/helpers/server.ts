import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";

export { parseModelRef } from "../../src/model.ts";

const OPENCODE_BIN =
  process.env.OPENCODE_BIN ?? Bun.which("opencode") ?? "/home/joost/.opencode/bin/opencode";

export function openCodeBinary() {
  return OPENCODE_BIN;
}

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

export interface StartedServer {
  client: ReturnType<typeof OpenCode.make>;
  url: string;
  password: string;
  stop: () => Promise<void>;
}

export async function startServer(
  dir: string,
  { isolateHome = true, env: extraEnv = {}, waitForSkills = true } = {},
): Promise<StartedServer> {
  const password = crypto.randomUUID();
  const home = await mkdtemp(join(tmpdir(), "egm-oc-home-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_PASSWORD;
  delete env.OPENCODE_SERVER_PASSWORD;
  env.OPENCODE_SERVER_PASSWORD = password;
  if (isolateHome) {
    env.HOME = home;
    env.XDG_CONFIG_HOME = join(home, ".config");
  }
  Object.assign(env, extraEnv);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(OPENCODE_BIN, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", () => {});

  const client = OpenCode.make({
    baseUrl: url,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
  });

  const deadline = Date.now() + 30_000;
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
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`opencode serve did not start in 30s\n${stderr}`);
  }

  if (waitForSkills) {
    while (Date.now() < deadline) {
      const { data } = await client.skill.list();
      if (data.filter((skill) => skill.id.startsWith("egm-")).length === 7) break;
      await Bun.sleep(250);
    }
    const { data } = await client.skill.list();
    if (data.filter((skill) => skill.id.startsWith("egm-")).length !== 7) {
      child.kill("SIGTERM");
      throw new Error(`EGM skills did not appear within 30s: ${data.map((s) => s.id).join(", ")}\n${stderr}`);
    }
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
    });
    await rm(home, { recursive: true, force: true });
  };

  return { client, url, password, stop };
}
