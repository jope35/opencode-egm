import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  VENDOR_ROOT_TOKEN,
  assertExpectedContent,
  loadManifest,
  materialize,
  parseManifest,
} from "../src/manifest.ts";

const fixtureVendor = resolve(import.meta.dir, "fixture/vendor");

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    upstream: { repo: "fixture/repo", sha: "fixture" },
    counts: { skills: 0, personas: 0 },
    skills: [],
    personas: [],
    ...overrides,
  };
}

describe("manifest", () => {
  test("materializes the vendor token with forward slashes", () => {
    expect(materialize(`read ${VENDOR_ROOT_TOKEN}/agents/x.md`, "/pkg/vendor/")).toBe(
      "read /pkg/vendor/agents/x.md",
    );
    expect(materialize(VENDOR_ROOT_TOKEN, "C:\\pkg\\vendor\\")).toBe("C:/pkg/vendor");
  });

  test("loads and validates the fixture content pack", async () => {
    const loaded = await loadManifest(fixtureVendor);
    expect(loaded.counts).toEqual({ skills: 7, personas: 9 });
    expect(loaded.skills.map((skill) => skill.id)).toContain("egm-review");
    expect(loaded.personas.map((persona) => persona.id)).toContain("egm-zoom-out");
    const zoomOut = loaded.personas.find((persona) => persona.id === "egm-zoom-out")!;
    expect(materialize(zoomOut.system, fixtureVendor)).toContain(
      `${fixtureVendor}/resources/document_standards/zoom-out-standard.md`,
    );
  });

  test("rejects a wrong version or count", () => {
    expect(() => parseManifest(manifest({ version: 2 }), fixtureVendor)).toThrow(/version/);
    expect(() =>
      parseManifest(manifest({ counts: { skills: 1, personas: 0 } }), fixtureVendor),
    ).toThrow(/counts.skills/);
  });

  test("rejects a file that escapes vendor", () => {
    expect(() =>
      parseManifest(
        manifest({
          counts: { skills: 1, personas: 0 },
          skills: [
            {
              id: "egm-review",
              name: "egm-review",
              file: "../evil.md",
              sha256: "x",
              content: "body",
            },
          ],
        }),
        fixtureVendor,
      ),
    ).toThrow(/relative path/);
  });

  test("rejects a content pack with a missing persona", async () => {
    const loaded = await loadManifest(fixtureVendor);
    expect(() =>
      assertExpectedContent({ ...loaded, personas: loaded.personas.slice(1) }),
    ).toThrow(/personas must be exactly/);
  });

  test("reports a missing manifest with the sync hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "egm-no-manifest-"));
    try {
      await expect(loadManifest(dir)).rejects.toThrow(
        /missing .*manifest\.json.*run "bun run sync"/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
