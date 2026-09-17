import { resumeDeploymentRuns } from '../api/admin-adapter/deployment-control.resume';

const queries: unknown[][] = [];
const transitions: Array<{ runId: string; state: string; patch: any }> = [];
const jobs = new Map<string, any>();

jest.mock('../config', () => { const actual = jest.requireActual('../config').default; return { __esModule: true, default: { ...actual, DATABASE: { ...actual.DATABASE, ENABLED: true } } }; });
jest.mock('../logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), err: jest.fn(), debug: jest.fn() } }));
jest.mock('../database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push([sql, params]);
      return [Array.from(jobs.values()).filter(j => j.row).map(j => j.row)];
    }),
  },
}));
jest.mock('../api/admin-adapter/admin-adapter.runs', () => ({
  __esModule: true,
  AdminRunConflict: class AdminRunConflict extends Error {},
  default: { transition: jest.fn(async (runId: string, state: string, patch: any) => { transitions.push({ runId, state, patch }); return { runId, state }; }) },
}));
jest.mock('../api/admin-adapter/deployment-control.client', () => ({
  __esModule: true,
  DEPLOYMENT_CONTROL_LIMITS: { pollIntervalMs: 1 },
  deploymentControlClient: {
    waitForJob: jest.fn(async (jobId: string) => jobs.get(jobId)?.answer),
  },
}));

function seed(runId: string, operationId: string, jobId: string, result: any, answer: any): void {
  jobs.set(jobId, { row: { run_id: runId, operation_id: operationId, document: JSON.stringify({ result: { jobId, ...result } }) }, answer });
}

describe('deployment runs interrupted by their own restart', () => {
  beforeEach(() => { queries.length = 0; transitions.length = 0; jobs.clear(); });

  it('closes a succeeded restart as SUCCEEDED with the adapter readback', async () => {
    seed('run-1', 'explorer.service.restart', 'job-1', { releaseBefore: 'abc1234', requestedRelease: null },
      { job: { jobId: 'job-1', operation: 'restart', state: 'succeeded', releaseAfter: 'abc1234', evidence: ['verify_live ok'], startedAt: 't0', finishedAt: 't1', error: null }, timedOut: false });
    const outcome = await resumeDeploymentRuns();
    expect(outcome).toEqual({ resumed: 1, skipped: 0 });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ runId: 'run-1', state: 'SUCCEEDED' });
    expect(transitions[0].patch.verification.verified).toBe(true);
    expect(transitions[0].patch.result.resumedAfterRestart).toBe(true);
  });

  it('a rollback whose serving release differs from the journal target needs review', async () => {
    seed('run-2', 'explorer.release.rollback', 'job-2', { releaseBefore: 'abc1234', requestedRelease: 'def5678' },
      { job: { jobId: 'job-2', operation: 'rollback', state: 'succeeded', releaseAfter: 'abc1234', evidence: [], startedAt: 't0', finishedAt: 't1', error: null }, timedOut: false });
    await resumeDeploymentRuns();
    expect(transitions[0]).toMatchObject({ runId: 'run-2', state: 'NEEDS_REVIEW' });
    expect(transitions[0].patch.verification.verified).toBe(false);
  });

  it('a failed adapter job fails the run and a still-running job is left for review, never marked done', async () => {
    seed('run-3', 'explorer.service.restart', 'job-3', { releaseBefore: 'abc1234' },
      { job: { jobId: 'job-3', operation: 'restart', state: 'failed', releaseAfter: null, evidence: [], startedAt: 't0', finishedAt: 't1', error: 'cutover gate failed' }, timedOut: false });
    seed('run-4', 'explorer.service.restart', 'job-4', { releaseBefore: 'abc1234' },
      { job: { jobId: 'job-4', operation: 'restart', state: 'running', releaseAfter: null, evidence: [], startedAt: 't0', finishedAt: null, error: null }, timedOut: true });
    await resumeDeploymentRuns();
    const byRun = Object.fromEntries(transitions.map(t => [t.runId, t]));
    expect(byRun['run-3'].state).toBe('FAILED');
    expect(byRun['run-4'].state).toBe('NEEDS_REVIEW');
    expect(byRun['run-4'].patch.verification.verified).toBe(false);
  });

  it('runs without a recorded job id are left to the reconciler', async () => {
    jobs.set('none', { row: { run_id: 'run-5', operation_id: 'explorer.service.restart', document: JSON.stringify({ result: {} }) }, answer: null });
    expect(await resumeDeploymentRuns()).toEqual({ resumed: 0, skipped: 1 });
    expect(transitions).toHaveLength(0);
  });
});
