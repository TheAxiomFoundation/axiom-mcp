/**
 * Reads what the Claude Code CLI printed for one `--output-format stream-json`
 * run.
 *
 * Kept apart from the driver that spawns the CLI so it can be tested without
 * a model, a credential or a subprocess. `tests/eval-cli-stream.test.ts` feeds
 * it recorded streams, including the failure shapes that must not be mistaken
 * for a prompt that performed badly: an MCP server that never connected, a
 * tool the permission allowlist missed, and a run the model declined.
 */

/** The name the driver registers the Axiom server under. */
export const MCP_SERVER_NAME = "axiom";

/** The CLI prefixes every MCP tool name with its server. */
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** What the CLI says when a result is too large to hand to the model. */
const SPILL_MARKER = "exceeds maximum allowed tokens";

export interface CliRun {
  readonly ok: boolean;
  readonly reason: string;
  readonly text: string;
  readonly toolsCalled: Set<string>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turns: number;
  readonly costUsd: number;
  /** The CLI that ran, so a report says which harness produced it. */
  readonly cliVersion: string;
}

export function parseCliStream(lines: readonly string[]): CliRun {
  const toolsCalled = new Set<string>();
  let result: Record<string, unknown> | undefined;
  let unconnected: string[] = [];
  let foreignTools: string[] = [];
  let spilled: string | undefined;
  let cliVersion = "";
  let sawInit = false;

  for (const event of jsonEvents(lines)) {
    const type = asString(event.type);
    if (type === "system" && asString(event.subtype) === "init") {
      sawInit = true;
      unconnected = serversNotConnected(event);
      foreignTools = toolsBeyondTheServer(event);
      cliVersion = asString(event.claude_code_version) ?? "";
    } else if (type === "assistant") {
      for (const name of toolNamesIn(event)) toolsCalled.add(name);
    } else if (type === "user") {
      spilled = spilled ?? spilledToolResult(event);
    } else if (type === "result") {
      result = event;
    }
  }

  const usage = asRecord(result?.usage);
  const totals: Totals = {
    // Cache reads and writes are input tokens too. They are counted in, so
    // the report's token line is the whole input the run was billed for.
    inputTokens:
      asNumber(usage?.input_tokens) +
      asNumber(usage?.cache_creation_input_tokens) +
      asNumber(usage?.cache_read_input_tokens),
    outputTokens: asNumber(usage?.output_tokens),
    turns: asNumber(result?.num_turns),
    // The CLI reports what the work costs on the API, whichever credential
    // actually paid for it.
    costUsd: asNumber(result?.total_cost_usd),
    cliVersion,
    toolsCalled
  };

  // Harness faults first. Each one leaves the model unable to do the thing a
  // grader is about to look for, so reporting it as a prompt result would be
  // a claim about the prompt that the run does not support.
  if (!sawInit) {
    return fault("the CLI printed no init event, so the run never started", totals);
  }
  if (unconnected.length > 0) {
    return fault(
      `the MCP server(s) ${unconnected.join(", ")} did not connect, so the model had no Axiom tools`,
      totals
    );
  }
  // The eval asks the CLI for the Axiom tools and nothing else, so the
  // prompt under test has to do all the work. A built-in that slips
  // through gives the model another way to reach an answer, and the run
  // stops being a test of the prompt. One CI run called `Bash`.
  if (foreignTools.length > 0) {
    return fault(
      `the CLI offered ${foreignTools.join(", ")} besides the ` +
        `${MCP_SERVER_NAME} tools, so the run was not isolated`,
      totals
    );
  }
  // A tool result the CLI would not hand over. Past its ceiling it writes
  // the result to a file and replies with the path, advising the model to
  // grep or slice it — advice this run cannot take, because it is given
  // the Axiom tools and nothing else. The model then answers without its
  // fixture, and a check that looks into that fixture fails for a reason
  // that has nothing to do with the prompt.
  if (spilled) {
    return fault(spilled, totals);
  }
  const denied = deniedTools(result);
  if (denied.length > 0) {
    return fault(
      `the CLI denied the tool call(s) ${denied.join(", ")}; the eval's allowlist is wrong, not the prompt`,
      totals
    );
  }

  if (!result) {
    return fault("the CLI printed no result event", totals);
  }
  const stops = stringList(result.safety_stops);
  if (stops.length > 0) {
    return fault(`the model declined: ${stops.join(", ")}`, totals);
  }
  const subtype = asString(result.subtype);
  if (subtype !== "success" || result.is_error === true) {
    const terminal =
      asString(result.terminal_reason) ?? asString(result.stop_reason);
    return fault(
      `the CLI ended with subtype "${subtype ?? "none"}"${terminal ? ` (${terminal})` : ""}`,
      totals
    );
  }

  const text = asString(result.result);
  if (text === undefined || text.trim() === "") {
    return fault("the run succeeded but produced no answer text", totals);
  }

  return { ok: true, reason: "", text, ...totals };
}

/** Strips the CLI's server prefix; a tool from anywhere else is kept verbatim. */
export function strippedToolName(name: string): string {
  return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
}

type Totals = Omit<CliRun, "ok" | "reason" | "text">;

function fault(reason: string, totals: Totals): CliRun {
  return { ok: false, reason, text: "", ...totals };
}

/**
 * The parsed JSON objects in the stream. A line that is not a JSON object is
 * skipped rather than thrown on: the CLI also prints warnings, and one of
 * those must not lose a run that otherwise completed.
 */
function* jsonEvents(
  lines: readonly string[]
): Generator<Record<string, unknown>> {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = asRecord(parsed);
    if (event) yield event;
  }
}

function toolNamesIn(event: Record<string, unknown>): string[] {
  const content = asRecord(event.message)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .map((block) => asRecord(block))
    .filter((block) => asString(block?.type) === "tool_use")
    .map((block) => asString(block?.name))
    .filter((name): name is string => name !== undefined)
    .map(strippedToolName);
}

function serversNotConnected(event: Record<string, unknown>): string[] {
  const servers = event.mcp_servers;
  if (!Array.isArray(servers)) return [];
  return servers
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry?.status) !== "connected")
    .map((entry) => asString(entry?.name) ?? "unnamed");
}

/**
 * The CLI's own words when it files a result away instead of answering it:
 * `Error: result (60,462 characters across 1 line) exceeds maximum allowed
 * tokens. Output has been saved to ...`.
 *
 * The whole event is searched rather than one field of it. A tool result
 * carries its text as a plain string from one server and as a list of
 * blocks from another, and a detector written for the shape in front of me
 * missed the shape in CI — twice over, at about $0.50 a run.
 */
function spilledToolResult(
  event: Record<string, unknown>
): string | undefined {
  const text = JSON.stringify(event);
  if (!text.includes(SPILL_MARKER)) return undefined;
  const size = /result \((\d[\d,]*) characters/.exec(text)?.[1];
  return (
    `a tool result${size ? ` of ${size} characters` : ""} was written to a ` +
    "file instead of answered to the model, which has no tool that can open it"
  );
}

/** Tools the CLI offered that did not come from the Axiom server. */
function toolsBeyondTheServer(event: Record<string, unknown>): string[] {
  const tools = event.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => asString(tool))
    .filter((name): name is string => name !== undefined)
    .filter((name) => !name.startsWith(TOOL_PREFIX));
}

function deniedTools(result: Record<string, unknown> | undefined): string[] {
  const denials = result?.permission_denials;
  if (!Array.isArray(denials)) return [];
  return denials.map(
    (entry) => asString(asRecord(entry)?.tool_name) ?? "an unnamed tool"
  );
}

/** Reads a list that may hold plain strings or objects carrying a reason. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    typeof entry === "string"
      ? entry
      : (asString(asRecord(entry)?.reason) ?? JSON.stringify(entry))
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
