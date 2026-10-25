// Reading a parity run against the API's own contract.
//
// `matching === total` is not that contract. A case can also come back
// `known_deviation` (axiom-api src/parity.ts): a pinned, issue-tracked
// difference where behaviour matches the pin, deliberately non-failing, and
// counted separately from `matching` by `summarizeParityResults`. One pinned
// case therefore failed the old live-smoke check while the API's own parity
// monitor stayed green — which is what kept the monitor red from 5 August to
// 4 October 2026, and would have again on the next pin.
//
// What should fail: a case that is `different` or `errored`; a deviation
// pinned without a tracking issue and note, since that is an unexplained
// wrong answer rather than a tracked one; and a summary whose counts
// disagree with the per-case statuses, because then one of the two is wrong
// and neither can be trusted.

export const PARITY_STATUSES = [
  "matching",
  "different",
  "errored",
  "known_deviation"
] as const;

export type ParityStatus = (typeof PARITY_STATUSES)[number];

export interface AcceptedDeviation {
  id: string;
  issue: string;
  note: string;
}

export interface ParityReview {
  /** Every reason this run should fail. Empty means it passes. */
  problems: string[];
  /** Pinned differences that are properly tracked, for the caller to log. */
  knownDeviations: AcceptedDeviation[];
  matching: number;
  skipped: number;
  total: number;
}

export function reviewParityRun(
  summary: unknown,
  results: unknown
): ParityReview {
  const problems: string[] = [];
  if (!isRecord(summary)) {
    return emptyReview(["run_parity_cases returned no summary"]);
  }
  if (!Array.isArray(results)) {
    return emptyReview(["run_parity_cases returned no results"]);
  }

  // Counts first. A summary that disagrees with its own results makes every
  // other check here meaningless, so say so and stop.
  const counted = Object.fromEntries(
    PARITY_STATUSES.map((status) => [
      status,
      results.filter((result) => field(result, "status") === status).length
    ])
  ) as Record<ParityStatus, number>;

  const disagreements = PARITY_STATUSES.filter(
    (status) => summary[status] !== counted[status]
  ).map(
    (status) =>
      `${status}: summary says ${String(summary[status])}, results hold ${counted[status]}`
  );
  if (summary.total !== results.length) {
    disagreements.push(
      `total: summary says ${String(summary.total)}, results hold ${results.length}`
    );
  }
  const unrecognized = results
    .filter((result) => !isParityStatus(field(result, "status")))
    .map((result) => `${String(field(result, "id"))}=${String(field(result, "status"))}`);
  if (unrecognized.length > 0) {
    disagreements.push(`unrecognized status: ${unrecognized.join(", ")}`);
  }
  if (disagreements.length > 0) {
    problems.push(
      `run_parity_cases summary does not add up — ${disagreements.join("; ")}`
    );
  }

  const failing = results
    .filter((result) => {
      const status = field(result, "status");
      return status === "different" || status === "errored";
    })
    .map((result) => `${String(field(result, "id"))} (${String(field(result, "status"))})`);
  if (failing.length > 0) {
    problems.push(
      `run_parity_cases reported ${failing.length} failing case(s): ${failing.join(", ")}`
    );
  }

  const deviations = results.filter(
    (result) => field(result, "status") === "known_deviation"
  );
  const knownDeviations: AcceptedDeviation[] = [];
  const untracked: string[] = [];
  for (const result of deviations) {
    const deviation = field(result, "known_deviation");
    const issue = field(deviation, "issue");
    const note = field(deviation, "note");
    if (isNonEmptyString(issue) && isNonEmptyString(note)) {
      knownDeviations.push({ id: String(field(result, "id")), issue, note });
    } else {
      untracked.push(String(field(result, "id")));
    }
  }
  if (untracked.length > 0) {
    problems.push(
      `run_parity_cases reported known_deviation without a tracking issue and note: ${untracked.join(", ")}`
    );
  }

  return {
    problems,
    knownDeviations,
    matching: counted.matching,
    skipped: typeof summary.skipped === "number" ? summary.skipped : 0,
    total: results.length
  };
}

/** One line per accepted deviation, then the run's shape. */
export function describeParityReview(review: ParityReview): string[] {
  return [
    ...review.knownDeviations.map(
      (deviation) =>
        `Parity known deviation: ${deviation.id} — ${deviation.note} (${deviation.issue})`
    ),
    `Parity: ${review.matching} matching, ${review.knownDeviations.length} known deviation(s), ${review.skipped} skipped, of ${review.total} run.`
  ];
}

function emptyReview(problems: string[]): ParityReview {
  return { problems, knownDeviations: [], matching: 0, skipped: 0, total: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined;
}

function isParityStatus(value: unknown): value is ParityStatus {
  return PARITY_STATUSES.includes(value as ParityStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
