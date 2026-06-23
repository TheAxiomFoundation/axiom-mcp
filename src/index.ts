#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AxiomApiClient } from "./axiom-client.js";
import { configFromEnv } from "./config.js";
import { createAxiomMcpServer } from "./server.js";

async function main() {
  const config = configFromEnv();
  const client = new AxiomApiClient({
    baseUrl: config.apiBaseUrl,
    apiKey: config.apiKey
  });
  const server = createAxiomMcpServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
