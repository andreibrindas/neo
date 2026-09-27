const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../updates');

function fixture(overrides = {}) {
  const updater = new EventEmitter();
  let checks = 0, downloads = 0, installs = 0;
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit('update-available', { version: '0.9.0' });
    return {};
  };
  updater.downloadUpdate = async () => { downloads++; };
  updater.quitAndInstall = () => { installs++; };
  const states = [], errors = [];
  const updates = createUpdates({
    updater, currentVersion: '0.8.3', fetchRelease: async () => '0.9.0',
    onState: (s) => states.push(s), onError: (e) => errors.push(e), ...overrides
  });
  return { updater, updates, states, errors, counts: () => ({ checks, downloads, installs }) };
}

test('checking never downloads or installs; restart is rejected before a download completes', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  f.updates.install();
  await f.updates.download();
  assert.equal((await f.updates.check()).status, 'available');
  f.updates.install();
  assert.deepEqual(f.counts(), { checks: 1, downloads: 0, installs: 0 });
});

test('download progress and ready state survive repeated checks; install runs once', async () => {
  const f = fixture();
  await f.updates.check();
  let finish;
  f.updater.downloadUpdate = () => new Promise((resolve) => { finish = resolve; });
  const pending = f.updates.download();
  await Promise.resolve();
  f.updater.emit('download-progress', { percent: 42.5 });
  assert.equal((await f.updates.check()).percent, 42.5);
  assert.equal(f.counts().checks, 1);
  f.updates.install();
  assert.equal(f.counts().installs, 0);
  f.updater.emit('update-downloaded', { version: '0.9.0' });
  finish();
  await pending;
  assert.equal((await f.updates.check()).status, 'downloaded');
  f.updates.install();
  f.updates.install();
  assert.equal(f.counts().installs, 1);
});

test('concurrent startup and manual checks make one request', async () => {
  const f = fixture();
  let finish;
  let calls = 0;
  f.updater.checkForUpdates = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const pending = f.updates.check();
  assert.equal((await f.updates.check()).status, 'checking');
  assert.equal(calls, 1);
  f.updater.emit('update-not-available');
  finish({});
  assert.equal((await pending).status, 'current');
});

test('failed checks and downloads are visible and retryable', async () => {
  const f = fixture();
  const check = f.updater.checkForUpdates;
  f.updater.checkForUpdates = async () => { throw new Error('offline'); };
  assert.equal((await f.updates.check()).status, 'error');
  f.updater.checkForUpdates = check;
  await f.updates.check();
  f.updater.downloadUpdate = async () => {
    const error = new Error('checksum mismatch');
    f.updater.emit('error', error);
    throw error;
  };
  const result = await f.updates.download();
  assert.equal(result.status, 'error');
  assert.match(result.error, /download/);
  assert.equal(f.errors.length, 2);
  f.updates.install();
  assert.equal(f.counts().installs, 0);
  assert.equal((await f.updates.check()).status, 'available');
});

test('installer errors restore an actionable error state', async () => {
  const f = fixture();
  f.updater.emit('update-downloaded', { version: '0.9.0' });
  f.updater.quitAndInstall = () => f.updater.emit('error', new Error('permission denied'));
  assert.match(f.updates.install().error, /install/);
});

test('manual builds compare numeric versions and never offer installation', async () => {
  const f = fixture({ updater: null, fetchRelease: async () => '0.10.0' });
  const result = await f.updates.check();
  assert.equal(result.canInstall, false);
  assert.equal(result.status, 'available');
  await f.updates.download();
  f.updates.install();
  assert.equal(f.counts().installs, 0);
  const older = fixture({ updater: null, fetchRelease: async () => '0.8.2' });
  assert.equal((await older.updates.check()).status, 'current');
});
