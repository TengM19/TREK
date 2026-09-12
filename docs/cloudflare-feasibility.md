# Cloudflare / Sites feasibility research

Status: experimental Workers adaptation implemented and locally accepted (2026-09-12); see `adapters/cloudflare/README.md` for scope, tests and limitations. This is an unofficial fork of liketrek/TREK.

## Scope and process

Preserve the original frontend, shared contracts, authorization behavior, licenses, history, and Node/SQLite deployment. Explore general Cloudflare Workers compatibility first; keep Sites-specific deployment configuration separate. Submit only small, agreed changes against upstream dev.

[Contribution discussion](https://discord.com/channels/1488298068427411591/1489744391080771768/threads/1548261815937400883) was posted in #github-pr on 2026-09-12. Downstream implementation proceeds independently for the fork owner; any upstream contribution remains separate. No maintainer approval is implied.

## Verified upstream baseline

Commit: `4f8605b529e3e592438b9536fb9923312548e00f` (dev). Local Node 24.19.0, npm 12.0.2, original lockfile.

- `npm run build`: passed for shared, server, client, and PWA generation; client emits large-chunk warnings.
- `npm run typecheck --workspace=server`: passed.
- `npm run typecheck --workspace=client`: passed.
- `npm run test --workspace=server -- tests/e2e/auth.e2e.test.ts tests/e2e/trips.e2e.test.ts tests/e2e/places.e2e.test.ts tests/unit/nest/database-service.test.ts tests/unit/nest/database-service.delegation.test.ts --maxWorkers=2`: 5 files, 59 tests passed.

These are existing Node/SQLite tests, some with mocked dependencies. They do not establish Workers compatibility or full browser-level cross-user authorization. Full coverage, Docker builds, and the complete test suite were not run.

## Initial feasibility questions

- DatabaseService exposes synchronous better-sqlite3 statements and transaction callbacks. D1 cannot be treated as a drop-in connection replacement; verify transaction atomicity, async propagation, and migration ordering.
- Preserve buildApp and the original default-deny guards, cookie behavior, REST/MCP contracts, and idempotency semantics.
- Reuse the storage driver interface while checking filesystem and temporary-file dependencies throughout uploads and backups.
- Preserve child-process plugin isolation; do not claim existing plugins work in Workers.
- Validate realtime connection state, cross-instance events, scheduling, and offline replay separately.

## First acceptance milestone

The original frontend must perform real login, trip/place creation and editing, sorting, durable persistence after reload, and cross-user authorization checks on the target runtime. Existing Node/SQLite regression checks must remain green. Static assets, mocked APIs, and a similar replacement UI do not satisfy this milestone.

Subsequent milestones cover maps, reservations, budgets, attachments, and narrowly scoped upstream contributions after agreement. Use synthetic examples only; never publish personal travel records, booking references, or credentials.
