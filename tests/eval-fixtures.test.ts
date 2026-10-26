import { describe, expect, it } from "vitest";
import {
  checkableValue,
  firstNumericValue,
  firstSubtreeRoot,
  removeOneLeaf,
  reportsNumber,
  sampleFactsFrom
} from "../scripts/eval-fixtures.js";

describe("removeOneLeaf", () => {
  // The eval asks the model to name the fact it is missing. That check is
  // only exact if the fact removed here is a household fact, so the
  // mode-selecting fields must survive.
  const sample = {
    program_id: "co-snap",
    jurisdiction: "us-co",
    period: "2026-01",
    variables: ["snap_benefit_amount"],
    household: { people: { maria: { age: 34 } } }
  };

  it("removes a household fact and names it", () => {
    const result = removeOneLeaf(sample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.field).toBe("age");
    expect(result.request).toMatchObject({
      program_id: "co-snap",
      jurisdiction: "us-co",
      household: { people: { maria: {} } }
    });
  });

  it("leaves the original request untouched", () => {
    removeOneLeaf(sample);
    expect(sample.household.people.maria.age).toBe(34);
  });

  it("never removes a field that selects the mode or the outputs", () => {
    const result = removeOneLeaf({
      program_id: "co-snap",
      root: "us:statutes/7/2014",
      period: "2026-01",
      variables: ["snap"],
      unit: { shelter_costs: 0 }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.field).toBe("shelter_costs");
  });

  it("reports a request with no fact to remove", () => {
    expect(removeOneLeaf({ program_id: "co-snap", jurisdiction: "us-co" })).toEqual({
      ok: false,
      reason: "sample request had no leaf fact to remove"
    });
  });
});

describe("firstNumericValue", () => {
  it("finds the computed value in a variable-addressed response", () => {
    expect(
      firstNumericValue({
        data: { computed: [{ variable: "snap_benefit_amount", value: 128 }] }
      })
    ).toBe(128);
  });

  it("finds a value nested in a package trace", () => {
    expect(
      firstNumericValue({ data: { trace: { outputs: [{ value: 42.5 }] } } })
    ).toBe(42.5);
  });

  it("ignores a non-finite value", () => {
    // A null or NaN result must read as "nothing to check", not as a value
    // the model should be asked to repeat.
    expect(firstNumericValue({ value: null })).toBeUndefined();
    expect(firstNumericValue({ value: Number.NaN })).toBeUndefined();
  });

  it("returns undefined when no value is present", () => {
    expect(firstNumericValue({ data: { unsupported: [{ variable: "x" }] } }))
      .toBeUndefined();
  });
});

describe("sampleFactsFrom", () => {
  it("fills each declared input by type", () => {
    const result = sampleFactsFrom({
      data: {
        inputs: [
          { name: "income", type: "number" },
          { name: "is_disabled", type: "boolean" },
          { name: "state", type: "enum", allowed_values: ["CO", "UT"] }
        ]
      }
    });
    expect(result).toEqual({
      ok: true,
      facts: { income: 1, is_disabled: false, state: "CO" }
    });
  });

  it("refuses a string input with no allowed values", () => {
    // Guessing a string would make the case fail on a bad fixture rather
    // than on the prompt, so it skips instead.
    expect(
      sampleFactsFrom({ data: { inputs: [{ name: "county", type: "string" }] } })
    ).toEqual({
      ok: false,
      reason: "input county has no value this eval can supply"
    });
  });

  it("reports a root that declares no inputs", () => {
    expect(sampleFactsFrom({ data: { inputs: [] } })).toEqual({
      ok: false,
      reason: "declared no inputs"
    });
  });
});

describe("firstSubtreeRoot", () => {
  it("reads the first root from the subtree list", () => {
    expect(
      firstSubtreeRoot({ data: { subtrees: [{ root: "us:statutes/7/2014" }] } })
    ).toBe("us:statutes/7/2014");
  });

  it("returns undefined for an empty list", () => {
    expect(firstSubtreeRoot({ data: { subtrees: [] } })).toBeUndefined();
  });
});

describe("checkableValue", () => {
  // A check the answer passes by accident is worse than no check: it reports
  // a prompt as working on evidence that says nothing.
  it("accepts a value with enough digits to be specific", () => {
    expect(checkableValue(339)).toEqual({ ok: true, value: 339 });
  });

  it("refuses a missing value", () => {
    expect(checkableValue(undefined)).toEqual({
      ok: false,
      reason: "returned no numeric value to check against"
    });
  });

  it("refuses a single digit, which prose contains by accident", () => {
    const result = checkableValue(9);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("computes 9");
  });

  it("refuses zero", () => {
    expect(checkableValue(0).ok).toBe(false);
  });

  it("judges a negative value by its size", () => {
    expect(checkableValue(-42).ok).toBe(false);
    expect(checkableValue(-339)).toEqual({ ok: true, value: -339 });
  });
});

describe("reportsNumber", () => {
  it("finds the number in prose", () => {
    expect(reportsNumber("You receive $339 per month.", 339)).toBe(true);
  });

  it("ignores separators the answer puts between digits", () => {
    expect(reportsNumber("The total is 12,345 dollars.", 12345)).toBe(true);
  });

  it("rejects the digits inside a longer number", () => {
    expect(reportsNumber("Your case id is 1339.", 339)).toBe(false);
    expect(reportsNumber("Totals: 3390 and 11200.", 339)).toBe(false);
  });

  it("rejects the digits after a decimal point", () => {
    expect(reportsNumber("The rate is 0.339 per unit.", 339)).toBe(false);
  });

  it("accepts the number with its own decimals after it", () => {
    expect(reportsNumber("You receive 339.42 per month.", 339)).toBe(true);
  });

  it("matches a negative value by its digits", () => {
    expect(reportsNumber("A deduction of -339 applies.", -339)).toBe(true);
  });

  it("rejects an answer with no number at all", () => {
    expect(reportsNumber("I could not compute that.", 339)).toBe(false);
  });
});
