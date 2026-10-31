/**
 * One source of truth for content IDs, persona capabilities and permission
 * rules. The plugin, the tests and the sync script all read this file.
 */

export const EXPECTED_SKILL_IDS = [
  "egm-bootstrap",
  "egm-brainstorm",
  "egm-draft",
  "egm-drift-report",
  "egm-resolve",
  "egm-review",
  "egm-review-loop",
] as const;

export const REVIEWER_IDS = [
  "egm-zoom-out",
  "egm-comprehension",
  "egm-design",
  "egm-structural",
  "egm-style",
  "egm-implementation-readiness",
  "egm-codebase-details",
] as const;

export const SYNTHESIZER_IDS = ["egm-synthesizer"] as const;
export const BOOTSTRAP_ORCHESTRATOR_IDS = ["egm-bootstrap-orchestrator"] as const;
export const ORCHESTRATOR_IDS = [
  ...SYNTHESIZER_IDS,
  ...BOOTSTRAP_ORCHESTRATOR_IDS,
] as const;
export const PERSONA_IDS = [...REVIEWER_IDS, ...ORCHESTRATOR_IDS] as const;

/**
 * Actions that only read. A reviewer needs `external_directory` to open the
 * standards under the installed package, which live outside the project.
 */
export const SAFE_ACTIONS = [
  "read",
  "glob",
  "grep",
  "skill",
  "question",
  "external_directory",
] as const;

export interface Policy {
  readonly allow: readonly string[];
  readonly subagentTargets: readonly string[];
}

export const REVIEWER_POLICY: Policy = {
  allow: SAFE_ACTIONS,
  subagentTargets: [],
};

/**
 * The synthesizer only aggregates reviews. It may spawn reviewers, never an
 * agent that can write.
 */
export const SYNTHESIZER_POLICY: Policy = {
  allow: [...SAFE_ACTIONS, "subagent"],
  subagentTargets: REVIEWER_IDS,
};

/**
 * Bootstrap writes README files, which the upstream skill explicitly requires
 * (`file-writing` and `file-editing` tools). It is a documented writer, not a
 * reviewer. It may only nest itself, never an arbitrary agent.
 */
export const BOOTSTRAP_ORCHESTRATOR_POLICY: Policy = {
  allow: [...SAFE_ACTIONS, "edit", "shell", "subagent"],
  subagentTargets: BOOTSTRAP_ORCHESTRATOR_IDS,
};

const REVIEWERS = new Set<string>(REVIEWER_IDS);
const SYNTHESIZERS = new Set<string>(SYNTHESIZER_IDS);
const BOOTSTRAP_ORCHESTRATORS = new Set<string>(BOOTSTRAP_ORCHESTRATOR_IDS);

export function policyFor(agentID: string | undefined): Policy | undefined {
  if (agentID === undefined) return undefined;
  if (REVIEWERS.has(agentID)) return REVIEWER_POLICY;
  if (SYNTHESIZERS.has(agentID)) return SYNTHESIZER_POLICY;
  if (BOOTSTRAP_ORCHESTRATORS.has(agentID)) return BOOTSTRAP_ORCHESTRATOR_POLICY;
  return undefined;
}

export interface PermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
}

/**
 * Actions each persona must never use. These rules are the visible first layer;
 * the `evaluate` hook below is the allowlist that also covers MCP tools and
 * actions the host adds in a later release. Agent rules only ever deny, so a
 * user's global deny stays final and is never widened by this plugin.
 */
export const REVIEWER_DENY = [
  "edit",
  "shell",
  "subagent",
  "webfetch",
  "websearch",
  "execute",
  "experimental_image_generate",
] as const;

export const SYNTHESIZER_DENY = [
  "edit",
  "shell",
  "webfetch",
  "websearch",
  "execute",
  "experimental_image_generate",
] as const;

export const BOOTSTRAP_ORCHESTRATOR_DENY = [
  "webfetch",
  "websearch",
  "execute",
  "experimental_image_generate",
] as const;

export function denyActionsFor(agentID: string): readonly string[] | undefined {
  if (REVIEWERS.has(agentID)) return REVIEWER_DENY;
  if (SYNTHESIZERS.has(agentID)) return SYNTHESIZER_DENY;
  if (BOOTSTRAP_ORCHESTRATORS.has(agentID)) return BOOTSTRAP_ORCHESTRATOR_DENY;
  return undefined;
}

export function permissionRules(agentID: string): PermissionRule[] {
  const actions = denyActionsFor(agentID);
  if (!actions) return [];
  return actions.map((action) => ({ action, resource: "*", effect: "deny" as const }));
}

/** Actions allowed when the session's persona cannot be resolved. */
export const UNRESOLVED_ALLOW = new Set<string>(SAFE_ACTIONS);

/** True when every requested target is an allowed subagent target. */
export function subagentTargetsAllowed(policy: Policy, resources: readonly string[]): boolean {
  if (!policy.allow.includes("subagent")) return false;
  if (policy.subagentTargets.length === 0) return false;
  return resources.every((resource) => policy.subagentTargets.includes(resource));
}
