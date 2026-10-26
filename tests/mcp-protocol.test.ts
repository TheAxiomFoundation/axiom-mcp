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
          "axiom://variables",
          "axiom://corpus/subtrees",
          "axiom://parity/cases"
        ])
      );

      const capabilities = await client.readResource({
        uri: "axiom://capabilities"
      });
      expect(JSON.parse(resourceText(capabilities))).toMatchObject({
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
          "calculate_variable_for_household",
          "explain_rule_for_caseworker",
          "trace_household_result",
          "run_corpus_subtree",
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

  it("discovers and forwards subtree requests through the MCP schemas", async () => {
    // Transport fixtures only: the adapter forwards requests to the real API;
    // this test does not implement or assert policy calculations.
    const root = "test:synthetic/example";
    const request = { root, facts: { example_input: 7 }, variables: ["example_output"] };
    const calls: Array<{ path: string; body: unknown }> = [];
    const apiClient = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return Response.json({
          status: "ok",
          data: path === "/v1/corpus/subtrees" ? { subtrees: [{ root }] } : { accepted: true },
          meta: {}
        });
      }
    });
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const resource = await client.readResource({ uri: "axiom://corpus/subtrees" });
      expect(JSON.parse(resourceText(resource))).toMatchObject({
        data: { subtrees: [{ root }] }
      });
      const prompt = await client.getPrompt({ name: "run_corpus_subtree", arguments: { root } });
      expect(prompt.messages[0]?.content).toMatchObject({
        type: "text", text: expect.stringContaining(root)
      });
      const single = await client.callTool({ name: "calculate_household", arguments: request });
      const batch = await client.callTool({ name: "calculate_batch", arguments: { requests: [request] } });
      expect(single.isError).not.toBe(true);
      expect(batch.isError).not.toBe(true);
      expect(calls).toEqual([
        { path: "/v1/corpus/subtrees", body: undefined },
        { path: "/v1/calculate", body: request },
        { path: "/v1/calculate/batch", body: { requests: [request] } }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("describes node reads under both certification enforcement modes", async () => {
    // The API serves uncertified nodes unless a deployment opts into
    // `enforced` (axiom-api certifiedEnforcement()), so no node-read tool
    // may describe certified-only serving as unconditional.
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
      const toolNamed = (name: string) => tools.find((tool) => tool.name === name);
      for (const name of ["list_certified_nodes", "get_node", "get_subgraph"]) {
        const description = toolNamed(name)?.description ?? "";
        expect(description).toMatch(/`permissive` \(the API default\)/);
        expect(description).toMatch(/`enforced`/);
        expect(description).not.toMatch(/^(Read|Get|Page through) (one |the |a )?certified/i);
      }
      for (const name of ["get_node", "get_subgraph"]) {
        expect(toolNamed(name)?.title).not.toMatch(/certified/i);
        expect(toolNamed(name)?.description).toContain("uncertified_node");
        expect(toolNamed(name)?.description).toContain("meta.certified.enforcement");
      }
      expect(toolNamed("get_node")?.description).toMatch(/certificate \(null unless/);
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

  it("forwards every calculate addressing mode without stripping fields", async () => {
    // POST /v1/calculate picks its mode from the body's shape, and the
    // variable-addressed mode (axiom-api isNativeCalculateBody: no
    // program_id, no root, an array of `variables`) carries entity-shaped
    // fields a strict schema would drop. A stripped body still parses as
    // that mode, so the API would answer 200 against an empty household
    // instead of refusing — every field has to reach it intact.
    const calls: Array<{ path: string; body: unknown }> = [];
    const apiClient = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (url, init) => {
        calls.push({
          path: new URL(String(url)).pathname,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        return Response.json({ status: "ok", data: {}, meta: {} });
      }
    });
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const variableAddressed = {
      period: "2026-01",
      state: "CO",
      people: { maria: { age: 34 }, leo: { age: 6 } },
      spm_units: {
        family: { members: ["maria", "leo"], snap_gross_monthly_income: 2000 }
      },
      variables: ["snap_benefit_amount"]
    };
    const singleUnit = {
      period: "2026-01",
      jurisdiction: "us-co",
      people: { maria: { age: 34 } },
      unit: { snap_gross_monthly_income: 2000, shelter_costs: 0 },
      variables: ["snap_benefit_amount"]
    };
    const rootMode = {
      root: "ca:policies/cra/t1-2025/canada-workers-benefit",
      input_contract: "selected-year-facts-v1",
      facts: { claimant_working_income: 9000 },
      variables: ["canada_workers_benefit_line_45300"]
    };
    const packageMode = {
      program_id: "co-snap",
      jurisdiction: "us-co",
      household: { people: { person_1: { age: 34 } } }
    };

    try {
      for (const request of [variableAddressed, singleUnit, rootMode, packageMode]) {
        const result = await client.callTool({
          name: "calculate_household",
          arguments: request
        });
        expect(result.isError).not.toBe(true);
      }
      await client.callTool({
        name: "calculate_batch",
        arguments: { requests: [variableAddressed, rootMode] }
      });
      await client.callTool({
        name: "submit_calculation_job",
        arguments: { requests: [variableAddressed] }
      });

      expect(calls).toEqual([
        { path: "/v1/calculate", body: variableAddressed },
        { path: "/v1/calculate", body: singleUnit },
        { path: "/v1/calculate", body: rootMode },
        { path: "/v1/calculate", body: packageMode },
        {
          path: "/v1/calculate/batch",
          body: { requests: [variableAddressed, rootMode] }
        },
        { path: "/v1/jobs/calculate", body: { requests: [variableAddressed] } }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("forwards entity groups and unknown calculate fields for the API to judge", async () => {
    // Entity groups are whatever plural the admitted packages declare
    // (axiom-api groupToken), so the schema cannot name them all; and the
    // API refuses an unknown field by name rather than ignoring it, which
    // it can only do if the field arrives.
    const calls: unknown[] = [];
    const apiClient = new AxiomApiClient({
      baseUrl: "https://api.example.test",
      fetchImpl: async (_url, init) => {
        calls.push(init?.body ? JSON.parse(String(init.body)) : undefined);
        return Response.json({ status: "ok", data: {}, meta: {} });
      }
    });
    const server = createAxiomMcpServer(apiClient);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const request = {
      period: "2026-01",
      people: { maria: { age: 34 } },
      families: { household_1: { members: ["maria"], shelter_costs: 400 } },
      tax_units: { filers: { members: ["maria"] } },
      households: { home: { members: ["maria"] } },
      not_a_field_the_api_knows: true,
      variables: ["snap_benefit_amount"]
    };

    try {
      await client.callTool({ name: "calculate_household", arguments: request });
      expect(calls).toEqual([request]);

      const { tools } = await client.listTools();
      const schema = tools.find((tool) => tool.name === "calculate_household")?.inputSchema;
      expect(schema?.additionalProperties).toBe(true);
      expect(Object.keys(schema?.properties ?? {})).toEqual(
        expect.arrayContaining([
          "program_id",
          "jurisdiction",
          "household",
          "root",
          "input_contract",
          "facts",
          "period",
          "state",
          "people",
          "unit",
          "spm_units",
          "tax_units",
          "households",
          "variables"
        ])
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// A resource's contents are text or blob, so `text` needs narrowing.
function resourceText(result: { contents: Array<Record<string, unknown>> }): string {
  const content = result.contents[0];
  return content && typeof content.text === "string" ? content.text : "{}";
}
