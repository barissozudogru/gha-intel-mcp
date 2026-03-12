# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-03-12

### Added

- Streamable HTTP transport for remote MCP clients (Cursor, VS Code, ChatGPT, cloud)
- `--http` flag and `TRANSPORT=http` environment variable for HTTP mode
- Health check endpoint at `/health`
- Dockerfile for containerized deployment
- smithery.yaml for Smithery registry
- Configuration examples for 10+ MCP clients

## [0.2.0] - 2026-03-12

### Fixed

- Run duration now reports wall-clock time instead of summing parallel jobs (was inflated by Nx)
- Jobs API now uses per_page=100 (was silently dropping jobs in matrix workflows with >30 combinations)
- Rate limit handling: retries on 429 with Retry-After, exponential backoff on 5xx errors
- Yarn install detection regex no longer false-positives on yarn test/build/lint
- fetch-depth regex now matches multi-digit values (10, 50, 100)
- Billing run timing uses job timestamps instead of unreliable updated_at field

### Added

- Parallel API calls with concurrency limit of 10 (was sequential, 10x faster)
- Error handling in all tool callbacks with proper MCP isError responses
- Fetch timeout (15s) prevents hung connections
- Workflow content validation rejects non-GHA YAML
- Input validation on owner/repo parameters
- Dynamic version from package.json (no more hardcoded strings)

### Removed

- structuredContent from tool responses (no outputSchema was defined)

## [0.1.0] - 2026-03-12

### Added

- `list_workflow_performance` tool: fetch last N workflow runs and compute per-job timing statistics (avg, min, max, p95) with step-level breakdowns for the slowest jobs
- `analyze_workflow_config` tool: parse workflow YAML and surface findings across caching, concurrency, matrix strategy, artifacts, Docker layer caching, triggers, timeouts, and runner pinning
- `get_billing_usage` tool: retrieve GitHub Actions billing summary (minutes used, estimated cost by runner type) and per-repo cache utilisation
- Native `fetch` based GitHub API client with Bearer token auth
- StdioServerTransport MCP server compatible with Claude Desktop and any MCP-capable client
