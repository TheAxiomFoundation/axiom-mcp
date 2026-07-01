import { AxiomApiError } from "./axiom-client.js";
import type { AxiomApiClient } from "./axiom-client.js";

export interface AxiomToolContext {
  client: AxiomApiClient;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

export async function getCapabilities(context: AxiomToolContext): Promise<ToolResult> {
  return runTool(() => context.client.capabilities);
}

export async function searchRules(
  context: AxiomToolContext,
  input: {
    query: string;
    jurisdiction?: string;
    program_id?: string;
    limit?: number;
  }
): Promise<ToolResult> {
  return runTool(() => context.client.searchRules(input));
}

export async function getRule(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return runTool(() => context.client.getRule(input.rule_id));
}

export async function getRuleSources(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return runTool(() => context.client.getRuleSources(input.rule_id));
}

export async function getRuleDependencies(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return runTool(() => context.client.getRuleDependencies(input.rule_id));
}

export async function listRuntimePackages(
  context: AxiomToolContext
): Promise<ToolResult> {
  return runTool(() => context.client.listRuntimePackages());
}

export async function getRuntimePackage(
  context: AxiomToolContext,
  input: { jurisdiction: string; program_id: string }
): Promise<ToolResult> {
  return runTool(() =>
    context.client.getRuntimePackage(input.jurisdiction, input.program_id)
  );
}

export async function listParityCases(
  context: AxiomToolContext
): Promise<ToolResult> {
  return runTool(() => context.client.listParityCases());
}

export async function runParityCases(
  context: AxiomToolContext
): Promise<ToolResult> {
  return runTool(() => context.client.runParityCases());
}

export async function calculateHousehold(
  context: AxiomToolContext,
  input: {
    program_id: string;
    jurisdiction: string;
    household: Record<string, unknown>;
    variables?: string[];
  }
): Promise<ToolResult> {
  return runTool(() => context.client.calculateHousehold(input));
}

async function runTool(call: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return asToolResult(await call());
  } catch (error) {
    if (error instanceof AxiomApiError) {
      return asToolResult(
        {
          error: {
            message: error.message,
            http_status: error.status,
            ...(error.retryAfter === null ? {} : { retry_after: error.retryAfter }),
            api_response: error.body
          }
        },
        true
      );
    }
    throw error;
  }
}

function asToolResult(value: unknown, isError = false): ToolResult {
  const structuredContent =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent,
    ...(isError ? { isError: true } : {})
  };
}
