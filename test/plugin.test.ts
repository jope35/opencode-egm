import { afterEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import plugin from "../src/index.ts";

const fixtureVendor = resolve(import.meta.dir, "fixture/vendor");

const REVIEWERS = [
  "egm-zoom-out",
  "egm-comprehension",
  "egm-design",
  "egm-structural",
  "egm-style",
  "egm-implementation-readiness",
  "egm-codebase-details",
];
const ORCHESTRATORS = ["egm-synthesizer", "egm-bootstrap-orchestrator"];
const READ_ONLY_ACTIONS = [
  "edit",
  "shell",
  "subagent",
  "webfetch",
  "websearch",
  "browser",
  "execute",
  "experimental_image_generate",
];

const originalRoot = process.env.EGM_PACKAGE_ROOT;
afterEach(() => {
  if (originalRoot === undefined) delete process.env.EGM_PACKAGE_ROOT;
  else process.env.EGM_PACKAGE_ROOT = originalRoot;
});

function createCtx(
  options: Record<string, unknown> = {},
  sessionAgents: Record<string, string> = {},
) {
  const skills = new Map<string, any>();
  const agents = new Map<string, any>();
  const calls: {
    skills: any[];
    agents: any[];
    default: number;
    skillReload: number;
    agentReload: number;
    skillsAtReload: number;
    agentsAtReload: number;
    disposals: number;
    disposed: number;
    hook?: (input: any) => Promise<void>;
    hookDisposed: number;
  } = {
    skills: [],
    agents: [],
    default: 0,
    skillReload: 0,
    agentReload: 0,
    skillsAtReload: -1,
    agentsAtReload: -1,
    disposals: 0,
    disposed: 0,
    hook: undefined,
    hookDisposed: 0,
  };
  const register = () => ({
    dispose: async () => {
      calls.disposed++;
    },
  });

  const ctx = {
    options,
    skill: {
      transform: async (callback: (editor: any) => void) => {
        calls.disposals++;
        await new Promise((resolvePromise) => queueMicrotask(resolvePromise));
        callback({
          list: () => [...skills.values()],
          get: (id: string) => skills.get(id),
          add: (skill: any) => {
            skills.set(skill.id, skill);
            calls.skills.push(skill);
          },
          update: (id: string, update: (skill: any) => void) => {
            const skill = { ...(skills.get(id) ?? { id }) };
            update(skill);
            skills.set(id, skill);
          },
          remove: (id: string) => skills.delete(id),
        });
        return register();
      },
      reload: async () => {
        calls.skillReload++;
        calls.skillsAtReload = skills.size;
      },
    },
    agent: {
      transform: async (callback: (editor: any) => void) => {
        calls.disposals++;
        await new Promise((resolvePromise) => queueMicrotask(resolvePromise));
        callback({
          list: () => [...agents.values()],
          get: (id: string) => agents.get(id),
          default: () => {
            calls.default++;
          },
          update: (id: string, update: (agent: any) => void) => {
            const agent = {
              id,
              name: id,
              request: { settings: {}, headers: {}, body: {} },
              mode: "all",
              hidden: false,
              permissions: [],
              ...(agents.get(id) ?? {}),
            };
            update(agent);
            agents.set(id, agent);
            calls.agents.push(agent);
          },
          remove: (id: string) => agents.delete(id),
        });
        return register();
      },
      reload: async () => {
        calls.agentReload++;
        calls.agentsAtReload = agents.size;
      },
    },
    permission: {
      hook: async (name: string, callback: (input: any) => Promise<void>) => {
        calls.disposals++;
        if (name !== "evaluate") throw new Error(`unexpected hook ${name}`);
        calls.hook = callback;
        return {
          dispose: async () => {
            calls.hookDisposed++;
          },
        };
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const agent = sessionAgents[sessionID];
        if (!agent) throw new Error("session not found");
        return { agent };
      },
    },
  };
  return { ctx, skills, agents, calls };
}

async function runSetup(
  options: Record<string, unknown> = {},
  sessionAgents: Record<string, string> = {},
) {
  process.env.EGM_PACKAGE_ROOT = fixtureVendor;
  const state = createCtx(options, sessionAgents);
  const cleanup = (await plugin.setup(state.ctx as any)) as () => Promise<void>;
  return { ...state, cleanup };
}

describe("plugin registration", () => {
  test("registers the 7 skills with absolute paths and rewritten content", async () => {
    const { skills, calls } = await runSetup();
    expect([...skills.keys()].sort()).toEqual(
      [
        "egm-brainstorm",
        "egm-draft",
        "egm-review",
        "egm-review-loop",
        "egm-resolve",
        "egm-drift-report",
        "egm-bootstrap",
      ].sort(),
    );

    for (const skill of skills.values()) {
      expect(skill.path.startsWith("/")).toBe(true);
      expect(skill.autoinvoke).toBe(false);
      expect(skill.content.trimStart().startsWith("In OpenCode, read ")).toBe(true);
      expect(skill.content).toContain(`${fixtureVendor}/docs/opencode.md`);
      expect(skill.content).toContain(
        `${fixtureVendor}/resources/document_standards/zoom-out-standard.md`,
      );
      expect(skill.content).toContain(`${fixtureVendor}/agents/comprehension.md`);
      expect(skill.content).toContain(`${fixtureVendor}/docs/harnesses.md`);
      expect(skill.content).toContain("docs/designs/architecture.md");
      expect(skill.content).toContain("subagents/helper.md");
      expect(skill.content).not.toContain("../../docs/opencode.md");
    }
    expect(skills.get("egm-brainstorm").description).toBe("Fixture skill for egm-brainstorm.");
    expect(calls.skillReload).toBe(1);
    expect(calls.skillsAtReload).toBe(7);
    expect(calls.default).toBe(0);
  });

  test("registers 9 personas and the egm primary agent", async () => {
    const { agents, calls } = await runSetup();
    expect(agents.size).toBe(10);
    expect(agents.get("egm").mode).toBe("primary");
    expect(typeof agents.get("egm").system).toBe("string");
    expect(agents.get("egm").system.length).toBeGreaterThan(0);

    for (const id of [...REVIEWERS, ...ORCHESTRATORS]) {
      const agent = agents.get(id);
      expect(agent.mode).toBe("subagent");
      expect(agent.system).toContain(`Persona body for ${id}.`);
      const actions = agent.permissions.map((rule: any) => rule.action).sort();
      const expected = id === "egm-synthesizer" || id === "egm-bootstrap-orchestrator"
        ? ["edit", "shell"]
        : READ_ONLY_ACTIONS;
      expect(actions).toEqual([...expected].sort());
      for (const rule of agent.permissions) {
        expect(rule.resource).toBe("*");
        expect(rule.effect).toBe("deny");
      }
    }
    expect(calls.default).toBe(0);
    expect(calls.agentReload).toBe(1);
    expect(calls.agentsAtReload).toBe(10);
  });

  test("cleanup disposes every registration", async () => {
    const { cleanup, calls } = await runSetup();
    await cleanup();
    expect(calls.disposals).toBe(18);
    expect(calls.disposed).toBe(17);
    expect(calls.hookDisposed).toBe(1);
  });
});

describe("options.model", () => {
  test("assigns a Model.Ref object to every persona", async () => {
    const { agents } = await runSetup({ model: "anthropic/claude-sonnet-5-5" });
    for (const id of [...REVIEWERS, ...ORCHESTRATORS]) {
      expect(agents.get(id).model).toEqual({
        providerID: "anthropic",
        id: "claude-sonnet-5-5",
      });
    }
  });

  test("splits the provider at the first slash and the variant at the last hash", async () => {
    const { agents } = await runSetup({
      model: "openrouter/anthropic/claude-sonnet-5-5#high",
    });
    expect(agents.get("egm-zoom-out").model).toEqual({
      providerID: "openrouter",
      id: "anthropic/claude-sonnet-5-5",
      variant: "high",
    });
  });

  test("leaves model undefined without the option", async () => {
    const { agents } = await runSetup({});
    for (const id of [...REVIEWERS, ...ORCHESTRATORS]) {
      expect(agents.get(id).model).toBeUndefined();
    }
  });

  test("rejects a malformed model during setup", async () => {
    await expect(runSetup({ model: "not-a-model" })).rejects.toThrow(/model/i);
    await expect(runSetup({ model: "anthropic/" })).rejects.toThrow(/model/i);
    await expect(runSetup({ model: "anthropic/x#" })).rejects.toThrow(/model/i);
  });
});

describe("permission hook", () => {
  test("denies the read-only set for reviewers under a global allow", async () => {
    const { calls } = await runSetup({}, { s1: "egm-zoom-out" });
    for (const action of READ_ONLY_ACTIONS) {
      const input = {
        sessionID: "s1",
        agent: "egm-zoom-out",
        action,
        resources: ["*"],
        effect: "allow",
      };
      await calls.hook!(input);
      expect(input.effect).toBe("deny");
    }
  });

  test("denies edit and shell for orchestrators but keeps subagent allowed", async () => {
    const { calls } = await runSetup({}, { s1: "egm-synthesizer" });
    const edit = { sessionID: "s1", agent: "egm-synthesizer", action: "edit", resources: ["*"], effect: "allow" };
    await calls.hook!(edit);
    expect(edit.effect).toBe("deny");
    const subagent = { sessionID: "s1", agent: "egm-synthesizer", action: "subagent", resources: ["*"], effect: "allow" };
    await calls.hook!(subagent);
    expect(subagent.effect).toBe("allow");
  });

  test("resolves a missing agent from the session", async () => {
    const { calls } = await runSetup({}, { "s-synth": "egm-synthesizer" });
    const input = { sessionID: "s-synth", action: "shell", resources: ["*"], effect: "allow" };
    await calls.hook!(input);
    expect(input.effect).toBe("deny");
  });

  test("leaves other agents unchanged", async () => {
    const { calls } = await runSetup({}, { "s-build": "build" });
    const input = { sessionID: "s-build", agent: "build", action: "edit", resources: ["*"], effect: "allow" };
    await calls.hook!(input);
    expect(input.effect).toBe("allow");
  });
});
