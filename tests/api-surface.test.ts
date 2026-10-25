import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ROUTE_PREFIX,
  UNWRAPPED_ROUTES,
  WRAPPED_ROUTES,
  diffApiSurface,
  publicRoutesFromOpenApi
} from "../src/api-surface.js";
import { AxiomApiClient } from "../src/axiom-client.js";
import { createAxiomMcpServer } from "../src/server.js";

async function registeredToolNames(): Promise<string[]> {
  const apiClient = new AxiomApiClient({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json({ status: "ok", data: {}, meta: {} })
  });
  const server = createAxiomMcpServer(apiClient);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("API surface manifest", () => {
  it("names a route for every registered tool, and a tool for every wrapped route", async () => {
    // The manifest is what `npm run check:api-surface` compares the deployed
    // contract against, so it is only worth anything while it still
    // describes this server.
    const tools = await registeredToolNames();
    const wrapped = Object.values(WRAPPED_ROUTES).sort();
    expect(wrapped).toEqual(tools);
    expect(new Set(wrapped).size).toBe(wrapped.length);
  });

  it("gives every deliberately unwrapped route a reason", () => {
    for (const [route, reason] of Object.entries(UNWRAPPED_ROUTES)) {
      expect(reason.trim().length, route).toBeGreaterThan(20);
    }
    const accounted = [
      ...Object.keys(WRAPPED_ROUTES),
      ...Object.keys(UNWRAPPED_ROUTES)
    ];
    expect(new Set(accounted).size).toBe(accounted.length);
    for (const route of accounted) {
      expect(route, route).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
    }
  });

  it("reads an OpenAPI document as public routes, admin aside", () => {
    const routes = publicRoutesFromOpenApi({
      paths: {
        "/v1/version": { get: {} },
        "/v1/calculate": { post: {} },
        "/v1/rules/{rule_id}": { get: {}, parameters: [] },
        [`${ADMIN_ROUTE_PREFIX}keys`]: { get: {}, post: {} }
      }
    });
    expect(routes).toEqual([
      "GET /v1/rules/{rule_id}",
      "GET /v1/version",
      "POST /v1/calculate"
    ]);
  });

  it("reports a route the manifest does not account for", () => {
    const drift = diffApiSurface([
      "GET /v1/version",
      "GET /v1/something-new",
      "POST /v1/calculate"
    ]);
    expect(drift.unknownRoutes).toEqual(["GET /v1/something-new"]);
    expect(drift.missingRoutes).toContain("GET /v1/capabilities");
  });

  it("reports nothing when the served routes are exactly the manifest", () => {
    const drift = diffApiSurface([
      ...Object.keys(WRAPPED_ROUTES),
      ...Object.keys(UNWRAPPED_ROUTES)
    ]);
    expect(drift).toEqual({ unknownRoutes: [], missingRoutes: [] });
  });
});
