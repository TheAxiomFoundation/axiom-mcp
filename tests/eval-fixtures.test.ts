import { describe, expect, it } from "vitest";
import {
  ANSWER_EXCERPT_LIMIT,
  answerExcerpt,
  checkableValue,
  namesField,
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

describe("answerExcerpt", () => {
  // A failed check says the text did not match. Only the text itself says
  // whether the model failed the task or merely worded it differently.
  it("returns a short answer whole", () => {
    expect(answerExcerpt("You receive $339 per month.")).toBe(
      "You receive $339 per month."
    );
  });

  it("drops surrounding whitespace", () => {
    expect(answerExcerpt("\n  the answer  \n")).toBe("the answer");
  });

  it("keeps the line breaks inside the answer", () => {
    expect(answerExcerpt("first line\nsecond line")).toBe(
      "first line\nsecond line"
    );
  });

  it("cuts a long answer and says how much it cut", () => {
    const excerpt = answerExcerpt("x".repeat(ANSWER_EXCERPT_LIMIT + 40));
    expect(excerpt).toContain("(40 more characters)");
    expect(excerpt.startsWith("x".repeat(ANSWER_EXCERPT_LIMIT))).toBe(true);
  });

  it("takes a shorter limit", () => {
    expect(answerExcerpt("abcdef", 3)).toBe("abc… (3 more characters)");
  });
});

describe("namesField", () => {
  // The answer that drove this. The eval scored it a failure for writing
  // "Maria's age" where the check wanted "people.maria.age", and the prompt
  // had asked for an answer a person could read.
  const realAnswer =
    "**Facts that didn't count (`ignored_inputs`):** **Maria's age (34)** " +
    "and **Leo's age (6)** were ignored. The Colorado SNAP package doesn't " +
    "take a person's age as an input.";

  it("accepts the field written for a person", () => {
    expect(namesField(realAnswer, "people.maria.age")).toBe(true);
  });

  it("accepts the path itself, for an answer that quotes it", () => {
    expect(namesField("ignored: people.maria.age", "people.maria.age")).toBe(
      true
    );
  });

  // "age" lives inside "percentage". Without a word boundary the check would
  // read an unrelated sentence as naming the field.
  it("does not find a part inside a longer word", () => {
    expect(
      namesField("Maria's coverage percentage was applied.", "people.maria.age")
    ).toBe(false);
  });

  it("refuses an answer that names a different entity", () => {
    expect(namesField("Leo's age (6) was ignored.", "people.maria.age")).toBe(
      false
    );
  });

  it("refuses an answer that names neither part", () => {
    expect(namesField("Everything you gave me counted.", "people.maria.age")).toBe(
      false
    );
  });

  it("reads a snake_case leaf written as words", () => {
    expect(
      namesField(
        "You did not say whether all household members are experiencing homelessness.",
        "all_household_members_experiencing_homelessness"
      )
    ).toBe(true);
  });

  it("keeps both parts of a two-segment path", () => {
    expect(namesField("Your income was ignored.", "household.income")).toBe(false);
    expect(
      namesField("The household income was ignored.", "household.income")
    ).toBe(true);
  });
});
