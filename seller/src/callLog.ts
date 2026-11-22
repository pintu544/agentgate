/**
 * Append-only call log for POST /api/snapshot attempts (SPEC FR4).
 *
 * One JSON object per line in seller/data/calls.jsonl (gitignored). On
 * hosts with a read-only project filesystem (Vercel), writes fall back
 * to /tmp so the /log page still works per-instance; write failures are
 * swallowed after a console error — logging must never break a request.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CallResult = "denied" | "payment-required" | "served";

export interface CallLogEntry {
  ts: string;
  caller: string | null;
  verified: boolean;
  result: CallResult;
  error?: string;
  topic?: string;
  agentId?: string;
  amount?: string;
  asset?: string;
  settlement?: string | null;
}

const FALLBACK_PATH = "/tmp/agentgate-calls.jsonl";

function defaultLogPath(): string {
  // src/callLog.ts -> seller/data/calls.jsonl
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "data", "calls.jsonl");
}

/** Winning write path per requested primary path (fallback sticks). */
const resolvedByPrimary = new Map<string, string>();

export async function appendCallLog(
  entry: CallLogEntry,
  configuredPath?: string,
): Promise<void> {
  const primary = configuredPath ?? defaultLogPath();
  const resolved = resolvedByPrimary.get(primary);
  const candidates = resolved ? [resolved] : [primary, FALLBACK_PATH];
  for (const candidate of candidates) {
    try {
      await mkdir(path.dirname(candidate), { recursive: true });
      await appendFile(candidate, JSON.stringify(entry) + "\n", "utf8");
      resolvedByPrimary.set(primary, candidate);
      return;
    } catch {
      // try the next candidate
    }
  }
  console.error("[agentgate] call log write failed on all paths", entry);
}

export async function readCallLog(configuredPath?: string): Promise<CallLogEntry[]> {
  const primary = configuredPath ?? defaultLogPath();
  const resolved = resolvedByPrimary.get(primary);
  const candidates = resolved ? [resolved] : [primary, FALLBACK_PATH];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as CallLogEntry);
    } catch {
      // try the next candidate
    }
  }
  return [];
}
