// Shared safety boundary for portal-driven downloads.
// Not wired to legacy engines yet: adapters must satisfy the lifecycle contract.

export class DownloadJobCancelledError extends Error {
  constructor(message = 'Download job cancelled or GST session changed') {
    super(message);
    this.name = 'DownloadJobCancelledError';
  }
}

/**
 * One instance must own all portal-mutating adapters in a browser profile.
 * execute() resolves only after a verified safe download handoff, NOT on click.
 * cleanup() must stop all context mutations before resolving, including on abort.
 * Abort is cooperative: never release the lane while old work may still run.
 * This in-memory coordinator does not survive service-worker termination.
 */
export function createDownloadCoordinator({ onState = () => {} } = {}) {
  let generation = 0;
  let sequence = 0;
  let tail = Promise.resolve();
  let recoveryRequired = false;
  const instanceId = globalThis.crypto.randomUUID();
  const pending = new Map();

  function publish(job, state) {
    // Observers must not break scheduling or cleanup. No credentials in events.
    try { onState(Object.freeze({ job, state })); } catch (_) {}
  }

  function submit(input, adapter) {
    for (const method of ['prepare', 'waitUntilReady', 'execute', 'cleanup']) {
      if (typeof adapter?.[method] !== 'function') {
        throw new TypeError(`Adapter must implement ${method}()`);
      }
    }
    for (const field of ['gstin', 'returnType', 'period', 'format']) {
      if (typeof input?.[field] !== 'string' || !input[field].trim()) {
        throw new TypeError(`Job requires ${field}`);
      }
    }
    if (!Number.isInteger(input.tabId) || input.tabId <= 0) {
      throw new TypeError('Job requires a resolved tabId');
    }

    // Whitelist scalar fields: never retain mutable UI objects or credentials.
    const job = Object.freeze({
      id: `${instanceId}:${++sequence}`,
      sessionGeneration: generation,
      tabId: input.tabId,
      gstin: input.gstin.trim().toUpperCase(),
      returnType: input.returnType.trim().toUpperCase(),
      period: input.period.trim(),
      format: input.format.trim().toUpperCase()
    });
    const controller = new AbortController();
    pending.set(job.id, controller);
    const assertCurrent = () => {
      if (controller.signal.aborted || job.sessionGeneration !== generation) {
        throw new DownloadJobCancelledError();
      }
    };
    const scope = Object.freeze({ job, signal: controller.signal, assertCurrent });
    publish(job, 'QUEUED');

    const run = async () => {
      let resource;
      let preparationStarted = false;
      let result;
      let failure;
      try {
        assertCurrent();
        if (recoveryRequired) throw new Error('Portal cleanup failed; coordinator recovery required');
        publish(job, 'PREPARING');
        preparationStarted = true;
        resource = await adapter.prepare(scope);
        assertCurrent();
        publish(job, 'WAITING_FOR_DATA');
        await adapter.waitUntilReady(scope, resource);
        assertCurrent();
        publish(job, 'EXECUTING');
        result = await adapter.execute(scope, resource);
        assertCurrent();
      } catch (error) {
        failure = error;
      } finally {
        if (preparationStarted) {
          publish(job, 'CLEANING_UP');
          try {
            // Called even if prepare partially initialized and then threw.
            await adapter.cleanup(scope, resource);
          } catch (error) {
            recoveryRequired = true;
            failure = new Error('Portal cleanup failed; further jobs blocked', { cause: error });
          }
        }
        pending.delete(job.id);
      }
      // Session may have changed during cleanup; never accept that old result.
      if (!failure) {
        try { assertCurrent(); } catch (error) { failure = error; }
      }
      if (failure) {
        publish(job, failure instanceof DownloadJobCancelledError ? 'CANCELLED' : 'FAILED');
        throw failure;
      }
      // Browser download completion is a separate responsibility.
      publish(job, 'HANDOFF_CONFIRMED');
      return Object.freeze({ job, result });
    };

    const completion = tail.then(run);
    // A failed job must not poison the promise chain or create unhandled rejection.
    tail = completion.then(() => undefined, () => undefined);
    return Object.freeze({
      job,
      completion,
      cancel: () => controller.abort()
    });
  }

  function invalidateSession() {
    generation += 1;
    for (const controller of pending.values()) controller.abort();
    // Do not clear the lane: active adapters still own their contexts until cleanup.
  }

  return Object.freeze({ submit, invalidateSession });
}
