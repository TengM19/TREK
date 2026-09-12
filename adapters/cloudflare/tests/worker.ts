import { DurableObject } from 'cloudflare:workers';
import { DurableSqlite } from '../src/sqlite';
import { createTables } from '../../../server/src/db/schema';
import { runMigrations } from '../../../server/src/db/migrations';
import type Database from 'better-sqlite3';

export class TestDatabase extends DurableObject {
  async fetch(request: Request) {
    const db = new DurableSqlite(this.ctx.storage);
    const action = new URL(request.url).pathname;
    try {
      if (action === '/named') {
        const result = db.prepare("SELECT :value AS first, :value AS second, ':ignored' AS literal, ? AS positional /* :ignored */ -- :ignored\n").get({value: 'bound'}, 'ordered');
        let missingRejected = false;
        try { db.prepare('SELECT :missing').get({present: 1}); } catch (error) { missingRejected = error instanceof RangeError; }
        return Response.json({result, missingRejected});
      }
      if (action === '/schema') {
        createTables(db as unknown as Database.Database);
        runMigrations(db as unknown as Database.Database);
        return Response.json(db.prepare('SELECT version FROM schema_version').get());
      }
      db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)');
      if (action === '/write') {
        const value = await request.text();
        return Response.json(db.prepare('INSERT INTO probe(value) VALUES (?)').run(value));
      }
      if (action === '/rollback') {
        try {
          db.transaction(() => {
            db.prepare('INSERT INTO probe(value) VALUES (?)').run('rolled-back');
            throw new Error('rollback');
          })();
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'rollback') throw error;
        }
      }
      if (action === '/nested') {
        db.transaction(() => {
          db.prepare('INSERT INTO probe(value) VALUES (?)').run('outer');
          try {
            db.transaction(() => {
              db.prepare('INSERT INTO probe(value) VALUES (?)').run('inner');
              throw new Error('inner rollback');
            })();
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'inner rollback') throw error;
          }
        })();
      }
      return Response.json(db.prepare('SELECT * FROM probe ORDER BY id').all());
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
}

export default {
  fetch(request: Request, env: { DATABASE: DurableObjectNamespace }) {
    return env.DATABASE.get(env.DATABASE.idFromName('test')).fetch(request);
  },
};
