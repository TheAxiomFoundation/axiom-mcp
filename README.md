# Axiom MCP

MCP server adapter for the Axiom Rule API. The server is intentionally thin:
all rule search, retrieval, source lookup, graph traversal, package discovery,
and calculation execution go through the HTTP API.

**Status: developer preview.** The MCP server and the hosted API it talks to
are open for evaluation with self-serve trial keys. Interfaces and limits may
change before general availability; pin versions and expect breaking changes
between minors.

## Run

For a client-focused setup guide, see [docs/quickstart.md](docs/quickstart.md).

From a checkout:

```sh
AXIOM_API_BASE_URL=https://api.axiom-foundation.org \
AXIOM_API_KEY=... \
npm run mcp
```

After installation:

```sh
AXIOM_API_BASE_URL=https://api.axiom-foundation.org \
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
        "AXIOM_API_BASE_URL": "https://api.axiom-foundation.org",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

The npm package `@axiom-foundation/mcp` is the primary distribution path.
Installing from GitHub also works and tracks `main`:

```json
{
  "mcpServers": {
    "axiom": {
      "command": "npx",
      "args": ["-y", "github:TheAxiomFoundation/axiom-mcp"],
      "env": {
        "AXIOM_API_BASE_URL": "https://api.axiom-foundation.org",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

For local development, point the client at the checkout:

```json
{
  "mcpServers": {
    "axiom-local": {
      "command": "node",
      "args": ["/path/to/axiom-mcp/dist/index.js"],
      "env": {
        "AXIOM_API_BASE_URL": "https://api.axiom-foundation.org",
        "AXIOM_API_KEY": "axiom_..."
      }
    }
  }
}
```

## Tools

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
- `calculate_batch` (up to 25 synchronous calculations, positional results)
- `submit_calculation_job` (up to 50 calculations as a detached async job)
- `get_calculation_job` (poll job status, progress, and results)

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

No API key yet? Issue yourself a trial key (14-day expiry, read +
calculate scopes, no signup): `curl -s -X POST
https://api.axiom-foundation.org/v1/keys/trial`

Recommended API key scopes:

```txt
rules:read      get_capabilities, list_programs, search_rules, get_rule, list_runtime_packages, get_runtime_package
sources:read    get_rule_sources
graphs:read     get_rule_dependencies
calculate:run   calculate_household, calculate_batch, submit_calculation_job, get_calculation_job
admin:parity    list_parity_cases, run_parity_cases
```

Use the narrowest key that matches the agent workflow. A read-only research
agent usually needs `rules:read`, `sources:read`, and `graphs:read`; a scenario
runner also needs `calculate:run`.

Axiom API errors are returned to the MCP client as structured tool errors that
include the HTTP status and the API's error body, so agents can see error
codes, messages, and request ids. If the Axiom API returns `429 rate_limited`
with a `retry-after` of 10 seconds or less, the server retries once
automatically; otherwise the tool error includes the response's `retry-after`
value — retry after that interval.

Full reference with recorded examples:
[api.axiom-foundation.org/docs/mcp](https://api.axiom-foundation.org/docs/mcp)

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AXIOM_API_BASE_URL` | `https://api.axiom-foundation.org` | Axiom API base URL |
| `AXIOM_API_KEY` | none | Bearer token sent to the API |
| `AXIOM_API_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds |

## Development

```sh
npm run check
npm pack --dry-run
npm run smoke:github-install
```

Live smoke against the deployed API:

```sh
AXIOM_API_BASE_URL=https://api.axiom-foundation.org \
AXIOM_API_KEY=... \
npm run smoke:live
```

## Publishing

The package is published to npm as `@axiom-foundation/mcp`.

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
`npm publish --access public --provenance` through GitHub OIDC. The first
version (`0.1.0`) was published manually because npm requires an existing
package before trusted publishing can be configured; all later releases should
go through the workflow.

MCP clients can install with:

```sh
npx -y @axiom-foundation/mcp
```
