import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtSeconds, durationSeconds, percentile, avg, computeRunTiming } from './index.js';

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
