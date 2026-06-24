# Axiom MCP

MCP server adapter for the Axiom Rule API. The server is intentionally thin:
all rule search, retrieval, source lookup, graph traversal, package discovery,
and calculation execution go through the HTTP API.

## Run

```sh
AXIOM_API_BASE_URL=https://axiom-api-eta.vercel.app \
AXIOM_API_KEY=... \
npm run mcp
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

## Development

```sh
npm run check
```

Live smoke against the deployed API:

```sh
AXIOM_API_BASE_URL=https://axiom-api-eta.vercel.app \
AXIOM_API_KEY=... \
npm run smoke:live
```
