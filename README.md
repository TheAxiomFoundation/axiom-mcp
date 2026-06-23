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
- `calculate_household`

## Resources

- `axiom://capabilities`
- `axiom://programs`
- `axiom://runtime/packages`

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
