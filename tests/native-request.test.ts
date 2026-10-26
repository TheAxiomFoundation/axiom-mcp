import { describe, expect, it } from "vitest";
import {
  NATIVE_EXAMPLE_PATH,
  nativeExampleFromOpenApi
} from "../scripts/native-request.js";

// Shaped like the live document: a variable-addressed request with no
// package coordinates and no root.
const example = {
  period: "2026-01",
  state: "CO",
  people: { maria: { age: 34 }, leo: { age: 6 } },
  unit: { snap_gross_monthly_income: 2000, shelter_costs: 0 },
  variables: ["snap_benefit_amount"]
};

function documentWith(examples: unknown) {
  return {
    components: { schemas: { NativeCalculateRequest: { examples } } }
  };
}

describe("nativeExampleFromOpenApi", () => {
  it("returns the published example and the variable it asks for", () => {
    const result = nativeExampleFromOpenApi(documentWith([example, {}]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual(example);
    expect(result.variable).toBe("snap_benefit_amount");
  });

  it("reports a document that carries no example", () => {
    // Not a smoke problem to shrug off: the mode would have no worked
    // example for callers to copy.
    expect(nativeExampleFromOpenApi(documentWith([])).ok).toBe(false);
    expect(nativeExampleFromOpenApi(documentWith(undefined))).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} is absent or empty`
    });
    expect(nativeExampleFromOpenApi({})).toEqual({
      ok: false,
      reason: "no NativeCalculateRequest schema"
    });
    expect(nativeExampleFromOpenApi(documentWith(["not an object"]))).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} is not an object`
    });
  });

  it("refuses an example that is not actually variable-addressed", () => {
    // program_id or root would route the request to another mode, where it
    // could answer 200 and prove nothing about this one.
    expect(
      nativeExampleFromOpenApi(
        documentWith([{ ...example, program_id: "co-snap" }])
      )
    ).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} carries program_id or root, so it is not variable-addressed`
    });
    expect(
      nativeExampleFromOpenApi(
        documentWith([{ ...example, root: "us:statutes/7/2014/e/6/A" }])
      )
    ).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} carries program_id or root, so it is not variable-addressed`
    });
  });

  it("refuses an example with no variable to resolve", () => {
    const { variables, ...withoutVariables } = example;
    expect(variables).toBeDefined();
    expect(nativeExampleFromOpenApi(documentWith([withoutVariables]))).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} requests no variables`
    });
    expect(
      nativeExampleFromOpenApi(documentWith([{ ...example, variables: [] }]))
    ).toEqual({
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} requests no variables`
    });
  });
});
