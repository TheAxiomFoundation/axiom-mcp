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
  listParityCases,
  listRuntimePackages,
  runParityCases,
  searchRules
} from "./tool-handlers.js";

export function createAxiomMcpServer(client: AxiomApiClient): McpServer {
  const server = new McpServer({
    name: "axiom-mcp",
    version: "0.1.0"
  });
  const context = { client };

  server.registerResource(
    "axiom-capabilities",
    "axiom://capabilities",
    {
      title: "Axiom API capabilities",
      description:
        "API version, environment, endpoint map, repository status, runtime packages, and sample requests.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await client.capabilities)
  );

  server.registerResource(
    "axiom-programs",
    "axiom://programs",
    {
      title: "Axiom programs",
      description: "Programs discoverable from the configured Axiom API.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await client.listPrograms())
  );

  server.registerResource(
    "axiom-runtime-packages",
    "axiom://runtime/packages",
    {
      title: "Axiom runtime packages",
      description: "Executable packages from the configured Axiom runtime.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await client.listRuntimePackages())
  );

  server.registerResource(
    "axiom-parity-cases",
    "axiom://parity/cases",
    {
      title: "Axiom parity cases",
      description:
        "Canonical runtime parity cases and expected outputs from the configured Axiom API.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await client.listParityCases())
  );

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
    "list_parity_cases",
    {
      title: "List parity cases",
      description:
        "List canonical Axiom runtime parity cases, expected outputs, and calculation requests."
    },
    async () => listParityCases(context)
  );

  server.registerTool(
    "run_parity_cases",
    {
      title: "Run parity cases",
      description:
        "Run canonical Axiom runtime parity cases against the active API runtime and return variable-level differences."
    },
    async () => runParityCases(context)
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

  server.registerPrompt(
    "explain_rule_for_caseworker",
    {
      title: "Explain rule for caseworker",
      description:
        "Guide an agent to retrieve sources and explain an encoded rule in operational language.",
      argsSchema: {
        rule_id: z.string().min(1)
      }
    },
    async ({ rule_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Use get_rule and get_rule_sources for ${rule_id}. ` +
              "Explain what the rule does, when it applies, what facts it needs, and cite source references from the API response. Avoid giving legal advice."
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "trace_household_result",
    {
      title: "Trace household result",
      description:
        "Guide an agent to calculate a household and explain the output trace.",
      argsSchema: {
        program_id: z.string().min(1),
        jurisdiction: z.string().min(1)
      }
    },
    async ({ program_id, jurisdiction }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Use get_runtime_package for ${jurisdiction}/${program_id}, then calculate_household with the user's household facts. ` +
              "Explain each requested output from the returned trace, including rule ids and warnings."
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "find_missing_household_inputs",
    {
      title: "Find missing household inputs",
      description:
        "Guide an agent to compare a package input schema with supplied household facts.",
      argsSchema: {
        program_id: z.string().min(1),
        jurisdiction: z.string().min(1)
      }
    },
    async ({ program_id, jurisdiction }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Use get_runtime_package for ${jurisdiction}/${program_id}. ` +
              "Compare the package entities, inputs, aliases, defaults, and sample request with the user's household. Return only missing or ambiguous facts needed for a reliable calculation."
          }
        }
      ]
    })
  );

  return server;
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
