import DB from '../../database';
import config from '../../config';
import logger from '../../logger';
import runStore, { AdminRunConflict } from './admin-adapter.runs';
import { adminTimestamp } from './admin-adapter.identity';
import { deploymentControlClient as controlClient, DEPLOYMENT_CONTROL_LIMITS } from './deployment-control.client';

const DEPLOYMENT_OPERATIONS = new Set(['explorer.service.restart', 'explorer.release.rollback']);

/**
 * Finishes the deployment runs the previous process could not.
 *
 * A restart or rollback replaces the very backend that is driving it. The
 * run already names the adapter job before the wait starts, so the process
 * that comes up afterwards can read that job back and close the run with
 * the same evidence the original executor would have written. Without this
 * the run would sit RUNNING until the reconciler marked it abandoned, which
 * would make every successful restart read as an unknown outcome.
 *
 * Only runs of the two deployment operations that are RUNNING and carry a
 * job id are touched; anything else belongs to the reconciler.
 * @asyncUnsafe Startup work: a failure is logged and the runs stay for the reconciler.
 */
export async function resumeDeploymentRuns(): Promise<{ resumed: number; skipped: number }> {
  if (!config.DATABASE.ENABLED) { return { resumed: 0, skipped: 0 }; }
  const [rows]: any[] = await DB.query(
    "SELECT run_id, operation_id, document FROM admin_adapter_runs WHERE state = 'RUNNING' AND operation_id IN ('explorer.service.restart', 'explorer.release.rollback') ORDER BY started_at ASC LIMIT 20",
  );
  let resumed = 0;
  let skipped = 0;
  for (const row of rows) {
    let document: any = {};
    try { document = typeof row.document === 'string' ? JSON.parse(row.document) : (row.document ?? {}); } catch { document = {}; }
    const jobId = document?.result?.jobId;
    if (!DEPLOYMENT_OPERATIONS.has(row.operation_id) || typeof jobId !== 'string' || !jobId) { skipped += 1; continue; }
    try {
      const { job, timedOut } = await controlClient.waitForJob(jobId, DEPLOYMENT_CONTROL_LIMITS.pollIntervalMs * 10);
      const expectedRelease = document.result?.requestedRelease ?? document.result?.releaseBefore ?? null;
      const verified = !timedOut && job.state === 'succeeded' && job.releaseAfter !== null && (expectedRelease === null || job.releaseAfter === expectedRelease);
      const result = { ...document.result, jobState: job.state, releaseAfter: job.releaseAfter, expectedRelease, jobStartedAt: job.startedAt, jobFinishedAt: job.finishedAt, jobError: job.error, resumedAfterRestart: true };
      const evidence = [
        `Resumed by the replacement process after the restart cut the original executor short.`,
        `Adapter job ${job.jobId} (${job.operation}) is ${job.state}.`,
        `Release before: ${document.result?.releaseBefore ?? 'unknown'}; after: ${job.releaseAfter ?? 'unknown'}; expected: ${expectedRelease ?? 'unknown'}.`,
        ...job.evidence.map((line: string) => 'Adapter: ' + line),
      ];
      // The executor path goes RUNNING -> VERIFYING -> terminal; the contract
      // allows no direct jump from RUNNING to SUCCEEDED.
      await runStore.transition(row.run_id, 'VERIFYING', { progressPercent: 90 });
      if (timedOut) {
        await runStore.transition(row.run_id, 'NEEDS_REVIEW', { progressPercent: 100, result, verification: { verified: false, evidence: [...evidence, 'The adapter job had not reached a terminal state when the replacement process looked it up.'] }, logs: [{ at: adminTimestamp(), level: 'warn', message: `Adapter job ${jobId} still ${job.state} after the restart.` }] });
      } else if (job.state === 'failed') {
        await runStore.transition(row.run_id, 'FAILED', { result, error: { class: 'operation_failed', message: (job.error ?? 'The adapter reported the job failed.').slice(0, 700), retryable: true }, logs: [{ at: adminTimestamp(), level: 'error', message: `Adapter job ${jobId} failed: ${job.error ?? 'no reason given'}` }] });
      } else {
        await runStore.transition(row.run_id, verified ? 'SUCCEEDED' : 'NEEDS_REVIEW', { progressPercent: 100, result, verification: { verified, evidence }, logs: [{ at: adminTimestamp(), level: verified ? 'info' : 'warn', message: verified ? `Release ${job.releaseAfter} is serving after the adapter's health-checked cutover (resumed after restart).` : `The adapter job succeeded but the serving release ${job.releaseAfter ?? 'unknown'} does not match the expected ${expectedRelease ?? 'unknown'}.` }] });
      }
      resumed += 1;
    } catch (e) {
      if (e instanceof AdminRunConflict) { skipped += 1; continue; }
      logger.warn(`[admin-adapter] could not resume deployment run ${row.run_id}: ` + (e instanceof Error ? e.message : String(e)));
      skipped += 1;
    }
  }
  if (resumed || skipped) {
    logger.info(`[admin-adapter] deployment runs resumed after restart: ${resumed} closed, ${skipped} left for the reconciler.`);
  }
  return { resumed, skipped };
}
