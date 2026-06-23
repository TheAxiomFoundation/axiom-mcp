import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AxiomApiClient } from "./axiom-client.js";
import {
  calculateHousehold,
  getCapabilities,
  getRule,
  getRuleDependencies,
  getRuleSources,
  getRuntimePackage,
  listRuntimePackages,
  searchRules
} from "./tool-handlers.js";

export function createAxiomMcpServer(client: AxiomApiClient): McpServer {
  const server = new McpServer({
    name: "axiom-mcp",
    version: "0.1.0"
  });
  const context = { client };

  server.registerTool(
    "get_capabilities",
    {
      title: "Get Axiom API capabilities",
      description:
        "Read API version, environment, endpoints, repository status, runtime packages, and sample calculation requests."
    },
    async () => getCapabilities(context)
  );

  server.registerTool(
    "search_rules",
    {
      title: "Search Axiom rules",
      description:
        "Search encoded and source-linked rules. Use jurisdiction/program filters when the user names a location or benefit program.",
      inputSchema: {
        query: z.string().min(2),
        jurisdiction: z.string().optional(),
        program_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async (input) => searchRules(context, input)
  );

  server.registerTool(
    "get_rule",
    {
      title: "Get an Axiom rule",
      description:
        "Read one rule by stable rule id or citation path, including summary, symbols, provenance, dependencies, and dependents.",
      inputSchema: {
        rule_id: z.string().min(1)
      }
    },
    async (input) => getRule(context, input)
  );

  server.registerTool(
    "get_rule_sources",
    {
      title: "Get rule sources",
      description: "Read source and provenance references for one rule.",
      inputSchema: {
        rule_id: z.string().min(1)
      }
    },
    async (input) => getRuleSources(context, input)
  );

  server.registerTool(
    "get_rule_dependencies",
    {
      title: "Get rule dependency graph",
      description: "Read upstream dependencies and downstream dependents for one rule.",
      inputSchema: {
        rule_id: z.string().min(1)
      }
    },
    async (input) => getRuleDependencies(context, input)
  );

  server.registerTool(
    "list_runtime_packages",
    {
      title: "List executable runtime packages",
      description:
        "List programs executable by the configured Axiom calculation runtime."
    },
    async () => listRuntimePackages(context)
  );

  server.registerTool(
    "get_runtime_package",
    {
      title: "Get runtime package detail",
      description:
        "Read executable package inputs, outputs, aliases, and sample request for a program.",
      inputSchema: {
        jurisdiction: z.string().min(1),
        program_id: z.string().min(1)
      }
    },
    async (input) => getRuntimePackage(context, input)
  );

  server.registerTool(
    "calculate_household",
    {
      title: "Calculate a household",
      description:
        "Run an Axiom executable package for a household payload. Discover supported package inputs with get_runtime_package first.",
      inputSchema: {
        program_id: z.string().min(1),
        jurisdiction: z.string().min(1),
        household: z.record(z.unknown()),
        variables: z.array(z.string()).optional()
      }
    },
    async (input) => calculateHousehold(context, input)
  );

  return server;
}
