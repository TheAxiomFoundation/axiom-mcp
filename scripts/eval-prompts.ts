import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AxiomApiClient } from "../src/axiom-client.js";
import { PROMPT_CONTRACTS } from "../src/prompt-contract.js";
import { createAxiomMcpServer } from "../src/server.js";
import { nativeExampleFromOpenApi } from "./native-request.js";
import {
  asString,
  collectObjects,
  findObject,
  firstNumericValue,
  firstSubtreeRoot,
  removeOneLeaf,
  sampleFactsFrom
} from "./eval-fixtures.js";


// What this measures, and what it does not.
//
// `tests/prompt-contract.test.ts` proves a prompt points at tools that exist.
// It cannot prove the text works, because the text is read by a model. This
// script gives a model each prompt, lets it call the real tools against the
// live API, and grades whether it reached the answer the API itself returns.
//
// Every grader is deterministic. The value the model must produce is computed
// here first by calling the tool directly, so a case fails because the model
// went wrong, not because a judge disagreed. Where a prompt has no such
// checkable answer — `explain_rule_for_caseworker` asks for an explanation —
// there is no case, rather than a check that only looks like one.
//
// This costs money per run. It is not in the 30-minute smoke; see
// `.github/workflows/prompt-eval.yml`.

const MODEL = "claude-opus-5-5";
// Each iteration is one model call. The cap bounds the spend of a run that
// loops instead of answering; hitting it fails the case.
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 8000;
// Per million tokens, for the run's cost line.
const PRICE_PER_TOKEN = { input: 4 / 1_000_000, output: 20 / 1_000_000 };

const baseUrl = process.env.AXIOM_API_BASE_URL || "https://api.axiom.org";
const apiKey = process.env.AXIOM_API_KEY || "";

if (!apiKey) {
  throw new Error("AXIOM_API_KEY is required for the prompt eval.");
}
// Not a hard check on ANTHROPIC_API_KEY: the SDK also resolves an
// `ant auth login` profile, so an unset variable does not mean there is no
// credential. A machine with a profile and no variable must still run. If
// there is really no credential, the SDK raises its own authentication error
// on the first model call.
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "ANTHROPIC_API_KEY is unset; the SDK will look for an `ant auth login` profile."
  );
}

const anthropic = new Anthropic();
const apiClient = new AxiomApiClient({ baseUrl, apiKey });
const server = createAxiomMcpServer(apiClient);
const mcp = new Client({ name: "axiom-mcp-prompt-eval", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface CaseResult {
  readonly prompt: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly checks: Check[];
  readonly reason?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly iterations: number;
}

const results: CaseResult[] = [];

try {
  const tools = await bridgeTools();
  for (const build of [variableCase, traceCase, missingInputsCase, subtreeCase]) {
    results.push(await build(tools));
  }
} finally {
  await mcp.close();
  await server.close();
}

report();

/** Exposes the MCP tool list to the model as Anthropic tool definitions. */
async function bridgeTools(): Promise<Anthropic.Beta.BetaToolUnion[]> {
  const listed = await mcp.listTools();
  return listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"]
  }));
}

/**
 * Variable-addressed mode. The fixture is the API's own published example, so
 * the case cannot drift from the documentation a caller would copy;
 * `native-request.ts` already reads it and refuses an unusable one.
 *
 * Two things are graded. The model must resolve the variable name through the
 * catalog rather than guess it, and reach the value the API returns. It must
 * also report the facts the response says were ignored — the API answers 200
 * for a fact no serving target reads, so an unreported `ignored_inputs` is an
 * answer that looks computed from the user's facts and was not.
 */
async function variableCase(
  tools: Anthropic.Beta.BetaToolUnion[]
): Promise<CaseResult> {
  const name = "calculate_variable_for_household";
  const document = await fetch(`${baseUrl}/v1/openapi.json`).then((response) =>
    response.json()
  );
  const example = nativeExampleFromOpenApi(document);
  if (!example.ok) return skipped(name, example.reason);

  // The jurisdiction comes from the catalog row, not from the example's own
  // `state`, so the argument is in whatever form the catalog uses. A variable
  // the catalog does not list is itself a finding, not a fixture problem to
  // paper over.
  const catalog = await callTool("list_variables", {
    q: example.variable,
    limit: 50
  });
  const row = collectObjects(catalog, "variables").find(
    (entry) => asString(entry.name) === example.variable
  );
  const jurisdiction = row ? asString(row.jurisdiction) : undefined;
  if (!jurisdiction) {
    return skipped(
      name,
      `the published example asks for "${example.variable}", which the variables catalog does not list`
    );
  }

  const direct = await callTool("calculate_household", example.request);
  const expected = firstNumericValue(direct);
  if (expected === undefined || expected === 0) {
    return skipped(
      name,
      `${example.variable} produced no nonzero value to check against`
    );
  }
  const ignored = collectObjects(direct, "ignored_inputs")
    .map((entry) => asString(entry.field))
    .filter((field): field is string => field !== undefined);

  // The prompt tells the agent to choose the variable itself, so the facts go
  // over without it.
  const { variables: _requested, ...facts } = example.request;
  const run = await runPrompt(
    name,
    { variable: example.variable, jurisdiction },
    `My facts are: ${JSON.stringify(facts)}`,
    tools
  );
  if (!run.ok) return failed(name, run.reason, run);

  const digits = String(Math.trunc(expected));
  const checks: Check[] = [
    toolCheck(run.toolsCalled, "list_variables"),
    toolCheck(run.toolsCalled, "calculate_household"),
    {
      name: "reports the computed value",
      ok: run.text.includes(digits),
      detail: `expected the answer to contain ${digits}`
    }
  ];
  if (ignored.length > 0) {
    checks.push({
      name: "reports the ignored facts",
      ok: ignored.some((field) => run.text.includes(field)),
      detail: `the API ignored ${ignored.join(", ")}; expected the answer to name at least one`
    });
  }
  return graded(name, run, checks);
}

/**
 * The prompt tells the agent to fetch a package and calculate a household.
 * The answer is checkable: this calls the same tool first and requires the
 * model to report the number the API returned.
 */
async function traceCase(
  tools: Anthropic.Beta.BetaToolUnion[]
): Promise<CaseResult> {
  const name = "trace_household_result";
  const pkg = await firstPackageWithSample();
  if (!pkg.ok) return skipped(name, pkg.reason);

  const direct = await callTool("calculate_household", pkg.sampleRequest);
  const expected = firstNumericValue(direct);
  if (expected === undefined) {
    return skipped(
      name,
      `calculate_household on ${pkg.jurisdiction}/${pkg.programId} returned no numeric value to check against`
    );
  }
  if (expected === 0) {
    return skipped(
      name,
      `${pkg.jurisdiction}/${pkg.programId} computes 0, which any answer contains by accident`
    );
  }

  const run = await runPrompt(
    name,
    { program_id: pkg.programId, jurisdiction: pkg.jurisdiction },
    `My household facts are: ${JSON.stringify(pkg.sampleRequest)}`,
    tools
  );
  if (!run.ok) return failed(name, run.reason, run);

  const digits = String(Math.trunc(expected));
  return graded(name, run, [
    toolCheck(run.toolsCalled, "get_runtime_package"),
    toolCheck(run.toolsCalled, "calculate_household"),
    {
      name: "reports the computed value",
      ok: run.text.includes(digits),
      detail: `expected the answer to contain ${digits}`
    }
  ]);
}

/**
 * The prompt tells the agent to name the facts a package needs and the
 * household lacks. One leaf fact is removed from the package's own sample
 * request, so the field the model must name is known exactly.
 */
async function missingInputsCase(
  tools: Anthropic.Beta.BetaToolUnion[]
): Promise<CaseResult> {
  const name = "find_missing_household_inputs";
  const pkg = await firstPackageWithSample();
  if (!pkg.ok) return skipped(name, pkg.reason);

  const removed = removeOneLeaf(pkg.sampleRequest);
  if (!removed.ok) return skipped(name, removed.reason);

  const run = await runPrompt(
    name,
    { program_id: pkg.programId, jurisdiction: pkg.jurisdiction },
    `My household facts are: ${JSON.stringify(removed.request)}`,
    tools
  );
  if (!run.ok) return failed(name, run.reason, run);

  return graded(name, run, [
    toolCheck(run.toolsCalled, "get_runtime_package"),
    {
      name: "names the withheld fact",
      ok: run.text.includes(removed.field),
      detail: `expected the answer to name "${removed.field}"`
    }
  ]);
}

/**
 * Root mode. Same shape as the trace case: discover a subtree, compute its
 * output directly, then require the model to reach it from the prompt.
 */
async function subtreeCase(
  tools: Anthropic.Beta.BetaToolUnion[]
): Promise<CaseResult> {
  const name = "run_corpus_subtree";
  const subtrees = await callTool("list_corpus_subtrees", {});
  const root = firstSubtreeRoot(subtrees);
  if (!root) return skipped(name, "list_corpus_subtrees returned no root");

  const inputs = await callTool("get_root_inputs", { root });
  const facts = sampleFactsFrom(inputs);
  if (!facts.ok) return skipped(name, `${root}: ${facts.reason}`);

  const direct = await callTool("calculate_household", {
    root,
    facts: facts.facts
  });
  const expected = firstNumericValue(direct);
  if (expected === undefined || expected === 0) {
    return skipped(
      name,
      `${root} produced no nonzero numeric output to check against`
    );
  }

  const run = await runPrompt(
    name,
    { root },
    `My facts are: ${JSON.stringify(facts.facts)}`,
    tools
  );
  if (!run.ok) return failed(name, run.reason, run);

  const digits = String(Math.trunc(expected));
  return graded(name, run, [
    toolCheck(run.toolsCalled, "get_root_inputs"),
    toolCheck(run.toolsCalled, "calculate_household"),
    {
      name: "reports the computed value",
      ok: run.text.includes(digits),
      detail: `expected the answer to contain ${digits}`
    }
  ]);
}

interface RunOutcome {
  readonly ok: boolean;
  readonly reason: string;
  readonly text: string;
  readonly toolsCalled: Set<string>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly iterations: number;
}

/**
 * Fetches a prompt from the server and runs it to completion, bridging the
 * model's tool calls to the MCP server. A manual loop rather than the SDK's
 * tool runner, because the runner is beta and this needs to count the calls.
 */
async function runPrompt(
  promptName: string,
  args: Record<string, string>,
  householdMessage: string,
  tools: Anthropic.Beta.BetaToolUnion[]
): Promise<RunOutcome> {
  const prompt = await mcp.getPrompt({ name: promptName, arguments: args });
  const promptText = prompt.messages
    .map((message) =>
      message.content.type === "text" ? message.content.text : ""
    )
    .join("\n");

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `${promptText}\n\n${householdMessage}` }
  ];
  const toolsCalled = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium" },
      // A policy decline would otherwise end the run with no answer and look
      // like a prompt failure.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools,
      messages
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        reason: `the model declined: ${response.stop_details?.category ?? "unknown"}`,
        text: "",
        toolsCalled,
        inputTokens,
        outputTokens,
        iterations: iteration
      };
    }
    if (response.stop_reason === "max_tokens") {
      return {
        ok: false,
        reason: `hit max_tokens (${MAX_TOKENS}) before answering`,
        text: textOf(response),
        toolsCalled,
        inputTokens,
        outputTokens,
        iterations: iteration
      };
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason === "end_turn") {
      return {
        ok: true,
        reason: "",
        text: textOf(response),
        toolsCalled,
        inputTokens,
        outputTokens,
        iterations: iteration
      };
    }

    const calls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use"
    );
    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      toolsCalled.add(call.name);
      toolResults.push(await bridgeCall(call));
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    ok: false,
    reason: `did not answer within ${MAX_ITERATIONS} model calls`,
    text: "",
    toolsCalled,
    inputTokens,
    outputTokens,
    iterations: MAX_ITERATIONS
  };
}

/** Runs one of the model's tool calls against the MCP server. */
async function bridgeCall(
  call: Anthropic.Beta.BetaToolUseBlock
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  try {
    const result = await mcp.callTool({
      name: call.name,
      arguments: (call.input ?? {}) as Record<string, unknown>
    });
    return {
      type: "tool_result",
      tool_use_id: call.id,
      // An API error is a real tool result the model should see and recover
      // from, so it is forwarded with its error flag rather than thrown.
      is_error: result.isError === true,
      content: JSON.stringify(result.structuredContent ?? result.content)
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      is_error: true,
      content: error instanceof Error ? error.message : String(error)
    };
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await mcp.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(
      `${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`
    );
  }
  return result.structuredContent ?? null;
}

type PackageFixture =
  | {
      ok: true;
      programId: string;
      jurisdiction: string;
      sampleRequest: Record<string, unknown>;
    }
  | { ok: false; reason: string };

let packageFixture: PackageFixture | undefined;

/**
 * The first runtime package that publishes a sample request. Discovered
 * rather than hard-coded, so the eval follows what the API actually serves.
 */
async function firstPackageWithSample(): Promise<PackageFixture> {
  if (packageFixture) return packageFixture;
  const listed = await callTool("list_runtime_packages", {});
  const rows = collectObjects(listed, "packages");
  for (const row of rows) {
    const programId = asString(row.program_id ?? row.id);
    const jurisdiction = asString(row.jurisdiction);
    if (!programId || !jurisdiction) continue;
    const detail = await callTool("get_runtime_package", {
      jurisdiction,
      program_id: programId
    });
    const sample = findObject(detail, "sample_request");
    if (sample) {
      packageFixture = { ok: true, programId, jurisdiction, sampleRequest: sample };
      return packageFixture;
    }
  }
  packageFixture = {
    ok: false,
    reason: "no runtime package published a sample_request"
  };
  return packageFixture;
}

function textOf(response: Anthropic.Beta.BetaMessage): string {
  return response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toolCheck(called: Set<string>, tool: string): Check {
  return {
    name: `calls ${tool}`,
    ok: called.has(tool),
    detail: `tools called: ${[...called].join(", ") || "none"}`
  };
}

function graded(prompt: string, run: RunOutcome, checks: Check[]): CaseResult {
  return {
    prompt,
    status: checks.every((check) => check.ok) ? "pass" : "fail",
    checks,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    iterations: run.iterations
  };
}

function failed(prompt: string, reason: string, run: RunOutcome): CaseResult {
  return {
    prompt,
    status: "fail",
    checks: [],
    reason,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    iterations: run.iterations
  };
}

function skipped(prompt: string, reason: string): CaseResult {
  return {
    prompt,
    status: "skipped",
    checks: [],
    reason,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0
  };
}

function report(): void {
  const covered = new Set(results.map((result) => result.prompt));
  let inputTokens = 0;
  let outputTokens = 0;

  for (const result of results) {
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    const mark =
      result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIP";
    console.log(`${mark} ${result.prompt} (${result.iterations} model calls)`);
    if (result.reason) console.log(`     ${result.reason}`);
    for (const check of result.checks) {
      console.log(`     ${check.ok ? "ok" : "no"} ${check.name} — ${check.detail}`);
    }
  }

  const cost =
    inputTokens * PRICE_PER_TOKEN.input + outputTokens * PRICE_PER_TOKEN.output;
  console.log(
    `\n${inputTokens} input tokens, ${outputTokens} output tokens on ${MODEL}, about $${cost.toFixed(2)}.`
  );

  const ungraded = PROMPT_CONTRACTS.filter(
    (contract) => !covered.has(contract.name)
  ).map((contract) => contract.name);
  if (ungraded.length > 0) {
    console.log(
      `No case grades: ${ungraded.join(", ")}. These prompts ask for an explanation, which no deterministic check can score.`
    );
  }

  const skippedCases = results.filter((result) => result.status === "skipped");
  if (skippedCases.length > 0) {
    console.log(
      `\n${skippedCases.length} case(s) found no live fixture and were not graded. A skip is not a pass.`
    );
  }

  const failures = results.filter((result) => result.status === "fail");
  if (failures.length > 0) {
    throw new Error(
      `prompt eval failed: ${failures.map((result) => result.prompt).join(", ")}`
    );
  }
}
