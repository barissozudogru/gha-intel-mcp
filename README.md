# gha-intel-mcp

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/npm-0.4.0-cb3837?style=flat-square&logo=npm&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
  <img alt="MCP Server" src="https://img.shields.io/badge/MCP-Server-8A2BE2?style=flat-square" />
</p>

A GitHub Actions intelligence MCP server that connects to the GitHub API and gives any MCP-capable AI client deep insight into workflow timing, configuration quality, and billing consumption. Surface bottlenecks, audit configurations, and understand costs — without leaving your AI client.

**Compatible With:** Claude Desktop | Claude Code | Cursor | Windsurf | VS Code | Cline | Continue | Zed | JetBrains | ChatGPT

## Tools

| Tool | Description |
|------|-------------|
| `list_workflow_performance` | Fetches the last N completed runs of a workflow and computes per-job and per-step timing statistics: average, min, max, and p95 duration. Reveals exactly which jobs are slowing your pipeline down. |
| `analyze_workflow_config` | Parses a workflow YAML string and evaluates it across nine categories: caching, parallelism, concurrency, artifacts, checkout depth, timeouts, runner pinning, Docker layer caching, and trigger efficiency. Returns findings with concrete recommendations. |
| `get_billing_usage` | Returns Actions billing minutes broken down by runner type with estimated cost, plus per-repo cache utilisation and a wall-clock time estimate for recent runs. |

## Requirements

- Node.js >= 18 (uses native `fetch`)
- A GitHub personal access token with `repo` and `read:org` scopes

## Setup

Three transport modes are available. Choose whichever fits your deployment:

---

### Option A: stdio (local — recommended for desktop clients)

The server runs as a subprocess of the MCP client over stdin/stdout. No network port required.

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
`%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "gha-intel": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add gha-intel -e GITHUB_TOKEN=ghp_your_token -- npx -y @barissozudogru/gha-intel-mcp
```

#### Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gha-intel": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

#### Windsurf

`~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "gha-intel": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

#### VS Code + Copilot

`.vscode/mcp.json` (workspace) or user settings

```json
{
  "servers": {
    "gha-intel": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

#### Cline

Open Cline settings, navigate to MCP Servers, and add:

```json
{
  "mcpServers": {
    "gha-intel": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

#### Continue.dev

`~/.continue/config.yaml`

```yaml
mcpServers:
  - name: gha-intel
    command: npx
    args:
      - -y
      - "@barissozudogru/gha-intel-mcp"
    env:
      GITHUB_TOKEN: ghp_your_token
```

#### Zed

`~/.config/zed/settings.json`

```json
{
  "context_servers": {
    "gha-intel": {
      "command": {
        "path": "npx",
        "args": ["-y", "@barissozudogru/gha-intel-mcp"],
        "env": {
          "GITHUB_TOKEN": "ghp_your_token"
        }
      }
    }
  }
}
```

#### JetBrains (IntelliJ, PyCharm, WebStorm, etc.)

Go to **Settings > Tools > AI Assistant > MCP** and add:

```json
{
  "mcpServers": {
    "gha-intel": {
      "command": "npx",
      "args": ["-y", "@barissozudogru/gha-intel-mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token"
      }
    }
  }
}
```

---

### Option B: HTTP (remote or cloud clients)

Start the server in HTTP mode and point clients at the endpoint:

```bash
GITHUB_TOKEN=ghp_your_token npx @barissozudogru/gha-intel-mcp --http
# Server listens on http://0.0.0.0:3000/mcp
# Health check: http://localhost:3000/health
```

Or set via environment variable instead of the flag:

```bash
TRANSPORT=http PORT=3000 GITHUB_TOKEN=ghp_your_token npx @barissozudogru/gha-intel-mcp
```

#### Cursor (HTTP)

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gha-intel": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### VS Code + Copilot (HTTP)

`.vscode/mcp.json`

```json
{
  "servers": {
    "gha-intel": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### Windsurf (HTTP)

`~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "gha-intel": {
      "serverUrl": "http://localhost:3000/mcp"
    }
  }
}
```

#### Continue.dev (HTTP)

`~/.continue/config.yaml`

```yaml
mcpServers:
  - name: gha-intel
    url: http://localhost:3000/mcp
```

---

### Option C: Docker

```bash
docker build -t gha-intel-mcp .
docker run -p 3000:3000 -e GITHUB_TOKEN=ghp_your_token gha-intel-mcp
```

The container starts in HTTP mode by default. Point your client at `http://localhost:3000/mcp`.

---

## Tool Reference

### list_workflow_performance

Fetch real run timing data and compute job-level statistics.

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

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | yes | GitHub username or organisation |
| `repo` | string | no | Repository name for repo-scoped cache and run stats |

**Output:** Total minutes used, plan utilisation, estimated cost broken down by runner type (Ubuntu / macOS / Windows / large runners), plus per-repo cache size and utilisation percentage.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | yes | GitHub personal access token. Requires `repo` scope for private repos, `read:org` for org billing. |
| `TRANSPORT` | no | Set to `http` to enable HTTP mode (default: stdio). |
| `PORT` | no | HTTP port when running in HTTP mode (default: `3000`). |

## License

MIT
