import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseFrontmatter } from "../../src/frontmatter.ts";
import {
  MANIFEST_FILE,
  MANIFEST_VERSION,
  VENDOR_ROOT_TOKEN,
  assertExpectedContent,
} from "../../src/manifest.ts";
import { absolutizePackagePaths } from "../../src/paths.ts";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function posix(path) {
  return path.split(sep).join("/");
}

async function skillFiles(root) {
  const entries = await readdir(join(root, "skills"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("skills", entry.name, "SKILL.md"))
    .sort();
}

async function personaFiles(root) {
  const entries = await readdir(join(root, "agents"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => posix(join("agents", entry.name)))
    .sort();
}

/**
 * Frontmatter is parsed exactly once, here, with the same parser the rest of
 * the package uses. A malformed upstream file fails the sync instead of
 * silently registering a skill with the wrong description or auto-invoke flag.
 */
export async function validateFrontmatter(root) {
  for (const file of [...(await skillFiles(root)), ...(await personaFiles(root))]) {
    const text = await readFile(join(root, file), "utf8");
    parseFrontmatter(text, file);
  }
}

export async function buildContentPack(root, { repo, sha }) {
  await validateFrontmatter(root);

  const skills = [];
  for (const file of await skillFiles(root)) {
    const bytes = await readFile(join(root, file));
    const { data, body } = parseFrontmatter(bytes.toString("utf8"), file);
    if (typeof data.name !== "string" || data.name.length === 0) {
      throw new Error(`${file}: skill frontmatter needs a non-empty "name"`);
    }
    skills.push({
      id: data.name,
      name: data.name,
      description: typeof data.description === "string" ? data.description : undefined,
      file,
      autoinvoke: data["disable-model-invocation"] === true ? false : undefined,
      sha256: sha256(bytes),
      content: absolutizePackagePaths(body, VENDOR_ROOT_TOKEN),
    });
  }
  skills.sort((left, right) => left.id.localeCompare(right.id));

  const personas = [];
  for (const file of await personaFiles(root)) {
    const bytes = await readFile(join(root, file));
    const { data, body } = parseFrontmatter(bytes.toString("utf8"), file);
    if (typeof data.name !== "string" || data.name.length === 0) {
      throw new Error(`${file}: persona frontmatter needs a non-empty "name"`);
    }
    personas.push({
      id: data.name,
      name: data.name,
      description: typeof data.description === "string" ? data.description : undefined,
      file,
      sha256: sha256(bytes),
      system: absolutizePackagePaths(body, VENDOR_ROOT_TOKEN),
    });
  }
  personas.sort((left, right) => left.id.localeCompare(right.id));

  const manifest = {
    version: MANIFEST_VERSION,
    upstream: { repo, sha },
    counts: { skills: skills.length, personas: personas.length },
    skills,
    personas,
  };
  assertExpectedContent(manifest);
  return manifest;
}

export async function writeContentPack(root, meta) {
  const manifest = await buildContentPack(root, meta);
  await writeFile(join(root, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
