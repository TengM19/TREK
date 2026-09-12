import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

let mf;
let storage;
let script;
const start = () => new Miniflare({
  modules: true, script, compatibilityDate: '2026-07-01',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: { DATABASE: { className: 'TestDatabase', useSQLite: true } },
  durableObjectsPersist: storage,
  bindings: { ENCRYPTION_KEY: 'test-only-encryption-key-not-for-deployment', JWT_SECRET: 'test-only-session-key-not-for-deployment' },
});
async function call(path, value) {
  const response = await mf.dispatchFetch(`http://test${path}`, value ? { method: 'POST', body: value } : undefined);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
before(async () => {
  storage = await mkdtemp(join(tmpdir(), 'trek-cloudflare-'));
  const result = await build({
    entryPoints: ['tests/worker.ts'], bundle: true, format: 'esm', platform: 'neutral',
    mainFields: ['module', 'main'], conditions: ['workerd', 'import'],
    target: 'es2022', write: false, external: ['cloudflare:*', 'node:*'],
    plugins: [{ name: 'node-prefix', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)config$/ }, args => resolve(args.resolveDir, args.path) === resolve('../../server/src/config')
        ? { path: resolve('src/config.ts') } : undefined);
      builder.onResolve({ filter: /^@trek\/shared$/ }, () => ({ path: resolve('../../shared/src/index.ts') }));
      builder.onResolve({ filter: /\/sanitize\/sanitize$/ }, args => ({
        path: resolve(args.resolveDir, `${args.path}.ts`), sideEffects: false,
      }));
      builder.onResolve({ filter: /.*/ }, args => builtinModules.includes(args.path)
        ? { path: `node:${args.path}`, external: true } : undefined);
    } }],
  });
  script = result.outputFiles[0].text;
  mf = start();
});
after(async () => { await mf?.dispose(); await rm(storage, { recursive: true, force: true }); });

test('durable SQL preserves statement results, rollback and nested savepoints across restart', async () => {
  assert.deepEqual(await call('/write', 'first'), { changes: 1, lastInsertRowid: 1 });
  assert.deepEqual(await call('/rollback'), [{ id: 1, value: 'first' }]);
  assert.deepEqual(await call('/nested'), [{ id: 1, value: 'first' }, { id: 2, value: 'outer' }]);
  await mf.dispose();
  mf = start();
  assert.deepEqual(await call('/read'), [{ id: 1, value: 'first' }, { id: 2, value: 'outer' }]);
});

test('the unmodified upstream schema and migration chain run on the actual Workers SQLite engine', async () => {
  const first = await call('/schema');
  assert.ok(first.version > 0);
  assert.deepEqual(await call('/schema'), first);
});

test('named and mixed bindings preserve SQL literals and reject missing parameters', async () => {
  assert.deepEqual(await call('/named'), {result:{first:'bound',second:'bound',literal:':ignored',positional:'ordered'},missingRejected:true});
});
