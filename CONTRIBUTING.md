# Contributing

Thank you for taking the time to contribute. The following guidelines keep the review process smooth for everyone.

## Getting Started

```bash
git clone https://github.com/barissozudogru/gha-intel-mcp.git
cd gha-intel-mcp
npm install
npm run build
```

Verify the server starts:

```bash
GITHUB_TOKEN=ghp_your_token node dist/index.js
```

## Development Workflow

1. Fork the repository and create a branch from `main`.
2. Make your changes in `src/`.
3. Build and verify: `npm run build`
4. Test by connecting an MCP client.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format.
6. Open a pull request against `main`.

## Testing Changes

**Claude Code (quickest):**

```bash
claude mcp add gha-intel-dev -e GITHUB_TOKEN=ghp_your_token -- node /absolute/path/to/dist/index.js
```

**HTTP mode:**

```bash
GITHUB_TOKEN=ghp_your_token node dist/index.js --http
```

## Branch Naming

```
feat/short-description
fix/short-description
chore/short-description
docs/short-description
```

## Commit Messages

```
feat: add per-step cache hit rate to performance report
fix: handle repos with no workflow runs gracefully
docs: add Windsurf HTTP configuration example
chore: bump @modelcontextprotocol/sdk to 1.13
```

Keep subject lines under 72 characters. Use the body for non-trivial context.

## Pull Requests

- One concern per PR.
- Fill in the PR template.
- All CI checks must pass before merge.

## Code Style

- TypeScript strict mode. No `any` types without justification.
- Explicit return types on exported functions.
- MCP tool handlers must return the `content` array format.
- Zod schemas for all tool input validation.

## Adding a New Tool

1. Define the Zod input schema in `src/`.
2. Register the tool with a clear name and description.
3. Implement the handler returning MCP content format.
4. Add to README (summary and reference sections).
5. Add a CHANGELOG entry under `## [Unreleased]`.

## License

By contributing you agree that your changes will be licensed under the [MIT License](LICENSE).
