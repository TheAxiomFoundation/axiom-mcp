import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AxiomApiError } from "./axiom-client.js";
import type { AxiomApiClient } from "./axiom-client.js";
import {
  calculateBatch,
  calculateHousehold,
  getCalculationJob,
  getCapabilities,
  getRule,
  getRuleDependencies,
  getRuleSources,
  getRuntimePackage,
  listParityCases,
  listPrograms,
  listRuntimePackages,
  runParityCases,
  searchRules,
  submitCalculationJob
} from "./tool-handlers.js";

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

export function createAxiomMcpServer(client: AxiomApiClient): McpServer {
  const server = new McpServer({
    name: "axiom-mcp",
    version: packageVersion
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
    async (uri) => jsonResource(uri.href, await readForResource(() => client.capabilities))
  );

  server.registerResource(
    "axiom-programs",
    "axiom://programs",
    {
      title: "Axiom programs",
      description: "Programs discoverable from the configured Axiom API.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await readForResource(() => client.listPrograms()))
  );

  server.registerResource(
    "axiom-runtime-packages",
    "axiom://runtime/packages",
    {
      title: "Axiom runtime packages",
      description: "Executable packages from the configured Axiom runtime.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await readForResource(() => client.listRuntimePackages()))
  );

  server.registerResource(
    "axiom-parity-cases",
    "axiom://parity/cases",
    {
      title: "Axiom parity cases",
      description:
        "Canonical runtime parity cases, expected outputs, trace variables, notes, and external comparison metadata from the configured Axiom API.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await readForResource(() => client.listParityCases()))
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
    "list_programs",
    {
      title: "List programs",
      description:
        "List programs discoverable in the configured Axiom rule index, including those without an executable runtime package."
    },
    async () => listPrograms(context)
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
        "List canonical Axiom runtime parity cases, expected outputs, trace variables, notes, external comparison metadata, and calculation requests."
    },
    async () => listParityCases(context)
  );

  server.registerTool(
    "run_parity_cases",
    {
      title: "Run parity cases",
      description:
        "Run canonical Axiom runtime parity cases and return variable-level differences, trace outputs, and calculation trace."
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

  const calculateRequestSchema = z.object({
    program_id: z.string().min(1),
    jurisdiction: z.string().min(1),
    household: z.record(z.unknown()),
    variables: z.array(z.string()).optional()
  });

  server.registerTool(
    "calculate_batch",
    {
      title: "Calculate a batch of households",
      description:
        "Run up to 25 calculations in one synchronous request. Results return positionally: results[i] corresponds to requests[i], each independently ok or error.",
      inputSchema: {
        requests: z.array(calculateRequestSchema).min(1).max(25)
      }
    },
    async (input) => calculateBatch(context, input)
  );

  server.registerTool(
    "submit_calculation_job",
    {
      title: "Submit an async calculation job",
      description:
        "Submit up to 50 calculations as a detached async job. Returns a job id to poll with get_calculation_job; results are retained for 24 hours and visible only to the submitting API key.",
      inputSchema: {
        requests: z.array(calculateRequestSchema).min(1).max(50)
      }
    },
    async (input) => submitCalculationJob(context, input)
  );

  server.registerTool(
    "get_calculation_job",
    {
      title: "Poll a calculation job",
      description:
        "Read the status, progress, and results of a calculation job submitted with submit_calculation_job.",
      inputSchema: {
        job_id: z.string().min(1)
      }
    },
    async (input) => getCalculationJob(context, input)
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

// Resource reads surface as protocol errors, so make the message carry what
// the API actually said instead of a bare HTTP status.
async function readForResource(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AxiomApiError) {
      const body =
        typeof error.body === "object" && error.body !== null
          ? (error.body as { error?: { code?: string; message?: string }; meta?: { request_id?: string } })
          : undefined;
      const detail = [
        body?.error?.code,
        body?.error?.message,
        body?.meta?.request_id ? `request_id ${body.meta.request_id}` : undefined
      ]
        .filter(Boolean)
        .join(" — ");
      throw new Error(detail ? `${error.message}: ${detail}` : error.message, {
        cause: error
      });
    }
    throw error;
  }
}
