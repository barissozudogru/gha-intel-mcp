<img src="./assets/banner-gha-intel.svg" alt="gha-intel-mcp" width="888" />

# gha-intel-mcp

[![npm version](https://img.shields.io/npm/v/@barissozudogru/gha-intel-mcp)](https://www.npmjs.com/package/@barissozudogru/gha-intel-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)

[npm](https://www.npmjs.com/package/@barissozudogru/gha-intel-mcp) · [Source](https://github.com/barissozudogru/gha-intel-mcp) · [Issues](https://github.com/barissozudogru/gha-intel-mcp/issues)

Inspect GitHub Actions run timing and review workflow configuration through MCP.

## Tools

| Tool | Description |
|------|-------------|
| `list_workflow_performance` | Computes average, min, max, and p95 duration statistics for recent workflow runs. |
| `analyze_workflow_config` | Evaluates workflow YAML for caching, parallelism, concurrency, artifacts, checkout depth, timeouts, runner pinning, Docker caching, and triggers. |
| `get_billing_usage` | Reads repository cache usage and recent run timing. Account billing uses retired endpoints; see limitations below. |

## Requirements

- Node.js >= 18 (uses native `fetch`)
- A GitHub token with access to the repositories you want to inspect. See your token type and endpoint permissions before granting access.

## Setup

Three transport modes are available. Choose whichever fits your deployment:

---

### Option A: stdio (local, recommended for desktop clients)

The server runs as a subprocess of the MCP client over stdin/stdout. No network port required.

<details open>
<summary>Claude Desktop</summary>

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

</details>

<details>
<summary>Claude Code</summary>

```bash
claude mcp add gha-intel -e GITHUB_TOKEN=ghp_your_token -- npx -y @barissozudogru/gha-intel-mcp
```

</details>

<details>
<summary>Cursor</summary>

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

</details>

<details>
<summary>Windsurf</summary>

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

</details>

<details>
<summary>VS Code + Copilot</summary>

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

</details>

<details>
<summary>Cline</summary>

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

</details>

<details>
<summary>Continue.dev</summary>

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

</details>

<details>
<summary>Zed</summary>

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

</details>

<details>
<summary>JetBrains (IntelliJ, PyCharm, WebStorm, etc.)</summary>

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

</details>

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

<details>
<summary>Cursor (HTTP)</summary>

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

</details>

<details>
<summary>VS Code + Copilot (HTTP)</summary>

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

</details>

<details>
<summary>Windsurf (HTTP)</summary>

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

</details>

<details>
<summary>Continue.dev (HTTP)</summary>

`~/.continue/config.yaml`

```yaml
mcpServers:
  - name: gha-intel
    url: http://localhost:3000/mcp
```

</details>

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

**Categories analysed:** Dependency caching, matrix strategy and fail-fast, concurrency groups and cancel-in-progress, artifact uploads, git checkout depth, job timeout-minutes, runner version pinning, Docker layer caching, and trigger path filters.

---

### get_billing_usage

Retrieve repository cache consumption and recent run estimates. Account billing is currently limited by a retired API integration.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | yes | GitHub username or organisation |
| `repo` | string | no | Repository name for repo-scoped cache and run stats |

**Output:** With `repo` supplied, cache usage and recent run timing where accessible. Account billing requests use retired GitHub endpoints and can fail. Existing cost estimates use a historical rate table and should not be treated as current charges.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | yes | GitHub personal access token. Access must match the requested repository and endpoint. Keep the token outside version control. |
| `TRANSPORT` | no | Set to `http` to enable HTTP mode (default: stdio). |
| `PORT` | no | HTTP port when running in HTTP mode (default: `3000`). |

## Limitations and deployment

- Account billing uses `/settings/billing/actions`, which GitHub
  [retired in September 2025](https://github.blog/changelog/2025-09-26-product-specific-billing-apis-are-closing-down/).
  Granting broader token scopes does not restore those endpoints. Repository cache
  and run timing requests use separate endpoints.
- Current cost estimates use historical rates, and cache utilisation assumes a
  fixed 10 GB limit. Review account configuration before using either for capacity
  or budget decisions.
- HTTP mode listens on all interfaces and does not implement client authentication.
  Keep it on a trusted network or place an authenticated gateway in front of it.
  The server uses its configured GitHub token for client requests.
- Timing statistics describe the fetched runs, rather than predicting a future run.

## Development and support

Report problems through [GitHub issues](https://github.com/barissozudogru/gha-intel-mcp/issues). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.

To build and test a source checkout with Node.js 22:

```bash
npm ci
npm test
npm run build
```

The default branch can contain changes that have not yet been published to npm.

## License

[MIT](./LICENSE)
