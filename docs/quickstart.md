# Axiom MCP Quickstart

This guide connects an MCP client to the Axiom Rule API through the published
npm package, `@axiom-foundation/mcp`.

Both the package and the hosted API are a **developer preview**: open for
evaluation, subject to interface and limit changes before general
availability.

Full reference with tool schemas, recorded examples, and a live console:
[api.axiom.org/docs/mcp](https://api.axiom.org/docs/mcp)

## Prerequisites

- Node.js `>=20.0.0`
- An Axiom API key — no key yet? Issue yourself a free trial key (14-day
  expiry, read + calculate scopes, no signup):

  ```sh
  curl -s -X POST https://api.axiom.org/v1/keys/trial
  ```

  Durable keys are issued by Axiom administrators.
- An MCP client such as Claude Desktop, Cursor, or another client that supports
  stdio MCP servers

The MCP server is an adapter. It does not contain rules or secrets. It calls the
configured Axiom API with the API key you provide in the client environment.

## API Key Scopes

Use the narrowest key that fits the workflow:

```txt
rules:read      search rules, read rule details, list executable packages
sources:read    read source and provenance references
graphs:read     read dependency/dependent graphs
calculate:run   run household calculations
admin:parity    list and run parity cases
```

For a read-only research assistant, start with `rules:read`, `sources:read`,
and `graphs:read`. For calculation workflows, add `calculate:run`.

## Claude Desktop

Add this to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "npx",
      "args": ["-y", "@axiom-foundation/mcp"],
      "env": {
        "AXIOM_API_BASE_URL": "https://api.axiom.org",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

Replace `axiom_...` with your API key, then restart the MCP client.

## Cursor

Use the same server definition:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "npx",
      "args": ["-y", "@axiom-foundation/mcp"],
      "env": {
        "AXIOM_API_BASE_URL": "https://api.axiom.org",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

## First Requests

After the client starts, ask it to use Axiom tools for tasks such as:

```txt
Search Axiom for Colorado SNAP utility allowance rules and cite the sources.
```

```txt
List executable Axiom runtime packages and show the sample request for Colorado SNAP.
```

```txt
Run the Axiom parity cases and summarize any differences.
```

For calculation work, first ask the client to call `get_runtime_package` so it
can see the package's supported inputs, outputs, aliases, and sample request.

## Available Tools

- `get_capabilities`
- `list_programs`
- `search_rules`
- `get_rule`
- `get_rule_sources`
- `get_rule_dependencies`
- `list_runtime_packages`
- `get_runtime_package`
- `list_parity_cases`
- `run_parity_cases`
- `calculate_household`
- `calculate_batch`
- `submit_calculation_job`
- `get_calculation_job`

## Troubleshooting

If the client cannot start the server, confirm Node is new enough:

```sh
node --version
```

If the client reports `unauthorized`, check that `AXIOM_API_KEY` is present in
the MCP server environment and has the scopes needed by the tool.

If the client reports `rate_limited`, wait for the API response's
`retry-after` interval before retrying.

If `npx` cannot install the package, test the install path directly:

```sh
npx -y @axiom-foundation/mcp
```

Installing from GitHub also works and tracks the `main` branch:

```sh
npx -y github:TheAxiomFoundation/axiom-mcp
```

The command starts a stdio MCP server and will wait for an MCP client. Stop it
with `Ctrl+C` when running it manually.

## Direct API Fallback

The HTTP API is the source of truth. If MCP setup is blocked, clients can call
the API directly:

```sh
curl https://api.axiom.org/v1/runtime/packages \
  -H "Authorization: Bearer axiom_..."
```
