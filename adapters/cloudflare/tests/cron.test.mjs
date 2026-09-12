import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

test('Cloudflare scheduled cleanup invokes the Durable Object task and is idempotent', { timeout: 120000 }, async () => {
  const storage = await mkdtemp(join(tmpdir(), 'trek-cron-'));
  const script = await readFile('dist/worker.js', 'utf8');
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'worker.js', contents: script }],
    compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { TREK: { className: 'TrekDatabase', useSQLite: true } }, durableObjectsPersist: storage,
    bindings: { NODE_ENV: 'production', TREK_INITIAL_REGISTRATION: 'false', TREK_PLUGINS_ENABLED: 'false', ADMIN_EMAIL: 'test@example.invalid', ADMIN_PASSWORD: 'test-only-password-0000000000000000', JWT_SECRET: 'test-only-jwt-000000000000000000000000', ENCRYPTION_KEY: 'test-only-key-000000000000000000000000' },
  });
  try {
    const env = await mf.getBindings();
    const stub = env.TREK.get(env.TREK.idFromName('trek-instance'));
    const run = () => stub.fetch('https://internal/__cloudflare/cron', {
      method: 'POST', headers: { 'x-trek-cron': 'cloudflare-scheduler-v1' },
    });
    const first = await run();
    const second = await run();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const reminders = await stub.fetch('https://internal/__cloudflare/cron', {
      method: 'POST', headers: { 'x-trek-cron': 'cloudflare-scheduler-v1', 'x-trek-cron-kind': 'reminders' },
    });
    assert.equal(reminders.status, 200);
    assert.equal((await reminders.json()).reminders, true);
    const retention = await stub.fetch('https://internal/__cloudflare/cron', {
      method: 'POST', headers: { 'x-trek-cron': 'cloudflare-scheduler-v1', 'x-trek-cron-kind': 'shadow-retention' },
    });
    assert.equal(retention.status, 200);
    assert.equal((await retention.json()).retention, true);
    const versionCheck = await stub.fetch('https://internal/__cloudflare/cron', {
      method: 'POST', headers: { 'x-trek-cron': 'cloudflare-scheduler-v1', 'x-trek-cron-kind': 'version-check' },
    });
    assert.equal(versionCheck.status, 200);
    assert.equal((await versionCheck.json()).versionCheck, true);
  } finally {
    await mf.dispose();
    await rm(storage, { recursive: true, force: true });
  }
});
