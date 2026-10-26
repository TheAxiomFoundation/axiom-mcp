import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AxiomApiClient } from "../src/axiom-client.js";
import { PROMPT_CONTRACTS } from "../src/prompt-contract.js";
import { createAxiomMcpServer } from "../src/server.js";
import { EVAL_MODEL, type PromptDriver, type RunOutcome } from "./eval-driver.js";
import { createCliDriver } from "./eval-driver-cli.js";
import { createSdkDriver } from "./eval-driver-sdk.js";
import { nativeExampleFromOpenApi } from "./native-request.js";
import {
  asString,
  collectObjects,
  findObject,
  checkableValue,
  firstNumericValue,
  firstSubtreeRoot,
  removeOneLeaf,
  reportsNumber,
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
// Two drivers can carry the model side, and they grade the same text the same
// way. `AXIOM_EVAL_DRIVER=cli` (the default) runs the Claude Code CLI, which
// needs no Anthropic API key. `AXIOM_EVAL_DRIVER=sdk` calls the Anthropic API
// and bills a key per token. Either way the run costs something; this is not
// in the 30-minute smoke. See `.github/workflows/prompt-eval.yml`.

const baseUrl = process.env.AXIOM_API_BASE_URL || "https://api.axiom.org";
const apiKey = process.env.AXIOM_API_KEY || "";

if (!apiKey) {
  throw new Error("AXIOM_API_KEY is required for the prompt eval.");
}

// The direct tool calls that compute what the model must reach run in
// process, against the same server either driver's model talks to.
const apiClient = new AxiomApiClient({ baseUrl, apiKey });
const server = createAxiomMcpServer(apiClient);
const mcp = new Client({ name: "axiom-mcp-prompt-eval", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

const driver = selectDriver();

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
  readonly costUsd: number;
}

/**
 * The runtime-package fixture, cached across the cases that share it.
 *
 * It is declared above the run block on purpose. The cases run from there,
 * so the same `let` further down the file is still in its temporal dead
 * zone when `firstPackageWithSample` reads it, and the second case dies
 * with a ReferenceError before it grades anything.
 */
let packageFixture: PackageFixture | undefined;

type CaseBuilder = (name: string) => Promise<CaseResult>;

/**
 * Each prompt under test, with the case that grades it. The names are the
 * server's own prompt names, so `report` can name a contract that no case
 * covers.
 */
const CASES: ReadonlyArray<readonly [string, CaseBuilder]> = [
  ["calculate_variable_for_household", variableCase],
  ["trace_household_result", traceCase],
  ["find_missing_household_inputs", missingInputsCase],
  ["run_corpus_subtree", subtreeCase]
];

const results: CaseResult[] = [];

try {
  for (const [name, build] of CASES) {
    results.push(await runCase(name, build));
  }
} finally {
  await driver.close();
  await mcp.close();
  await server.close();
}

report();

/**
 * Chooses how to reach a model. The CLI needs no API key, so it is the
 * default; `AXIOM_EVAL_DRIVER=sdk` asks for the key-and-token route instead.
 */
function selectDriver(): PromptDriver {
  const flag = process.argv
    .find((argument) => argument.startsWith("--driver="))
    ?.slice("--driver=".length);
  const choice = flag || process.env.AXIOM_EVAL_DRIVER || "cli";

  if (choice === "sdk") {
    // Not a hard check on ANTHROPIC_API_KEY: the SDK also resolves an
    // `ant auth login` profile, so an unset variable does not mean there is no
    // credential. A machine with a profile and no variable must still run. If
    // there is really no credential, the SDK raises its own authentication
    // error on the first model call.
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(
        "ANTHROPIC_API_KEY is unset; the SDK will look for an `ant auth login` profile."
      );
    }
    return createSdkDriver(mcp);
  }
  if (choice === "cli") {
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(
        "ANTHROPIC_API_KEY is set but is not passed to the CLI, which would " +
          "then bill the API instead of its own login. Use --driver=sdk to " +
          "spend the key on purpose."
      );
    }
    return createCliDriver({
      baseUrl,
      apiKey,
      timeoutMs: process.env.AXIOM_API_TIMEOUT_MS
    });
  }
  throw new Error(`unknown eval driver "${choice}"; expected "cli" or "sdk"`);
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
async function variableCase(name: string): Promise<CaseResult> {
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
  const expected = checkableValue(firstNumericValue(direct));
  if (!expected.ok) {
    return skipped(name, `${example.variable} ${expected.reason}`);
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
    `My facts are: ${JSON.stringify(facts)}`
  );
  if (!run.ok) return failed(name, run.reason, run);

  const checks: Check[] = [
    toolCheck(run.toolsCalled, "list_variables"),
    toolCheck(run.toolsCalled, "calculate_household"),
    valueCheck(run.text, expected.value)
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
async function traceCase(name: string): Promise<CaseResult> {
  const pkg = await firstPackageWithSample();
  if (!pkg.ok) return skipped(name, pkg.reason);

  const direct = await callTool("calculate_household", pkg.sampleRequest);
  const expected = checkableValue(firstNumericValue(direct));
  if (!expected.ok) {
    return skipped(
      name,
      `${pkg.jurisdiction}/${pkg.programId} ${expected.reason}`
    );
  }

  const run = await runPrompt(
    name,
    { program_id: pkg.programId, jurisdiction: pkg.jurisdiction },
    `My household facts are: ${JSON.stringify(pkg.sampleRequest)}`
  );
  if (!run.ok) return failed(name, run.reason, run);

  return graded(name, run, [
    toolCheck(run.toolsCalled, "get_runtime_package"),
    toolCheck(run.toolsCalled, "calculate_household"),
    valueCheck(run.text, expected.value)
  ]);
}

/**
 * The prompt tells the agent to name the facts a package needs and the
 * household lacks. One leaf fact is removed from the package's own sample
 * request, so the field the model must name is known exactly.
 */
async function missingInputsCase(name: string): Promise<CaseResult> {
  const pkg = await firstPackageWithSample();
  if (!pkg.ok) return skipped(name, pkg.reason);

  const removed = removeOneLeaf(pkg.sampleRequest);
  if (!removed.ok) return skipped(name, removed.reason);

  const run = await runPrompt(
    name,
    { program_id: pkg.programId, jurisdiction: pkg.jurisdiction },
    `My household facts are: ${JSON.stringify(removed.request)}`
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
async function subtreeCase(name: string): Promise<CaseResult> {
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
  const expected = checkableValue(firstNumericValue(direct));
  if (!expected.ok) {
    return skipped(name, `${root} ${expected.reason}`);
  }

  const run = await runPrompt(name, { root }, `My facts are: ${JSON.stringify(facts.facts)}`);
  if (!run.ok) return failed(name, run.reason, run);

  return graded(name, run, [
    toolCheck(run.toolsCalled, "get_root_inputs"),
    toolCheck(run.toolsCalled, "calculate_household"),
    valueCheck(run.text, expected.value)
  ]);
}

/**
 * Fetches a prompt from the server and hands it to whichever driver is in
 * use. The prompt text is rendered here, not by the driver, so both drivers
 * grade the same words.
 */
async function runPrompt(
  promptName: string,
  args: Record<string, string>,
  householdMessage: string
): Promise<RunOutcome> {
  const prompt = await mcp.getPrompt({ name: promptName, arguments: args });
  const promptText = prompt.messages
    .map((message) =>
      message.content.type === "text" ? message.content.text : ""
    )
    .join("\n");
  return driver.run(`${promptText}\n\n${householdMessage}`);
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

/** Requires the answer to report the number the API computed. */
function valueCheck(text: string, expected: number): Check {
  const digits = String(Math.trunc(Math.abs(expected)));
  return {
    name: "reports the computed value",
    ok: reportsNumber(text, expected),
    detail: `expected the answer to report ${digits} as its own number`
  };
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
    iterations: run.iterations,
    costUsd: run.costUsd
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
    iterations: run.iterations,
    costUsd: run.costUsd
  };
}

/**
 * Runs one case, and turns a thrown setup failure into a skip.
 *
 * Only the harness throws here: a tool call the API refuses, or a prompt
 * the server will not render. Letting it escape ends the whole run, which
 * loses every case already graded and the model calls they cost. One
 * endpoint answering 503 must not erase three results.
 */
async function runCase(
  name: string,
  build: CaseBuilder
): Promise<CaseResult> {
  try {
    return await build(name);
  } catch (error) {
    return skipped(
      name,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function skipped(prompt: string, reason: string): CaseResult {
  return {
    prompt,
    status: "skipped",
    checks: [],
    reason,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    costUsd: 0
  };
}

function report(): void {
  const covered = new Set(results.map((result) => result.prompt));
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for (const result of results) {
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    costUsd += result.costUsd;
    const mark =
      result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIP";
    console.log(`${mark} ${result.prompt} (${result.iterations} model calls)`);
    if (result.reason) console.log(`     ${result.reason}`);
    for (const check of result.checks) {
      console.log(`     ${check.ok ? "ok" : "no"} ${check.name} — ${check.detail}`);
    }
  }

  console.log(
    `\n${inputTokens} input tokens, ${outputTokens} output tokens on ${EVAL_MODEL} through ${driver.billing}, about $${costUsd.toFixed(2)}.`
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
