import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin } from "@opencode/plugin";
import type { Agent, Skill } from "@opencode/plugin";
import { appendLedger, countFindingMarkers, ledgerRecord } from "./ledger.ts";
import { loadManifest, materialize } from "./manifest.ts";
import { parseLedgerOption, parseModelRouting } from "./model.ts";
import { normalizeRoot } from "./paths.ts";
import {
  PERSONA_IDS,
  UNRESOLVED_ALLOW,
  permissionRules,
  policyFor,
  subagentTargetsAllowed,
} from "./policy.ts";

const ELEPHANT_PROMPT = `You are the Elephant: the context-rich session of the Elephant-Goldfish Model (EGM).

- Do not write code in this session. The Elephant designs, reviews, and decides; implementation happens elsewhere.
- Deliver artifacts first. Write long proposals, drafts, and reports to a file, then summarize the path and the decision in the chat. Do not paste large documents into the conversation.
- Enumerate every file the change will touch before asking for approval.
- Wait for explicit human approval before implementation starts. The human is the approver.
- For Goldfish reviews, dispatch each reviewer persona directly with OpenCode's \`subagent\` tool at the default depth. Use \`egm-synthesizer\` only when \`experimental.subagent_depth\` is 2.
- Pause at each single-question gate and wait for the answer.`;

interface Disposable {
  dispose: () => Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default Plugin.define({
  id: "opencode-egm",
  async setup(ctx) {
    const disposals: Disposable[] = [];
    const cleanup = async () => {
      for (const disposable of disposals) {
        try {
          await disposable.dispose();
        } catch (error) {
          console.error(`opencode-egm: dispose failed: ${describe(error)}`);
        }
      }
    };

    try {
      const vendorRoot =
        process.env.EGM_PACKAGE_ROOT ?? fileURLToPath(new URL("../vendor", import.meta.url));
      const contentRoot = normalizeRoot(vendorRoot);
      const manifest = await loadManifest(vendorRoot);
      const routing = parseModelRouting(ctx.options, [...PERSONA_IDS, "egm"]);
      const ledgerPath = parseLedgerOption(
        (ctx.options as { ledger?: unknown }).ledger,
        String(ctx.location.directory),
      );

      for (const skill of manifest.skills) {
        disposals.push(
          await ctx.skill.transform((editor) =>
            editor.add({
              id: skill.id as Skill.Info["id"],
              name: skill.name as Skill.Info["name"],
              description: skill.description,
              path: join(vendorRoot, skill.file) as Skill.Info["path"],
              content: materialize(skill.content, contentRoot),
              autoinvoke: skill.autoinvoke,
            }),
          ),
        );
      }
      await ctx.skill.reload();

      for (const persona of manifest.personas) {
        const policy = policyFor(persona.id);
        if (!policy) {
          throw new Error(`content manifest contains an unregistered persona "${persona.id}"`);
        }
        const model = routing.byAgent.get(persona.id) ?? routing.default;
        disposals.push(
          await ctx.agent.transform((editor) =>
            editor.update(persona.id, (agent) => {
              agent.description = persona.description ?? persona.id;
              agent.mode = "subagent";
              agent.system = materialize(persona.system, contentRoot);
              agent.permissions = permissionRules(persona.id);
              if (model) agent.model = model as Agent.Info["model"];
            }),
          ),
        );
      }

      const egmModel = routing.byAgent.get("egm");
      disposals.push(
        await ctx.agent.transform((editor) =>
          editor.update("egm", (agent) => {
            agent.description =
              "Elephant session for the Elephant-Goldfish Model: design and review, no code.";
            agent.mode = "primary";
            agent.system = ELEPHANT_PROMPT;
            if (egmModel) agent.model = egmModel as Agent.Info["model"];
          }),
        ),
      );
      await ctx.agent.reload();

      disposals.push(
        await ctx.permission.hook("evaluate", async (input) => {
          let agentID = input.agent === undefined ? undefined : String(input.agent);
          if (agentID === undefined) {
            try {
              const session = await ctx.session.get({ sessionID: input.sessionID });
              agentID = session.agent === undefined ? undefined : String(session.agent);
            } catch {
              // A session we cannot identify gets no side effects. This is the
              // fail-closed path for a transient session lookup failure.
              if (!UNRESOLVED_ALLOW.has(input.action)) {
                input.effect = "deny";
                input.message = `EGM: could not resolve the agent for this session; ${input.action} is denied.`;
              }
              return;
            }
          }

          const policy = policyFor(agentID);
          if (!policy) return;

          if (!policy.allow.includes(input.action)) {
            input.effect = "deny";
            input.message = `EGM persona ${agentID} may not use ${input.action}.`;
            return;
          }
          if (input.action === "subagent" && !subagentTargetsAllowed(policy, input.resources)) {
            input.effect = "deny";
            input.message = `EGM persona ${agentID} may only spawn: ${policy.subagentTargets.join(", ")}.`;
          }
        }),
      );

      if (ledgerPath) {
        disposals.push(
          await ctx.session.hook("experimental.idle", async (idle) => {
            try {
              const session = await ctx.session.get({ sessionID: idle.sessionID });
              const agent = session.agent === undefined ? undefined : String(session.agent);
              if (agent === undefined || (agent !== "egm" && !agent.startsWith("egm-"))) return;

              let findingMarkers: number | undefined;
              if (agent !== "egm") {
                try {
                  const context = await ctx.session.context({ sessionID: idle.sessionID });
                  findingMarkers = countFindingMarkers(JSON.stringify(context));
                } catch {
                  findingMarkers = undefined;
                }
              }

              await appendLedger(
                ledgerPath,
                ledgerRecord(String(idle.sessionID), session, findingMarkers),
              );
            } catch (error) {
              console.error(`opencode-egm: review ledger: ${describe(error)}`);
            }
          }),
        );
      }

      return cleanup;
    } catch (error) {
      // The server swallows a thrown setup error; log it before it disappears.
      console.error(`opencode-egm: ${describe(error)}`);
      await cleanup();
      throw error;
    }
  },
});
