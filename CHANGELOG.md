# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-12

### Added

- `list_workflow_performance` tool: fetch last N workflow runs and compute per-job timing statistics (avg, min, max, p95) with step-level breakdowns for the slowest jobs
- `analyze_workflow_config` tool: parse workflow YAML and surface findings across caching, concurrency, matrix strategy, artifacts, Docker layer caching, triggers, timeouts, and runner pinning
- `get_billing_usage` tool: retrieve GitHub Actions billing summary (minutes used, estimated cost by runner type) and per-repo cache utilisation
- Native `fetch` based GitHub API client with Bearer token auth
- StdioServerTransport MCP server compatible with Claude Desktop and any MCP-capable client
