import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const execAsync = promisify(execCb);

export async function hasBinary(name: string): Promise<boolean> {
  try {
    await execAsync(`${name} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function fakeScanPath(): string | undefined {
  return process.env.EDGE_FAKE_SCAN_DIR || undefined;
}

export function forceFixtures(): boolean {
  return process.env.EDGE_FORCE_FIXTURES === "1" || process.env.EDGE_FORCE_FIXTURES === "true";
}

export async function readFixture<T>(tool: string): Promise<T | null> {
  const dir = fakeScanPath();
  if (!dir) return null;
  const p = resolve(dir, `${tool}.json`);
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export interface ToolResult<T> {
  ok: boolean;
  tool: string;
  data?: T;
  error?: string;
  binaryAvailable: boolean;
}

export function ok<T>(tool: string, data: T, binaryAvailable = true): ToolResult<T> {
  return { ok: true, tool, data, binaryAvailable };
}

export function unavailable<T>(tool: string, reason: string): ToolResult<T> {
  return { ok: false, tool, binaryAvailable: false, error: reason };
}

export function failed<T>(tool: string, err: unknown, binaryAvailable = true): ToolResult<T> {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, tool, binaryAvailable, error: msg };
}

export function safeTarget(target: string): string {
  return resolve(target);
}
