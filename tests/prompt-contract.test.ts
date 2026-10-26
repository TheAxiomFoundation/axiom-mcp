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

it("tells the variable-addressed prompt to read the three response fields", () => {
    // These three are the whole point of the prompt. `unsupported` means no
    // value was computed, `ignored_inputs` means facts the user supplied did
    // not count, and `served_by` says what answered. An agent that skips any
    // of them reports a confident number it should have qualified.
    const contract = PROMPT_CONTRACTS.find(
      (entry) => entry.name === "calculate_variable_for_household"
    );
    expect(contract).toBeDefined();
    if (!contract) return;
    const text = renderPrompt(contract, {
      variable: "snap_benefit_amount",
      jurisdiction: "us-co"
    });
    for (const field of ["unsupported", "ignored_inputs", "served_by"]) {
      expect(text, `does not mention ${field}`).toContain(field);
    }
    // The other two modes are selected by these fields, so a
    // variable-addressed request must not carry them.
    expect(text).toContain("program_id");
    expect(text).toContain("root");
  });

  it("tells every calculating prompt to check ignored_inputs", () => {
    // The API answers 200 for a fact no serving target reads and reports it
    // in this field, so a prompt that never names it invites an answer that
    // looks computed from the user's facts and was not.
    const calculating = PROMPT_CONTRACTS.filter((contract) =>
      contract.tools.includes("calculate_household")
    );
    expect(calculating.length).toBeGreaterThan(1);
    const missing = calculating
      .filter(
        (contract) =>
          !renderPrompt(contract, sampleArgs(contract)).includes("ignored_inputs")
      )
      .map((contract) => contract.name);
    // `run_corpus_subtree` is deliberately not in the list, and this pins
    // that choice rather than a claim about the API: root mode takes a typed
    // input contract, and whether it reports ignored facts the way
    // variable-addressed mode does is unverified here. Guidance about a field
    // that may never appear in that mode would be noise. Add it once a live
    // root-mode response is seen to carry `ignored_inputs`.
    expect(missing).toEqual(["run_corpus_subtree"]);
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
