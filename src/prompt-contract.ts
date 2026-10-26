import { z } from "zod";
import { TOOL_NAMES } from "./api-surface.js";

// Prompts are instructions for a model, not code, so nothing about them fails
// a build. They name tools in prose, and a renamed tool leaves the prose
// pointing at nothing while every test still passes.
//
// So each prompt declares the tools it uses, and its text is built from that
// declaration instead of repeating the names. `toolRef` refuses a name the
// prompt did not declare, and `tests/prompt-contract.test.ts` holds every
// declared name against the tools the server registers. Drift then fails a
// test in whichever direction it happens: a prompt naming an undeclared tool,
// a declaration naming a tool that no longer exists, or a declaration left
// behind after the text stopped using it.
//
// This checks that a prompt points at real tools. It cannot check that the
// text works — `scripts/eval-prompts.ts` runs a model against the live API
// for that.

/** Returns a declared tool name, and refuses an undeclared one. */
export type ToolRef = (name: string) => string;

export interface PromptContract {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Argument shape, passed to the MCP server as `argsSchema`. */
  readonly args: Readonly<Record<string, z.ZodString>>;
  /** Every tool this prompt tells the agent to call. */
  readonly tools: readonly string[];
  readonly text: (args: Record<string, string>, tool: ToolRef) => string;
}

export function toolRef(declared: readonly string[]): ToolRef {
  return (name) => {
    if (!declared.includes(name)) {
      throw new Error(
        `prompt text names the tool "${name}", which the prompt does not declare`
      );
    }
    return name;
  };
}

/** Renders a prompt's text, refusing any tool it did not declare. */
export function renderPrompt(
  contract: PromptContract,
  args: Record<string, string>
): string {
  return contract.text(args, toolRef(contract.tools));
}

export interface ContractDrift {
  /** Declared tools that the server does not register. */
  readonly unknownTools: string[];
  /** Declared tools that the rendered text never names. */
  readonly unusedTools: string[];
}

/**
 * Compares one prompt's declaration with the registered tools and its own
 * rendered text. `sampleArgs` supplies a value for each argument, since the
 * text is only complete once it is rendered.
 */
export function diffPromptContract(
  contract: PromptContract,
  sampleArgs: Record<string, string>,
  registered: ReadonlySet<string> = TOOL_NAMES
): ContractDrift {
  const rendered = renderPrompt(contract, sampleArgs);
  return {
    unknownTools: contract.tools.filter((tool) => !registered.has(tool)),
    unusedTools: contract.tools.filter((tool) => !rendered.includes(tool))
  };
}

const ruleArgs = { rule_id: z.string().min(1) };
const packageArgs = {
  program_id: z.string().min(1),
  jurisdiction: z.string().min(1)
};
const rootArgs = { root: z.string().min(1) };

export const PROMPT_CONTRACTS: readonly PromptContract[] = [
  {
    name: "explain_rule_for_caseworker",
    title: "Explain rule for caseworker",
    description:
      "Guide an agent to retrieve sources and explain an encoded rule in operational language.",
    args: ruleArgs,
    tools: ["get_rule", "get_rule_sources"],
    text: ({ rule_id }, tool) =>
      `Use ${tool("get_rule")} and ${tool("get_rule_sources")} for ${rule_id}. ` +
      "Explain what the rule does, when it applies, what facts it needs, and cite source references from the API response. Avoid giving legal advice."
  },
  {
    name: "trace_household_result",
    title: "Trace household result",
    description:
      "Guide an agent to calculate a household and explain the output trace.",
    args: packageArgs,
    tools: ["get_runtime_package", "calculate_household"],
    text: ({ program_id, jurisdiction }, tool) =>
      `Use ${tool("get_runtime_package")} for ${jurisdiction}/${program_id}, then ${tool("calculate_household")} with the user's household facts. ` +
      "Explain each requested output from the returned trace, including rule ids and warnings."
  },
  {
    name: "run_corpus_subtree",
    title: "Run any corpus subtree on demand",
    description:
      "Guide an agent to discover a subtree's inputs and execute it with calculate_household in root mode.",
    args: rootArgs,
    tools: ["get_root_inputs", "calculate_household", "compose_graph"],
    text: ({ root }, tool) =>
      `Use ${tool("get_root_inputs")} for root ${root} to learn its typed inputs, then call ${tool("calculate_household")} with { root: "${root}", facts: {...} } using the user's facts. ` +
      `Explain each output from the returned trace, including rule ids and warnings. Use ${tool("compose_graph")} on the root if the user asks how the rules connect.`
  },
  {
    name: "find_missing_household_inputs",
    title: "Find missing household inputs",
    description:
      "Guide an agent to compare a package input schema with supplied household facts.",
    args: packageArgs,
    tools: ["get_runtime_package"],
    text: ({ program_id, jurisdiction }, tool) =>
      `Use ${tool("get_runtime_package")} for ${jurisdiction}/${program_id}. ` +
      "Compare the package entities, inputs, aliases, defaults, and sample request with the user's household. Return only missing or ambiguous facts needed for a reliable calculation."
  }
];
