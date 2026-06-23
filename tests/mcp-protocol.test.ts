import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { AxiomApiClient } from "../src/axiom-client.js";
import { createAxiomMcpServer } from "../src/server.js";

describe("Axiom MCP server protocol", () => {
  it("lists and invokes Axiom tools over MCP", async () => {
    const apiClient = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/v1/capabilities")) {
          return Response.json({
            status: "ok",
            data: { runtime: { package_count: 2 } },
            meta: {}
          });
        }
        if (String(url).endsWith("/v1/programs")) {
          return Response.json({
            status: "ok",
            data: { programs: [{ id: "co-snap" }] },
            meta: {}
          });
        }
        if (String(url).endsWith("/v1/search")) {
          return Response.json({
            status: "ok",
            data: {
              query: "co snap",
              results: [
                {
                  id: "us-co.cdhs_snap_fy_2026_benefit_calculation",
                  jurisdiction: "us-co"
                }
              ]
            },
            meta: { request_id: "req-test" }
          });
        }
        if (String(url).endsWith("/v1/parity/run")) {
          return Response.json({
            status: "ok",
            data: {
              summary: { total: 1, matching: 1, different: 0, errored: 0 },
              results: [{ id: "co-snap-us-co-family-1", status: "matching" }]
            },
            meta: { request_id: "req-parity" }
          });
        }
        if (String(url).endsWith("/v1/parity/cases")) {
          return Response.json({
            status: "ok",
            data: {
              cases: [{ id: "co-snap-us-co-family-1", program_id: "co-snap" }]
            },
            meta: { request_id: "req-parity-cases" }
          });
        }
        return Response.json({ status: "ok", data: {}, meta: {} });
      }
    });
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "search_rules",
          "get_rule",
          "get_rule_sources",
          "get_rule_dependencies",
          "list_runtime_packages",
          "get_runtime_package",
          "list_parity_cases",
          "run_parity_cases",
          "calculate_household"
        ])
      );

      const result = await client.callTool({
        name: "search_rules",
        arguments: { query: "co snap", jurisdiction: "us-co" }
      });

      expect(result.structuredContent).toMatchObject({
        status: "ok",
        data: {
          results: [
            {
              id: "us-co.cdhs_snap_fy_2026_benefit_calculation"
            }
          ]
        }
      });

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual(
        expect.arrayContaining([
          "axiom://capabilities",
          "axiom://programs",
          "axiom://runtime/packages",
          "axiom://parity/cases"
        ])
      );

      const capabilities = await client.readResource({
        uri: "axiom://capabilities"
      });
      expect(JSON.parse(capabilities.contents[0]?.text ?? "{}")).toMatchObject({
        data: { runtime: { package_count: 2 } }
      });

      const parity = await client.callTool({ name: "run_parity_cases" });
      expect(parity.structuredContent).toMatchObject({
        status: "ok",
        data: {
          summary: { total: 1, matching: 1 }
        }
      });

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(
        expect.arrayContaining([
          "explain_rule_for_caseworker",
          "trace_household_result",
          "find_missing_household_inputs"
        ])
      );

      const prompt = await client.getPrompt({
        name: "trace_household_result",
        arguments: { program_id: "co-snap", jurisdiction: "us-co" }
      });
      expect(prompt.messages[0]?.content).toMatchObject({
        type: "text",
        text: expect.stringContaining("us-co/co-snap")
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
