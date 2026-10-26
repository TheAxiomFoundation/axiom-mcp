import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AxiomApiClient } from "../src/axiom-client.js";
import { nativeExampleFromOpenApi } from "./native-request.js";
import {
  describeParityReview,
  reviewParityRun
} from "../src/parity-report.js";
import { createAxiomMcpServer } from "../src/server.js";

const baseUrl = process.env.AXIOM_API_BASE_URL || "https://api.axiom.org";
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
  const toolNames = tools.tools.map((tool) => tool.name);
  for (const expected of [
    "get_capabilities",
    "list_programs",
    "search_rules",
    "get_rule",
    "get_rule_sources",
    "get_rule_dependencies",
    "get_rule_versions",
    "list_variables",
    "list_runtime_packages",
    "get_runtime_package",
    "get_package_graph",
    "list_parity_cases",
    "run_parity_cases",
    "calculate_household",
    "calculate_batch",
    "submit_calculation_job",
    "get_calculation_job"
  ]) {
    assertIncludes(toolNames, expected, "tools");
  }

  // The catalog is what resolves a variable name for a variable-addressed
  // calculation, so an empty one breaks that mode without breaking any
  // package call.
  const variables = await client.callTool({
    name: "list_variables",
    arguments: { kind: "output", limit: 5 }
  });
  const variableRows = readPath<unknown[]>(variables.structuredContent, [
    "data",
    "variables"
  ]);
  if (!Array.isArray(variableRows) || variableRows.length < 1) {
    throw new Error("list_variables returned no outputs");
  }

  const programs = await client.callTool({ name: "list_programs" });
  const programRows = readPath<unknown[]>(programs.structuredContent, [
    "data",
    "programs"
  ]);
  if (!Array.isArray(programRows) || programRows.length < 1) {
    throw new Error("list_programs returned no programs");
  }

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

  const parity = await client.callTool({ name: "run_parity_cases" });
  const paritySummary = readPath<Record<string, unknown>>(parity.structuredContent, [
    "data",
    "summary"
  ]);
  const parityResults = readPath<unknown[]>(parity.structuredContent, [
    "data",
    "results"
  ]);
  const parityReview = reviewParityRun(paritySummary, parityResults);
  if (parityReview.problems.length > 0) {
    throw new Error(parityReview.problems.join("\n"));
  }
  for (const line of describeParityReview(parityReview)) console.log(line);

  const coSnapParity = parityResults?.find(
    (result) =>
      readField(result, "id") === "co-snap-us-co-family-1"
  );
  const traceOutputs = readField(coSnapParity, "trace_outputs");
  if (
    typeof traceOutputs !== "object" ||
    traceOutputs === null ||
    readField(traceOutputs, "gross_income") !== 1200
  ) {
    throw new Error("run_parity_cases did not include CO SNAP trace outputs");
  }

  const parityCases = await client.callTool({ name: "list_parity_cases" });
  const cases = readPath<unknown[]>(parityCases.structuredContent, [
    "data",
    "cases"
  ]);
  const coSnapCase = cases?.find(
    (candidate) => readField(candidate, "id") === "co-snap-us-co-family-1"
  );
  const comparisons = readField(coSnapCase, "external_comparisons");
  if (
    !Array.isArray(comparisons) ||
    !comparisons.some(
      (comparison) =>
        readField(comparison, "id") === "co-snap-policyengine-current" &&
        readField(comparison, "engine") === "policyengine"
    )
  ) {
    throw new Error(
      "list_parity_cases did not include CO SNAP PolicyEngine comparison metadata"
    );
  }

  const resources = await client.listResources();
  assertIncludes(
    resources.resources.map((resource) => resource.uri),
    "axiom://capabilities",
    "resources"
  );
  const capabilitiesResource = await client.readResource({
    uri: "axiom://capabilities"
  });
  // A resource's contents are text or blob, so `text` needs narrowing.
  const resourceContent = capabilitiesResource.contents[0];
  const resourceText =
    resourceContent && "text" in resourceContent ? resourceContent.text : undefined;
  if (
    typeof resourceText !== "string" ||
    JSON.parse(resourceText)?.status !== "ok"
  ) {
    throw new Error("axiom://capabilities resource did not return an ok envelope");
  }

  // Batch calculation needs calculate:run; skip cleanly when the smoke key
  // is narrower so scope changes do not break the monitor.
  const packageDetail = readPath<Record<string, unknown>>(
    runtimePackage.structuredContent,
    ["data", "package"]
  );
  const sampleRequest = readField(packageDetail, "sample_request");
  if (typeof sampleRequest === "object" && sampleRequest !== null) {
    const batch = await client.callTool({
      name: "calculate_batch",
      arguments: { requests: [sampleRequest, sampleRequest] }
    });
    if (batch.isError) {
      const code = readPath<string>(batch.structuredContent, [
        "error",
        "api_response",
        "error",
        "code"
      ]);
      if (code !== "insufficient_scope") {
        throw new Error(`calculate_batch failed with ${JSON.stringify(code)}`);
      }
      console.log("calculate_batch skipped: smoke key lacks calculate:run");
    } else {
      const batchSummary = readPath<Record<string, unknown>>(
        batch.structuredContent,
        ["data", "summary"]
      );
      if (batchSummary?.total !== 2 || batchSummary?.succeeded !== 2) {
        throw new Error(
          `calculate_batch did not succeed positionally: ${JSON.stringify(batchSummary)}`
        );
      }
    }
  }

  // Variable-addressed calculation: no program_id, no root — the API
  // resolves `variables` through the catalog and routes the facts itself.
  // Nothing else here reaches that path. The batch and job calls send the
  // package's own sample_request, which is package mode, so a regression in
  // catalog resolution or fact routing would ship unnoticed.
  //
  // The request is the API's own published example for the mode (see
  // ./native-request.ts), so this pins no facts of its own and fails if the
  // example a reader of the docs would copy stops working.
  const specResponse = await fetch(`${baseUrl}/v1/openapi.json`, {
    headers: { accept: "application/json" }
  });
  if (!specResponse.ok) {
    throw new Error(
      `could not read ${baseUrl}/v1/openapi.json: HTTP ${specResponse.status}`
    );
  }
  const example = nativeExampleFromOpenApi(await specResponse.json());
  if (!example.ok) {
    throw new Error(`no variable-addressed example to smoke: ${example.reason}`);
  }
  const native = await client.callTool({
    name: "calculate_household",
    arguments: example.request
  });
  if (native.isError) {
    const code = readPath<string>(native.structuredContent, [
      "error",
      "api_response",
      "error",
      "code"
    ]);
    if (code !== "insufficient_scope") {
      throw new Error(
        `variable-addressed calculate_household failed with ${JSON.stringify(code)}: ${JSON.stringify(native.structuredContent).slice(0, 400)}`
      );
    }
    console.log(
      "variable-addressed calculation skipped: smoke key lacks calculate:run"
    );
  } else {
    assertVariableAddressed(native.structuredContent, example.variable);
  }

  // Async job flow: submit one calculation as a detached job and poll it to
  // completion, proving durable job persistence across instances. Skips
  // cleanly alongside calculate_batch when the key lacks calculate:run.
  if (typeof sampleRequest === "object" && sampleRequest !== null) {
    const submitted = await client.callTool({
      name: "submit_calculation_job",
      arguments: { requests: [sampleRequest] }
    });
    if (submitted.isError) {
      const code = readPath<string>(submitted.structuredContent, [
        "error",
        "api_response",
        "error",
        "code"
      ]);
      if (code !== "insufficient_scope") {
        throw new Error(
          `submit_calculation_job failed with ${JSON.stringify(code)}`
        );
      }
      console.log("job flow skipped: smoke key lacks calculate:run");
    } else {
      const jobId = readPath<string>(submitted.structuredContent, [
        "data",
        "job_id"
      ]);
      if (typeof jobId !== "string" || !jobId) {
        throw new Error("submit_calculation_job returned no job_id");
      }
      const deadline = Date.now() + 90_000;
      let jobStatus: unknown;
      for (;;) {
        const polled = await client.callTool({
          name: "get_calculation_job",
          arguments: { job_id: jobId }
        });
        if (polled.isError) {
          throw new Error(
            `get_calculation_job errored: ${JSON.stringify(polled.structuredContent).slice(0, 300)}`
          );
        }
        jobStatus = readPath<string>(polled.structuredContent, ["data", "status"]);
        if (jobStatus === "succeeded") break;
        if (jobStatus === "failed") {
          throw new Error(
            `calculation job failed: ${JSON.stringify(polled.structuredContent).slice(0, 300)}`
          );
        }
        if (Date.now() > deadline) {
          throw new Error(
            `calculation job did not finish within 90s (last status: ${String(jobStatus)})`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  console.log(`Live MCP smoke passed for ${baseUrl}`);
} finally {
  await client.close();
  await server.close();
}

/**
 * A variable-addressed response has to show its work: the variable resolved
 * to a target and computed, and every fact sent was understood.
 *
 * `unsupported` is a quiet failure: a variable nothing can serve lands
 * there and the request still answers 200, so a 200 alone proves nothing.
 * That fails the smoke.
 *
 * `ignored_inputs` is reported, not failed. A fact no serving target
 * declares lands there and the answer is computed without it — worth
 * seeing, but today the API's own published example trips it (`people.*.age`
 * reaches no target that declares a person input named `age`), so failing
 * on it would hold this monitor red for something upstream. Logged every
 * run instead, so a growing list stays visible.
 */
function assertVariableAddressed(content: unknown, variable: string) {
  const data = readPath<Record<string, unknown>>(content, ["data"]);
  if (!data) {
    throw new Error("variable-addressed calculation returned no data");
  }
  const computed = data.computed;
  const unsupported = Array.isArray(data.unsupported) ? data.unsupported : [];
  const ignored = Array.isArray(data.ignored_inputs) ? data.ignored_inputs : [];
  if (!Array.isArray(computed) || !Array.isArray(data.native_request)) {
    throw new Error(
      `variable-addressed calculation did not return that mode's shape: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const refused = unsupported.find(
    (row) => readField(row, "variable") === variable
  );
  if (refused) {
    throw new Error(
      `${variable} was unsupported: ${String(readField(refused, "reason"))}`
    );
  }
  const row = computed.find((entry) => readField(entry, "variable") === variable);
  if (!row) {
    throw new Error(
      `${variable} was neither computed nor reported unsupported: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const value = readField(row, "value");
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${variable} computed a non-numeric value: ${JSON.stringify(value)}`
    );
  }
  if (!readField(row, "served_by")) {
    throw new Error(`${variable} computed without served_by provenance`);
  }
  console.log(
    `Variable-addressed: ${variable} = ${value} for period ${String(data.period)}, served by ${JSON.stringify(readField(row, "served_by"))}`
  );
  for (const entry of ignored) {
    console.log(
      `Variable-addressed ignored input: ${String(readField(entry, "field"))} — ${String(readField(entry, "reason"))}`
    );
  }
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
