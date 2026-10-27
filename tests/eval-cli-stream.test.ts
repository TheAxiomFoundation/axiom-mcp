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
  it("reads the CLI version, so two reports can be compared", () => {
    const run = parseCliStream(stream([init(), result({})]));

    expect(run.cliVersion).toBe("2.1.311");
  });

  // A CI run called `Bash`, which the eval never offers. Whatever reached it,
  // the model then had a second way to an answer and the run stopped being a
  // test of the prompt.
  it("faults when the CLI offers a tool the eval did not ask for", () => {
    const run = parseCliStream(
      stream([
        init(undefined, ["mcp__axiom__calculate_household", "Bash", "Read"]),
        assistantToolUse("Bash"),
        result({ result: "I ran it in the shell." })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("Bash");
    expect(run.reason).toContain("Read");
    expect(run.reason).toContain("not isolated");
    expect(run.text).toBe("");
  });

  // The CLI's own reply when a result is too big to hand over. It advises
  // grepping the file or slicing it with Bash — which this run cannot do, and
  // which is where the stray `Bash` in one report came from.
  it("faults when a tool result was written to a file", () => {
    const run = parseCliStream(
      stream([
        init(),
        assistantToolUse("mcp__axiom__get_runtime_package"),
        toolResult(
          "Error: result (60,462 characters across 1 line) exceeds maximum " +
            "allowed tokens. Output has been saved to /tmp/tool-results/x.txt.\n" +
            "- For targeted searches (find a string): use grep on the file."
        ),
        result({ result: "I could not read the package." })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("60,462 characters");
    expect(run.reason).toContain("written to a file");
    expect(run.text).toBe("");
  });

  it("still reports what a spilled run called and spent", () => {
    const run = parseCliStream(
      stream([
        init(),
        assistantToolUse("mcp__axiom__get_runtime_package"),
        toolResult("Error: result (99 characters) exceeds maximum allowed tokens."),
        result({})
      ])
    );

    expect([...run.toolsCalled]).toEqual(["get_runtime_package"]);
    expect(run.inputTokens).toBe(32085);
  });

  // The first detector read one field and missed this shape in CI, where a
  // tool result carries its text as a list of blocks rather than a string.
  it("faults on a filed-away result whose text is in blocks", () => {
    const run = parseCliStream(
      stream([
        init(),
        assistantToolUse("mcp__axiom__get_runtime_package"),
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: [
                  {
                    type: "text",
                    text:
                      "Error: result (60,462 characters across 1 line) " +
                      "exceeds maximum allowed tokens. Output has been " +
                      "saved to /tmp/tool-results/x.txt."
                  }
                ]
              }
            ]
          }
        },
        result({ result: "I could not read the package." })
      ])
    );

    expect(run.ok).toBe(false);
    expect(run.reason).toContain("60,462 characters");
  });

  it("leaves an ordinary tool result alone", () => {
    const run = parseCliStream(
      stream([
        init(),
        assistantToolUse("mcp__axiom__get_runtime_package"),
        toolResult('{"program_id":"us-ny/snap"}'),
        result({ result: "The package is us-ny/snap." })
      ])
    );

    expect(run.ok).toBe(true);
  });

  it("accepts a run offered only the server's own tools", () => {
    const run = parseCliStream(
      stream([init(), result({ result: "SNAP comes to 291 dollars." })])
    );

    expect(run.ok).toBe(true);
  });
});

function toolResult(content: string): unknown {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content }]
    }
  };
}

function stream(events: unknown[]): string[] {
  return events.map((event) => JSON.stringify(event));
}

function init(
  servers: Array<{ name: string; status: string }> = [
    { name: MCP_SERVER_NAME, status: "connected" }
  ],
  tools: string[] = [
    "mcp__axiom__calculate_household",
    "mcp__axiom__list_variables"
  ]
): unknown {
  return {
    type: "system",
    subtype: "init",
    claude_code_version: "2.1.311",
    mcp_servers: servers.map((server) => ({ ...server, source: "dynamic" })),
    tools
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
