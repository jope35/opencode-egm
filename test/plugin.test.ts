import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import plugin from "../src/index.ts";
import {
  BOOTSTRAP_ORCHESTRATOR_DENY,
  BOOTSTRAP_ORCHESTRATOR_IDS,
  ORCHESTRATOR_IDS,
  REVIEWER_DENY,
  REVIEWER_IDS,
  SYNTHESIZER_DENY,
  SYNTHESIZER_IDS,
} from "../src/policy.ts";

const fixtureVendor = resolve(import.meta.dir, "fixture/vendor");
const tempDirs: string[] = [];

const originalRoot = process.env.EGM_PACKAGE_ROOT;
afterEach(async () => {
  if (originalRoot === undefined) delete process.env.EGM_PACKAGE_ROOT;
  else process.env.EGM_PACKAGE_ROOT = originalRoot;
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function createCtx(
  options: Record<string, unknown> = {},
  sessionAgents: Record<string, unknown> = {},
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
    sessionHook?: (input: any) => Promise<void>;
    sessionHookDisposed: number;
    context: unknown;
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
    sessionHook: undefined,
    sessionHookDisposed: 0,
    context: [],
  };
  const register = () => ({
    dispose: async () => {
      calls.disposed++;
    },
  });

  const ctx = {
    options,
    location: { directory: process.cwd() },
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
        const value = sessionAgents[sessionID];
        if (value === undefined) throw new Error("session not found");
        return typeof value === "string" ? { agent: value } : value;
      },
      context: async () => calls.context,
      hook: async (name: string, callback: (input: any) => Promise<void>) => {
        calls.disposals++;
        if (name !== "experimental.idle") throw new Error(`unexpected session hook ${name}`);
        calls.sessionHook = callback;
        return {
          dispose: async () => {
            calls.sessionHookDisposed++;
          },
        };
      },
    },
  };
  return { ctx, skills, agents, calls };
}

async function runSetup(
  options: Record<string, unknown> = {},
  sessionAgents: Record<string, unknown> = {},
) {
  process.env.EGM_PACKAGE_ROOT = fixtureVendor;
  const state = createCtx({ ledger: false, ...options }, sessionAgents);
  const cleanup = (await plugin.setup(state.ctx as any)) as () => Promise<void>;
  return { ...state, cleanup };
}

function input(agent: string | undefined, action: string, resources: string[] = ["*"]) {
  return { sessionID: "s1", agent, action, resources, effect: "allow" as string };
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
    expect(agents.get("egm").permissions).toEqual([]);

    for (const id of [...REVIEWER_IDS, ...ORCHESTRATOR_IDS]) {
      const agent = agents.get(id);
      expect(agent.mode).toBe("subagent");
      expect(agent.system).toContain(`Persona body for ${id}.`);
      const expected =
        id === SYNTHESIZER_IDS[0]
          ? SYNTHESIZER_DENY
          : id === BOOTSTRAP_ORCHESTRATOR_IDS[0]
            ? BOOTSTRAP_ORCHESTRATOR_DENY
            : REVIEWER_DENY;
      const actions = agent.permissions.map((rule: any) => rule.action).sort();
      expect(actions).toEqual([...expected].sort());
      for (const rule of agent.permissions) {
        expect(rule.resource).toBe("*");
        expect(rule.effect).toBe("deny");
      }
    }
    expect(calls.default).toBe(0);
    expect(calls.agentReload).toBe(1);
    expect(calls.agentsAtReload).toBe(10);

    expect(agents.get("egm-zoom-out").system).toContain(
      `${fixtureVendor}/resources/document_standards/zoom-out-standard.md`,
    );
    expect(agents.get("egm-zoom-out").system).not.toContain(
      "`resources/document_standards/zoom-out-standard.md`",
    );
  });

  test("cleanup disposes every registration", async () => {
    const { cleanup, calls } = await runSetup();
    await cleanup();
    expect(calls.disposals).toBe(18);
    expect(calls.disposed).toBe(17);
    expect(calls.hookDisposed).toBe(1);
    expect(calls.sessionHookDisposed).toBe(0);
  });
});

describe("options.model", () => {
  test("assigns a default Model.Ref object to every persona", async () => {
    const { agents } = await runSetup({ model: "anthropic/claude-sonnet-5-5" });
    for (const id of [...REVIEWER_IDS, ...ORCHESTRATOR_IDS]) {
      expect(agents.get(id).model).toEqual({
        providerID: "anthropic",
        id: "claude-sonnet-5-5",
      });
    }
    expect(agents.get("egm").model).toBeUndefined();
  });

  test("overrides one persona and keeps the default for the rest", async () => {
    const { agents } = await runSetup({
      model: "anthropic/default",
      models: { "egm-zoom-out": "openai/gpt-5" },
    });
    expect(agents.get("egm-zoom-out").model).toEqual({ providerID: "openai", id: "gpt-5" });
    expect(agents.get("egm-comprehension").model).toEqual({
      providerID: "anthropic",
      id: "default",
    });
  });

  test("routes the egm primary agent only when explicitly configured", async () => {
    const { agents } = await runSetup({ models: { egm: "google/gemini-3" } });
    expect(agents.get("egm").model).toEqual({ providerID: "google", id: "gemini-3" });
    expect(agents.get("egm-zoom-out").model).toBeUndefined();
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

  test("rejects a malformed model during setup with a visible diagnostic", async () => {
    const messages: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };
    try {
      await expect(runSetup({ model: "not-a-model" })).rejects.toThrow(/model/i);
      await expect(runSetup({ model: "anthropic/" })).rejects.toThrow(/model/i);
      await expect(runSetup({ model: "anthropic/x#" })).rejects.toThrow(/model/i);
      await expect(
        runSetup({ models: { "egm-zoom-out": "not-a-model" } }),
      ).rejects.toThrow(/models\.egm-zoom-out/);
    } finally {
      console.error = original;
    }
    expect(messages.join("\n")).toContain('invalid plugin option "model"');
  });

  test("rejects an unknown per-persona key", async () => {
    await expect(runSetup({ models: { "egm-nope": "openai/gpt-5" } })).rejects.toThrow(
      /unknown agent/,
    );
  });
});

describe("permission hook", () => {
  test("allows only the reviewer safe actions and denies MCP tools", async () => {
    const { calls } = await runSetup({}, { s1: REVIEWER_IDS[0] });
    for (const action of [
      "read",
      "glob",
      "grep",
      "skill",
      "question",
      "external_directory",
    ]) {
      const event = input(REVIEWER_IDS[0], action);
      await calls.hook!(event);
      expect(event.effect).toBe("allow");
    }
    for (const action of [...REVIEWER_DENY, "github_write", "server_delete"]) {
      const event = input(REVIEWER_IDS[0], action);
      await calls.hook!(event);
      expect(event.effect).toBe("deny");
    }
  });

  test("lets the synthesizer spawn reviewers only", async () => {
    const { calls } = await runSetup({}, { s1: SYNTHESIZER_IDS[0] });
    for (const action of ["edit", "shell", "execute"]) {
      const event = input(SYNTHESIZER_IDS[0], action);
      await calls.hook!(event);
      expect(event.effect).toBe("deny");
    }
    for (const target of REVIEWER_IDS) {
      const event = input(SYNTHESIZER_IDS[0], "subagent", [target]);
      await calls.hook!(event);
      expect(event.effect).toBe("allow");
    }
    for (const target of ["build", "general", BOOTSTRAP_ORCHESTRATOR_IDS[0]]) {
      const event = input(SYNTHESIZER_IDS[0], "subagent", [target]);
      await calls.hook!(event);
      expect(event.effect).toBe("deny");
    }
  });

  test("lets the bootstrap orchestrator write and spawn itself only", async () => {
    const { calls } = await runSetup({}, { s1: BOOTSTRAP_ORCHESTRATOR_IDS[0] });
    for (const action of ["read", "edit", "shell"]) {
      const event = input(BOOTSTRAP_ORCHESTRATOR_IDS[0], action);
      await calls.hook!(event);
      expect(event.effect).toBe("allow");
    }
    const self = input(BOOTSTRAP_ORCHESTRATOR_IDS[0], "subagent", [
      BOOTSTRAP_ORCHESTRATOR_IDS[0],
    ]);
    await calls.hook!(self);
    expect(self.effect).toBe("allow");
    const other = input(BOOTSTRAP_ORCHESTRATOR_IDS[0], "subagent", ["build"]);
    await calls.hook!(other);
    expect(other.effect).toBe("deny");
    const web = input(BOOTSTRAP_ORCHESTRATOR_IDS[0], "webfetch");
    await calls.hook!(web);
    expect(web.effect).toBe("deny");
  });

  test("resolves a missing agent from the session", async () => {
    const { calls } = await runSetup({}, { "s-synth": SYNTHESIZER_IDS[0] });
    const event = input(undefined, "shell");
    event.sessionID = "s-synth";
    await calls.hook!(event);
    expect(event.effect).toBe("deny");
  });

  test("leaves other agents unchanged", async () => {
    const { calls } = await runSetup({}, { "s-build": "build" });
    const event = input("build", "edit");
    event.sessionID = "s-build";
    await calls.hook!(event);
    expect(event.effect).toBe("allow");
  });

  test("fails closed for an unresolved session", async () => {
    const { calls } = await runSetup({}, {});
    for (const action of ["edit", "shell", "github_write"]) {
      const event = input(undefined, action);
      event.sessionID = "missing";
      await calls.hook!(event);
      expect(event.effect).toBe("deny");
    }
    const read = input(undefined, "read");
    read.sessionID = "missing";
    await calls.hook!(read);
    expect(read.effect).toBe("allow");
  });
});

describe("review ledger", () => {
  test("writes tokens, cost, duration and finding markers for a persona", async () => {
    const dir = await mkdtemp(join(tmpdir(), "egm-ledger-"));
    tempDirs.push(dir);
    const path = join(dir, "ledger.jsonl");
    const session = {
      agent: "egm-zoom-out",
      parentID: "parent",
      model: { providerID: "anthropic", id: "claude-sonnet-5-5", variant: "high" },
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 1, write: 2 } },
      cost: 0.5,
      outcome: "succeeded",
      time: { created: 1_000, idle: 2_500 },
    };
    const { calls } = await runSetup({ ledger: path }, { child: session });
    calls.context = [{ type: "assistant", text: "🔴 one 🟡 two 🟢 three" }];

    await calls.sessionHook!({ sessionID: "child", background: [] });

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({
      sessionID: "child",
      parentSessionID: "parent",
      agent: "egm-zoom-out",
      model: "anthropic/claude-sonnet-5-5#high",
      outcome: "succeeded",
      durationMs: 1_500,
      tokens: session.tokens,
      cost: 0.5,
      findingMarkers: 3,
    });
  });

  test("ignores non-EGM sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "egm-ledger-"));
    tempDirs.push(dir);
    const path = join(dir, "ledger.jsonl");
    const { calls } = await runSetup({ ledger: path }, { user: { agent: "build" } });

    await calls.sessionHook!({ sessionID: "user", background: [] });

    expect(await Bun.file(path).exists()).toBe(false);
  });
});
