/** Render worker: runs jobs posted by the pool and transfers the pixels back. */

import { runJob, runToEndJob, transferables, type Job } from './workerApi';

interface Req {
  id: number;
  job: Job;
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent<Req>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (ev) => {
  const { id, job } = ev.data;
  try {
    const result = runToEndJob(runJob(job));
    scope.postMessage({ id, result }, transferables(result));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
scope.postMessage({ ready: true });
