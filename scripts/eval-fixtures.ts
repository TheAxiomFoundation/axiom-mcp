// Fixture logic for `eval-prompts.ts`, in its own module so it can be tested
// without an API key or a model call. These functions decide whether an eval
// case runs or is skipped, so a quiet mistake here would turn a real failure
// into a skip that reads as "nothing to grade".

export type FactsFixture =
  | { ok: true; facts: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Builds a facts object from a root's typed inputs, filling each declared
 * input with a value its type accepts.
 */
export function sampleFactsFrom(inputs: unknown): FactsFixture {
  const rows = collectObjects(inputs, "inputs");
  if (rows.length === 0) return { ok: false, reason: "declared no inputs" };
  const facts: Record<string, unknown> = {};
  for (const row of rows) {
    const field = asString(row.name ?? row.id ?? row.field);
    if (!field) continue;
    const type = (asString(row.type ?? row.value_type) ?? "number").toLowerCase();
    if (type.includes("bool")) facts[field] = false;
    else if (type.includes("str") || type.includes("enum")) {
      const allowed = Array.isArray(row.allowed_values)
        ? row.allowed_values
        : undefined;
      if (!allowed || allowed.length === 0) {
        return { ok: false, reason: `input ${field} has no value this eval can supply` };
      }
      facts[field] = allowed[0];
    } else facts[field] = 1;
  }
  if (Object.keys(facts).length === 0) {
    return { ok: false, reason: "no input had a usable name" };
  }
  return { ok: true, facts };
}

export type RemovedLeaf =
  | { ok: true; request: Record<string, unknown>; field: string }
  | { ok: false; reason: string };

/**
 * Removes one leaf fact from a sample request. The sample is a complete
 * request by construction, so whatever is removed is a fact the package
 * expects — which is what makes the check exact.
 */
export function removeOneLeaf(request: Record<string, unknown>): RemovedLeaf {
  const copy = structuredClone(request) as Record<string, unknown>;
  const path = findLeafPath(copy, []);
  if (!path) return { ok: false, reason: "sample request had no leaf fact to remove" };
  let parent: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) {
    parent = parent[key] as Record<string, unknown>;
  }
  const field = path[path.length - 1]!;
  delete parent[field];
  return { ok: true, request: copy, field };
}

/** The first scalar leaf that is not a request-shaping field. */
export function findLeafPath(
  value: unknown,
  path: string[]
): string[] | undefined {
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    // These select the mode and the outputs rather than describe the
    // household, so removing one would change the request, not starve it.
    if (["program_id", "jurisdiction", "root", "variables", "period"].includes(key)) {
      continue;
    }
    if (typeof child === "number" || typeof child === "boolean") {
      return [...path, key];
    }
    if (isRecord(child)) {
      const found = findLeafPath(child, [...path, key]);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * The first finite number under a key named `value`, which is how both
 * addressing modes report a computed output.
 */
export function firstNumericValue(value: unknown): number | undefined {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "value" && typeof child === "number" && Number.isFinite(child)) {
        return child;
      }
      const found = firstNumericValue(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstNumericValue(entry);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function collectObjects(value: unknown, key: string): Record<string, unknown>[] {
  const found = findValue(value, key);
  return Array.isArray(found) ? found.filter(isRecord) : [];
}

export function findObject(value: unknown, key: string): Record<string, unknown> | undefined {
  const found = findValue(value, key);
  return isRecord(found) ? found : undefined;
}

export function firstSubtreeRoot(value: unknown): string | undefined {
  for (const row of collectObjects(value, "subtrees")) {
    const found = asString(row.root);
    if (found) return found;
  }
  return undefined;
}

export function findValue(value: unknown, key: string): unknown {
  if (isRecord(value)) {
    if (key in value) return value[key];
    for (const child of Object.values(value)) {
      const found = findValue(child, key);
      if (found !== undefined) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findValue(entry, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The smallest computed value a text check can speak for.
 *
 * Below it the digits turn up in an unrelated part of an answer — a count, an
 * age, a line number — so a pass would say nothing about the prompt. A case
 * whose value falls short skips instead of claiming a pass.
 */
export const SMALLEST_CHECKABLE_VALUE = 100;

export type CheckableValue =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/** Is this computed value specific enough to require in an answer? */
export function checkableValue(value: number | undefined): CheckableValue {
  if (value === undefined) {
    return { ok: false, reason: "returned no numeric value to check against" };
  }
  if (Math.abs(value) < SMALLEST_CHECKABLE_VALUE) {
    return {
      ok: false,
      reason: `computes ${value}, which an unrelated answer contains by accident`
    };
  }
  return { ok: true, value };
}

/**
 * Does the answer report this number, rather than merely hold its digits?
 *
 * The digits must stand as a number of their own: 339 does not count inside
 * 1339, nor as the decimals of 0.339. Separators between digits come out
 * first, so an answer of "12,345" reports 12345.
 */
export function reportsNumber(text: string, expected: number): boolean {
  const digits = String(Math.trunc(Math.abs(expected)));
  const normalized = text.replace(/(?<=\d)[,_](?=\d)/g, "");
  return new RegExp(`(?<![\\d.])${digits}(?![\\d])`).test(normalized);
}

/** How much of an answer the report prints under a failed case. */
export const ANSWER_EXCERPT_LIMIT = 1500;

/**
 * The part of an answer a reader needs to judge a failed check.
 *
 * Every check matches on text, so a failure has two readings: the model did
 * not do the thing, or it did it in words the check does not match. Only the
 * answer itself separates them, and a run costs too much to repeat blind.
 */
export function answerExcerpt(
  text: string,
  limit: number = ANSWER_EXCERPT_LIMIT
): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.length - limit;
  return `${trimmed.slice(0, limit)}… (${cut} more characters)`;
}

/**
 * Does the answer name this input field?
 *
 * A field arrives as a path, `people.maria.age`, and a good answer says
 * "Maria's age (34) was ignored". Requiring the path would fail every answer
 * worth having, so the test is the words that identify the field.
 *
 * The group segment is dropped, because no plain answer repeats it, and a
 * snake_case leaf is split, because an answer writes it as prose and puts
 * its own words in between: "all household members **are** experiencing
 * homelessness". Order is not required for the same reason. What remains is
 * specific enough — prose that holds every word of a field by accident is
 * prose about that field.
 */
export function namesField(text: string, field: string): boolean {
  if (text.includes(field)) return true;
  const words = identifyingWords(field);
  if (words.length === 0) return false;
  return words.every((word) => wordIn(text, word));
}

function identifyingWords(field: string): string[] {
  const segments = field.split(".").filter((segment) => segment.length > 0);
  const kept = segments.length > 2 ? segments.slice(1) : segments;
  return kept
    .flatMap((segment) => segment.split("_"))
    .filter((word) => word.length > 0);
}

/** The word on its own, in whatever case the answer wrote it. */
function wordIn(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}
