import { NextFunction, Request, Response } from 'express';
import { cpus, freemem, loadavg, totalmem } from 'os';
import { promises as fsPromises } from 'fs';
import v8 from 'v8';

/**
 * The numbers an operator asks for first when a page is slow: how long the
 * event loop is blocked, how many requests are failing, how much heap is left,
 * and whether the disk is about to run out.
 *
 * All of it is measured in this process. Nothing is estimated, and a number
 * that could not be read is reported as null rather than as a zero.
 */

const LATENCY_WINDOW = 512;

class RuntimeMetrics {
  private lagMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private latencies: number[] = [];
  private requests = 0;
  private failures = 0;
  private windowStartedAt = Date.now();

  /**
   * Event loop lag, sampled by scheduling a timer and measuring how late it
   * actually fires. A blocked loop is the difference between an explorer that
   * feels instant and one that feels broken, and it is invisible in every
   * other metric here.
   */
  start(intervalMs = 1_000): void {
    if (this.timer) {
      return;
    }
    let expected = Date.now() + intervalMs;
    this.timer = setInterval(() => {
      const now = Date.now();
      this.lagMs = Math.max(0, now - expected);
      expected = now + intervalMs;
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  eventLoopLagMs(): number {
    return this.lagMs;
  }

  record(durationMs: number, failed: boolean): void {
    this.requests += 1;
    if (failed) {
      this.failures += 1;
    }
    this.latencies.push(durationMs);
    if (this.latencies.length > LATENCY_WINDOW) {
      this.latencies.shift();
    }
  }

  /** Percentile over the recent window, or null when nothing was measured. */
  percentileMs(percentile: number): number | null {
    if (this.latencies.length === 0) {
      return null;
    }
    const sorted = [...this.latencies].sort((left, right) => left - right);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
    );
    return Math.round(sorted[index]);
  }

  errorRate(): number | null {
    return this.requests === 0 ? null : Number((this.failures / this.requests).toFixed(4));
  }

  requestCount(): number {
    return this.requests;
  }

  windowSeconds(): number {
    return Math.max(1, Math.round((Date.now() - this.windowStartedAt) / 1_000));
  }

  reset(): void {
    this.latencies = [];
    this.requests = 0;
    this.failures = 0;
    this.windowStartedAt = Date.now();
  }
}

export const runtimeMetrics = new RuntimeMetrics();

/**
 * Times every public API request. Registered before the routes so a route that
 * throws is still counted, which is the case that matters.
 */
export function runtimeMetricsMiddleware() {
  return (request: Request, response: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      runtimeMetrics.record(durationMs, response.statusCode >= 500);
    });
    next();
  };
}

export interface ProcessSnapshot {
  uptimeSeconds: number;
  nodeVersion: string;
  cpuCount: number;
  loadAverage1m: number | null;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  memoryUsedPercent: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  heapUsedPercent: number;
  eventLoopLagMs: number;
  requestsInWindow: number;
  windowSeconds: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  errorRate: number | null;
}

export function processSnapshot(): ProcessSnapshot {
  const heap = v8.getHeapStatistics();
  const memoryTotal = totalmem();
  const memoryFree = freemem();
  const load = loadavg();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    cpuCount: cpus().length,
    // Windows reports a load average of zero, which is not a measurement.
    loadAverage1m: load[0] > 0 ? Number(load[0].toFixed(2)) : null,
    memoryTotalBytes: memoryTotal,
    memoryFreeBytes: memoryFree,
    memoryUsedPercent:
      memoryTotal > 0
        ? Math.round(((memoryTotal - memoryFree) / memoryTotal) * 10_000) / 100
        : 0,
    heapUsedBytes: heap.used_heap_size,
    heapLimitBytes: heap.heap_size_limit,
    heapUsedPercent:
      heap.heap_size_limit > 0
        ? Math.round((heap.used_heap_size / heap.heap_size_limit) * 10_000) / 100
        : 0,
    eventLoopLagMs: runtimeMetrics.eventLoopLagMs(),
    requestsInWindow: runtimeMetrics.requestCount(),
    windowSeconds: runtimeMetrics.windowSeconds(),
    latencyP50Ms: runtimeMetrics.percentileMs(50),
    latencyP95Ms: runtimeMetrics.percentileMs(95),
    errorRate: runtimeMetrics.errorRate(),
  };
}

export interface DiskSnapshot {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

/**
 * Disk capacity for the directory the process is running from. Returns null
 * where the platform does not answer, rather than a fabricated figure.
 */
export async function diskSnapshot(path = process.cwd()): Promise<DiskSnapshot | null> {
  const statfs = (fsPromises as unknown as {
    statfs?: (target: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  }).statfs;
  if (typeof statfs !== 'function') {
    return null;
  }
  try {
    const stats = await statfs(path);
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bavail;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return null;
    }
    return {
      path,
      totalBytes,
      freeBytes,
      usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 10_000) / 100,
    };
  } catch {
    return null;
  }
}
