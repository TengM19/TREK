import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle} from './worker.mjs';
test('gateway forwards only the TREK session, keeps auth responses private and rejects cross-origin writes', async()=>{
 let calls=0;
 const transport=async(url,options)=>{
  calls++;
  assert.equal(url.origin,'https://trek-cloudflare-demo.teng-m95.workers.dev');
  assert.equal(options.headers.get('authorization'),null);
  assert.equal(options.headers.get('cookie'),'trek_session=trek-only');
  return new Response('{}',{headers:{'set-cookie':'trek_session=renewed; Secure; HttpOnly; SameSite=Lax'}});
 };
 const response=await handle(new Request('https://example.sites.test/api/auth/me',{headers:{authorization:'platform-secret',cookie:'platform_auth=secret; trek_session=trek-only; another_secret=hidden'}}),transport);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.match(response.headers.get('set-cookie'),/trek_session=renewed/);
 const denied=await handle(new Request('https://example.sites.test/api/trips',{method:'POST',headers:{origin:'https://attacker.test'}}),transport);
 assert.equal(denied.status,403);
 assert.equal(calls,1);
});
