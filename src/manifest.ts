import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  EXPECTED_SKILL_IDS,
  PERSONA_IDS,
} from "./policy.ts";
import { normalizeRoot } from "./paths.ts";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";

/**
 * Content is stored once and materialized against the installed package root,
 * so the same manifest works from a checkout, a git install or a registry
 * install. Do not change this token without regenerating every manifest.
 */
export const VENDOR_ROOT_TOKEN = "{{VENDOR_ROOT}}";

export interface ManifestSkill {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly file: string;
  readonly autoinvoke?: boolean;
  readonly sha256: string;
  readonly content: string;
}

export interface ManifestPersona {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly file: string;
  readonly sha256: string;
  readonly system: string;
}

export interface ContentManifest {
  readonly version: number;
  readonly upstream: { readonly repo: string; readonly sha: string };
  readonly counts: { readonly skills: number; readonly personas: number };
  readonly skills: readonly ManifestSkill[];
  readonly personas: readonly ManifestPersona[];
}

function fail(message: string): never {
  throw new Error(`opencode-egm: invalid content manifest: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function safeFile(value: unknown, label: string, vendorRoot: string): string {
  const file = string(value, label);
  if (isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
    fail(`${label} must be a relative path inside vendor/`);
  }
  const root = resolve(vendorRoot);
  const full = resolve(root, file);
  if (full !== root && !full.startsWith(root + sep)) {
    fail(`${label} escapes vendor/`);
  }
  return file;
}

function parseSkill(value: unknown, index: number, vendorRoot: string): ManifestSkill {
  const label = `skills[${index}]`;
  const entry = record(value, label);
  return {
    id: string(entry.id, `${label}.id`),
    name: string(entry.name, `${label}.name`),
    description: optionalString(entry.description, `${label}.description`),
    file: safeFile(entry.file, `${label}.file`, vendorRoot),
    autoinvoke: entry.autoinvoke === undefined ? undefined : Boolean(entry.autoinvoke),
    sha256: string(entry.sha256, `${label}.sha256`),
    content: string(entry.content, `${label}.content`),
  };
}

function parsePersona(value: unknown, index: number, vendorRoot: string): ManifestPersona {
  const label = `personas[${index}]`;
  const entry = record(value, label);
  return {
    id: string(entry.id, `${label}.id`),
    name: string(entry.name, `${label}.name`),
    description: optionalString(entry.description, `${label}.description`),
    file: safeFile(entry.file, `${label}.file`, vendorRoot),
    sha256: string(entry.sha256, `${label}.sha256`),
    system: string(entry.system, `${label}.system`),
  };
}

function assertUnique(entries: ReadonlyArray<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) fail(`${label} contains duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
}

export function parseManifest(value: unknown, vendorRoot: string): ContentManifest {
  const root = record(value, "manifest");
  if (root.version !== MANIFEST_VERSION) {
    fail(`version must be ${MANIFEST_VERSION}, got ${JSON.stringify(root.version)}`);
  }

  const upstream = record(root.upstream, "upstream");
  const counts = record(root.counts, "counts");
  if (!Array.isArray(root.skills)) fail("skills must be an array");
  if (!Array.isArray(root.personas)) fail("personas must be an array");

  const skills = root.skills.map((entry, index) => parseSkill(entry, index, vendorRoot));
  const personas = root.personas.map((entry, index) => parsePersona(entry, index, vendorRoot));
  assertUnique(skills, "skills");
  assertUnique(personas, "personas");

  if (counts.skills !== skills.length) {
    fail(`counts.skills is ${JSON.stringify(counts.skills)}, found ${skills.length}`);
  }
  if (counts.personas !== personas.length) {
    fail(`counts.personas is ${JSON.stringify(counts.personas)}, found ${personas.length}`);
  }

  return {
    version: MANIFEST_VERSION,
    upstream: {
      repo: string(upstream.repo, "upstream.repo"),
      sha: string(upstream.sha, "upstream.sha"),
    },
    counts: { skills: skills.length, personas: personas.length },
    skills,
    personas,
  };
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((id, index) => id === right[index]);
}

/**
 * The plugin refuses to start on a partial or renamed content pack. This is the
 * loud alternative to the old `catch { continue }` loop.
 */
export function assertExpectedContent(manifest: ContentManifest): void {
  if (!sameSet(manifest.skills.map((skill) => skill.id), EXPECTED_SKILL_IDS)) {
    const actual = manifest.skills.map((skill) => skill.id).sort();
    fail(`skills must be exactly ${EXPECTED_SKILL_IDS.join(", ")}; found ${actual.join(", ")}`);
  }
  if (!sameSet(manifest.personas.map((persona) => persona.id), PERSONA_IDS)) {
    const actual = manifest.personas.map((persona) => persona.id).sort();
    fail(`personas must be exactly ${PERSONA_IDS.join(", ")}; found ${actual.join(", ")}`);
  }
}

export function materialize(content: string, vendorRoot: string): string {
  return content.split(VENDOR_ROOT_TOKEN).join(normalizeRoot(vendorRoot));
}

export async function loadManifest(vendorRoot: string): Promise<ContentManifest> {
  const path = join(vendorRoot, MANIFEST_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `opencode-egm: missing ${path}. Run "bun run sync" in the package to generate the content manifest.`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`opencode-egm: ${path} is not valid JSON: ${(error as Error).message}`);
  }

  const manifest = parseManifest(parsed, vendorRoot);
  assertExpectedContent(manifest);
  return manifest;
}
