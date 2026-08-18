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
              results: [
                {
                  id: "co-snap-us-co-family-1",
                  status: "matching",
                  trace_outputs: {
                    gross_income: 1200,
                    snap_standard_deduction: 209,
                    excess_shelter_deduction: 524.5
                  },
                  calculation_trace: [
                    {
                      rule_id: "gross_income",
                      variable: "gross_income",
                      value: 1200,
                      sources: ["axiom:test#gross_income"]
                    }
                  ],
                  notes: ["Canonical values are monthly."]
                }
              ]
            },
            meta: { request_id: "req-parity" }
          });
        }
        if (String(url).endsWith("/v1/parity/cases")) {
          return Response.json({
            status: "ok",
            data: {
              cases: [
                {
                  id: "co-snap-us-co-family-1",
                  program_id: "co-snap",
                  trace_variables: ["gross_income", "snap_standard_deduction"],
                  notes: ["Canonical values are monthly."],
                  external_comparisons: [
                    {
                      id: "co-snap-policyengine-current",
                      engine: "policyengine",
                      mappings: [
                        {
                          axiom_variable: "snap_benefit_amount",
                          external_path: "result.spm_units.spm_unit.snap.2026",
                          transform: "annual_to_monthly"
                        }
                      ]
                    }
                  ]
                }
              ]
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
          "list_programs",
          "search_rules",
          "get_rule",
          "get_rule_sources",
          "get_rule_dependencies",
          "list_runtime_packages",
          "get_runtime_package",
          "list_parity_cases",
          "run_parity_cases",
          "calculate_household",
          "calculate_batch",
          "submit_calculation_job",
          "get_calculation_job",
          "get_version",
          "list_certified_nodes",
          "get_node",
          "list_corpus_subtrees",
          "compose_graph",
          "get_subgraph",
          "get_root_inputs",
          "list_runtime_artifacts",
          "calculate_household_compat"
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
          summary: { total: 1, matching: 1 },
          results: [
            expect.objectContaining({
              trace_outputs: {
                gross_income: 1200,
                snap_standard_deduction: 209,
                excess_shelter_deduction: 524.5
              },
              notes: ["Canonical values are monthly."]
            })
          ]
        }
      });

      const parityCases = await client.callTool({ name: "list_parity_cases" });
      expect(parityCases.structuredContent).toMatchObject({
        status: "ok",
        data: {
          cases: [
            expect.objectContaining({
              external_comparisons: [
                expect.objectContaining({
                  id: "co-snap-policyengine-current",
                  engine: "policyengine"
                })
              ]
            })
          ]
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

  it("carries API error detail in resource read failures", async () => {
    const apiClient = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async () =>
        Response.json(
          {
            status: "error",
            error: { code: "insufficient_scope", message: "Requires admin:parity." },
            meta: { request_id: "req-scope" }
          },
          { status: 403 }
        )
    });
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      await expect(
        client.readResource({ uri: "axiom://parity/cases" })
      ).rejects.toThrow(/insufficient_scope.*Requires admin:parity.*req-scope/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("surfaces Axiom API error bodies through MCP tool errors", async () => {
    const apiClient = new AxiomApiClient({
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
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      const result = await client.callTool({
        name: "get_rule",
        arguments: { rule_id: "us-co/missing" }
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          http_status: 404,
          api_response: {
            error: { code: "unknown_rule", message: "Rule not found." },
            meta: { request_id: "req-404" }
          }
        }
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
