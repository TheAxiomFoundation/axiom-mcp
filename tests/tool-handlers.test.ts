import { describe, expect, it } from "vitest";
import { AxiomApiClient } from "../src/axiom-client.js";
import {
  calculateHousehold,
  getCapabilities,
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
