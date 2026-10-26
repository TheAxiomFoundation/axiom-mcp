// The map between the Axiom API's public surface and this server's tools.
//
// The server is a pass-through: every public, non-admin route is a tool. That
// claim decays silently as the API grows, so it is written down here and
// checked two ways — `tests/api-surface.test.ts` holds this manifest against
// the tools the server actually registers, and `npm run check:api-surface`
// holds it against the deployed `GET /v1/openapi.json`.
//
// Keys are `METHOD /path`, with the OpenAPI document's path templates
// verbatim, so a route renamed upstream reads as removed rather than matching
// by accident.

export const WRAPPED_ROUTES: Readonly<Record<string, string>> = {
  "GET /v1/capabilities": "get_capabilities",
  "GET /v1/version": "get_version",
  "GET /v1/health": "check_health",
  "GET /v1/ready": "check_readiness",
  "GET /v1/programs": "list_programs",
  "GET /v1/variables": "list_variables",
  "GET /v1/certified": "list_certified_nodes",
  "GET /v1/corpus/subtrees": "list_corpus_subtrees",
  "GET /v1/public/validation/bundled": "get_bundled_validation",
  "POST /v1/search": "search_rules",
  "GET /v1/rules/{rule_id}": "get_rule",
  "GET /v1/rules/{rule_id}/sources": "get_rule_sources",
  "GET /v1/rules/{rule_id}/dependencies": "get_rule_dependencies",
  "GET /v1/rules/{rule_id}/versions": "get_rule_versions",
  "GET /v1/nodes/{node_id}": "get_node",
  "GET /v1/graph/compose": "compose_graph",
  "GET /v1/subgraph": "get_subgraph",
  "GET /v1/runtime/packages": "list_runtime_packages",
  "GET /v1/runtime/packages/{jurisdiction}/{program_id}": "get_runtime_package",
  "GET /v1/runtime/packages/{jurisdiction}/{program_id}/graph": "get_package_graph",
  "GET /v1/runtime/root-inputs": "get_root_inputs",
  "GET /v1/runtime/artifacts": "list_runtime_artifacts",
  "POST /v1/calculate": "calculate_household",
  "POST /v1/calculate/batch": "calculate_batch",
  "POST /v1/jobs/calculate": "submit_calculation_job",
  "GET /v1/jobs/{job_id}": "get_calculation_job",
  "POST /v1/household/{country_id}/calculate": "calculate_household_compat",
  "GET /v1/parity/cases": "list_parity_cases",
  "POST /v1/parity/run": "run_parity_cases"
};

// Every tool the server registers, derived from the manifest above so the
// prompt contract and the manifest cannot disagree about what a tool is
// called. `tests/api-surface.test.ts` holds the manifest against the server's
// real registrations, which is what makes this set authoritative.
export const TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(WRAPPED_ROUTES)
);

// Public routes that are deliberately not tools. Each needs a reason, because
// the drift check reads silence as drift.
export const UNWRAPPED_ROUTES: Readonly<Record<string, string>> = {
  "POST /v1/keys/trial":
    "Mints a credential. Issuing one is the operator's act, and this server never writes its own configuration.",
  "GET /v1/openapi.json":
    "The contract this manifest is checked against; `npm run check:api-surface` reads it directly.",
  "GET /docs": "HTML for people, not JSON for agents.",
  "GET /docs/validation": "HTML for people, not JSON for agents."
};

// Admin routes carry admin scopes and stay off the tool surface entirely, so
// they are excluded by prefix rather than listed one by one.
export const ADMIN_ROUTE_PREFIX = "/v1/admin/";

export interface SurfaceDrift {
  unknownRoutes: string[];
  missingRoutes: string[];
}

/**
 * Compare the manifest with the routes an OpenAPI document declares.
 * `unknownRoutes` are public routes nothing accounts for — the drift this
 * guards against. `missingRoutes` are manifest entries the API no longer
 * serves, which means a tool now calls a route that is gone.
 */
export function diffApiSurface(routes: Iterable<string>): SurfaceDrift {
  const accounted = new Set([
    ...Object.keys(WRAPPED_ROUTES),
    ...Object.keys(UNWRAPPED_ROUTES)
  ]);
  const served = new Set<string>();
  const unknownRoutes: string[] = [];
  for (const route of routes) {
    served.add(route);
    if (!accounted.has(route)) unknownRoutes.push(route);
  }
  const missingRoutes = [...accounted].filter((route) => !served.has(route));
  return {
    unknownRoutes: unknownRoutes.sort(),
    missingRoutes: missingRoutes.sort()
  };
}

/** The `METHOD /path` routes an OpenAPI document declares, admin aside. */
export function publicRoutesFromOpenApi(document: unknown): string[] {
  const paths =
    typeof document === "object" && document !== null
      ? (document as { paths?: Record<string, Record<string, unknown>> }).paths
      : undefined;
  if (!paths || typeof paths !== "object") {
    throw new Error("OpenAPI document has no `paths` object");
  }
  const routes: string[] = [];
  for (const [path, operations] of Object.entries(paths)) {
    if (path.startsWith(ADMIN_ROUTE_PREFIX)) continue;
    for (const method of Object.keys(operations ?? {})) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      routes.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes.sort();
}
