import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distIndex = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const packageVersion = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string }
).version;

describe("stdio end-to-end", () => {
  let mockApi: Server;
  let mockApiBaseUrl: string;
  const receivedAuthHeaders: Array<string | undefined> = [];

  beforeAll(async () => {
    if (!existsSync(distIndex)) {
      const build = spawnSync("npm", ["run", "build"], {
        cwd: repoRoot,
        stdio: "pipe",
        shell: process.platform === "win32"
      });
      if (build.status !== 0) {
        throw new Error(`npm run build failed:\n${String(build.stderr)}`);
      }
    }

    mockApi = createServer((request, response) => {
      receivedAuthHeaders.push(request.headers.authorization);
      const payload = routeMockApi(request);
      response.writeHead(payload.status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload.body));
    });
    await new Promise<void>((resolve) => {
      mockApi.listen(0, "127.0.0.1", resolve);
    });
    const address = mockApi.address() as AddressInfo;
    mockApiBaseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      mockApi.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("serves MCP tools from the built binary over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distIndex],
      env: {
        ...getDefaultEnvironment(),
        AXIOM_API_BASE_URL: mockApiBaseUrl,
        AXIOM_API_KEY: "test-key",
        AXIOM_API_TIMEOUT_MS: "5000"
      }
    });
    const client = new Client({ name: "e2e-client", version: "0.1.0" });
    await client.connect(transport);

    try {
      expect(client.getServerVersion()).toMatchObject({
        name: "axiom-mcp",
        version: packageVersion
      });

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "get_capabilities",
          "search_rules",
          "get_rule",
          "calculate_household"
        ])
      );

      const capabilities = await client.callTool({ name: "get_capabilities" });
      expect(capabilities.isError).toBeFalsy();
      expect(capabilities.structuredContent).toMatchObject({
        status: "ok",
        data: { runtime: { package_count: 1 } }
      });
      expect(receivedAuthHeaders).toContain("Bearer test-key");

      const missingRule = await client.callTool({
        name: "get_rule",
        arguments: { rule_id: "us-co/missing" }
      });
      expect(missingRule.isError).toBe(true);
      expect(missingRule.structuredContent).toMatchObject({
        error: {
          http_status: 404,
          api_response: {
            error: { code: "unknown_rule" }
          }
        }
      });
    } finally {
      await client.close();
    }
  }, 30_000);
});

function routeMockApi(request: IncomingMessage): { status: number; body: unknown } {
  if (request.method === "GET" && request.url === "/v1/capabilities") {
    return {
      status: 200,
      body: {
        status: "ok",
        data: { runtime: { package_count: 1 } },
        meta: { request_id: "req-e2e-capabilities" }
      }
    };
  }
  if (request.method === "GET" && request.url === "/v1/rules/us-co/missing") {
    return {
      status: 404,
      body: {
        status: "error",
        error: { code: "unknown_rule", message: "Rule not found." },
        meta: { request_id: "req-e2e-missing-rule" }
      }
    };
  }
  return {
    status: 404,
    body: {
      status: "error",
      error: { code: "unknown_endpoint", message: `No route for ${request.url}` },
      meta: { request_id: "req-e2e-fallback" }
    }
  };
}
