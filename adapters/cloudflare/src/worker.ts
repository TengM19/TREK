import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { databaseContext } from './connection';
import { DurableSqlite } from './sqlite';
import { createTables } from '../../../server/src/db/schema';
import { runMigrations } from '../../../server/src/db/migrations';
import { runSeeds } from '../../../server/src/db/seeds';
import type Database from 'better-sqlite3';
import { consumeEphemeralTokenWithMeta } from '../../../server/src/nest/auth/ephemeral-tokens';
import { cloudflareJoin, cloudflareLeave, cloudflareLeaveAll } from '../../../server/src/cloudflare-realtime';
import { ReminderJobsService } from '../../../server/src/nest/notifications/reminder-jobs.service';

export class TrekDatabase extends DurableObject {
  private readonly database = new DurableSqlite(this.ctx.storage);
  private readonly socketUsers = new Map<any, { id: number }>();
  private handler?: ReturnType<typeof httpServerHandler>;
  private application?: { get<T>(token: new (...args: any[]) => T, options?: { strict?: boolean }): T };

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
        this.application = await buildApp();
        this.handler = httpServerHandler(getHttpServer());
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    return databaseContext.run(this.database, async () => {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.websocket(request);
      const internalCron = request.headers.get('x-trek-cron') === 'cloudflare-scheduler-v1';
      if (new URL(request.url).pathname === '/__cloudflare/cron' && request.method === 'POST' && internalCron) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const idempotency = this.database.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff).changes;
        const challenges = this.database.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(Date.now()).changes;
        const invites = this.database.prepare("DELETE FROM invite_tokens WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run().changes;
        // The native reminder service already owns preference checks, recipient
        // resolution and the in-app WebSocket event contract. Invoke it from
        // the scheduler instead of duplicating those rules in the adapter.
        const reminder = this.application?.get(ReminderJobsService, { strict: false });
        if (request.headers.get('x-trek-cron-kind') === 'reminders' && reminder) {
          await reminder.tripTick();
          await reminder.todoTick();
        }
        return Response.json({ ok: true, idempotency, challenges, invites, reminders: request.headers.get('x-trek-cron-kind') === 'reminders' });
      }
      if (!this.handler) throw new Error('TREK application failed to initialize');
      return this.handler.fetch(request, this.env, this.ctx);
    });
  }

  private websocket(request: Request): Response {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return new Response('Authentication required', { status: 401 });
    const consumed = consumeEphemeralTokenWithMeta(token, 'ws');
    if (!consumed) return new Response('Invalid or expired token', { status: 401 });
    const user = this.database.prepare('SELECT id, password_version FROM users WHERE id = ?').get(consumed.userId) as { id: number; password_version?: number } | undefined;
    if (!user || Number(user.password_version ?? 0) !== Number(consumed.pv ?? 0)) return new Response('Invalid or expired token', { status: 401 });
    const Pair = (globalThis as any).WebSocketPair;
    if (!Pair) return new Response('WebSocket unavailable', { status: 501 });
    const pair = new Pair();
    const socket = pair[1] as any;
    socket.trekSocketId = Math.floor(Math.random() * 2147483647);
    const accept = (this.ctx as any).acceptWebSocket;
    if (typeof accept === 'function') accept.call(this.ctx, socket); else socket.accept();
    socket.send(JSON.stringify({ type: 'welcome', socketId: socket.trekSocketId }));
    this.socketUsers.set(socket, user);
    const onMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data));
        const tripId = String(message?.tripId ?? ''); if (!tripId) return;
        if (message.type === 'join') {
          const allowed = this.database.prepare('SELECT 1 FROM trips t WHERE t.id = ? AND (t.user_id = ? OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = ?))').get(tripId, user.id, user.id);
          if (!allowed) { socket.send(JSON.stringify({ type: 'error', message: 'Access denied' })); return; }
          cloudflareJoin(socket, tripId); socket.send(JSON.stringify({ type: 'joined', tripId: Number(tripId) }));
        } else if (message.type === 'leave') { cloudflareLeave(socket, tripId); socket.send(JSON.stringify({ type: 'left', tripId: Number(tripId) })); }
      } catch { /* ignore malformed frames */ }
    };
    if (typeof accept !== 'function') socket.addEventListener('message', onMessage);
    if (typeof accept !== 'function') socket.addEventListener('close', () => cloudflareLeaveAll(socket));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(socket: any, message: string | ArrayBuffer): void {
    const user = this.socketUsers.get(socket); if (!user) return;
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    try {
      const parsed = JSON.parse(raw); const tripId = String(parsed?.tripId ?? ''); if (!tripId) return;
      if (parsed.type === 'join') {
        const allowed = this.database.prepare('SELECT 1 FROM trips t WHERE t.id = ? AND (t.user_id = ? OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = ?))').get(tripId, user.id, user.id);
        if (!allowed) { socket.send(JSON.stringify({ type: 'error', message: 'Access denied' })); return; }
        cloudflareJoin(socket, tripId); socket.send(JSON.stringify({ type: 'joined', tripId: Number(tripId) }));
      } else if (parsed.type === 'leave') { cloudflareLeave(socket, tripId); socket.send(JSON.stringify({ type: 'left', tripId: Number(tripId) })); }
    } catch { /* ignore malformed frames */ }
  }

  webSocketClose(socket: any): void { this.socketUsers.delete(socket); cloudflareLeaveAll(socket); }
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
    if (pathname === '/api/runtime-capabilities') return Response.json({profile:'cloudflare-preview',attachments:false,plugins:false,scheduledTasks:true,realtime:{websocket:true,tripRooms:true},pdfImport:false,maps:{osm:true,trekPlaces:true,googlePlaces:false}});
    if ((pathname === '/ws' && request.headers.get('upgrade')?.toLowerCase() !== 'websocket') || pathname.startsWith('/api/backup') || pathname.startsWith('/api/admin/storage') || (request.headers.get('content-type') || '').includes('multipart/form-data')) {
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
  async scheduled(event: ScheduledEvent, env: { TREK: DurableObjectNamespace }) {
    const reminders = event.cron === '0 9 * * *';
    const response = await env.TREK.get(env.TREK.idFromName('trek-instance')).fetch(
      new Request('https://internal/__cloudflare/cron', {
        method: 'POST',
        headers: { 'x-trek-cron': 'cloudflare-scheduler-v1', ...(reminders ? { 'x-trek-cron-kind': 'reminders' } : {}) },
      }),
    );
    if (!response.ok) throw new Error(`Cloudflare scheduled cleanup failed (${response.status})`);
    console.log(`[cloudflare-cron] ${reminders ? 'reminders' : 'cleanup'}`, await response.text());
  },
};
