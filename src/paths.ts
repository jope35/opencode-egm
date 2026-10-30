const RELATIVE_PATHS: Record<string, (vendorRoot: string) => string> = {
  "../../docs/opencode.md": (root) => `${root}/docs/opencode.md`,
  "docs/harnesses.md": (root) => `${root}/docs/harnesses.md`,
  "agents/": (root) => `${root}/agents/`,
  "resources/": (root) => `${root}/resources/`,
};

// Rewrite package-relative references to absolute vendor paths. The lookbehind
// keeps `subagents/` and already-absolute paths untouched.
const REFERENCE = /(?<![\w./-])(\.\.\/\.\.\/docs\/opencode\.md|docs\/harnesses\.md|agents\/|resources\/)/g;

export function absolutizePackagePaths(content: string, vendorRoot: string): string {
  const root = vendorRoot.replace(/\/+$/, "");
  return content.replace(REFERENCE, (match) => RELATIVE_PATHS[match](root));
}
