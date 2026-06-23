import { describe, expect, it } from "vitest";
import { AxiomApiClient, AxiomApiError } from "../src/axiom-client.js";

describe("AxiomApiClient", () => {
  it("sends bearer auth and JSON requests to the configured API", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test/",
      apiKey: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({ status: "ok", data: { results: [] } });
      }
    });

    await client.searchRules({ query: "co snap", jurisdiction: "us-co", limit: 5 });

    expect(calls[0]).toMatchObject({
      url: "https://api.example.test/v1/search",
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer secret",
          "content-type": "application/json"
        }
      }
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "co snap",
      jurisdiction: "us-co",
      limit: 5
    });
  });

  it("encodes citation-path rule ids while preserving API wildcard slashes", async () => {
    const calls: string[] = [];
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return Response.json({ status: "ok", data: { rule: {} } });
      }
    });

    await client.getRule("us-co/policy/cdhs/snap/fy-2026-benefit-calculation");

    expect(calls[0]).toBe(
      "https://api.example.test/v1/rules/us-co/policy/cdhs/snap/fy-2026-benefit-calculation"
    );
  });

  it("throws structured API errors", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        Response.json(
          { status: "error", error: { code: "unauthorized" } },
          { status: 401 }
        )
    });

    await expect(client.listRuntimePackages()).rejects.toMatchObject({
      name: "AxiomApiError",
      status: 401,
      body: {
        status: "error",
        error: { code: "unauthorized" }
      }
    } satisfies Partial<AxiomApiError>);
  });

  it("calls parity endpoints", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method });
        return Response.json({ status: "ok", data: {} });
      }
    });

    await client.listParityCases();
    await client.runParityCases();

    expect(calls).toEqual([
      {
        url: "https://api.example.test/v1/parity/cases",
        method: "GET"
      },
      {
        url: "https://api.example.test/v1/parity/run",
        method: "POST"
      }
    ]);
  });
});
