import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { databaseContext } from './connection';
import { DurableSqlite } from './sqlite';
import { createTables } from '../../../server/src/db/schema';
import { runMigrations } from '../../../server/src/db/migrations';
import { runSeeds } from '../../../server/src/db/seeds';
import type Database from 'better-sqlite3';

export class TrekDatabase extends DurableObject {
  private readonly database = new DurableSqlite(this.ctx.storage);
  private handler?: ReturnType<typeof httpServerHandler>;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      await databaseContext.run(this.database, async () => {
        const connection = this.database as unknown as Database.Database;
        createTables(connection);
        runMigrations(connection);
        runSeeds(connection, {logAdminPassword: false});
        for (const key of ['password_registration', 'oidc_registration']) {
          this.database.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES (?, ?)').run(key, process.env.TREK_INITIAL_REGISTRATION === 'true' ? 'true' : 'false');
        }
        const { buildApp, getHttpServer } = await import('../../../server/src/bootstrap').catch(error => { console.error(error.stack); throw error; });
        await buildApp();
        this.handler = httpServerHandler(getHttpServer());
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    return databaseContext.run(this.database, async () => {
      if (!this.handler) throw new Error('TREK application failed to initialize');
      return this.handler.fetch(request, this.env, this.ctx);
    });
  }
}

export default {
  async fetch(request: Request, env: { TREK: DurableObjectNamespace; ASSETS: Fetcher }) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/cloudflare-source.tar.gz') {
      // Static assets have a per-file size limit; stream the source archive parts.
      const parts = ['/cloudflare-source.part1', '/cloudflare-source.part2', '/cloudflare-source.part3'];
      let index = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (true) {
            if (!reader) {
              if (index === parts.length) { controller.close(); return; }
              const response = await env.ASSETS.fetch(new Request(new URL(parts[index++], request.url)));
              if (!response.ok || !response.body) { controller.error(new Error('Source archive unavailable')); return; }
              reader = response.body.getReader();
            }
            const next = await reader.read();
            if (next.done) { reader.releaseLock(); reader = undefined; continue; }
            controller.enqueue(next.value); return;
          }
        },
        async cancel() { await reader?.cancel(); },
      });
      return new Response(stream, {headers:{'content-type':'application/gzip','content-disposition':'attachment; filename="TREK-cloudflare-source.tar.gz"'}});
    }
    if (pathname === '/api/runtime-capabilities') return Response.json({profile:'cloudflare-preview',attachments:false,plugins:false,scheduledTasks:false,realtime:false,pdfImport:false});
    if (pathname === '/ws' || pathname.startsWith('/api/backup') || pathname.startsWith('/api/admin/storage') || (request.headers.get('content-type') || '').includes('multipart/form-data')) {
      return Response.json({error:'This feature is not available in the initial Cloudflare preview.',code:'RUNTIME_UNSUPPORTED'}, {status:501});
    }
    if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/oauth/') || pathname.startsWith('/.well-known/') || pathname === '/ws' || pathname.startsWith('/uploads/')) {
      const headers = new Headers(request.headers);
      // Cloudflare performs edge compression; avoid a second Node compression pass.
      headers.delete('accept-encoding');
      headers.set('x-forwarded-proto', new URL(request.url).protocol.slice(0, -1));
      headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '127.0.0.1');
      headers.set('x-forwarded-host', new URL(request.url).host);
      return env.TREK.get(env.TREK.idFromName('trek-instance')).fetch(new Request(request, {headers}));
    }
    return env.ASSETS.fetch(request);
  },
};
