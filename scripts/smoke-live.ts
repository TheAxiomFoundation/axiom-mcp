import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AxiomApiClient } from "../src/axiom-client.js";
import { createAxiomMcpServer } from "../src/server.js";

const baseUrl = process.env.AXIOM_API_BASE_URL || "https://axiom-api-eta.vercel.app";
const apiKey = process.env.AXIOM_API_KEY || "";

if (!apiKey) {
  throw new Error("AXIOM_API_KEY is required for live MCP smoke.");
}

const apiClient = new AxiomApiClient({ baseUrl, apiKey });
const server = createAxiomMcpServer(apiClient);
const client = new Client({ name: "axiom-mcp-smoke", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

try {
  const tools = await client.listTools();
  assertIncludes(
    tools.tools.map((tool) => tool.name),
    "search_rules",
    "tools"
  );

  const capabilities = await client.callTool({ name: "get_capabilities" });
  const packages = readPath<unknown[]>(capabilities.structuredContent, [
    "data",
    "runtime",
    "packages"
  ]);
  if (!Array.isArray(packages) || packages.length < 1) {
    throw new Error("get_capabilities did not return runtime packages");
  }

  const search = await client.callTool({
    name: "search_rules",
    arguments: { query: "colorado snap utility allowance", limit: 5 }
  });
  const searchResults = readPath<unknown[]>(search.structuredContent, [
    "data",
    "results"
  ]);
  if (!Array.isArray(searchResults) || searchResults.length < 1) {
    throw new Error("search_rules returned no results");
  }

  const runtimePackage = await client.callTool({
    name: "get_runtime_package",
    arguments: { jurisdiction: "us-co", program_id: "co-snap" }
  });
  const outputs = readPath<unknown[]>(runtimePackage.structuredContent, [
    "data",
    "package",
    "outputs"
  ]);
  if (
    !Array.isArray(outputs) ||
    !outputs.some((output) => readField(output, "name") === "snap_benefit_amount")
  ) {
    throw new Error("get_runtime_package did not include snap_benefit_amount");
  }

  console.log(`Live MCP smoke passed for ${baseUrl}`);
} finally {
  await client.close();
  await server.close();
}

function assertIncludes(values: string[], expected: string, label: string) {
  if (!values.includes(expected)) {
    throw new Error(`Expected ${label} to include ${expected}`);
  }
}

function readPath<T>(value: unknown, path: string[]): T | undefined {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T;
}

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
