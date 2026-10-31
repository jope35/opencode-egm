import { isAbsolute, resolve } from "node:path";

export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

export function parseModelRef(value: string): ModelRef {
  const invalid = () => {
    throw new Error(
      `expected "provider/model[#variant]", got ${JSON.stringify(value)}`,
    );
  };
  if (typeof value !== "string") invalid();

  const slash = value.indexOf("/");
  if (slash <= 0) invalid();
  const providerID = value.slice(0, slash);
  let rest = value.slice(slash + 1);

  let variant: string | undefined;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    variant = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (variant === "") invalid();
  }
  if (rest === "") invalid();
  if (/\s/.test(providerID) || /\s/.test(rest) || (variant && /\s/.test(variant))) invalid();

  return variant === undefined ? { providerID, id: rest } : { providerID, id: rest, variant };
}

export interface ModelRouting {
  /** Default for every EGM persona. */
  readonly default?: ModelRef;
  /** Per-persona overrides, keyed by agent ID. */
  readonly byAgent: ReadonlyMap<string, ModelRef>;
}

function optionModel(value: unknown, key: string): ModelRef {
  if (typeof value !== "string") {
    throw new Error(`invalid plugin option ${key}: expected a string`);
  }
  try {
    return parseModelRef(value);
  } catch (error) {
    throw new Error(`invalid plugin option ${key}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * `model` is the default for the nine EGM personas. `models` overrides one
 * persona at a time (or the `egm` primary agent). Unknown keys fail setup, so
 * a typo does not silently leave a persona on the session model.
 */
export function parseModelRouting(
  options: Readonly<Record<string, unknown>>,
  knownAgents: readonly string[],
): ModelRouting {
  const defaultModel =
    options.model === undefined ? undefined : optionModel(options.model, '"model"');

  const byAgent = new Map<string, ModelRef>();
  if (options.models !== undefined) {
    const models = options.models;
    if (models === null || typeof models !== "object" || Array.isArray(models)) {
      throw new Error('invalid plugin option "models": expected an object of agent ID to model');
    }
    const known = new Set(knownAgents);
    for (const [agentID, value] of Object.entries(models)) {
      if (!known.has(agentID)) {
        throw new Error(
          `invalid plugin option "models.${agentID}": unknown agent (expected one of ${knownAgents.join(", ")})`,
        );
      }
      byAgent.set(agentID, optionModel(value, `"models.${agentID}"`));
    }
  }

  return { default: defaultModel, byAgent };
}

export type LedgerOption = false | string;

export function parseLedgerOption(option: unknown, directory: string): string | undefined {
  if (option === false) return undefined;
  const value = option === undefined ? ".egm/review-ledger.jsonl" : option;
  if (value === true) return resolve(directory, ".egm/review-ledger.jsonl");
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('invalid plugin option "ledger": expected true, false, or a path');
  }
  return isAbsolute(value) ? value : resolve(directory, value);
}
