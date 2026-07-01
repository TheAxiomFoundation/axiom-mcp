# Axiom MCP

MCP server adapter for the Axiom Rule API. The server is intentionally thin:
all rule search, retrieval, source lookup, graph traversal, package discovery,
and calculation execution go through the HTTP API.

## Run

For a client-focused setup guide, see [docs/quickstart.md](docs/quickstart.md).

From a checkout:

```sh
AXIOM_API_BASE_URL=https://axiom-api-eta.vercel.app \
AXIOM_API_KEY=... \
npm run mcp
```

After installation:

```sh
AXIOM_API_BASE_URL=https://axiom-api-eta.vercel.app \
AXIOM_API_KEY=... \
axiom-mcp
```

Claude Desktop example:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "npx",
      "args": ["-y", "@axiom-foundation/mcp"],
      "env": {
        "AXIOM_API_BASE_URL": "https://axiom-api-eta.vercel.app",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

GitHub install example while the npm package is not published:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "npx",
      "args": ["-y", "github:TheAxiomFoundation/axiom-mcp"],
      "env": {
        "AXIOM_API_BASE_URL": "https://axiom-api-eta.vercel.app",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

The GitHub install path works for public users while the npm package is not
published. The npm package remains the preferred long-term distribution path
once `@axiom-foundation/mcp` is published.

For local development before the package is published, point the client at the
checkout:

```json
{
  "mcpServers": {
    "axiom-local": {
      "command": "node",
      "args": ["/path/to/axiom-mcp/dist/index.js"],
      "env": {
        "AXIOM_API_BASE_URL": "https://axiom-api-eta.vercel.app",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

## Tools

- `get_capabilities`
- `search_rules`
- `get_rule`
- `get_rule_sources`
- `get_rule_dependencies`
- `list_runtime_packages`
- `get_runtime_package`
- `list_parity_cases`
- `run_parity_cases`
- `calculate_household`

`list_parity_cases` returns canonical Axiom requests plus optional
`external_comparisons` metadata for engines such as PolicyEngine. Those
comparisons include the external request, output mappings, trace mappings,
notes, and tolerances owned by the Axiom API fixture.

`run_parity_cases` returns the Axiom API parity summary, expected-output
diffs, `trace_outputs`, calculation trace rows, and case notes when the API
provides them. Use it for migration checks and to explain why a result differs
from another engine.

## Resources

- `axiom://capabilities`
- `axiom://programs`
- `axiom://runtime/packages`
- `axiom://parity/cases`

## Prompts

- `explain_rule_for_caseworker`
- `trace_household_result`
- `find_missing_household_inputs`

## Security

The server does not expose shell execution, arbitrary network fetch, database
access, or write/admin operations. It only calls the configured Axiom API base
URL with the configured API key.

Recommended API key scopes:

```txt
rules:read      get_capabilities, search_rules, get_rule, list_runtime_packages, get_runtime_package
sources:read    get_rule_sources
graphs:read     get_rule_dependencies
calculate:run   calculate_household
admin:parity    list_parity_cases, run_parity_cases
```

Use the narrowest key that matches the agent workflow. A read-only research
agent usually needs `rules:read`, `sources:read`, and `graphs:read`; a scenario
runner also needs `calculate:run`.

If the Axiom API returns `429 rate_limited`, the MCP client should retry after
the response's `retry-after` interval.

## Development

```sh
npm run check
npm pack --dry-run
npm run smoke:github-install
```

Live smoke against the deployed API:

```sh
AXIOM_API_BASE_URL=https://axiom-api-eta.vercel.app \
AXIOM_API_KEY=... \
npm run smoke:live
```

## Publishing

The package is prepared for npm publication as `@axiom-foundation/mcp`.

Use npm Trusted Publishing for CI/CD releases instead of a long-lived npm token.
Configure the package's trusted publisher in npm with:

- package: `@axiom-foundation/mcp`
- repository owner: `TheAxiomFoundation`
- repository name: `axiom-mcp`
- workflow filename: `publish.yml`
- environment: leave blank unless the workflow is later moved behind a GitHub
  environment

Then run the manual `Publish MCP Package` workflow from:

```txt
https://github.com/TheAxiomFoundation/axiom-mcp/actions
```

The publish workflow runs `npm run check`, `npm pack --dry-run`, and
`npm publish --access public --provenance` through GitHub OIDC. If npm does not
allow trusted-publisher setup before the first package version exists, do a
one-time local first publish with a real npm publish OTP, then configure Trusted
Publishing for all later releases.

After publication, MCP clients can install with:

```sh
npx -y @axiom-foundation/mcp
```
