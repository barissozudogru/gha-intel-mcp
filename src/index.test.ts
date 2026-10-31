import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fmtSeconds, durationSeconds, percentile, avg, computeRunTiming, createHttpApp, createMcpServer } from './index.js';

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

test('fmtSeconds carries rounded sub-minute values into minute format', () => {
  assert.equal(fmtSeconds(59.96), '1m 00s');
  assert.equal(fmtSeconds(59.95), '1m 00s');
  assert.equal(fmtSeconds(59.94), '59.9s');
  assert.equal(fmtSeconds(1.15), '1.1s');
  assert.equal(fmtSeconds(59.15), '59.1s');
});

test('fmtSeconds renders non-finite durations as zero', () => {
  assert.equal(fmtSeconds(Number.NaN), '0.0s');
  assert.equal(fmtSeconds(Number.POSITIVE_INFINITY), '0.0s');
  assert.equal(fmtSeconds(Number.NEGATIVE_INFINITY), '0.0s');
});

test('fmtSeconds clamps negative durations to zero', () => {
  assert.equal(fmtSeconds(-0.5), '0.0s');
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

test('percentile returns zero for a non-finite percentile', () => {
  assert.equal(percentile([1, 2, 3], Number.NaN), 0);
});

test('percentile ignores non-finite samples', () => {
  assert.equal(percentile([1, Number.NaN, 3], 50), 1);
});

test('percentile sorts unsorted samples before selecting a value', () => {
  assert.equal(percentile([30, 10, 20], 50), 20);
});

test('avg ignores non-finite samples', () => {
  assert.equal(avg([1, Number.NaN, 3, Number.POSITIVE_INFINITY]), 2);
  assert.equal(avg([Number.NaN, Number.NEGATIVE_INFINITY]), 0);
});

test('avg avoids overflow when finite samples have a large magnitude', () => {
  assert.equal(avg([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE);
  assert.equal(avg([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE);
});

test('avg preserves small values when large values cancel', () => {
  assert.ok(Math.abs(avg([Number.MAX_VALUE, 1, -Number.MAX_VALUE]) - 1 / 3) < 1e-15);
});

test('avg preserves the smallest non-zero finite magnitude', () => {
  assert.equal(avg([Number.MIN_VALUE, Number.MIN_VALUE]), Number.MIN_VALUE);
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

test('computeRunTiming rounds each short job up to a billable minute', () => {
  const jobs = [
    {
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:00:10Z',
      steps: [],
    },
    {
      id: 2,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:00:20Z',
      steps: [],
    },
  ];

  assert.equal(computeRunTiming(jobs).billable_seconds, 120);
});

test('computeRunTiming bills a zero-duration completed job for one minute', () => {
  const jobs = [
    {
      id: 1,
      name: 'instant',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T00:00:00Z',
      steps: [],
    },
  ];

  assert.deepEqual(computeRunTiming(jobs), {
    wall_clock_seconds: 0,
    billable_seconds: 60,
  });
});

test('computeRunTiming ignores jobs whose completion precedes their start', () => {
  const jobs = [
    {
      id: 1,
      name: 'valid',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T00:10:00Z',
      completed_at: '2026-01-01T00:11:00Z',
      steps: [],
    },
    {
      id: 2,
      name: 'malformed',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2025-12-31T23:59:00Z',
      steps: [],
    },
  ];

  assert.deepEqual(computeRunTiming(jobs), {
    wall_clock_seconds: 60,
    billable_seconds: 60,
  });
});

test('list_workflow_performance excludes jobs whose completion precedes their start', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/actions/workflows/ci.yml/runs')) {
      return new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [{
            id: 1,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:01:00Z',
            run_started_at: '2026-01-01T00:00:00Z',
            run_number: 1,
            html_url: 'https://github.com/test-owner/test-repo/actions/runs/1',
          }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/actions/runs/1/jobs')) {
      return new Response(
        JSON.stringify({
          total_count: 2,
          jobs: [
            {
              id: 1,
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-01-01T00:00:00Z',
              completed_at: '2026-01-01T00:01:00Z',
              steps: [],
            },
            {
              id: 2,
              name: 'build',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2026-01-01T00:02:00Z',
              completed_at: '2026-01-01T00:01:00Z',
              steps: [],
            },
          ],
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'list_workflow_performance',
      arguments: { owner: 'test-owner', repo: 'test-repo', workflow_id: 'ci.yml', count: 1 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /build\s+avg: 1m 00s/);
    assert.doesNotMatch(text, /build\s+avg: 30\.0s/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('list_workflow_performance excludes steps whose completion precedes their start', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/actions/workflows/ci.yml/runs')) {
      return new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [{
            id: 1,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:02:00Z',
            run_started_at: '2026-01-01T00:00:00Z',
            run_number: 1,
            html_url: 'https://github.com/test-owner/test-repo/actions/runs/1',
          }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/actions/runs/1/jobs')) {
      return new Response(
        JSON.stringify({
          total_count: 1,
          jobs: [{
            id: 1,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:02:00Z',
            steps: [
              {
                name: 'valid step',
                status: 'completed',
                conclusion: 'success',
                number: 1,
                started_at: '2026-01-01T00:00:00Z',
                completed_at: '2026-01-01T00:01:00Z',
              },
              {
                name: 'malformed step',
                status: 'completed',
                conclusion: 'failure',
                number: 2,
                started_at: '2026-01-01T00:01:30Z',
                completed_at: '2026-01-01T00:01:00Z',
              },
              {
                name: 'invalid start step',
                status: 'completed',
                conclusion: 'failure',
                number: 3,
                started_at: 'not-a-date',
                completed_at: '2026-01-01T00:01:00Z',
              },
              {
                name: 'invalid completion step',
                status: 'completed',
                conclusion: 'failure',
                number: 4,
                started_at: '2026-01-01T00:01:00Z',
                completed_at: 'not-a-date',
              },
            ],
          }],
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'list_workflow_performance',
      arguments: { owner: 'test-owner', repo: 'test-repo', workflow_id: 'ci.yml', count: 1 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /valid step\s+avg: 1m 00s/);
    assert.doesNotMatch(text, /malformed step/);
    assert.doesNotMatch(text, /invalid start step/);
    assert.doesNotMatch(text, /invalid completion step/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('get_billing_usage rejects path traversal identifiers through the registered tool', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    for (const arguments_ of [{ owner: '..' }, { owner: 'org', repo: '..' }]) {
      const result = await client.callTool({ name: 'get_billing_usage', arguments: arguments_ });
      assert.equal(result.isError, true);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('get_billing_usage ignores negative runner minutes when estimating cost', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/orgs/')) return new Response('not found', { status: 404 });
    if (url.includes('/users/')) {
      return new Response(
        JSON.stringify({
          total_minutes_used: 0,
          total_paid_minutes_used: 0,
          included_minutes: 100,
          minutes_used_breakdown: { UBUNTU: -5 },
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'get_billing_usage',
      arguments: { owner: 'test-owner' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /Estimated cost:\s+\$0\.00/);
    assert.doesNotMatch(text, /UBUNTU/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('get_billing_usage clamps invalid aggregate billing minutes to zero', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/orgs/')) return new Response('not found', { status: 404 });
    if (url.includes('/users/')) {
      return new Response(
        JSON.stringify({
          total_minutes_used: -10,
          total_paid_minutes_used: -3,
          included_minutes: -100,
          minutes_used_breakdown: {},
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'get_billing_usage',
      arguments: { owner: 'test-owner' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /Total minutes used:\s+0 min/);
    assert.match(text, /Included minutes:\s+0 min/);
    assert.match(text, /Paid minutes:\s+0 min/);
    assert.match(text, /Plan utilisation:\s+N\/A%/);
    assert.doesNotMatch(text, /-10|-100|-3/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('get_billing_usage clamps invalid cache usage values to zero', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/settings/billing/actions')) {
      return new Response('not found', { status: 404 });
    }
    if (url.includes('/actions/cache/usage')) {
      return new Response(
        JSON.stringify({
          full_name: 'test-owner/test-repo',
          active_caches_size_in_bytes: -1,
          active_caches_count: -3,
        }),
        { status: 200 }
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'get_billing_usage',
      arguments: { owner: 'test-owner', repo: 'test-repo' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /Active caches:\s+0/);
    assert.match(text, /Total cache size:\s+0\.0 MB \(0\.000 GB\)/);
    assert.match(text, /Cache utilisation:\s+0\.0%/);
    assert.doesNotMatch(text, /-1|NaN/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('list_workflow_performance rejects an empty workflow identifier', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  let fetchCount = 0;
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 });
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'list_workflow_performance',
      arguments: { owner: 'test-owner', repo: 'test-repo', workflow_id: '' },
    });
    assert.equal(result.isError, true);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('list_workflow_performance rejects a whitespace-only workflow identifier', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  let fetchCount = 0;
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 });
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'list_workflow_performance',
      arguments: { owner: 'test-owner', repo: 'test-repo', workflow_id: '   ' },
    });
    assert.equal(result.isError, true);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
});

test('list_workflow_performance rejects workflow identifiers with surrounding whitespace', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  let fetchCount = 0;
  process.env.GITHUB_TOKEN = 'test-token';
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 });
  }) as typeof fetch;

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'list_workflow_performance',
      arguments: { owner: 'test-owner', repo: 'test-repo', workflow_id: ' ci.yml ' },
    });
    assert.equal(result.isError, true);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await client.close();
    await server.close();
  }
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

test('list_workflow_performance paginates jobs when run has more than 100 jobs', async () => {
  const app = createHttpApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    requestedUrls.push(urlStr);
    if (urlStr.includes('/actions/workflows/ci.yml/runs')) {
      return new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              id: 101,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:02:00Z',
              run_started_at: '2026-01-01T00:00:00Z',
              run_number: 42,
              html_url: 'https://github.com/test-owner/test-repo/actions/runs/101',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/actions/runs/101/jobs')) {
      const url = new URL(urlStr);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      if (page === 1) {
        const jobs = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `job-${i + 1}`,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T00:01:00Z',
          steps: [],
        }));
        return new Response(JSON.stringify({ total_count: 105, jobs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (page === 2) {
        const jobs = Array.from({ length: 5 }, (_, i) => ({
          id: 101 + i,
          name: `job-${101 + i}`,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T00:01:00Z',
          steps: [],
        }));
        return new Response(JSON.stringify({ total_count: 105, jobs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ total_count: 105, jobs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'list_workflow_performance',
          arguments: {
            owner: 'test-owner',
            repo: 'test-repo',
            workflow_id: 'ci.yml',
            count: 1,
          },
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.error, undefined);
    const text = data.result.content[0].text;
    assert.match(text, /job-105/);
    assert.ok(requestedUrls.some((u) => u.includes('page=2')));
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

test('get_billing_usage paginates jobs when recent run has more than 100 jobs', async () => {
  const app = createHttpApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    requestedUrls.push(urlStr);
    if (urlStr.includes('/settings/billing/actions')) {
      return new Response(
        JSON.stringify({
          total_minutes_used: 0,
          total_paid_minutes_used: 0,
          included_minutes: 2000,
          minutes_used_breakdown: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/actions/cache/usage')) {
      return new Response(
        JSON.stringify({
          full_name: 'test-owner/test-repo',
          active_caches_size_in_bytes: 0,
          active_caches_count: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/actions/runs?per_page=100&status=completed')) {
      return new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              id: 202,
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:02:00Z',
              run_started_at: '2026-01-01T00:00:00Z',
              run_number: 1,
              html_url: 'https://github.com/test-owner/test-repo/actions/runs/202',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/actions/runs/202/jobs')) {
      const url = new URL(urlStr);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      if (page === 1) {
        const jobs = Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          name: `job-${i + 1}`,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T00:01:00Z',
          steps: [],
        }));
        return new Response(JSON.stringify({ total_count: 105, jobs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (page === 2) {
        const jobs = Array.from({ length: 5 }, (_, i) => ({
          id: 101 + i,
          name: `job-${101 + i}`,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T00:01:00Z',
          steps: [],
        }));
        return new Response(JSON.stringify({ total_count: 105, jobs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ total_count: 105, jobs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_billing_usage',
          arguments: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.error, undefined);
    const text = data.result.content[0].text;
    assert.match(text, /Estimated cost \(Ubuntu\):\s+\$0\.84/);
    assert.ok(requestedUrls.some((u) => u.includes('page=2')));
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

test('analyze_workflow_config recognizes Java, Rust, and Go caching configurations', async () => {
  const app = createHttpApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  const analyze = async (workflowContent: string) => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'analyze_workflow_config',
          arguments: {
            workflow_content: workflowContent,
          },
        },
      }),
    });
    const data = await res.json();
    return data.result.content[0].text as string;
  };

  try {
    const javaWorkflow = `
name: Java CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'maven'
      - run: mvn install
`;
    const javaResult = await analyze(javaWorkflow);
    assert.match(javaResult, /\[OK\] \[caching\] Dependency caching is configured\./);
    assert.doesNotMatch(javaResult, /Dependency installation detected but no caching is configured\./);

    const rustWorkflow = `
name: Rust CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Swatinem/rust-cache@v2
      - run: cargo build --release
`;
    const rustResult = await analyze(rustWorkflow);
    assert.match(rustResult, /\[OK\] \[caching\] Dependency caching is configured\./);
    assert.doesNotMatch(rustResult, /Dependency installation detected but no caching is configured\./);

    const gradleWorkflow = `
name: Gradle CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'gradle'
`;
    const gradleResult = await analyze(gradleWorkflow);
    assert.match(gradleResult, /\[OK\] \[caching\] Dependency caching is configured\./);

    const sbtWorkflow = `
name: SBT CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'sbt'
`;
    const sbtResult = await analyze(sbtWorkflow);
    assert.match(sbtResult, /\[OK\] \[caching\] Dependency caching is configured\./);

    const uncachedJavaWorkflow = `
name: Uncached Java CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - run: mvn install
`;
    const uncachedJavaResult = await analyze(uncachedJavaWorkflow);
    assert.match(uncachedJavaResult, /\[WARN\] \[caching\] Dependency installation detected but no caching is configured\./);

    const uncachedRustWorkflow = `
name: Uncached Rust CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release
`;
    const uncachedRustResult = await analyze(uncachedRustWorkflow);
    assert.match(uncachedRustResult, /\[WARN\] \[caching\] Dependency installation detected but no caching is configured\./);

    const goWorkflow = `
name: Go CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
`;
    const goResult = await analyze(goWorkflow);
    assert.match(goResult, /\[OK\] \[caching\] Dependency caching is configured\./);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('analyze_workflow_config recognizes flow-style setup-node caching', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: {cache: npm}
      - run: npm ci
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[OK\] \[caching\] Dependency caching is configured\./);
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config detects pip3 dependency installs', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: Python CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pip3 install -r requirements.txt
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /Dependency installation detected but no caching is configured\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a Cargo command prefix for installation', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: cargo test-package
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /No matrix strategy detected\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not accept unsupported setup cache values', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          cache: npm-invalid
      - run: npm ci
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[WARN\] \[caching\] Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /\[OK\] \[caching\] Dependency caching is configured\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config recognizes npm shell delimiters without matching subcommands', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    for (const command of ['npm install; echo done', 'npm install&&npm test', 'npm ci|npm test']) {
      const result = await client.callTool({
        name: 'analyze_workflow_config',
        arguments: {
          workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ${command}
`,
        },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      assert.match(text, /Dependency installation detected but no caching is configured\./, command);
      assert.match(text, /No matrix strategy detected\./, command);
    }

    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm install-package
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /No matrix strategy detected\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a pip command prefix for installation', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pip install-package
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /No matrix strategy detected\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a Maven command prefix for installation', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: mvn install-package
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /No matrix strategy detected\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a yarn version check for installation', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: yarn --version
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a Yarn help command for installation', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: yarn --help
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /Dependency installation detected but no caching is configured\./);
    assert.doesNotMatch(text, /No matrix strategy detected\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config recognizes yarn install flags', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    for (const command of ['yarn --frozen-lockfile', 'yarn --immutable', 'yarn --offline']) {
      const result = await client.callTool({
        name: 'analyze_workflow_config',
        arguments: {
          workflow_content: `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ${command}
`,
        },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      assert.match(text, /Dependency installation detected but no caching is configured\./, command);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config recognizes job-level concurrency configurations', async () => {
  const app = createHttpApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  const analyze = async (workflowContent: string) => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'analyze_workflow_config',
          arguments: {
            workflow_content: workflowContent,
          },
        },
      }),
    });
    const data = await res.json();
    return data.result.content[0].text as string;
  };

  try {
    const jobConcurrencyWorkflow = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    concurrency:
      group: ci-\${{ github.ref }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v4
`;
    const result = await analyze(jobConcurrencyWorkflow);
    assert.match(result, /\[OK\] \[concurrency\] Concurrency with cancel-in-progress: true is configured\./);
    assert.doesNotMatch(result, /No concurrency group is configured\./);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('analyze_workflow_config detects quoted ubuntu-latest runners', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: [push]
jobs:
  build:
    runs-on: 'ubuntu-latest'
    steps: []
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[INFO\] \[runner\] Using ubuntu-latest which is a floating label\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config recognizes quoted full checkout depth', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: '0'
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[INFO\] \[checkout\] Full git history is being fetched \(fetch-depth: 0\)\./);
    assert.doesNotMatch(text, /Shallow clone \(default fetch-depth: 1\) is used/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config recognizes flow-style checkout depth', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with: {fetch-depth: "0"}
      - uses: actions/checkout@v4
        with: {fetch-depth: 0}
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[INFO\] \[checkout\] Full git history is being fetched \(fetch-depth: 0\)\./);
    assert.doesNotMatch(text, /Shallow clone \(default fetch-depth: 1\) is used/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config keeps quoted ubuntu-latest warnings with mixed runner labels', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: [push]
jobs:
  latest:
    runs-on: 'ubuntu-latest'
    steps: []
  pinned:
    runs-on: 'ubuntu-24.04'
    steps: []
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.match(text, /\[INFO\] \[runner\] Using ubuntu-latest which is a floating label\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config does not mistake a custom runner label for ubuntu-latest', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest-custom
    steps: []
`,
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.doesNotMatch(text, /\[INFO\] \[runner\] Using ubuntu-latest which is a floating label\./);
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config rejects text where runs-on is mistaken for the on key', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: `
name: Not a workflow
runs-on: ubuntu-latest
steps: []
`,
      },
    });
    assert.equal(result.isError, true);
    assert.match(
      (result.content as Array<{ type: string; text: string }>)[0].text,
      /does not appear to be a GitHub Actions workflow/
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test('analyze_workflow_config accepts workflows with a UTF-8 BOM', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'analyze_workflow_config',
      arguments: {
        workflow_content: '\uFEFFon: push\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps: []\n',
      },
    });

    assert.equal(result.isError, undefined);
    assert.match(
      (result.content as Array<{ type: string; text: string }>)[0].text,
      /Push trigger has no paths filter\./
    );
  } finally {
    await client.close();
    await server.close();
  }
});



