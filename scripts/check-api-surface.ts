// Hold src/api-surface.ts against the deployed contract.
//
// The pass-through claim — every public, non-admin route is a tool — only
// stays true if something notices when the API grows a route. Nothing did:
// `/v1/variables`, `/v1/rules/{id}/versions`,
// `/v1/runtime/packages/{j}/{p}/graph`, and
// `/v1/public/validation/bundled` all shipped upstream and sat unwrapped.
//
// `GET /v1/openapi.json` is unauthenticated, so this needs no API key and
// runs anywhere. It is deliberately out of PR CI, which stays hermetic; the
// live-smoke workflow runs it on a schedule, where an upstream change is
// allowed to turn the build red.

import { diffApiSurface, publicRoutesFromOpenApi } from "../src/api-surface.js";

const baseUrl = (
  process.env.AXIOM_API_BASE_URL || "https://api.axiom.org"
).replace(/\/+$/, "");
const timeoutMs = Number(process.env.AXIOM_API_TIMEOUT_MS) || 30_000;
const specUrl = `${baseUrl}/v1/openapi.json`;

const response = await fetch(specUrl, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(timeoutMs)
});
if (!response.ok) {
  console.error(`Could not read ${specUrl}: HTTP ${response.status}`);
  process.exit(1);
}

const routes = publicRoutesFromOpenApi(await response.json());
const { unknownRoutes, missingRoutes } = diffApiSurface(routes);

if (unknownRoutes.length === 0 && missingRoutes.length === 0) {
  console.log(
    `API surface matches: ${routes.length} public routes accounted for at ${baseUrl}.`
  );
  process.exit(0);
}

if (unknownRoutes.length > 0) {
  console.error(
    `${unknownRoutes.length} public route(s) at ${baseUrl} are neither wrapped as a tool nor listed as deliberately unwrapped:`
  );
  for (const route of unknownRoutes) console.error(`  ${route}`);
  console.error(
    "Add a tool for each, or an UNWRAPPED_ROUTES entry with the reason, in src/api-surface.ts."
  );
}
if (missingRoutes.length > 0) {
  console.error(
    `${missingRoutes.length} route(s) in src/api-surface.ts are no longer served at ${baseUrl}:`
  );
  for (const route of missingRoutes) console.error(`  ${route}`);
  console.error("A tool may now be calling a route that is gone.");
}
process.exit(1);
