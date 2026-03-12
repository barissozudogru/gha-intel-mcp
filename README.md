# gha-optimizer-mcp

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square" />
</p>

An MCP (Model Context Protocol) server that connects to the GitHub API and gives any MCP-capable AI client the ability to analyse GitHub Actions workflows, surface timing bottlenecks, review workflow configurations, and report billing usage.

## What It Does

| Tool | Description |
|------|-------------|
| `list_workflow_performance` | Fetches the last N completed runs of a workflow and computes per-job and per-step timing statistics: average, min, max, and p95 duration. Reveals exactly which jobs are slowing your pipeline down. |
| `analyze_workflow_config` | Parses a workflow YAML string and evaluates it across nine categories: caching, parallelism, concurrency, artifacts, checkout depth, timeouts, runner pinning, Docker layer caching, and trigger efficiency. Returns findings with concrete recommendations. |
| `get_billing_usage` | Returns Actions billing minutes broken down by runner type with estimated cost, plus per-repo cache utilisation and a wall-clock time estimate for recent runs. |

## Requirements

- Node.js >= 18 (uses native `fetch`)
- A GitHub personal access token with `repo` and `read:org` scopes

## Setup — Claude Desktop

Add the following to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gha-optimizer": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-optimizer-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop after saving. The three tools will be available immediately.

## Setup — Local build

```bash
git clone https://github.com/barissozudogru/gha-optimizer-mcp.git
cd gha-optimizer-mcp
npm install
npm run build

# Run directly
GITHUB_TOKEN=ghp_... node dist/index.js
```

For local builds, point Claude Desktop at the absolute path:

```json
{
  "mcpServers": {
    "gha-optimizer": {
      "command": "node",
      "args": ["/absolute/path/to/gha-optimizer-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

## Tool Reference

### list_workflow_performance

Fetch real run timing data and compute job-level statistics.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | yes | GitHub owner (user or org) |
| `repo` | string | yes | Repository name |
| `workflow_id` | string | yes | Workflow file name (e.g. `ci.yml`) or numeric ID |
| `count` | number | no | Number of recent runs to analyse (default: 10, max: 100) |

**Output:** Per-job and per-step timing stats (avg, min, max, p95), overall run timing, and a list of recent run conclusions.

---

### analyze_workflow_config

Parse and audit a workflow YAML for optimisation opportunities.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workflow_content` | string | yes | Full YAML content of the workflow file |

**Output:** Findings grouped by severity (critical / warning / info / good) across nine categories, each with a concrete recommendation.

**Categories analysed:**
- Dependency caching (actions/cache, setup-node cache, pip cache)
- Matrix strategy and fail-fast
- Concurrency groups and cancel-in-progress
- Artifact uploads
- Git checkout depth
- Job timeout-minutes
- Runner version pinning
- Docker layer caching
- Trigger path filters and duplicate triggers

---

### get_billing_usage

Retrieve billing and cache consumption data.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | yes | GitHub username or organisation |
| `repo` | string | no | Repository name for repo-scoped cache and run stats |

**Output:** Total minutes used, plan utilisation, estimated cost broken down by runner type (Ubuntu / macOS / Windows / large runners), plus per-repo cache size and utilisation percentage.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | yes | GitHub personal access token. Requires `repo` scope for private repos, `read:org` for org billing. |

## License

MIT
