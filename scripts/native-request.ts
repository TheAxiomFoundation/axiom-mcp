// The variable-addressed request the live smoke runs, taken from the API's
// own published example.
//
// The first attempt at this translated a runtime package's `sample_request`
// instead. That was wrong: its household is `{ entities, facts, period }`
// keyed by the engine's entity names (`Person`, `SPMUnit`), while
// variable-addressed mode wants plural group names (`people`, `spm_units`)
// at the top level. Mapping between them would mean reimplementing the
// API's own `groupToken` here and guessing at the rest.
//
// `components.schemas.NativeCalculateRequest.examples[0]` in
// `GET /v1/openapi.json` is already a complete, working request in this
// mode — the one a reader of the docs would copy. Running that proves both
// that the mode works and that the published example still does, and it
// cannot drift from the documentation, because it IS the documentation.
// The document is unauthenticated, so this needs no API key.

export interface PublishedExample {
  ok: true;
  request: Record<string, unknown>;
  /** The example's own first requested variable, to assert the answer against. */
  variable: string;
}

export interface MissingExample {
  ok: false;
  reason: string;
}

export const NATIVE_EXAMPLE_PATH =
  "components.schemas.NativeCalculateRequest.examples[0]";

/**
 * Pull the variable-addressed example out of an OpenAPI document, with the
 * variable it asks for. A document that no longer carries one is itself a
 * finding — the mode would have no worked example for callers.
 */
export function nativeExampleFromOpenApi(
  document: unknown
): PublishedExample | MissingExample {
  const schema = readPath(document, [
    "components",
    "schemas",
    "NativeCalculateRequest"
  ]);
  if (!isRecord(schema)) {
    return { ok: false, reason: "no NativeCalculateRequest schema" };
  }
  const examples = schema.examples;
  if (!Array.isArray(examples) || examples.length === 0) {
    return { ok: false, reason: `${NATIVE_EXAMPLE_PATH} is absent or empty` };
  }
  const request = examples[0];
  if (!isRecord(request)) {
    return { ok: false, reason: `${NATIVE_EXAMPLE_PATH} is not an object` };
  }

  // Guard the two things that make it this mode rather than another: no
  // package coordinates, no root, and a variable to resolve. An example that
  // lost them would still answer 200 in a different mode and prove nothing.
  if (request.program_id !== undefined || request.root !== undefined) {
    return {
      ok: false,
      reason: `${NATIVE_EXAMPLE_PATH} carries program_id or root, so it is not variable-addressed`
    };
  }
  const variables = request.variables;
  if (!Array.isArray(variables) || typeof variables[0] !== "string") {
    return { ok: false, reason: `${NATIVE_EXAMPLE_PATH} requests no variables` };
  }

  return { ok: true, request, variable: variables[0] };
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
