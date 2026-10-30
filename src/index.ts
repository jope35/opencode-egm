import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin } from "@opencode/plugin";
import type { Agent, Skill } from "@opencode/plugin";
import { parseFrontmatter } from "./frontmatter.ts";
import { parseModelRef } from "./model.ts";
import { absolutizePackagePaths } from "./paths.ts";

const REVIEWER_IDS = [
  "egm-zoom-out",
  "egm-comprehension",
  "egm-design",
  "egm-structural",
  "egm-style",
  "egm-implementation-readiness",
  "egm-codebase-details",
];
const ORCHESTRATOR_IDS = ["egm-synthesizer", "egm-bootstrap-orchestrator"];
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
const ORCHESTRATOR_DENY = ["edit", "shell"];

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

export default Plugin.define({
  id: "opencode-egm",
  async setup(ctx) {
    const vendorRoot =
      process.env.EGM_PACKAGE_ROOT ?? fileURLToPath(new URL("../vendor", import.meta.url));
    const optionValue = (ctx.options as { model?: unknown }).model;
    const model = optionValue === undefined ? undefined : parseModelRef(optionValue as string);
    const disposals: Disposable[] = [];

    const skillEntries = (await readdir(join(vendorRoot, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of skillEntries) {
      const id = entry.name;
      const skillPath = join(vendorRoot, "skills", id, "SKILL.md");
      let text: string;
      try {
        text = await readFile(skillPath, "utf8");
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(text);
      disposals.push(
        await ctx.skill.transform((editor) =>
          editor.add({
            id: id as Skill.Info["id"],
            name: (typeof data.name === "string" ? data.name : id) as Skill.Info["name"],
            description: typeof data.description === "string" ? data.description : undefined,
            path: skillPath as Skill.Info["path"],
            content: absolutizePackagePaths(body, vendorRoot),
            autoinvoke: data["disable-model-invocation"] === true ? false : undefined,
          }),
        ),
      );
    }
    await ctx.skill.reload();

    const agentEntries = (await readdir(join(vendorRoot, "agents")))
      .filter((file) => file.endsWith(".md"))
      .sort();

    for (const file of agentEntries) {
      const { data, body } = parseFrontmatter(
        await readFile(join(vendorRoot, "agents", file), "utf8"),
      );
      if (typeof data.name !== "string") continue;
      const id = data.name;
      const isReviewer = REVIEWER_IDS.includes(id);
      const isOrchestrator = ORCHESTRATOR_IDS.includes(id);
      if (!isReviewer && !isOrchestrator) continue;

      disposals.push(
        await ctx.agent.transform((editor) =>
          editor.update(id, (agent) => {
            agent.description =
              typeof data.description === "string" ? data.description : id;
            agent.mode = "subagent";
            agent.system = body;
            agent.permissions = (isReviewer ? READ_ONLY_ACTIONS : ORCHESTRATOR_DENY).map(
              (action) => ({ action, resource: "*", effect: "deny" as const }),
            );
            if (model) agent.model = model as Agent.Info["model"];
          }),
        ),
      );
    }

    disposals.push(
      await ctx.agent.transform((editor) =>
        editor.update("egm", (agent) => {
          agent.description =
            "Elephant session for the Elephant-Goldfish Model: design and review, no code.";
          agent.mode = "primary";
          agent.system = ELEPHANT_PROMPT;
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
            agentID = undefined;
          }
        }

        const denied = REVIEWER_IDS.includes(agentID ?? "")
          ? READ_ONLY_ACTIONS
          : ORCHESTRATOR_IDS.includes(agentID ?? "")
            ? ORCHESTRATOR_DENY
            : undefined;
        if (!denied || !denied.includes(input.action)) return;

        input.effect = "deny";
        input.message = `EGM persona ${agentID} is read-only: ${input.action} is denied.`;
      }),
    );

    return async () => {
      for (const disposable of disposals) await disposable.dispose();
    };
  },
});
