import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContentPack } from "./lib/content-pack.mjs";

export const UPSTREAM_REPO = "google/elephant-goldfish-model";
export const UPSTREAM_SHA = "403d8881d62022490637d740657b33f01e321ea8";
export const HARNESS_MARKERS = [
  "CLAUDE_PLUGIN_ROOT",
  "docs/codex.md",
  "docs/claude.md",
  "invoke_subagent",
  "spawn_agent",
];

const VENDORED_PREFIXES = ["skills/", "agents/", "resources/", "docs/"];

const packageDir = fileURLToPath(new URL("..", import.meta.url));

function repoRoot() {
  return process.env.EGM_REPO_ROOT ? resolve(process.env.EGM_REPO_ROOT) : packageDir;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export async function assertHarnessNeutral(dir) {
  const failures = [];
  for (const file of await walk(dir)) {
    const text = await readFile(file, "utf8");
    for (const marker of HARNESS_MARKERS) {
      if (text.includes(marker)) failures.push(`${file}: ${marker}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`harness-specific markers survived the patch:\n${failures.join("\n")}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "opencode-egm-sync" } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function fetchBlob(repo, sha, path, target) {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
  const response = await fetch(url, { headers: { "User-Agent": "opencode-egm-sync" } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  const destination = join(target, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function buildTree(target) {
  const treeUrl = `https://api.github.com/repos/${UPSTREAM_REPO}/git/trees/${UPSTREAM_SHA}?recursive=1`;
  const tree = await fetchJson(treeUrl);
  if (tree.truncated) throw new Error(`tree response for ${UPSTREAM_SHA} is truncated`);

  const blobs = tree.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      (entry.path === "LICENSE" || VENDORED_PREFIXES.some((p) => entry.path.startsWith(p))),
  );
  for (const blob of blobs) await fetchBlob(UPSTREAM_REPO, UPSTREAM_SHA, blob.path, target);

  const skillFiles = tree.tree.filter(
    (entry) => entry.type === "blob" && /^skills\/[^/]+\/SKILL\.md$/.test(entry.path),
  );
  const agentFiles = tree.tree.filter(
    (entry) => entry.type === "blob" && /^agents\/[^/]+\.md$/.test(entry.path),
  );
  if (skillFiles.length !== 7) {
    throw new Error(`expected 7 skills, got ${skillFiles.length}: ${skillFiles.map((f) => f.path).join(", ")}`);
  }
  if (agentFiles.length !== 9) {
    throw new Error(`expected 9 agents, got ${agentFiles.length}: ${agentFiles.map((f) => f.path).join(", ")}`);
  }
}

async function applyPatch(target, mode) {
  const root = repoRoot();
  const patch = join(packageDir, "patches/opencode.patch");
  if (mode === "check") {
    execFileSync("git", ["init", "-q"], { cwd: target });
    execFileSync("git", ["apply", "--check", patch], { cwd: target, stdio: "inherit" });
    execFileSync("git", ["apply", patch], { cwd: target, stdio: "inherit" });
  } else {
    execFileSync("git", ["apply", "--check", "--directory=vendor", patch], {
      cwd: root,
      stdio: "inherit",
    });
    execFileSync("git", ["apply", "--directory=vendor", patch], { cwd: root, stdio: "inherit" });
  }
}

async function compareTrees(actualDir, expectedDir) {
  const list = async (dir) => {
    const files = await walk(dir);
    return new Map(files.map((file) => [relative(dir, file), file]));
  };
  const actual = await list(actualDir);
  const expected = await list(expectedDir);
  const changes = [];
  for (const [rel, file] of expected) {
    if (!actual.has(rel)) {
      changes.push(`removed: ${rel}`);
      continue;
    }
    const [a, b] = await Promise.all([readFile(file), readFile(actual.get(rel))]);
    if (!a.equals(b)) changes.push(`changed: ${rel}`);
  }
  for (const rel of actual.keys()) {
    if (!expected.has(rel)) changes.push(`added: ${rel}`);
  }
  return changes.sort();
}

async function main() {
  const check = process.argv.includes("--check");
  const root = repoRoot();
  const vendor = join(root, "vendor");
  const target = check ? await mkdtemp(join(tmpdir(), "egm-vendor-")) : vendor;

  try {
    if (!check) await rm(vendor, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await buildTree(target);

    const guide = join(root, "docs/opencode.md");
    if (!(await stat(guide).catch(() => null))) {
      throw new Error(`missing authored guide: ${guide}`);
    }
    await mkdir(join(target, "docs"), { recursive: true });
    await writeFile(join(target, "docs/opencode.md"), await readFile(guide));

    await applyPatch(target, check ? "check" : "normal");
    await assertHarnessNeutral(join(target, "skills"));
    await assertHarnessNeutral(join(target, "agents"));
    await assertHarnessNeutral(join(target, "resources"));
    await writeContentPack(target, { repo: UPSTREAM_REPO, sha: UPSTREAM_SHA });

    if (check) {
      const changes = await compareTrees(target, vendor);
      if (changes.length > 0) {
        console.error(`vendor drift detected:\n${changes.join("\n")}`);
        process.exitCode = 1;
      } else {
        console.log("vendor matches the pinned upstream tree");
      }
    } else {
      console.log(`vendor/ synced from ${UPSTREAM_REPO}@${UPSTREAM_SHA}`);
    }
  } finally {
    if (check) await rm(target, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
