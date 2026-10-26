import { describe, expect, it } from "vitest";
import {
  MCP_SERVER_NAME,
  parseCliStream,
  strippedToolName
} from "../scripts/eval-cli-stream.js";

// The event shapes here are trimmed copies of what `claude --print
// --output-format stream-json` actually printed for a run against this
// server. The point of testing the parser on its own is that every one of
// these cases — above all the three harness faults — can be proven without a
// credential, a model call or a subprocess.

describe("parseCliStream", () => {
  it("reads the answer, the tools called and the usage of a run", () => {
    const run = parseCliStream(
      stream([
        init(),
        assistantToolUse("mcp__axiom__list_variables"),
        assistantToolUse("mcp__axiom__calculate_household"),
        result({ result: "SNAP comes to 291 dollars a month." })
      ])
    );

    expect(run.ok).toBe(true);
    expect(run.reason).toBe("");
    expect(run.text).toContain("291");
    expect([...run.toolsCalled].sort()).toEqual([
      "calculate_household",
      "list_variables"
    ]);
    expect(run.turns).toBe(4);
    expect(run.outputTokens).toBe(96);
    expect(run.costUsd).toBeCloseTo(0.067, 3);
  });

  it("counts cache reads and writes as input tokens", () => {
    const run = parseCliStream(stream([init(), result({})]));

    // 4 fresh + 16110 written to cache + 15971 read from it.
    expect(run.inputTokens).toBe(32085);
  });

  it("strips the server prefix and keeps any other tool name verbatim", () => {
    expect(strippedToolName(`mcp__${MCP_SERVER_NAME}__get_rule`)).toBe("get_rule");
    expect(strippedToolName("mcp__other__get_rule")).toBe("mcp__other__get_rule");
    expect(strippedToolName("Bash")).toBe("Bash");
  });

  it("records a built-in tool under its own name, so a stray call shows", () => {
    const run = parseCliStream(
      stream([init(), assistantToolUse("WebFetch"), result({})])
    );

    expect(run.toolsCalled.has("WebFetch")).toBe(true);
  });

  it("ignores lines that are not JSON objects", () => {
    const lines = [
      "warning: something the CLI printed on its own",
      "",
      "{ not json at all",
      ...stream([init(), result({ result: "done" })])
    ];

    expect(parseCliStream(lines).ok).toBe(true);
  });

  // The three faults below are the reason the parser is a separate unit. Each
  // one leaves the model unable to do what a grader looks for, so each has to
  // read as the harness's fault and not as a prompt that performed badly.

  it("fails a run whose MCP server never connected", () => {
    const run = parseCliStream(
      stream([
        init([{ name: MCP_SERVER_NAME, status: "failed" }]),
        result({ result: "I have no tools for that." })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("did not connect");
    expect(run.reason).toContain(MCP_SERVER_NAME);
  });

  it("fails a run whose tool call the allowlist denied", () => {
    const run = parseCliStream(
      stream([
        init(),
        result({
          result: "I was not allowed to call it.",
          permission_denials: [{ tool_name: "mcp__axiom__calculate_household" }]
        })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("mcp__axiom__calculate_household");
    expect(run.reason).toContain("allowlist");
  });

  it("fails a run the model declined", () => {
    const run = parseCliStream(
      stream([init(), result({ safety_stops: ["refusal"], result: "" })])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("declined");
  });

  it("fails a run that the CLI did not finish, and says how it ended", () => {
    const run = parseCliStream(
      stream([
        init(),
        result({
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "api_error",
          result: ""
        })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("error_during_execution");
    expect(run.reason).toContain("api_error");
  });

  it("fails a run that printed no init event", () => {
    const run = parseCliStream(stream([result({ result: "done" })]));

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("never started");
  });

  it("fails a run that printed no result event", () => {
    const run = parseCliStream(
      stream([init(), assistantToolUse("mcp__axiom__get_rule")])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("no result event");
    // The tools it did call are still reported, so a timed-out run says how
    // far it got.
    expect(run.toolsCalled.has("get_rule")).toBe(true);
  });

  it("fails a run that succeeded with nothing to grade", () => {
    const run = parseCliStream(stream([init(), result({ result: "   " })]));

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("no answer text");
  });
});

function stream(events: unknown[]): string[] {
  return events.map((event) => JSON.stringify(event));
}

function init(
  servers: Array<{ name: string; status: string }> = [
    { name: MCP_SERVER_NAME, status: "connected" }
  ]
): unknown {
  return {
    type: "system",
    subtype: "init",
    mcp_servers: servers.map((server) => ({ ...server, source: "dynamic" })),
    tools: ["mcp__axiom__calculate_household", "mcp__axiom__list_variables"]
  };
}

function assistantToolUse(name: string): unknown {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_01", name, input: {} }],
      usage: { input_tokens: 4, output_tokens: 96 }
    }
  };
}

function result(fields: Record<string, unknown>): unknown {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 4,
    total_cost_usd: 0.0670051,
    permission_denials: [],
    usage: {
      input_tokens: 4,
      cache_creation_input_tokens: 16110,
      cache_read_input_tokens: 15971,
      output_tokens: 96
    },
    ...fields
  };
}
