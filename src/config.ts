import { DEFAULT_TIMEOUT_MS } from "./axiom-client.js";

export interface AxiomMcpConfig {
  apiBaseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

export function configFromEnv(): AxiomMcpConfig {
  return {
    apiBaseUrl:
      process.env.AXIOM_API_BASE_URL?.replace(/\/+$/, "") ||
      "https://api.axiom-foundation.org",
    apiKey: process.env.AXIOM_API_KEY || null,
    timeoutMs: timeoutFromEnv(process.env.AXIOM_API_TIMEOUT_MS)
  };
}

function timeoutFromEnv(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `AXIOM_API_TIMEOUT_MS must be a positive number of milliseconds, got "${raw}"`
    );
  }
  return parsed;
}
