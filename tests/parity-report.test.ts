import { describe, expect, it } from "vitest";
import { describeParityReview, reviewParityRun } from "../src/parity-report.js";

function summaryFor(results: Array<{ status: string }>, skipped = 0) {
  return {
    total: results.length,
    matching: results.filter((result) => result.status === "matching").length,
    different: results.filter((result) => result.status === "different").length,
    errored: results.filter((result) => result.status === "errored").length,
    known_deviation: results.filter(
      (result) => result.status === "known_deviation"
    ).length,
    skipped
  };
}

const tracked = {
  id: "co-snap-us-co-family-2",
  status: "known_deviation",
  known_deviation: {
    issue: "https://github.com/TheAxiomFoundation/axiom-api/issues/1",
    note: "Shelter deduction rounds down pending the FY2027 table."
  }
};

describe("reviewParityRun", () => {
  it("passes a run whose only non-matching cases are tracked deviations", () => {
    // The old check was `matching === total`, which a single pinned case
    // broke while the API's own parity monitor stayed green.
    const results = [{ id: "a", status: "matching" }, tracked];
    const review = reviewParityRun(summaryFor(results, 3), results);

    expect(review.problems).toEqual([]);
    expect(review.knownDeviations).toEqual([
      {
        id: tracked.id,
        issue: tracked.known_deviation.issue,
        note: tracked.known_deviation.note
      }
    ]);
    expect(review).toMatchObject({ matching: 1, skipped: 3, total: 2 });
  });

  it("passes a run where everything matches", () => {
    const results = [
      { id: "a", status: "matching" },
      { id: "b", status: "matching" }
    ];
    const review = reviewParityRun(summaryFor(results), results);
    expect(review.problems).toEqual([]);
    expect(review.knownDeviations).toEqual([]);
  });

  it("names every different or errored case", () => {
    const results = [
      { id: "a", status: "matching" },
      { id: "b", status: "different" },
      { id: "c", status: "errored" }
    ];
    const review = reviewParityRun(summaryFor(results), results);

    expect(review.problems).toHaveLength(1);
    expect(review.problems[0]).toContain("2 failing case(s)");
    expect(review.problems[0]).toContain("b (different)");
    expect(review.problems[0]).toContain("c (errored)");
  });

  it("refuses a deviation pinned without a tracking issue and note", () => {
    const results = [
      { id: "a", status: "known_deviation", known_deviation: { issue: "", note: "x" } },
      { id: "b", status: "known_deviation", known_deviation: { note: "no issue" } },
      { id: "c", status: "known_deviation" },
      tracked
    ];
    const review = reviewParityRun(summaryFor(results), results);

    expect(review.problems).toHaveLength(1);
    expect(review.problems[0]).toContain("without a tracking issue and note");
    expect(review.problems[0]).toContain("a, b, c");
    expect(review.knownDeviations.map((deviation) => deviation.id)).toEqual([
      tracked.id
    ]);
  });

  it("refuses a summary that disagrees with its own results", () => {
    const results = [
      { id: "a", status: "matching" },
      { id: "b", status: "known_deviation" }
    ];
    const review = reviewParityRun(
      { ...summaryFor(results), matching: 2, known_deviation: 0 },
      results
    );

    expect(review.problems[0]).toContain("does not add up");
    expect(review.problems[0]).toContain("matching: summary says 2, results hold 1");
    expect(review.problems[0]).toContain(
      "known_deviation: summary says 0, results hold 1"
    );
  });

  it("refuses a total that does not match the results, and an unknown status", () => {
    const results = [{ id: "a", status: "matching" }, { id: "b", status: "flaky" }];
    const review = reviewParityRun({ ...summaryFor(results), total: 9 }, results);

    expect(review.problems[0]).toContain("total: summary says 9, results hold 2");
    expect(review.problems[0]).toContain("unrecognized status: b=flaky");
  });

  it("refuses a response with no summary or no results", () => {
    expect(reviewParityRun(undefined, []).problems).toEqual([
      "run_parity_cases returned no summary"
    ]);
    expect(reviewParityRun({ total: 0 }, undefined).problems).toEqual([
      "run_parity_cases returned no results"
    ]);
  });
});

describe("describeParityReview", () => {
  it("logs each accepted deviation and the run's shape", () => {
    const results = [{ id: "a", status: "matching" }, tracked];
    const lines = describeParityReview(
      reviewParityRun(summaryFor(results, 2), results)
    );

    expect(lines[0]).toContain(tracked.id);
    expect(lines[0]).toContain(tracked.known_deviation.issue);
    expect(lines[0]).toContain(tracked.known_deviation.note);
    expect(lines[1]).toBe(
      "Parity: 1 matching, 1 known deviation(s), 2 skipped, of 2 run."
    );
  });
});
