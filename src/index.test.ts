import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtSeconds, durationSeconds, percentile, avg, computeRunTiming, createHttpApp } from './index.js';

test('fmtSeconds formats sub-minute durations in seconds', () => {
  assert.equal(fmtSeconds(0), '0.0s');
  assert.equal(fmtSeconds(12.34), '12.3s');
  assert.equal(fmtSeconds(59.4), '59.4s');
});

test('fmtSeconds formats minute durations and prevents 60s rollover overflow', () => {
  assert.equal(fmtSeconds(60), '1m 00s');
  assert.equal(fmtSeconds(119.7), '2m 00s');
  assert.equal(fmtSeconds(125), '2m 05s');
});

test('durationSeconds handles valid, null, and invalid date inputs', () => {
  assert.equal(durationSeconds('2026-01-01T00:00:00Z', '2026-01-01T00:01:30Z'), 90);
  assert.equal(durationSeconds('invalid', '2026-01-01T00:01:30Z'), 0);
  assert.equal(durationSeconds(null, '2026-01-01T00:01:30Z'), 0);
});

test('percentile and avg compute expected summary statistics', () => {
  assert.equal(avg([10, 20, 30]), 20);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

test('computeRunTiming calculates parallel wall clock and billable seconds', () => {
  const jobs = [
    {
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:02:00Z',
      steps: [],
    },
    {
      id: 2,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:01:00Z',
      completed_at: '2026-01-01T00:03:00Z',
      steps: [],
    },
  ];

  const timing = computeRunTiming(jobs);
  assert.equal(timing.wall_clock_seconds, 180);
  assert.equal(timing.billable_seconds, 240);
});

test('HTTP server handles concurrent MCP requests without crashing', async () => {
  const app = createHttpApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('api.github.com')) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  try {
    const payload = (id: number) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: 'list_workflow_performance',
          arguments: {
            owner: 'test-owner',
            repo: 'test-repo',
            workflow_id: 'test.yml',
          },
        },
      });

    const sendRequest = (id: number) =>
      fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: payload(id),
      });

    const [res1, res2] = await Promise.all([sendRequest(1), sendRequest(2)]);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    const json1 = await res1.json();
    const json2 = await res2.json();

    assert.equal(json1.id, 1);
    assert.equal(json2.id, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

