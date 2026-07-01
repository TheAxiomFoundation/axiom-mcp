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

  it("captures retry-after headers on rate-limited responses", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        Response.json(
          { status: "error", error: { code: "rate_limited" } },
          { status: 429, headers: { "retry-after": "12" } }
        )
    });

    await expect(client.listRuntimePackages()).rejects.toMatchObject({
      name: "AxiomApiError",
      status: 429,
      retryAfter: "12"
    });
  });

  it("aborts requests that exceed the configured timeout", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
    });

    await expect(client.listRuntimePackages()).rejects.toThrow(
      "Axiom API request to https://api.example.test/v1/runtime/packages timed out after 20ms"
    );
  });

  it("describes network failures with the request URL", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      }
    });

    await expect(client.listRuntimePackages()).rejects.toThrow(
      "Axiom API request to https://api.example.test/v1/runtime/packages failed: fetch failed"
    );
  });

  it("rejects successful responses with non-JSON bodies", async () => {
    const client = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        new Response("<html>upstream proxy error</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    });

    await expect(client.listRuntimePackages()).rejects.toThrow(
      "Axiom API /v1/runtime/packages returned HTTP 200 with a non-JSON body"
    );
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
