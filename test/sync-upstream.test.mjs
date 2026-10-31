import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HARNESS_MARKERS,
  UPSTREAM_REPO,
  UPSTREAM_SHA,
  assertHarnessNeutral,
} from "../scripts/sync-upstream.mjs";
import { buildContentPack } from "../scripts/lib/content-pack.mjs";

const repoRoot = resolve(import.meta.dir, "..");
const patchPath = join(repoRoot, "patches/opencode.patch");
const tempDirs = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function networkUp() {
  try {
    const response = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

describe("assertHarnessNeutral", () => {
  test("throws and names every file and marker", async () => {
    const dir = await tempDir("egm-markers-");
    const skillDir = join(dir, "skills/egm-review");
    await mkdir(skillDir, { recursive: true });
    const markerLines = HARNESS_MARKERS.map((marker) => `use ${marker} here`).join("\n");
    await writeFile(join(skillDir, "SKILL.md"), `# Skill\n${markerLines}\n`);

    let error;
    try {
      await assertHarnessNeutral(dir);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(join(skillDir, "SKILL.md"));
    for (const marker of HARNESS_MARKERS) expect(error.message).toContain(marker);
  });

  test("passes once the markers are stripped", async () => {
    const dir = await tempDir("egm-clean-");
    const skillDir = join(dir, "skills/egm-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Skill\nIn OpenCode, read the guide.\n");
    await expect(assertHarnessNeutral(dir)).resolves.toBeUndefined();
  });
});

test("UPSTREAM_SHA is a full commit sha", () => {
  expect(UPSTREAM_SHA).toMatch(/^[0-9a-f]{40}$/);
});

test("fixture manifest matches the fixture content", async () => {
  const rebuilt = JSON.parse(
    JSON.stringify(
      await buildContentPack(join(repoRoot, "test/fixture/vendor"), {
        repo: "fixture",
        sha: "fixture",
      }),
    ),
  );
  const committed = JSON.parse(
    await readFile(join(repoRoot, "test/fixture/vendor/manifest.json"), "utf8"),
  );
  expect(rebuilt).toEqual(committed);
});

describe("opencode.patch", () => {
  test("applies to the pinned upstream skills", async () => {
    if (!(await networkUp())) {
      console.warn("SKIP: network unavailable, cannot fetch upstream skills");
      return;
    }
    const dir = await tempDir("egm-patch-");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const skill of [
      "bootstrap",
      "brainstorm",
      "draft",
      "drift-report",
      "resolve",
      "review-loop",
      "review",
    ]) {
      const response = await fetch(
        `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_SHA}/skills/egm-${skill}/SKILL.md`,
      );
      if (!response.ok) throw new Error(`fetch failed: egm-${skill} ${response.status}`);
      const target = join(dir, "skills", `egm-${skill}`);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), await response.text());
    }
    execFileSync("git", ["apply", "--check", patchPath], { cwd: dir });
  }, 60_000);

  test("--check reports a clean tree and a one-byte drift", async () => {
    if (!existsSync(join(repoRoot, "vendor/skills"))) {
      console.warn("SKIP: vendor/ is missing, run bun scripts/sync-upstream.mjs first");
      return;
    }
    if (!(await networkUp())) {
      console.warn("SKIP: network unavailable, cannot rebuild the pinned tree");
      return;
    }
    const dir = await tempDir("egm-check-");
    await cp(join(repoRoot, "vendor"), join(dir, "vendor"), { recursive: true });
    await mkdir(join(dir, "docs"), { recursive: true });
    await cp(join(repoRoot, "docs/opencode.md"), join(dir, "docs/opencode.md"));

    const clean = Bun.spawnSync(["bun", "scripts/sync-upstream.mjs", "--check"], {
      cwd: repoRoot,
      env: { ...process.env, EGM_REPO_ROOT: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(clean.exitCode).toBe(0);

    const drifted = join(dir, "vendor/skills/egm-review/SKILL.md");
    await writeFile(drifted, (await readFile(drifted, "utf8")) + "\n");
    const dirty = Bun.spawnSync(["bun", "scripts/sync-upstream.mjs", "--check"], {
      cwd: repoRoot,
      env: { ...process.env, EGM_REPO_ROOT: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(dirty.exitCode).not.toBe(0);
    expect(dirty.stdout.toString() + dirty.stderr.toString()).toContain(
      "skills/egm-review/SKILL.md",
    );
  }, 120_000);
});
