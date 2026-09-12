# Experimental Cloudflare runtime

Unofficial adaptation of [liketrek/TREK](https://github.com/liketrek/TREK), based on upstream dev `4f8605b529e3e592438b9536fb9923312548e00f`. The original AGPL-3.0 license, frontend, shared contracts and Nest authorization remain in place. This is a limited preview, not upstream support or full feature parity.

## Architecture

The public Worker serves the original Vite build and forwards application requests to one SQLite-backed Durable Object (`trek-instance`). The original Nest application runs through Cloudflare's Node HTTP adapter. `DurableSqlite` implements the synchronous statement/transaction surface used by TREK, including named bindings; writes and rollback use actual Durable Object storage. It does not emulate a durable database in memory or attempt to make D1 synchronous.

The original Node database initializer is split into `server/src/db/database.connection.ts`, with the existing helper exports retained in `database.ts`. Only the Workers bundle resolves that connection to an AsyncLocalStorage-scoped adapter. Node deployments retain better-sqlite3. The optional seed logging argument prevents credentials appearing in hosted logs.

This profile deliberately supports a single application instance. It is not a per-user Durable Object partitioning scheme. SQL migrations, guards, validation pipes, auth cookies and business services are reused from upstream.

## Verified

Tests run against workerd through Miniflare, not mocked database/auth services:

- Upstream schema and migration chain to version 215, including repeat startup.
- Statement results, named/mixed bindings, literal/comment preservation, missing-parameter rejection, transaction and nested rollback, and storage after runtime restart.
- Real login and Secure/HttpOnly session cookie, request validation, trip/place CRUD, itinerary reorder, data after runtime restart, and cross-user read/write denial.
- Existing Node regression: five test files, 59 tests pass; server typecheck passes.

## Preview limitations

Attachments, PDF import, plugin execution and realtime collaboration are unavailable. Upload writes fail explicitly; multipart uploads, backup/restore and storage reconfiguration return 501. Plugins are disabled with `TREK_PLUGINS_ENABLED=false`; child-process isolation is not replaced with in-process execution. Cloudflare Cron now runs the durable cleanup task (expired idempotency keys, WebAuthn challenges and registration invites); the remaining upstream jobs still need individual migration. Rotating log files are replaced by console logging. Unsupported admin secret rotation fails with an instruction to rotate the Cloudflare secret.

Other upstream features have not been accepted on this profile. OSM, TREK Places, Frankfurter exchange rates and Transitous public transit are available through the existing server-side proxies; Google Places/Transit, weather, email, MCP, import/export, offline conflict reconciliation and load limits need separate verification. This preview is not a claim that all upstream features work.

Sites currently exposes D1/R2 bindings but not this SQLite Durable Object binding. This is a general Cloudflare backend deployment; a Sites frontend deployment must be documented separately and must not be described as a Sites-native backend.

## Build and test

Use Node 24 and a current npm. From the repository root, install the original locked dependencies with `npm ci` and build shared (`npm run build --workspace @trek/shared`). Install this separate adapter's lockfile using `npm ci` inside `adapters/cloudflare`.

From the repository root:

```sh
VITE_RUNTIME_PREVIEW=cloudflare npm run build --workspace @trek/client
cd adapters/cloudflare
npm test
wrangler deploy --dry-run --no-bundle
```

The build preserves Nest decorator metadata and class names because the upstream guard validators rely on them. Workers-only bundling removes the client HTML-sanitizer barrel export (the original frontend sanitizer remains unchanged), replaces depd's dynamic wrapper with a closure preserving receiver, arguments, arity and warning logging, and deduplicates identical iconv-lite 0.7.2 copies. PDF native rendering fails explicitly. These build-specific adaptations need review when dependencies change.

## Deployment

Create Cloudflare Secrets `JWT_SECRET`, `ENCRYPTION_KEY` (each at least 32 characters), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` using the official Wrangler workflow. Never commit credentials or put secrets in `wrangler.jsonc`. The administrator is seeded on an empty database only. Public password/OIDC registration defaults off; existing settings remain unchanged on restart. Tests explicitly enable registration in an isolated database to verify separate users.

Deploy with `npm run deploy` after building the frontend. The configuration uses the free workers.dev domain and one SQLite Durable Object. The checked upload is under the free-plan compressed bundle limit; this does not guarantee unlimited usage.

The deployment should expose the corresponding source archive at `/cloudflare-source.tar.gz`, including this adapter and the original source, with a visible source link in the preview notice. Do not publish a source archive containing secrets, runtime data, node_modules or local tooling.
