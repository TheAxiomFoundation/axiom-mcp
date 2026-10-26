import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_NAMES } from "../src/api-surface.js";
import {
  PROMPT_CONTRACTS,
  diffPromptContract,
  renderPrompt,
  toolRef,
  type PromptContract
} from "../src/prompt-contract.js";

/** A value for every argument, so the text renders completely. */
function sampleArgs(contract: PromptContract): Record<string, string> {
  return Object.fromEntries(
    Object.keys(contract.args).map((key) => [key, `sample-${key}`])
  );
}

describe("prompt contracts", () => {
  it("names only tools the server registers", () => {
    // The failure this prevents: a tool is renamed, every prompt that tells
    // an agent to call it now points at nothing, and no test notices because
    // prompt text is prose.
    for (const contract of PROMPT_CONTRACTS) {
      const drift = diffPromptContract(contract, sampleArgs(contract));
      expect(drift.unknownTools, `${contract.name} names unknown tools`).toEqual(
        []
      );
    }
  });

  it("uses every tool it declares", () => {
    // The other direction: text stops mentioning a tool, the declaration
    // stays, and the contract overstates what the prompt does.
    for (const contract of PROMPT_CONTRACTS) {
      const drift = diffPromptContract(contract, sampleArgs(contract));
      expect(drift.unusedTools, `${contract.name} declares unused tools`).toEqual(
        []
      );
    }
  });

  it("interpolates every argument into the text", () => {
    for (const contract of PROMPT_CONTRACTS) {
      const args = sampleArgs(contract);
      const text = renderPrompt(contract, args);
      for (const value of Object.values(args)) {
        expect(text, `${contract.name} dropped ${value}`).toContain(value);
      }
    }
  });

  it("registers each prompt name once", () => {
    const names = PROMPT_CONTRACTS.map((contract) => contract.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("refuses text that names an undeclared tool", () => {
    const tool = toolRef(["get_rule"]);
    expect(tool("get_rule")).toBe("get_rule");
    expect(() => tool("get_rule_sources")).toThrow(/does not declare/);
  });

  it("reports a declaration that points at a tool which does not exist", () => {
    // Proves the check fires, rather than passing because nothing is wrong.
    const stale: PromptContract = {
      name: "stale",
      title: "Stale",
      description: "Names a tool that was renamed away.",
      args: { rule_id: z.string().min(1) },
      tools: ["get_rule_renamed"],
      text: ({ rule_id }, tool) => `Use ${tool("get_rule_renamed")} for ${rule_id}.`
    };
    expect(TOOL_NAMES.has("get_rule_renamed")).toBe(false);
    expect(diffPromptContract(stale, { rule_id: "us-co/snap" })).toEqual({
      unknownTools: ["get_rule_renamed"],
      unusedTools: []
    });
  });
});
