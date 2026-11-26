/**
 * Runs render jobs on a small pool of Web Workers (navigator.hardwareConcurrency, capped at 4), reporting progress
 * by estimated cost. Without workers (unsupported, blocked, or a worker fails to start) the remaining jobs run on
 * the main thread in ~12 ms slices that yield to the event loop, so the tab never freezes.
 */

import { jobCost, runJob, type Job, type JobResult } from './jobs';

export interface PoolOptions {
  /** Force the main-thread path (tests, `?artWorkers=0`). */
  noWorkers?: boolean;
  maxWorkers?: number;
}

export interface PoolReport {
  workers: number;
  mainThreadJobs: number;
}

const SLICE_MS = 12;
const yieldToLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function runOnMain(job: Job): Promise<JobResult> {
  const g = runJob(job);
  let t0 = performance.now();
  for (;;) {
    const r = g.next();
    if (r.done === true) return r.value;
    if (performance.now() - t0 > SLICE_MS) {
      await yieldToLoop();
      t0 = performance.now();
    }
  }
}

function spawnWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'art-render' });
  } catch {
    return null;
  }
}

export async function runJobs(jobs: readonly Job[], onProgress: (f: number) => void, opts: PoolOptions = {}): Promise<{ results: JobResult[]; report: PoolReport }> {
  const results: (JobResult | undefined)[] = new Array<JobResult | undefined>(jobs.length);
  const costs = jobs.map(jobCost);
  const total = costs.reduce((a, b) => a + b, 0) || 1;
  let doneCost = 0;
  const finish = (i: number, r: JobResult): void => {
    results[i] = r;
    doneCost += costs[i]!;
    onProgress(Math.min(1, doneCost / total));
  };
  let next = 0;
  const take = (): number => (next < jobs.length ? next++ : -1);
  const report: PoolReport = { workers: 0, mainThreadJobs: 0 };

  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 2;
  const want = opts.noWorkers === true ? 0 : Math.max(1, Math.min(opts.maxWorkers ?? 4, hc));

  const workerLoop = (w: Worker): Promise<void> =>
    new Promise<void>((resolve) => {
      let current = -1;
      let started = false;
      let failed = false;
      const fail = (): void => {
        if (failed) return;
        failed = true;
        // Hand the job back and let the main thread finish the queue.
        if (current >= 0 && results[current] === undefined) requeue.push(current);
        current = -1;
        w.terminate();
        resolve();
      };
      // A worker that never starts (blocked script, broken module) hands its share to the main thread.
      const timer = setTimeout(() => {
        if (!started) fail();
      }, 15000);
      const send = (): void => {
        current = requeue.length > 0 ? requeue.pop()! : take();
        if (current < 0) {
          w.terminate();
          resolve();
          return;
        }
        w.postMessage({ id: current, job: jobs[current] });
      };
      w.onmessage = (ev: MessageEvent<{ ready?: boolean; id?: number; result?: JobResult; error?: string }>) => {
        const d = ev.data;
        if (d.ready === true) {
          if (!started) {
            started = true;
            clearTimeout(timer);
            report.workers++;
            send();
          }
          return;
        }
        if (d.error !== undefined || d.result === undefined || d.id === undefined) {
          fail();
          return;
        }
        finish(d.id, d.result);
        send();
      };
      w.onerror = (e) => {
        e.preventDefault();
        fail();
      };
      w.onmessageerror = () => fail();
    });

  const requeue: number[] = [];
  const loops: Promise<void>[] = [];
  for (let i = 0; i < want; i++) {
    const w = spawnWorker();
    if (w === null) break;
    loops.push(workerLoop(w));
  }
  await Promise.all(loops);
  // Whatever is left (no workers, or they failed) runs here, sliced.
  for (;;) {
    const i = requeue.length > 0 ? requeue.pop()! : take();
    if (i < 0) break;
    report.mainThreadJobs++;
    finish(i, await runOnMain(jobs[i]!));
    await yieldToLoop();
  }
  return { results: results as JobResult[], report };
}
