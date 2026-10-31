import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelRef } from "./model.ts";

export interface LedgerTokens {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: { readonly read: number; readonly write: number };
}

export interface LedgerRecord {
  readonly at: string;
  readonly sessionID: string;
  readonly parentSessionID?: string;
  readonly agent: string;
  readonly model?: string;
  readonly outcome?: string;
  readonly startedAt?: string;
  readonly idleAt?: string;
  readonly durationMs?: number;
  readonly tokens?: LedgerTokens;
  readonly cost?: number;
  readonly findingMarkers?: number;
}

/** Structural shape of the fields the ledger reads from a session. */
export interface LedgerSession {
  readonly id?: unknown;
  readonly parentID?: unknown;
  readonly agent?: unknown;
  readonly model?: unknown;
  readonly outcome?: unknown;
  readonly tokens?: unknown;
  readonly cost?: unknown;
  readonly time?: {
    readonly created?: unknown;
    readonly idle?: unknown;
  };
}

export function modelLabel(model: unknown): string | undefined {
  if (model === null || typeof model !== "object") return undefined;
  const value = model as Partial<ModelRef>;
  if (typeof value.providerID !== "string" || typeof value.id !== "string") return undefined;
  return `${value.providerID}/${value.id}${value.variant ? `#${value.variant}` : ""}`;
}

export function countFindingMarkers(text: string): number {
  return (text.match(/🔴|🟡|🟢/gu) ?? []).length;
}

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function toTokens(value: unknown): LedgerTokens | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tokens = value as Record<string, unknown>;
  const cache = tokens.cache;
  if (cache === null || typeof cache !== "object" || Array.isArray(cache)) return undefined;
  const cacheRecord = cache as Record<string, unknown>;
  if (
    typeof tokens.input !== "number" ||
    typeof tokens.output !== "number" ||
    typeof tokens.reasoning !== "number" ||
    typeof cacheRecord.read !== "number" ||
    typeof cacheRecord.write !== "number"
  ) {
    return undefined;
  }
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { read: cacheRecord.read, write: cacheRecord.write },
  };
}

export function ledgerRecord(
  sessionID: string,
  session: LedgerSession,
  findingMarkers?: number,
): LedgerRecord {
  const created = toMillis(session.time?.created);
  const idle = toMillis(session.time?.idle);
  const durationMs =
    created === undefined || idle === undefined ? undefined : Math.max(0, idle - created);

  return {
    at: new Date().toISOString(),
    sessionID,
    parentSessionID: typeof session.parentID === "string" ? session.parentID : undefined,
    agent: typeof session.agent === "string" ? session.agent : "unknown",
    model: modelLabel(session.model),
    outcome: typeof session.outcome === "string" ? session.outcome : undefined,
    startedAt: created === undefined ? undefined : new Date(created).toISOString(),
    idleAt: idle === undefined ? undefined : new Date(idle).toISOString(),
    durationMs,
    tokens: toTokens(session.tokens),
    cost: typeof session.cost === "number" ? session.cost : undefined,
    findingMarkers,
  };
}

export async function appendLedger(path: string, record: LedgerRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}
