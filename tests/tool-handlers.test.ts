import { describe, expect, it } from "vitest";
import { AxiomApiClient } from "../src/axiom-client.js";
import {
  calculateHousehold,
  getCapabilities,
  getRule,
  getRuntimePackage,
  listParityCases,
  runParityCases,
  searchRules
} from "../src/tool-handlers.js";

function clientFor(response: unknown) {
  return new AxiomApiClient({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => Response.json(response)
  });
}

describe("tool handlers", () => {
  it("returns both text and structured content", async () => {
    const response = { status: "ok", data: { runtime: { package_count: 2 } } };
    const result = await getCapabilities({ client: clientFor(response) });

    expect(result.structuredContent).toEqual(response);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(response);
  });

  it("forwards search, package, and calculate inputs to the API client", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        return Response.json({ status: "ok", data: {} });
      }
    });

    await searchRules({ client }, { query: "az gross income", jurisdiction: "us-az" });
    await getRuntimePackage({ client }, { jurisdiction: "us-co", program_id: "co-snap" });
    await calculateHousehold(
      { client },
      {
        program_id: "co-snap",
        jurisdiction: "us-co",
        household: { people: {} },
        variables: ["snap_benefit_amount"]
      }
    );

    expect(calls).toEqual([
      {
        url: "https://api.example.test/v1/search",
        body: { query: "az gross income", jurisdiction: "us-az" }
      },
      {
        url: "https://api.example.test/v1/runtime/packages/us-co/co-snap",
        body: undefined
      },
      {
        url: "https://api.example.test/v1/calculate",
        body: {
          program_id: "co-snap",
          jurisdiction: "us-co",
          household: { people: {} },
          variables: ["snap_benefit_amount"]
        }
      }
    ]);
  });

  it("returns API errors as structured tool errors instead of throwing", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        Response.json(
          {
            status: "error",
            error: { code: "unknown_rule", message: "Rule not found." },
            meta: { request_id: "req-404" }
          },
          { status: 404 }
        )
    });

    const result = await getRule({ client }, { rule_id: "us-co/missing" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        message: "Axiom API /v1/rules/us-co/missing returned HTTP 404",
        http_status: 404,
        api_response: {
          status: "error",
          error: { code: "unknown_rule", message: "Rule not found." },
          meta: { request_id: "req-404" }
        }
      }
    });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  });

  it("includes retry-after in rate-limited tool errors", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        Response.json(
          { status: "error", error: { code: "rate_limited" } },
          { status: 429, headers: { "retry-after": "30" } }
        )
    });

    const result = await getCapabilities({ client });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { http_status: 429, retry_after: "30" }
    });
  });

  it("rethrows non-API errors", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      }
    });

    await expect(getCapabilities({ client })).rejects.toThrow(
      "Axiom API request to https://api.example.test/v1/capabilities failed: fetch failed"
    );
  });

  it("forwards parity tools to the API client", async () => {
    const calls: string[] = [];
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return Response.json({ status: "ok", data: {} });
      }
    });

    await listParityCases({ client });
    await runParityCases({ client });

    expect(calls).toEqual([
      "https://api.example.test/v1/parity/cases",
      "https://api.example.test/v1/parity/run"
    ]);
  });
});
