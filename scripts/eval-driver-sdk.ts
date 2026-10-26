import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { EVAL_MODEL, type PromptDriver, type RunOutcome } from "./eval-driver.js";

/**
 * Reaches a model through the Anthropic API, which needs a key and bills per
 * token. `eval-driver-cli.ts` needs neither; this driver stays for a run that
 * is meant to be billed to the API, and so the CLI driver has something to be
 * compared against.
 *
 * The loop is written out rather than handed to the SDK's tool runner, which
 * is beta and does not report the call count this eval reports.
 */

// Each iteration is one model call. The cap bounds the spend of a run that
// loops instead of answering; hitting it fails the case.
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 8000;
// Per million tokens, for the run's cost line.
const PRICE_PER_TOKEN = { input: 4 / 1_000_000, output: 20 / 1_000_000 };

export function createSdkDriver(mcp: Client): PromptDriver {
  const anthropic = new Anthropic();
  let tools: Anthropic.Beta.BetaToolUnion[] | undefined;

  return {
    name: "sdk",
    billing: "the Anthropic API, billed per token",

    async run(userMessage: string): Promise<RunOutcome> {
      tools ??= await bridgeTools(mcp);
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: "user", content: userMessage }
      ];
      const toolsCalled = new Set<string>();
      let inputTokens = 0;
      let outputTokens = 0;

      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
        const response = await anthropic.beta.messages.create({
          model: EVAL_MODEL,
          max_tokens: MAX_TOKENS,
          output_config: { effort: "medium" },
          // A policy decline would otherwise end the run with no answer and
          // look like a prompt failure.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          tools,
          messages
        });
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        const spent = () => ({
          toolsCalled,
          inputTokens,
          outputTokens,
          iterations: iteration,
          costUsd:
            inputTokens * PRICE_PER_TOKEN.input +
            outputTokens * PRICE_PER_TOKEN.output
        });

        if (response.stop_reason === "refusal") {
          return {
            ok: false,
            reason: `the model declined: ${response.stop_details?.category ?? "unknown"}`,
            text: "",
            ...spent()
          };
        }
        if (response.stop_reason === "max_tokens") {
          return {
            ok: false,
            reason: `hit max_tokens (${MAX_TOKENS}) before answering`,
            text: textOf(response),
            ...spent()
          };
        }

        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "pause_turn") continue;
        if (response.stop_reason === "end_turn") {
          return { ok: true, reason: "", text: textOf(response), ...spent() };
        }

        const calls = response.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock =>
            block.type === "tool_use"
        );
        const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          toolsCalled.add(call.name);
          toolResults.push(await bridgeCall(mcp, call));
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
        iterations: MAX_ITERATIONS,
        costUsd:
          inputTokens * PRICE_PER_TOKEN.input +
          outputTokens * PRICE_PER_TOKEN.output
      };
    },

    async close(): Promise<void> {
      tools = undefined;
    }
  };
}

/** Exposes the MCP tool list to the model as Anthropic tool definitions. */
async function bridgeTools(
  mcp: Client
): Promise<Anthropic.Beta.BetaToolUnion[]> {
  const listed = await mcp.listTools();
  return listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool["input_schema"]
  }));
}

/** Runs one of the model's tool calls against the MCP server. */
async function bridgeCall(
  mcp: Client,
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

function textOf(response: Anthropic.Beta.BetaMessage): string {
  return response.content
    .filter(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === "text"
    )
    .map((block) => block.text)
    .join("\n");
}
