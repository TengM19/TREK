/** Same-origin Sites gateway to this fork owner's independent Cloudflare runtime. */
// Keep the gateway source explicit so Sites local archives remain reproducible.
const BACKEND = 'https://trek-cloudflare-demo.teng-m95.workers.dev';

export async function handle(request, upstreamFetch = fetch) {
  const incoming = new URL(request.url);
  const origin = request.headers.get('origin');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (unsafe && origin && origin !== incoming.origin) {
    return Response.json({error:'Cross-origin request rejected'}, {status:403});
  }
  const target = new URL(incoming.pathname + incoming.search, BACKEND);
  const headers = new Headers();
  for (const key of ['accept', 'content-type', 'if-none-match', 'if-modified-since', 'range', 'x-socket-id', 'idempotency-key']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  // Never forward the Sites platform's authentication headers/cookies to another host.
  const trekSession = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith('trek_session='));
  if (trekSession) headers.set('cookie', trekSession);
  if (origin) headers.set('origin', BACKEND);
  const response = await upstreamFetch(target, {
    method:request.method, headers, redirect:'manual',
    ...(!['GET','HEAD'].includes(request.method) ? {body:request.body,duplex:'half'} : {}),
  });
  const returnedHeaders = new Headers(response.headers);
  const location = returnedHeaders.get('location');
  if (location?.startsWith(BACKEND + '/')) returnedHeaders.set('location', incoming.origin + location.slice(BACKEND.length));
  if (incoming.pathname.startsWith('/api/')) returnedHeaders.set('cache-control', 'private, no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:returnedHeaders});
}

export default { fetch(request) { return handle(request); } };
