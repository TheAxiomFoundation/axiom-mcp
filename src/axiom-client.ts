export interface AxiomClientOptions {
  baseUrl: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}

export class AxiomApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(path: string, status: number, body: unknown) {
    super(`Axiom API ${path} returned HTTP ${status}`);
    this.name = "AxiomApiError";
    this.status = status;
    this.body = body;
  }
}

export class AxiomApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AxiomClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get capabilities() {
    return this.request("GET", "/v1/capabilities");
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

  getRule(ruleId: string) {
    return this.request("GET", `/v1/rules/${encodeRuleId(ruleId)}`);
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

  listParityCases() {
    return this.request("GET", "/v1/parity/cases");
  }

  runParityCases() {
    return this.request("POST", "/v1/parity/run");
  }

  calculateHousehold(input: {
    program_id: string;
    jurisdiction: string;
    household: Record<string, unknown>;
    variables?: string[];
  }) {
    return this.request("POST", "/v1/calculate", input);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown) {
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AxiomApiError(path, response.status, responseBody);
    }
    return responseBody;
  }
}

function encodeRuleId(ruleId: string): string {
  return ruleId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
