import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { readEnv } from '../app-config';
import { applyDurabilityPragmas } from './durability';
import { createTables } from './schema';
import { runMigrations } from './migrations';
import { runSeeds } from './seeds';

// In test mode each vitest worker gets an isolated in-memory DB so that
// parallel forks can't race on the same file or share migration state.
const isTest = readEnv().app.isTest;

let dbPath: string;
if (isTest) {
  dbPath = ':memory:';
} else if (readEnv().db.trekDbFile) {
  // Explicit DB file (used by the Playwright E2E harness to run against an
  // isolated, throwaway database instead of the real data/travel.db). Purely
  // additive — when unset the default path below is used exactly as before.
  dbPath = readEnv().db.trekDbFile!;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} else {
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbPath = path.join(dataDir, 'travel.db');
}

let _db: Database.Database | null = null;

function initDb(): void {
  if (_db) {
    try { _db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) {}
    try { _db.close(); } catch (e) {}
    _db = null;
  }

  _db = new Database(dbPath);
  // Ahead of the journal switch now: changing journal_mode needs an exclusive
  // lock, which a sibling process (reset-admin, the rotation script) may hold.
  _db.exec('PRAGMA busy_timeout = 5000');
  const durability = applyDurabilityPragmas(_db);
  _db.exec('PRAGMA foreign_keys = ON');
  // Reported so an operator can see whether their setting took — the test DB is
  // :memory: and has no journal file, so there is nothing to report there.
  if (dbPath !== ':memory:') {
    console.log(`[DB] journal_mode=${durability.journalMode}, synchronous=${durability.synchronous}`);
  }

  createTables(_db);
  runMigrations(_db);

  runSeeds(_db);
}

initDb();

const db = new Proxy({} as Database.Database, {
  get(_, prop: string | symbol) {
    if (!_db) throw new Error('Database connection is not available (restore in progress?)');
    const val = (_db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? val.bind(_db) : val;
  },
  set(_, prop: string | symbol, val: unknown) {
    (_db as unknown as Record<string | symbol, unknown>)[prop] = val;
    return true;
  },
});

if (readEnv().demo.enabled) {
  try {
    const { seedDemoData } = require('../demo/demo-seed');
    seedDemoData(_db);
  } catch (err: unknown) {
    console.error('[Demo] Seed error:', err instanceof Error ? err.message : err);
  }
}

function closeDb(): void {
  if (_db) {
    try { _db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) {}
    try { _db.close(); } catch (e) {}
    _db = null;
    console.log('[DB] Database connection closed');
  }
}

function reinitialize(): void {
  console.log('[DB] Reinitializing database connection after restore...');
  if (_db) closeDb();
  initDb();
  console.log('[DB] Database reinitialized successfully');
}

export { db, closeDb, reinitialize };
