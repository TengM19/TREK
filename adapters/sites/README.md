# Sites gateway

This experimental Sites deployment is a same-origin gateway to the fork owner's independent Cloudflare Worker. It serves the original TREK interface and uses that backend's SQLite Durable Object. It is deliberately **not** described as a Sites-native D1 backend.

The gateway forwards only TREK's own session cookie. It does not transmit Sites authentication cookies or the platform Authorization header to Cloudflare. Cross-origin mutations are rejected before forwarding, API responses are private/no-store, and redirects back to the backend are rewritten to the Sites origin. Public registration stays controlled by the TREK backend.

Run `node --test adapters/sites/worker.test.mjs` and `node adapters/sites/build.mjs` from the repository root. The build produces `dist/server/index.js` and copies the registered `.openai/hosting.json`. Publish that Worker output using Sites hosting. The Sites entry starts owner-private; TREK still asks for its separate application login.

The current gateway targets `https://trek-cloudflare-demo.teng-m95.workers.dev`. Changing backend ownership or hostname requires reviewing the explicit target and session-forwarding boundary. General API bearer tokens, OIDC/passkeys and non-core upstream functionality have not been accepted through this gateway; WebSocket upgrades are forwarded for the backend's realtime collaboration transport. The backend's Cloudflare Cron cleanup runs independently; Sites does not invoke scheduled jobs itself.
