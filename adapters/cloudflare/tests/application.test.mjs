import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

test('original Nest application authenticates, validates, persists trips and places, reorders itinerary, and isolates users', {timeout:120000}, async () => {
  const storage = await mkdtemp(join(tmpdir(), 'trek-app-'));
  const script = await readFile('dist/worker.js', 'utf8');
  const start = () => new Miniflare({
    modules: [{type:'ESModule',path:'worker.js',contents:script}],
    compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],
    durableObjects:{TREK:{className:'TrekDatabase',useSQLite:true}},durableObjectsPersist:storage,
    bindings:{NODE_ENV:'production',TREK_INITIAL_REGISTRATION:'true',TREK_PLUGINS_ENABLED:'false',ADMIN_EMAIL:'test@example.invalid',ADMIN_PASSWORD:'test-only-password-0000000000000000',JWT_SECRET:'test-only-jwt-000000000000000000000000',ENCRYPTION_KEY:'test-only-key-000000000000000000000000'},
  });
  let mf = start();
  async function request(path, expected, method='GET', body, token) {
    const r = await mf.dispatchFetch('https://test'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
    const data = await r.json();
    assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return {data,response:r};
  }
  try {
    await request('/api/trips',401);
    await request('/api/backup',501);
    await request('/ws',501);
    const wsRejected = await mf.dispatchFetch('https://test/ws', { headers: { upgrade: 'websocket' } });
    assert.equal(wsRejected.status, 401);
    const {data:capabilities} = await request('/api/runtime-capabilities',200);
    assert.equal(capabilities.attachments,false);
    assert.equal(capabilities.scheduledTasks,true);
    assert.deepEqual(capabilities.realtime,{websocket:true,tripRooms:true});
    assert.deepEqual(capabilities.maps,{osm:true,trekPlaces:true,googlePlaces:false});
    const {data:login,response} = await request('/api/auth/login',200,'POST',{email:'test@example.invalid',password:'test-only-password-0000000000000000'});
    const owner = login.token;
    assert.ok(owner);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /Secure/i);
    await request('/api/auth/me',200,'GET',undefined,owner);
    await request('/api/trips',400,'POST',{},owner);
    const {data:{trip}} = await request('/api/trips',201,'POST',{title:'Workers trip',start_date:'2026-10-01',end_date:'2026-10-03'},owner);
    const base = `/api/trips/${trip.id}`;
    const {data:{place:first}} = await request(base+'/places',201,'POST',{name:'First stop',lat:35,lng:139},owner);
    const {data:{place:second}} = await request(base+'/places',201,'POST',{name:'Second stop',lat:36,lng:140},owner);
    await request(base+`/places/${first.id}`,200,'PUT',{name:'Updated first stop'},owner);
    const {data:dayData} = await request(base+'/days',200,'GET',undefined,owner);
    const days = dayData.days ?? dayData;
    const assignments = base+`/days/${days[0].id}/assignments`;
    const {data:{assignment:a}} = await request(assignments,201,'POST',{place_id:first.id},owner);
    const {data:{assignment:b}} = await request(assignments,201,'POST',{place_id:second.id},owner);
    await request(assignments+'/reorder',200,'PUT',{orderedIds:[b.id,a.id]},owner);
    const {data:ordered} = await request(assignments,200,'GET',undefined,owner);
    assert.deepEqual(ordered.assignments.map(x=>x.id),[b.id,a.id]);
    const {data:other} = await request('/api/auth/register',201,'POST',{username:'second_user',email:'second@example.invalid',password:'Second-test-password-1234'});
    assert.ok(other.token);
    await request(base,404,'GET',undefined,other.token);
    await request(base+'/places',404,'GET',undefined,other.token);
    await request(base,404,'PUT',{title:'unauthorized'},other.token);
    await request(assignments+'/reorder',404,'PUT',{orderedIds:[a.id,b.id]},other.token);
    await mf.dispose(); mf = start();
    const {data:restored} = await request(base,200,'GET',undefined,owner);
    assert.equal(restored.trip.title,'Workers trip');
    const {data:places} = await request(base+'/places',200,'GET',undefined,owner);
    assert.equal(places.places.find(x=>x.id===first.id).name,'Updated first stop');
    const {data:orderAfterRestart} = await request(assignments,200,'GET',undefined,owner);
    assert.deepEqual(orderAfterRestart.assignments.map(x=>x.id),[b.id,a.id]);
    await request(base+`/places/${first.id}`,200,'DELETE',undefined,owner);
    const {data:remaining} = await request(base+'/places',200,'GET',undefined,owner);
    assert.equal(remaining.places.length,1);
    await request(base,200,'DELETE',undefined,owner);
    await request(base,404,'GET',undefined,owner);
  } finally {await mf.dispose(); await rm(storage,{recursive:true,force:true});}
});
