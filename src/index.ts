#!/usr/bin/env node

import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function githubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }
  return token;
}

async function githubFetch<T>(path: string, retries = 3): Promise<T> {
  const token = githubToken();
  const url = `https://api.github.com${path}`;

  let lastError: Error | null = null;
  let delay = 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `gha-intel-mcp/${VERSION}`,
      },
    });

    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining !== null) {
      process.stderr.write(`GitHub rate limit remaining: ${remaining}\n`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, waitMs));
        delay *= 2;
        continue;
      }
      const body = await res.text().catch(() => '');
      lastError = new Error(`GitHub API error 429 (rate limited) for ${url}: ${body}`);
      break;
    }

    if (res.status >= 500 && attempt < retries) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status} for ${url}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  throw lastError ?? new Error(`GitHub API request failed for ${url}`);
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 10
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Type definitions matching GitHub API responses
// ---------------------------------------------------------------------------

interface WorkflowRunsResponse {
  total_count: number;
  workflow_runs: WorkflowRun[];
}

interface WorkflowRun {
  id: number;
  name: string | null;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  run_number: number;
  html_url: string;
}

interface JobsResponse {
  total_count: number;
  jobs: Job[];
}

interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: Step[];
}

interface Step {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

interface CacheUsageResponse {
  full_name: string;
  active_caches_size_in_bytes: number;
  active_caches_count: number;
}

// ---------------------------------------------------------------------------
// Utility: duration helpers
// ---------------------------------------------------------------------------

export function durationSeconds(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 0;
  return Math.max(0, (endTime - startTime) / 1000);
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function fmtSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`;
  const totalSec = Math.round(s);
  const m = Math.floor(totalSec / 60);
  const rem = String(totalSec % 60).padStart(2, '0');
  return `${m}m ${rem}s`;
}

// Compute wall-clock seconds and billable seconds from a list of jobs.
// Wall-clock: earliest job start → latest job completion (parallel-aware).
// Billable:   sum of all individual job durations (what GitHub charges).
export function computeRunTiming(jobs: Job[]): { wall_clock_seconds: number; billable_seconds: number } {
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  let billable = 0;

  for (const job of jobs) {
    if (job.started_at && job.completed_at) {
      const start = new Date(job.started_at).getTime();
      const end = new Date(job.completed_at).getTime();
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        if (earliestStart === null || start < earliestStart) earliestStart = start;
        if (latestEnd === null || end > latestEnd) latestEnd = end;
        billable += Math.max(0, (end - start) / 1000);
      }
    }
  }

  const wallClock =
    earliestStart !== null && latestEnd !== null
      ? Math.max(0, (latestEnd - earliestStart) / 1000)
      : 0;

  return { wall_clock_seconds: wallClock, billable_seconds: billable };
}

// ---------------------------------------------------------------------------
// Input validation schema helpers
// ---------------------------------------------------------------------------

const ownerSchema = z
  .string()
  .regex(/^[a-zA-Z0-9._-]+$/, 'owner must contain only alphanumeric characters, dots, hyphens, or underscores')
  .describe('GitHub repository owner (user or org)');

const repoSchema = z
  .string()
  .regex(/^[a-zA-Z0-9._-]+$/, 'repo must contain only alphanumeric characters, dots, hyphens, or underscores')
  .describe('GitHub repository name');

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'gha-intel-mcp', version: VERSION });

// ---------------------------------------------------------------------------
// Tool 1: list_workflow_performance
// ---------------------------------------------------------------------------

server.registerTool(
  'list_workflow_performance',
  {
    title: 'List Workflow Performance',
    description:
      'Fetch the last N workflow runs and compute job-level timing statistics ' +
      '(avg, min, max, p95) across those runs. Useful for identifying slow jobs and trends.',
    inputSchema: z.object({
      owner: ownerSchema,
      repo: repoSchema,
      workflow_id: z
        .string()
        .describe('Workflow file name (e.g. ci.yml) or numeric workflow ID'),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Number of recent runs to analyse (default: 10, max: 100)'),
    }),
  },
  async ({ owner, repo, workflow_id, count = 10 }) => {
    try {
      const runsData = await githubFetch<WorkflowRunsResponse>(
        `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow_id)}/runs?per_page=${count}&status=completed`
      );

      const runs = runsData.workflow_runs.slice(0, count);

      if (runs.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No completed runs found for workflow "${workflow_id}" in ${owner}/${repo}.`,
            },
          ],
        };
      }

      // Collect per-job durations keyed by job name
      const jobDurations: Record<string, number[]> = {};
      const stepDurations: Record<string, Record<string, number[]>> = {};
      const runSummaries: Array<{
        run_number: number;
        conclusion: string | null;
        started_at: string | null;
        wall_clock_seconds: number;
        billable_seconds: number;
      }> = [];

      const jobsPerRun = await parallelMap(runs, (run) =>
        githubFetch<JobsResponse>(
          `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`
        )
      );

      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const jobsData = jobsPerRun[i];
        const { wall_clock_seconds, billable_seconds } = computeRunTiming(jobsData.jobs);

        for (const job of jobsData.jobs) {
          // Jobs that were skipped never executed and carry no timestamps.
          // durationSeconds would return 0 for them, injecting bogus samples
          // that drag down the average, force min to 0s, and overcount runs.
          if (!job.started_at || !job.completed_at) continue;

          const dur = durationSeconds(job.started_at, job.completed_at);

          if (!jobDurations[job.name]) jobDurations[job.name] = [];
          jobDurations[job.name].push(dur);

          if (!stepDurations[job.name]) stepDurations[job.name] = {};
          for (const step of job.steps) {
            if (!step.started_at || !step.completed_at) continue;
            const sDur = durationSeconds(step.started_at, step.completed_at);
            if (!stepDurations[job.name][step.name]) stepDurations[job.name][step.name] = [];
            stepDurations[job.name][step.name].push(sDur);
          }
        }

        runSummaries.push({
          run_number: run.run_number,
          conclusion: run.conclusion,
          started_at: run.run_started_at,
          wall_clock_seconds,
          billable_seconds,
        });
      }

      // Build job stats
      const jobStats = Object.entries(jobDurations).map(([name, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b);
        return {
          job: name,
          runs_analysed: durations.length,
          avg: fmtSeconds(avg(durations)),
          min: fmtSeconds(sorted[0]),
          max: fmtSeconds(sorted[sorted.length - 1]),
          p95: fmtSeconds(percentile(sorted, 95)),
          raw_avg_seconds: parseFloat(avg(durations).toFixed(1)),
        };
      });

      // Sort by avg descending (slowest first)
      jobStats.sort((a, b) => b.raw_avg_seconds - a.raw_avg_seconds);

      // Build step stats for top jobs
      const topJobNames = jobStats.slice(0, 5).map((j) => j.job);
      const topStepStats: Record<
        string,
        Array<{ step: string; avg: string; p95: string; raw_avg_seconds: number }>
      > = {};
      for (const jobName of topJobNames) {
        if (!stepDurations[jobName]) continue;
        const steps = Object.entries(stepDurations[jobName]).map(([stepName, durations]) => {
          const sorted = [...durations].sort((a, b) => a - b);
          return {
            step: stepName,
            avg: fmtSeconds(avg(durations)),
            p95: fmtSeconds(percentile(sorted, 95)),
            raw_avg_seconds: parseFloat(avg(durations).toFixed(1)),
          };
        });
        steps.sort((a, b) => b.raw_avg_seconds - a.raw_avg_seconds);
        topStepStats[jobName] = steps.slice(0, 10);
      }

      const wallClockValues = runSummaries.map((r) => r.wall_clock_seconds).sort((a, b) => a - b);
      const billableValues = runSummaries.map((r) => r.billable_seconds).sort((a, b) => a - b);

      const report: Record<string, unknown> = {
        workflow: workflow_id,
        repository: `${owner}/${repo}`,
        runs_analysed: runs.length,
        overall_timing: {
          avg_wall_clock: fmtSeconds(avg(wallClockValues)),
          min_wall_clock: fmtSeconds(wallClockValues[0] ?? 0),
          max_wall_clock: fmtSeconds(wallClockValues[wallClockValues.length - 1] ?? 0),
          p95_wall_clock: fmtSeconds(percentile(wallClockValues, 95)),
          avg_billable: fmtSeconds(avg(billableValues)),
          p95_billable: fmtSeconds(percentile(billableValues, 95)),
        },
        job_stats: jobStats.map(({ raw_avg_seconds: _, ...rest }) => rest),
        top_job_step_breakdown: topStepStats,
        recent_runs: runSummaries.slice(0, 10),
      };

      const ot = report.overall_timing as Record<string, string>;
      const lines: string[] = [
        `Workflow Performance: ${workflow_id} (${owner}/${repo})`,
        `Runs analysed: ${runs.length}`,
        '',
        'Overall run timing (wall-clock = parallel-aware; billable = sum of all jobs):',
        `  wall-clock  avg: ${ot['avg_wall_clock']}  min: ${ot['min_wall_clock']}  max: ${ot['max_wall_clock']}  p95: ${ot['p95_wall_clock']}`,
        `  billable    avg: ${ot['avg_billable']}  p95: ${ot['p95_billable']}`,
        '',
        'Job breakdown (slowest first):',
        ...jobStats.map(
          (j) =>
            `  ${j.job.padEnd(40)} avg: ${j.avg.padEnd(10)} min: ${j.min.padEnd(10)} max: ${j.max.padEnd(10)} p95: ${j.p95}`
        ),
      ];

      for (const [jobName, steps] of Object.entries(topStepStats)) {
        lines.push('', `  Top steps in "${jobName}":`);
        for (const s of steps) {
          lines.push(`    ${s.step.padEnd(50)} avg: ${s.avg.padEnd(10)} p95: ${s.p95}`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 2: analyze_workflow_config
// ---------------------------------------------------------------------------

interface Finding {
  severity: 'good' | 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  recommendation?: string;
}

server.registerTool(
  'analyze_workflow_config',
  {
    title: 'Analyze Workflow Config',
    description:
      'Parse a GitHub Actions workflow YAML (provided as a string) and identify ' +
      'optimization opportunities: missing caches, matrix strategy, concurrency controls, ' +
      'slow dependency installs, artifact handling, and more.',
    inputSchema: z.object({
      workflow_content: z
        .string()
        .describe('Full YAML content of the GitHub Actions workflow file'),
    }),
  },
  async ({ workflow_content }) => {
    try {
      const content = workflow_content;

      // Validate that the input looks like a GHA workflow
      if (!/\bon:/i.test(content) && !/\bjobs:/i.test(content)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: the provided content does not appear to be a GitHub Actions workflow. Expected "on:" or "jobs:" keys.',
            },
          ],
          isError: true,
        };
      }

      const findings: Finding[] = [];
      const lines = content.split('\n');

      // Helper: count occurrences
      const occurrences = (pattern: RegExp) => (content.match(pattern) ?? []).length;
      const hasPattern = (pattern: RegExp) => pattern.test(content);

      // --- Caching ---
      const hasActionsCache = hasPattern(/actions\/cache/);
      const hasSetupNodeCache = hasPattern(/cache:\s*['"]?npm|cache:\s*['"]?yarn|cache:\s*['"]?pnpm/);
      const hasSetupPythonCache = hasPattern(/cache:\s*['"]?pip/);
      const hasCaching = hasActionsCache || hasSetupNodeCache || hasSetupPythonCache;

      const hasNpmInstall = hasPattern(/npm\s+(?:ci|install)/);
      const hasYarnInstall =
        hasPattern(/yarn\s+install\b/) || hasPattern(/\byarn\b(?!\s+\w)/);
      const hasPipInstall = hasPattern(/pip\s+install/);
      const hasCargoFetch = hasPattern(/cargo\s+(?:build|test|fetch)/);
      const hasMavenInstall = hasPattern(/mvn\s+(?:install|package|test)/);
      const hasDependencyInstall =
        hasNpmInstall || hasYarnInstall || hasPipInstall || hasCargoFetch || hasMavenInstall;

      if (hasDependencyInstall && !hasCaching) {
        findings.push({
          severity: 'warning',
          category: 'caching',
          message: 'Dependency installation detected but no caching is configured.',
          recommendation:
            'Add actions/cache or use the built-in cache option on setup-node/setup-python/setup-java to avoid re-downloading dependencies on every run. This is typically the single largest time saving.',
        });
      } else if (hasCaching) {
        findings.push({
          severity: 'good',
          category: 'caching',
          message: 'Dependency caching is configured.',
        });
      }

      // --- Matrix strategy ---
      const hasMatrix = hasPattern(/strategy:\s*\n\s+matrix:/m) || hasPattern(/matrix:/);
      if (hasMatrix) {
        findings.push({
          severity: 'good',
          category: 'parallelism',
          message: 'Matrix strategy is in use (builds run in parallel across matrix dimensions).',
        });

        const hasFailFast = hasPattern(/fail-fast:\s*false/);
        if (!hasFailFast) {
          findings.push({
            severity: 'info',
            category: 'parallelism',
            message: 'Matrix fail-fast is not set to false.',
            recommendation:
              'Consider setting "fail-fast: false" under strategy if you want all matrix jobs to complete even when one fails, which gives full test coverage across all dimensions.',
          });
        }

        const hasMaxParallel = hasPattern(/max-parallel:/);
        if (!hasMaxParallel) {
          findings.push({
            severity: 'info',
            category: 'parallelism',
            message: 'No max-parallel limit is set on the matrix.',
            recommendation:
              'If your matrix is large, consider setting max-parallel to avoid saturating GitHub-hosted runners and incurring queue wait time.',
          });
        }
      } else if (!hasMatrix && (hasNpmInstall || hasPipInstall)) {
        findings.push({
          severity: 'info',
          category: 'parallelism',
          message: 'No matrix strategy detected.',
          recommendation:
            'If you test against multiple Node/Python/OS versions, a matrix strategy enables parallel execution rather than sequential runs.',
        });
      }

      // --- Concurrency ---
      const hasConcurrency = hasPattern(/^concurrency:/m);
      if (!hasConcurrency) {
        findings.push({
          severity: 'warning',
          category: 'concurrency',
          message: 'No concurrency group is configured.',
          recommendation:
            'Add a concurrency block to cancel in-progress runs on the same branch/PR when a new commit is pushed. This prevents wasting runner minutes on stale builds:\n\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true',
        });
      } else {
        const hasCancelInProgress = hasPattern(/cancel-in-progress:\s*true/);
        if (!hasCancelInProgress) {
          findings.push({
            severity: 'info',
            category: 'concurrency',
            message: 'Concurrency group configured but cancel-in-progress is not true.',
            recommendation:
              'Set cancel-in-progress: true to abort superseded runs and free up runner capacity immediately.',
          });
        } else {
          findings.push({
            severity: 'good',
            category: 'concurrency',
            message: 'Concurrency with cancel-in-progress: true is configured.',
          });
        }
      }

      // --- Artifact uploads ---
      const artifactUploadCount = occurrences(/actions\/upload-artifact/g);
      const artifactDownloadCount = occurrences(/actions\/download-artifact/g);
      if (artifactUploadCount > 3) {
        findings.push({
          severity: 'info',
          category: 'artifacts',
          message: `${artifactUploadCount} artifact upload steps detected.`,
          recommendation:
            'Uploading many artifacts adds time and storage cost. Consider combining outputs into a single archive, or skip uploading on non-default-branch runs.',
        });
      } else if (artifactUploadCount > 0) {
        findings.push({
          severity: 'good',
          category: 'artifacts',
          message: `${artifactUploadCount} artifact upload(s) and ${artifactDownloadCount} download(s) found (artifacts are being used to pass data between jobs).`,
        });
      }

      // --- Checkout depth ---
      const hasShallowClone = hasPattern(/fetch-depth:\s*[1-9]\d*/);
      const hasFullClone = hasPattern(/fetch-depth:\s*0/);
      if (hasFullClone) {
        findings.push({
          severity: 'info',
          category: 'checkout',
          message: 'Full git history is being fetched (fetch-depth: 0).',
          recommendation:
            'Full history is expensive on large repos. Only use it when git history is needed (e.g. semantic-release, conventional commits). Default (fetch-depth: 1) is faster.',
        });
      } else if (!hasShallowClone) {
        findings.push({
          severity: 'good',
          category: 'checkout',
          message: 'Shallow clone (default fetch-depth: 1) is used, minimising checkout time.',
        });
      } else {
        findings.push({
          severity: 'good',
          category: 'checkout',
          message: `Explicit fetch-depth is set, controlling clone depth.`,
        });
      }

      // --- Timeout ---
      const hasJobTimeout = hasPattern(/timeout-minutes:/);
      if (!hasJobTimeout) {
        findings.push({
          severity: 'warning',
          category: 'reliability',
          message: 'No timeout-minutes is set on any job.',
          recommendation:
            'Without a timeout, a hanging job consumes runner minutes until the 6-hour GitHub limit. Set timeout-minutes on jobs to fail fast and free resources:\n\ntimeout-minutes: 15',
        });
      } else {
        findings.push({
          severity: 'good',
          category: 'reliability',
          message: 'timeout-minutes is configured on at least one job.',
        });
      }

      // --- Runner type ---
      const hasUbuntuLatest = hasPattern(/runs-on:\s*ubuntu-latest/);
      const hasUbuntuVersioned = hasPattern(/runs-on:\s*ubuntu-2\d/);
      if (hasUbuntuLatest && !hasUbuntuVersioned) {
        findings.push({
          severity: 'info',
          category: 'runner',
          message: 'Using ubuntu-latest which is a floating label.',
          recommendation:
            'Pin to a specific runner version (e.g. ubuntu-24.04) for reproducible builds. ubuntu-latest can change without notice, potentially breaking your workflow.',
        });
      }

      // --- Self-hosted runners ---
      const hasSelfHosted = hasPattern(/runs-on:.*self-hosted/);
      if (hasSelfHosted) {
        findings.push({
          severity: 'info',
          category: 'runner',
          message: 'Self-hosted runners are in use.',
          recommendation:
            'Ensure self-hosted runners have adequate caching in place (e.g. local Docker layer cache, pre-warmed dependency directories) to maximise the speed advantage over GitHub-hosted runners.',
        });
      }

      // --- Workflow triggers ---
      const hasPushTrigger = hasPattern(/^on:\s*\n\s+push:/m) || hasPattern(/^on:\s+push/m);
      const hasPullRequestTrigger = hasPattern(/pull_request:/);
      const hasPathFilter = hasPattern(/paths:/);
      const hasPathIgnore = hasPattern(/paths-ignore:/);

      if (hasPushTrigger && !hasPathFilter && !hasPathIgnore) {
        findings.push({
          severity: 'info',
          category: 'triggers',
          message: 'Push trigger has no paths filter.',
          recommendation:
            'Adding a paths filter (e.g. paths: ["src/**", "package.json"]) prevents the workflow from running on documentation-only or unrelated changes, saving runner minutes.',
        });
      }

      if (hasPushTrigger && hasPullRequestTrigger) {
        findings.push({
          severity: 'info',
          category: 'triggers',
          message: 'Workflow triggers on both push and pull_request events.',
          recommendation:
            'This can cause duplicate runs on PRs. Consider triggering only on pull_request for feature branches and push for main/release branches, or use branch filters to separate concerns.',
        });
      }

      // --- Environment variable repetition ---
      const envLineCount = lines.filter((l) => l.trim().startsWith('env:')).length;
      if (envLineCount > 3) {
        findings.push({
          severity: 'info',
          category: 'maintainability',
          message: `${envLineCount} separate "env:" blocks detected.`,
          recommendation:
            'Consider consolidating repeated environment variables into a single top-level "env:" block or using workflow-level env to reduce duplication.',
        });
      }

      // --- Docker layer caching ---
      const hasDockerBuild = hasPattern(/docker\s+build/i) || hasPattern(/docker\/build-push-action/);
      const hasDockerCache = hasPattern(/cache-from:/) || hasPattern(/type=gha/);
      if (hasDockerBuild && !hasDockerCache) {
        findings.push({
          severity: 'warning',
          category: 'docker',
          message: 'Docker build detected but no layer caching is configured.',
          recommendation:
            'Use GitHub Actions cache for Docker layers:\n\n- name: Set up Docker Buildx\n  uses: docker/setup-buildx-action@v3\n\n- name: Build\n  uses: docker/build-push-action@v5\n  with:\n    cache-from: type=gha\n    cache-to: type=gha,mode=max',
        });
      } else if (hasDockerBuild && hasDockerCache) {
        findings.push({
          severity: 'good',
          category: 'docker',
          message: 'Docker layer caching is configured.',
        });
      }

      // --- Summary ---
      const bySeverity = {
        good: findings.filter((f) => f.severity === 'good').length,
        info: findings.filter((f) => f.severity === 'info').length,
        warning: findings.filter((f) => f.severity === 'warning').length,
        critical: findings.filter((f) => f.severity === 'critical').length,
      };

      const lines_out: string[] = [
        'Workflow Configuration Analysis',
        `Findings: ${bySeverity.good} good  |  ${bySeverity.info} info  |  ${bySeverity.warning} warnings  |  ${bySeverity.critical} critical`,
        '',
      ];

      for (const severity of ['critical', 'warning', 'info', 'good'] as const) {
        const group = findings.filter((f) => f.severity === severity);
        if (group.length === 0) continue;
        const icon =
          severity === 'good'
            ? '[OK]'
            : severity === 'info'
              ? '[INFO]'
              : severity === 'warning'
                ? '[WARN]'
                : '[CRIT]';
        for (const f of group) {
          lines_out.push(`${icon} [${f.category}] ${f.message}`);
          if (f.recommendation) {
            for (const rline of f.recommendation.split('\n')) {
              lines_out.push(`     ${rline}`);
            }
            lines_out.push('');
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines_out.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 3: get_billing_usage
// ---------------------------------------------------------------------------

server.registerTool(
  'get_billing_usage',
  {
    title: 'Get Billing Usage',
    description:
      'Retrieve GitHub Actions billing and cache usage statistics for an owner ' +
      '(user or org), optionally scoped to a specific repository.',
    inputSchema: z.object({
      owner: z.string().describe('GitHub username or organisation name'),
      repo: z
        .string()
        .optional()
        .describe(
          'Optional repository name to scope usage. When provided, returns repo-level cache stats and recent run timing.'
        ),
    }),
  },
  async ({ owner, repo }) => {
    try {
      interface BillingResponse {
        total_minutes_used: number;
        total_paid_minutes_used: number;
        included_minutes: number;
        minutes_used_breakdown: {
          UBUNTU?: number;
          MACOS?: number;
          WINDOWS?: number;
          ubuntu_4_core?: number;
          ubuntu_8_core?: number;
          ubuntu_16_core?: number;
          ubuntu_32_core?: number;
          ubuntu_64_core?: number;
          macos_12_core?: number;
          windows_8_core?: number;
          windows_16_core?: number;
          windows_32_core?: number;
        };
      }

      // Per-runner-type cost multipliers (GitHub pricing as of 2024)
      const costMultipliers: Record<string, number> = {
        UBUNTU: 0.008,
        MACOS: 0.08,
        WINDOWS: 0.016,
        ubuntu_4_core: 0.016,
        ubuntu_8_core: 0.032,
        ubuntu_16_core: 0.064,
        ubuntu_32_core: 0.128,
        ubuntu_64_core: 0.256,
        macos_12_core: 0.12,
        windows_8_core: 0.032,
        windows_16_core: 0.064,
        windows_32_core: 0.128,
      };

      const resultSections: string[] = [];
      const structuredResult: Record<string, unknown> = { owner };

      // --- Billing (org or user) ---
      let billing: BillingResponse | null = null;
      try {
        // Try org billing first, then user billing
        try {
          billing = await githubFetch<BillingResponse>(`/orgs/${owner}/settings/billing/actions`);
        } catch {
          billing = await githubFetch<BillingResponse>(`/users/${owner}/settings/billing/actions`);
        }
      } catch (err) {
        resultSections.push(
          `Billing API: Not accessible (requires admin scope). Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (billing) {
        const breakdown = billing.minutes_used_breakdown ?? {};
        let estimatedCost = 0;
        const breakdownLines: string[] = [];

        for (const [type, minutes] of Object.entries(breakdown)) {
          if (typeof minutes !== 'number' || minutes === 0) continue;
          const rate = costMultipliers[type] ?? 0.008;
          const cost = minutes * rate;
          estimatedCost += cost;
          breakdownLines.push(
            `  ${type.padEnd(20)} ${String(minutes).padStart(8)} min   $${cost.toFixed(2)}`
          );
        }

        const includedMins = billing.included_minutes ?? 0;
        const usedMins = billing.total_minutes_used ?? 0;
        const paidMins = billing.total_paid_minutes_used ?? 0;
        const percentUsed =
          includedMins > 0 ? ((usedMins / includedMins) * 100).toFixed(1) : 'N/A';

        resultSections.push(
          'Actions Billing',
          `  Total minutes used:    ${usedMins} min`,
          `  Included minutes:      ${includedMins} min`,
          `  Paid minutes:          ${paidMins} min`,
          `  Plan utilisation:      ${percentUsed}%`,
          `  Estimated cost:        $${estimatedCost.toFixed(2)}`,
          '',
          'Breakdown by runner type:',
          ...breakdownLines
        );

        structuredResult['billing'] = {
          total_minutes_used: usedMins,
          included_minutes: includedMins,
          total_paid_minutes_used: paidMins,
          plan_utilisation_percent: percentUsed,
          estimated_cost_usd: parseFloat(estimatedCost.toFixed(2)),
          breakdown,
        };
      }

      // --- Cache usage (repo-scoped if repo provided) ---
      if (repo) {
        try {
          const cache = await githubFetch<CacheUsageResponse>(
            `/repos/${owner}/${repo}/actions/cache/usage`
          );

          const sizeGB = (cache.active_caches_size_in_bytes / 1_073_741_824).toFixed(3);
          const sizeMB = (cache.active_caches_size_in_bytes / 1_048_576).toFixed(1);

          resultSections.push(
            '',
            `Cache Usage: ${owner}/${repo}`,
            `  Active caches:         ${cache.active_caches_count}`,
            `  Total cache size:      ${sizeMB} MB (${sizeGB} GB)`,
            `  GitHub cache limit:    10 GB per repo`
          );

          const cacheUsedPct = (
            (cache.active_caches_size_in_bytes / (10 * 1_073_741_824)) *
            100
          ).toFixed(1);
          resultSections.push(`  Cache utilisation:     ${cacheUsedPct}%`);

          if (cache.active_caches_size_in_bytes > 8 * 1_073_741_824) {
            resultSections.push(
              '',
              'WARNING: Cache is above 80% of the 10 GB limit. Old caches will be evicted soon.',
              '  Consider scoping cache keys more precisely or reducing artifact sizes.'
            );
          }

          structuredResult['cache_usage'] = {
            repository: `${owner}/${repo}`,
            active_caches_count: cache.active_caches_count,
            active_caches_size_bytes: cache.active_caches_size_in_bytes,
            active_caches_size_mb: parseFloat(sizeMB),
            cache_utilisation_percent: parseFloat(cacheUsedPct),
          };
        } catch (err) {
          resultSections.push(
            '',
            `Cache usage for ${owner}/${repo}: Not accessible. Error: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // --- Recent run cost estimate for this repo ---
        // Use job-level timestamps to compute accurate wall-clock and billable seconds.
        try {
          const runsData = await githubFetch<WorkflowRunsResponse>(
            `/repos/${owner}/${repo}/actions/runs?per_page=100&status=completed`
          );

          const recentRuns = runsData.workflow_runs.slice(0, 100);

          const jobsPerRun = await parallelMap(recentRuns, (run) =>
            githubFetch<JobsResponse>(
              `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`
            )
          );

          let totalWallClockSeconds = 0;
          let totalBillableSeconds = 0;
          for (const jobsData of jobsPerRun) {
            const { wall_clock_seconds, billable_seconds } = computeRunTiming(jobsData.jobs);
            totalWallClockSeconds += wall_clock_seconds;
            totalBillableSeconds += billable_seconds;
          }

          const wallClockMinutes = totalWallClockSeconds / 60;
          const billableMinutes = totalBillableSeconds / 60;
          const estimatedUbuntuCost = billableMinutes * 0.008;

          resultSections.push(
            '',
            `Recent Run Timing: ${owner}/${repo} (last ${recentRuns.length} completed runs)`,
            `  Total wall-clock time:    ${fmtSeconds(totalWallClockSeconds)} (${wallClockMinutes.toFixed(1)} min)`,
            `  Total billable time:      ${fmtSeconds(totalBillableSeconds)} (${billableMinutes.toFixed(1)} min)`,
            `  Estimated cost (Ubuntu):  $${estimatedUbuntuCost.toFixed(2)}`,
            '',
            'Note: wall-clock is parallel-aware; billable is the sum of all individual job durations.'
          );

          structuredResult['recent_runs_estimate'] = {
            runs_counted: recentRuns.length,
            total_wall_clock_seconds: parseFloat(totalWallClockSeconds.toFixed(1)),
            total_billable_seconds: parseFloat(totalBillableSeconds.toFixed(1)),
            total_wall_clock_minutes: parseFloat(wallClockMinutes.toFixed(1)),
            total_billable_minutes: parseFloat(billableMinutes.toFixed(1)),
            estimated_cost_ubuntu_usd: parseFloat(estimatedUbuntuCost.toFixed(2)),
          };
        } catch {
          // Non-fatal: skip run timing if inaccessible
        }
      } else {
        resultSections.push(
          '',
          'Tip: Provide the "repo" parameter to also see per-repository cache usage and run timing estimates.'
        );
      }

      return {
        content: [{ type: 'text' as const, text: resultSections.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const useHttp = process.argv.includes('--http') || (process.env.TRANSPORT ?? '').toLowerCase() === 'http';

  if (useHttp) {
    const app = express();
    app.use(express.json());
    const port = parseInt(process.env.PORT || '3000', 10);

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', server: 'gha-intel-mcp', version: VERSION });
    });

    app.listen(port, () => {
      process.stderr.write(`gha-intel-mcp v${VERSION} listening on http://0.0.0.0:${port}/mcp\n`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`gha-intel-mcp v${VERSION} running on stdio\n`);
  }
}

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
