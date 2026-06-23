import type { AxiomApiClient } from "./axiom-client.js";

export interface AxiomToolContext {
  client: AxiomApiClient;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

export async function getCapabilities(context: AxiomToolContext): Promise<ToolResult> {
  return asToolResult(await context.client.capabilities);
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
  return asToolResult(await context.client.searchRules(input));
}

export async function getRule(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return asToolResult(await context.client.getRule(input.rule_id));
}

export async function getRuleSources(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return asToolResult(await context.client.getRuleSources(input.rule_id));
}

export async function getRuleDependencies(
  context: AxiomToolContext,
  input: { rule_id: string }
): Promise<ToolResult> {
  return asToolResult(await context.client.getRuleDependencies(input.rule_id));
}

export async function listRuntimePackages(
  context: AxiomToolContext
): Promise<ToolResult> {
  return asToolResult(await context.client.listRuntimePackages());
}

export async function getRuntimePackage(
  context: AxiomToolContext,
  input: { jurisdiction: string; program_id: string }
): Promise<ToolResult> {
  return asToolResult(
    await context.client.getRuntimePackage(input.jurisdiction, input.program_id)
  );
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
  return asToolResult(await context.client.calculateHousehold(input));
}

function asToolResult(value: unknown): ToolResult {
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
    structuredContent
  };
}
