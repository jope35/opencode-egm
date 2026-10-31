import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openCodeBinary } from "./helpers/server.ts";

const repoRoot = resolve(import.meta.dir, "..");
const bin = openCodeBinary();
const gated = process.env.OPENCODE_INSTALL_TEST === "1" && existsSync(bin);

if (!gated) {
  console.warn(
    `SKIP install test: set OPENCODE_INSTALL_TEST=1 and provide an opencode binary (looked for ${bin})`,
  );
}

const suite = gated ? describe : describe.skip;

suite("install from a git spec", () => {
  test(
    "registers 7 skills and 10 agents in an isolated home",
    () => {
      const result = spawnSync("bun", ["scripts/verify-install.mjs"], {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: "utf8",
        timeout: 180_000,
      });
      expect(result.status).toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("7 skills, 10 agents");
    },
    180_000,
  );
});
