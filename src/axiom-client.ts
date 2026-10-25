export interface AxiomClientOptions {
  baseUrl: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

// A rate-limited request is retried once when the API's retry-after fits
// inside an interactive tool call; longer waits surface as structured
// errors for the agent to handle.
export const MAX_RETRY_AFTER_SECONDS = 10;

export class AxiomApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter: string | null;

  constructor(
    path: string,
    status: number,
    body: unknown,
    retryAfter: string | null = null
  ) {
    super(`Axiom API ${path} returned HTTP ${status}`);
    this.name = "AxiomApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

// Mirrors POST /v1/calculate: address a registered program (program_id +
// jurisdiction), any rulespec subtree (root), or nothing at all — the
// variable-addressed shape, which the API recognises by `variables` with
// neither program_id nor root. The API enforces mutual exclusion and owns
// validation; the client forwards the body untouched, unknown fields
// included, so the API can refuse them by name.
export interface CalculateRequest {
  program_id?: string;
  jurisdiction?: string;
  household?: Record<string, unknown>;
  root?: string;
  input_contract?: string;
  facts?: Record<string, unknown>;
  period?: string;
  state?: string;
  people?: Record<string, unknown>;
  unit?: Record<string, unknown>;
  spm_units?: Record<string, unknown>;
  tax_units?: Record<string, unknown>;
  households?: Record<string, unknown>;
  variables?: string[];
  // Entity groups this deployment declares beyond the three named above,
  // and any field the API adds after this release.
  [field: string]: unknown;
}

export class AxiomApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AxiomClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get capabilities() {
    return this.request("GET", "/v1/capabilities");
  }

  getVersion() {
    return this.request("GET", "/v1/version");
  }

  getHealth() {
    return this.request("GET", "/v1/health");
  }

  getReadiness() {
    return this.request("GET", "/v1/ready");
  }

  getBundledValidation() {
    return this.request("GET", "/v1/public/validation/bundled");
  }

  listVariables(
    input: {
      jurisdiction?: string;
      kind?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    return this.request("GET", withQuery("/v1/variables", input));
  }

  listCertifiedNodes(input: { limit?: number; offset?: number } = {}) {
    return this.request("GET", withQuery("/v1/certified", input));
  }

  getNode(legalId: string) {
    return this.request("GET", `/v1/nodes/${encodeRuleId(legalId)}`);
  }

  listCorpusSubtrees() {
    return this.request("GET", "/v1/corpus/subtrees");
  }

  composeGraph(focus: string) {
    return this.request("GET", withQuery("/v1/graph/compose", { focus }));
  }

  getSubgraph(roots: string[]) {
    return this.request("GET", withQuery("/v1/subgraph", { roots: roots.join(",") }));
  }

  getRootInputs(root: string) {
    return this.request("GET", withQuery("/v1/runtime/root-inputs", { root }));
  }

  listRuntimeArtifacts() {
    return this.request("GET", "/v1/runtime/artifacts");
  }

  calculateHouseholdCompat(countryId: string, household: Record<string, unknown>) {
    return this.request(
      "POST",
      `/v1/household/${encodeURIComponent(countryId)}/calculate`,
      { household }
    );
  }

  searchRules(input: {
    query: string;
    jurisdiction?: string;
    program_id?: string;
    limit?: number;
  }) {
    return this.request("POST", "/v1/search", input);
  }

  listPrograms() {
    return this.request("GET", "/v1/programs");
  }

  getRule(ruleId: string, input: { as_of?: string } = {}) {
    return this.request(
      "GET",
      withQuery(`/v1/rules/${encodeRuleId(ruleId)}`, input)
    );
  }

  getRuleVersions(
    ruleId: string,
    input: { symbol?: string; as_of?: string } = {}
  ) {
    return this.request(
      "GET",
      withQuery(`/v1/rules/${encodeRuleId(ruleId)}/versions`, input)
    );
  }

  getRuleSources(ruleId: string) {
    return this.request("GET", `/v1/rules/${encodeRuleId(ruleId)}/sources`);
  }

  getRuleDependencies(ruleId: string) {
    return this.request("GET", `/v1/rules/${encodeRuleId(ruleId)}/dependencies`);
  }

  listRuntimePackages() {
    return this.request("GET", "/v1/runtime/packages");
  }

  getRuntimePackage(jurisdiction: string, programId: string) {
    return this.request(
      "GET",
      `/v1/runtime/packages/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(programId)}`
    );
  }

  getPackageGraph(jurisdiction: string, programId: string) {
    return this.request(
      "GET",
      `/v1/runtime/packages/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(programId)}/graph`
    );
  }

  listParityCases() {
    return this.request("GET", "/v1/parity/cases");
  }

  runParityCases() {
    return this.request("POST", "/v1/parity/run");
  }

  calculateHousehold(input: CalculateRequest) {
    return this.request("POST", "/v1/calculate", input);
  }

  calculateBatch(input: { requests: unknown[] }) {
    return this.request("POST", "/v1/calculate/batch", input);
  }

  submitCalculationJob(input: { requests: unknown[] }) {
    return this.request("POST", "/v1/jobs/calculate", input);
  }

  getCalculationJob(jobId: string) {
    return this.request("GET", `/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    let retried = false;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        throw new Error(
          describeRequestFailure(this.baseUrl, path, this.timeoutMs, error),
          { cause: error }
        );
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        if (response.status === 429 && !retried) {
          const delaySeconds = Number(retryAfter);
          if (Number.isFinite(delaySeconds) && delaySeconds >= 0 && delaySeconds <= MAX_RETRY_AFTER_SECONDS) {
            retried = true;
            await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
            continue;
          }
        }
        const errorBody = await response.json().catch(() => null);
        throw new AxiomApiError(path, response.status, errorBody, retryAfter);
      }
      try {
        return await response.json();
      } catch (error) {
        throw new Error(
          `Axiom API ${path} returned HTTP ${response.status} with a non-JSON body`,
          { cause: error }
        );
      }
    }
  }
}

function describeRequestFailure(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  error: unknown
): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? (error as { name?: unknown }).name
      : undefined;
  if (name === "TimeoutError" || name === "AbortError") {
    return `Axiom API request to ${baseUrl}${path} timed out after ${timeoutMs}ms`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Axiom API request to ${baseUrl}${path} failed: ${detail}`;
}

function withQuery(
  path: string,
  params: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function encodeRuleId(ruleId: string): string {
  return ruleId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
