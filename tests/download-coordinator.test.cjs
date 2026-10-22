'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Production uses browser ES modules; package.json remains CommonJS for scripts.
const source = fs.readFileSync(path.join(__dirname, '../engine/download-coordinator.js'), 'utf8');
const loaded = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const input = { tabId: 7, gstin: '22AAAAA0000A1Z5', returnType: 'GSTR2B', period: '042026', format: 'PDF' };
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const adapter = (overrides = {}) => ({
  prepare: async () => ({}),
  waitUntilReady: async () => {},
  execute: async () => ({ downloadId: 42 }),
  cleanup: async () => {},
  ...overrides
});

test('snapshots job identity and excludes mutable or sensitive input', async () => {
  const { createDownloadCoordinator } = await loaded;
  const mutable = { ...input, password: 'must-not-copy', options: {} };
  const handle = createDownloadCoordinator().submit(mutable, adapter());
  mutable.period = '052026';
  assert.equal(handle.job.period, '042026');
  assert.equal(handle.job.password, undefined);
  assert.equal(handle.job.options, undefined);
  assert.ok(Object.isFrozen(handle.job));
  await handle.completion;
});

test('PDF and Excel across returns/tabs share a lane through cleanup', async () => {
  const { createDownloadCoordinator } = await loaded;
  const coordinator = createDownloadCoordinator();
  const cleaning = deferred();
  const release = deferred();
  const events = [];
  const first = coordinator.submit(input, adapter({ cleanup: async () => {
    events.push('first cleanup'); cleaning.resolve(); await release.promise;
  } }));
  const second = coordinator.submit({ ...input, tabId: 8, returnType: 'GSTR1', format: 'EXCEL' }, adapter({
    prepare: async () => { events.push('second prepare'); }
  }));
  await cleaning.promise;
  assert.deepEqual(events, ['first cleanup']);
  release.resolve();
  await Promise.all([first.completion, second.completion]);
  assert.deepEqual(events, ['first cleanup', 'second prepare']);
  assert.notEqual(first.job.id, second.job.id);
});

test('does not execute until readiness resolves', async () => {
  const { createDownloadCoordinator } = await loaded;
  const waiting = deferred();
  const ready = deferred();
  let executions = 0;
  const handle = createDownloadCoordinator().submit(input, adapter({
    waitUntilReady: async () => { waiting.resolve(); await ready.promise; },
    execute: async () => { executions++; }
  }));
  await waiting.promise;
  assert.equal(executions, 0);
  ready.resolve();
  await handle.completion;
  assert.equal(executions, 1);
});

test('readiness failure cleans up and does not block the next job', async () => {
  const { createDownloadCoordinator } = await loaded;
  let cleaned = false;
  const coordinator = createDownloadCoordinator();
  const failed = coordinator.submit(input, adapter({
    waitUntilReady: async () => { throw new Error('Period mismatch'); },
    execute: async () => assert.fail('must not execute'),
    cleanup: async () => { cleaned = true; }
  }));
  const next = coordinator.submit(input, adapter());
  await assert.rejects(failed.completion, /Period mismatch/);
  await next.completion;
  assert.ok(cleaned);
});

test('session invalidation rejects active/queued old jobs and keeps lock until cleanup', async () => {
  const { createDownloadCoordinator, DownloadJobCancelledError } = await loaded;
  const coordinator = createDownloadCoordinator();
  const executing = deferred();
  const release = deferred();
  const events = [];
  const active = coordinator.submit(input, adapter({
    execute: async () => { executing.resolve(); await release.promise; return 'old data'; },
    cleanup: async () => { events.push('old cleanup'); }
  }));
  const queued = coordinator.submit(input, adapter({ prepare: async () => assert.fail('stale queue started') }));
  const activeRejected = assert.rejects(active.completion, DownloadJobCancelledError);
  const queuedRejected = assert.rejects(queued.completion, DownloadJobCancelledError);
  await executing.promise;
  coordinator.invalidateSession();
  const fresh = coordinator.submit({ ...input, gstin: '27BBBBB0000B1Z5' }, adapter({
    prepare: async () => { events.push('fresh prepare'); }
  }));
  assert.equal(fresh.job.sessionGeneration, 1);
  assert.deepEqual(events, []);
  release.resolve();
  await Promise.all([activeRejected, queuedRejected, fresh.completion]);
  assert.deepEqual(events, ['old cleanup', 'fresh prepare']);
});

test('cancellation before start skips adapter initialization', async () => {
  const { createDownloadCoordinator, DownloadJobCancelledError } = await loaded;
  const handle = createDownloadCoordinator().submit(input, adapter({ prepare: async () => assert.fail('cancelled') }));
  handle.cancel();
  await assert.rejects(handle.completion, DownloadJobCancelledError);
});

test('partial prepare failure still invokes cleanup', async () => {
  const { createDownloadCoordinator } = await loaded;
  let cleaned = false;
  const handle = createDownloadCoordinator().submit(input, adapter({
    prepare: async () => { throw new Error('partial initialization'); },
    cleanup: async (_scope, resource) => { assert.equal(resource, undefined); cleaned = true; }
  }));
  await assert.rejects(handle.completion, /partial initialization/);
  assert.ok(cleaned);
});

test('cleanup failure blocks further portal work instead of risking overlap', async () => {
  const { createDownloadCoordinator } = await loaded;
  const coordinator = createDownloadCoordinator();
  const first = coordinator.submit(input, adapter({ cleanup: async () => { throw new Error('frame still alive'); } }));
  const second = coordinator.submit(input, adapter({ prepare: async () => assert.fail('unsafe restart') }));
  await assert.rejects(first.completion, /cleanup failed/);
  await assert.rejects(second.completion, /recovery required/);
});

test('session change during cleanup rejects an otherwise successful result', async () => {
  const { createDownloadCoordinator, DownloadJobCancelledError } = await loaded;
  const coordinator = createDownloadCoordinator();
  const handle = coordinator.submit(input, adapter({ cleanup: async () => coordinator.invalidateSession() }));
  await assert.rejects(handle.completion, DownloadJobCancelledError);
});

test('reports handoff, not browser completion; observer errors cannot break execution', async () => {
  const { createDownloadCoordinator } = await loaded;
  const states = [];
  const coordinator = createDownloadCoordinator({ onState: event => { states.push(event.state); throw new Error('UI disconnected'); } });
  const result = await coordinator.submit(input, adapter()).completion;
  assert.equal(result.result.downloadId, 42);
  assert.deepEqual(states, ['QUEUED', 'PREPARING', 'WAITING_FOR_DATA', 'EXECUTING', 'CLEANING_UP', 'HANDOFF_CONFIRMED']);
});

test('rejects unresolved identity or incomplete adapters before enqueueing', async () => {
  const { createDownloadCoordinator } = await loaded;
  const coordinator = createDownloadCoordinator();
  assert.throws(() => coordinator.submit({ ...input, gstin: '' }, adapter()), /requires gstin/);
  assert.throws(() => coordinator.submit({ ...input, tabId: null }, adapter()), /resolved tabId/);
  assert.throws(() => coordinator.submit(input, {}), /implement prepare/);
});
