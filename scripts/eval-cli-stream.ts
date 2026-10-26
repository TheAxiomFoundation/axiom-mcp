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

export interface CliRun {
  readonly ok: boolean;
  readonly reason: string;
  readonly text: string;
  readonly toolsCalled: Set<string>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turns: number;
  readonly costUsd: number;
}

export function parseCliStream(lines: readonly string[]): CliRun {
  const toolsCalled = new Set<string>();
  let result: Record<string, unknown> | undefined;
  let unconnected: string[] = [];
  let sawInit = false;

  for (const event of jsonEvents(lines)) {
    const type = asString(event.type);
    if (type === "system" && asString(event.subtype) === "init") {
      sawInit = true;
      unconnected = serversNotConnected(event);
    } else if (type === "assistant") {
      for (const name of toolNamesIn(event)) toolsCalled.add(name);
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
