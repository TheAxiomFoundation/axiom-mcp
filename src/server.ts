import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AxiomApiError } from "./axiom-client.js";
import {
  PROMPT_CONTRACTS,
  renderPrompt
} from "./prompt-contract.js";

import type { AxiomApiClient } from "./axiom-client.js";
import {
  calculateBatch,
  calculateHousehold,
  calculateHouseholdCompat,
  composeGraph,
  getBundledValidation,
  getCalculationJob,
  getCapabilities,
  getHealth,
  getNode,
  getPackageGraph,
  getReadiness,
  getRootInputs,
  getRule,
  getRuleDependencies,
  getRuleSources,
  getRuleVersions,
  getRuntimePackage,
  getSubgraph,
  getVersion,
  listCertifiedNodes,
  listCorpusSubtrees,
  listParityCases,
  listPrograms,
  listRuntimeArtifacts,
  listRuntimePackages,
  listVariables,
  runParityCases,
  searchRules,
  submitCalculationJob
} from "./tool-handlers.js";

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

// What node reads serve under the API's opt-in `enforced` certification
// mode (axiom-api certifiedGraphView). The default, `permissive`, serves
// uncertified nodes too, so no description may state this as always on.
const ENFORCED_NODES =
  "certified rules and parameters whose rule, input, and relation dependencies are all certified (checked transitively), plus the certified inputs and relations reachable from them";

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

  // The catalog that resolves a variable name. It was the one list reachable
  // only by a tool call, so a client could show a user every program and
  // every subtree up front but not the variables — the thing a
  // variable-addressed call needs first. Unfiltered, matching what the
  // `list_variables` tool returns with no arguments.
  server.registerResource(
    "axiom-variables",
    "axiom://variables",
    {
      title: "Axiom variables catalog",
      description:
        "Every output a caller can request and every input a caller can supply, with name, kind, entity, dtype, period, jurisdiction, and legal id. Resolve a variable name here before a variable-addressed calculate_household call.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await readForResource(() => client.listVariables()))
  );

  server.registerResource(
    "axiom-corpus-subtrees",
    "axiom://corpus/subtrees",
    {
      title: "Axiom corpus subtrees",
      description:
        "Every rulespec subtree in the live corpus mirror executable on demand via calculate_household with `root`.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, await readForResource(() => client.listCorpusSubtrees()))
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
    "get_version",
    {
      title: "Get Axiom API version",
      description: "Read the API version, environment, and deployment identity."
    },
    async () => getVersion(context)
  );

  // No resource for health or readiness: a resource is context a client
  // reads once and keeps, and a liveness status read at listing time would
  // be stale by the time it mattered. Asking is the point, so it stays a
  // tool call.
  server.registerTool(
    "check_health",
    {
      title: "Check API liveness",
      description:
        "Check that the Axiom API is reachable and serving. Needs no API key."
    },
    async () => getHealth(context)
  );

  server.registerTool(
    "check_readiness",
    {
      title: "Check API dependency readiness",
      description:
        "Check whether the API's dependencies are ready to serve. Use it when calculations or rule reads fail and you need to tell an unready deployment from a bad request. Needs no API key."
    },
    async () => getReadiness(context)
  );

  server.registerTool(
    "list_variables",
    {
      title: "List the variables catalog",
      description:
        "List every output a caller can request and every input a caller can supply, assembled from the package and mapping registries — nothing is authored. Rows carry name, kind, entity, dtype, period, jurisdiction, and legal id. This is how you resolve a variable name before a variable-addressed calculate_household call. Which package or root serves an output is deliberately absent; the calculation response's provenance carries serving identity.",
      inputSchema: {
        jurisdiction: z.string().min(1).optional(),
        kind: z.enum(["output", "input"]).optional(),
        q: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async (input) => listVariables(context, input)
  );

  server.registerTool(
    "get_bundled_validation",
    {
      title: "Get the bundled validation snapshot",
      description:
        "Read the comparison run and partner demand summary committed in this deployment's bundle. It is a snapshot, never live, and the same under both enforcement modes. Needs no API key."
    },
    async () => getBundledValidation(context)
  );

  server.registerTool(
    "list_certified_nodes",
    {
      title: "Read the certification ledger",
      description:
        "Read the certification ledger the API serves under: the enforcement mode; the ledger's metadata (its id and vintage when the ledger is valid); its entries, paged by limit and offset; status counts (certified, validated, and encoded, with incomplete_by_declaration counted within encoded) over the nodes get_node serves, plus the pending count; and the full pending list (legal ids a closure ledger names that are not encoded yet). " +
        "Under `permissive` (the API default) the ledger labels nodes but does not limit what any tool serves. " +
        `Under \`enforced\` the ledger also gates search, rule reads, programs, compose_graph, runtime packages, and calculations, and get_node and get_subgraph serve only ${ENFORCED_NODES}.`,
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async (input) => listCertifiedNodes(context, input)
  );

  server.registerTool(
    "get_node",
    {
      title: "Get a node",
      description:
        "Read one node (kind `derived`, `parameter`, `input`, or `relation`) of the compiled runtime packages' graphs by legal id, with its certification status (`certified`, `validated`, or `encoded`), its certificate (null unless the node is in a valid ledger), and, when the ledger is valid, the ledger id and vintage. " +
        "Under `permissive` (the API default) uncertified nodes are served. " +
        `Under \`enforced\` only ${ENFORCED_NODES} are readable. ` +
        "An id outside the package graphs served in the current mode is a 404 `uncertified_node`; under `permissive` that means the id is not in a served package graph, not that the node is uncertified. Successful responses report the mode in `meta.certified.enforcement`.",
      inputSchema: {
        legal_id: z.string().min(1)
      }
    },
    async (input) => getNode(context, input)
  );

  server.registerTool(
    "list_corpus_subtrees",
    {
      title: "List executable corpus subtrees",
      description:
        "List every rulespec subtree in the live corpus mirror that can be executed on demand via calculate_household with `root` — no pre-registered package required.",
      inputSchema: {}
    },
    async () => listCorpusSubtrees(context)
  );

  server.registerTool(
    "compose_graph",
    {
      title: "Compose a dependency graph",
      description:
        "Build the dependency graph for any encoded rule or file legal id by walking RuleSpec imports across the live corpus mirror.",
      inputSchema: {
        focus: z.string().min(1)
      }
    },
    async (input) => composeGraph(context, input)
  );

  server.registerTool(
    "get_subgraph",
    {
      title: "Get a node subgraph",
      description:
        "Read the dependency closure of up to 20 root node legal ids, over the nodes get_node serves, in program-graph shape. Every root must be a node get_node serves (otherwise 404 `uncertified_node`). " +
        "Under `permissive` (the API default) the closure is not filtered by certification and can include uncertified nodes. " +
        `Under \`enforced\` it holds only ${ENFORCED_NODES}. ` +
        "Rule and parameter nodes carry `certificationStatus`, plus `certificateId` when certified; input and relation nodes carry no status (use get_node). Closures are cut at 500 nodes and flagged truncated. Successful responses report the mode in `meta.certified.enforcement`.",
      inputSchema: {
        roots: z.array(z.string().min(1)).min(1).max(20)
      }
    },
    async (input) => getSubgraph(context, input)
  );

  server.registerTool(
    "get_root_inputs",
    {
      title: "Get input catalog for a root",
      description:
        "Read the typed input catalog for any rulespec root (file legal id, optionally with #rule) before calling calculate_household with `root`.",
      inputSchema: {
        root: z.string().min(1)
      }
    },
    async (input) => getRootInputs(context, input)
  );

  server.registerTool(
    "list_runtime_artifacts",
    {
      title: "List runtime artifact identities",
      description:
        "List every compiled artifact this deployment pins: release tag, corpus sha, and file sha256, for pinning and replay.",
      inputSchema: {}
    },
    async () => listRuntimeArtifacts(context)
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
        "Read one rule by stable rule id or citation path, including summary, symbols, provenance, dependencies, and dependents. `as_of` (YYYY-MM-DD or YYYY-MM) narrows `rule.versions` to the versions in force on that date and adds a `coverage` block; the rest of the record has no version axis and is served at HEAD either way.",
      inputSchema: {
        rule_id: z.string().min(1),
        as_of: z.string().min(1).optional()
      }
    },
    async (input) => getRule(context, input)
  );

  server.registerTool(
    "get_rule_versions",
    {
      title: "Get a rule's version history",
      description:
        "Read every (symbol, version) pair the rule's RuleSpec module retained, with each version's valid-time window, citation, and formula or values. `symbol` restricts the list to one RuleSpec rule name inside the module; `as_of` (YYYY-MM-DD or YYYY-MM) returns only the versions in force on that date, at most one per symbol. Read `coverage` before concluding anything from a gap: a symbol with one version has no retained history, which is not evidence that the rule never changed.",
      inputSchema: {
        rule_id: z.string().min(1),
        symbol: z.string().min(1).optional(),
        as_of: z.string().min(1).optional()
      }
    },
    async (input) => getRuleVersions(context, input)
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
    "get_package_graph",
    {
      title: "Get a package's rule graph",
      description:
        "Read one executable package's rules, inputs, relations, and terminal outputs as a directed acyclic graph derived from the compiled artifact, with certificates and certification statuses stamped on. Use it to explain how a program's outputs are computed. " +
        "Under `permissive` (the API default) the graph is the dependency closure of the package's graph roots — its default outputs when it declares none — uncertified rules included. " +
        "Under `enforced` it is the servable part of the whole compiled graph, not pruned to the graph roots, and a package with nothing servable returns `rules: []`.",
      inputSchema: {
        jurisdiction: z.string().min(1),
        program_id: z.string().min(1)
      }
    },
    async (input) => getPackageGraph(context, input)
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

  // Mirrors POST /v1/calculate. Three addressing modes, picked by the API
  // from the body's shape: variable-addressed (no program_id, no root, an
  // array of `variables`), root (`root`, compiled on demand), or a
  // registered package (program_id + jurisdiction). `facts` is API sugar
  // for household.facts.
  //
  // The schema is passthrough, not strict: the API owns validation, and it
  // refuses an unknown field rather than ignoring it. Stripping here would
  // hide the field from the API instead — and a stripped variable-addressed
  // body still parses as one, so it answers 200 against an empty household.
  // Passthrough also carries the entity groups this deployment declares
  // (any regular plural, e.g. `families`) without a list to maintain.
  const calculateRequestSchema = z
    .object({
      // Package mode.
      program_id: z.string().min(1).optional(),
      jurisdiction: z.string().min(1).optional(),
      household: z.record(z.unknown()).optional(),
      // Root mode.
      root: z.string().min(1).optional(),
      input_contract: z.string().min(1).optional(),
      facts: z.record(z.unknown()).optional(),
      // Variable-addressed mode.
      period: z.string().min(1).optional(),
      state: z.string().min(1).optional(),
      people: z.record(z.unknown()).optional(),
      unit: z.record(z.unknown()).optional(),
      spm_units: z.record(z.unknown()).optional(),
      tax_units: z.record(z.unknown()).optional(),
      households: z.record(z.unknown()).optional(),
      // Every mode.
      variables: z.array(z.string()).optional()
    })
    .passthrough();

  server.registerTool(
    "calculate_household",
    {
      title: "Calculate a household",
      description:
        "Run a calculation in one of three addressing modes, which the API picks from the body's shape. " +
        "Variable-addressed: send `variables` with no program_id and no root, plus what you know — `period` (YYYY or YYYY-MM), `state` (two letters) or `jurisdiction` (`us-xx`, send one spelling or the other), `people` keyed by your own ids, and either `unit` for a single unit or entity groups such as `spm_units` and `tax_units` keyed by your own unit ids, each with `members` and that unit's facts. Resolve variable names with the variables catalog; unsupported ones come back in `unsupported[]` rather than failing. " +
        "Root: run any corpus subtree on demand with `root` and `facts` (discover inputs with get_root_inputs); `input_contract` selects source-declared annual facts and is valid only here. " +
        "Package: address a registered package with program_id + jurisdiction and `household` (discover inputs with get_runtime_package). " +
        "The modes are mutually exclusive. Unknown fields are forwarded, and the API refuses them by name.",
      inputSchema: calculateRequestSchema
    },
    async (input) => calculateHousehold(context, input)
  );

  server.registerTool(
    "calculate_household_compat",
    {
      title: "Calculate a household (PolicyEngine wire format)",
      description:
        "PolicyEngine household-API compatible calculation: accepts the PE v1 household body for a country_id and mirrors PE's response envelope, with an `axiom` sidecar reporting which variables Axiom computed.",
      inputSchema: {
        country_id: z.string().min(1),
        household: z.record(z.unknown())
      }
    },
    async (input) => calculateHouseholdCompat(context, input)
  );

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

  // Prompts come from the contract module so each one's tool names are
  // declared data, not prose a tool rename can silently invalidate.
  for (const contract of PROMPT_CONTRACTS) {
    server.registerPrompt(
      contract.name,
      {
        title: contract.title,
        description: contract.description,
        argsSchema: contract.args
      },
      async (args) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: renderPrompt(contract, args as Record<string, string>)
            }
          }
        ]
      })
    );
  }

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
