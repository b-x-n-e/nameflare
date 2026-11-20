import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NameflareClient,serviceOrigin,identityKey,normalizeCosmetic } from '../public/client.js';
const cosmetic={id:'paint-1',recipe:{colors:['#ff1a35','#ffffff'],animation:'shimmer',speed:4,angle:120,glow:3}};
const user=(provider,id,paint=cosmetic)=>({provider,provider_id:id,cosmetic:paint});
const response=users=>Response.json({users});
test('SDK trusts only explicit HTTPS/loopback origins and immutable provider IDs',()=>{
  assert.equal(serviceOrigin('https://nameflare.bxne.dev/'),'https://nameflare.bxne.dev');assert.equal(serviceOrigin('http://127.0.0.1:3100'),'http://127.0.0.1:3100');
  for(const value of ['http://example.com','https://example.com/api','https://user:pass@example.com','https://example.com?secret=x','javascript:alert(1)'])assert.equal(serviceOrigin(value),null);
  assert.equal(identityKey('twitch','123'),'twitch:123');assert.equal(identityKey('kick','123'),'kick:123');assert.equal(identityKey('youtube',`UC${'a'.repeat(22)}`),`youtube:UC${'a'.repeat(22)}`);
  for(const [provider,id]of [['twitch','display_name'],['youtube','video-id'],['twitch',123],['other','123'],['kick','message-uuid']])assert.equal(identityKey(provider,id),null);
});
test('SDK strips executable recipe fields and rejects invalid images/layers/effects',()=>{
  const clean=normalizeCosmetic({...cosmetic,recipe:{...cosmetic.recipe,css:'url(javascript:x)',html:'<img>',image_url:'https://evil/image'}});assert.deepEqual(clean.recipe,cosmetic.recipe);
  for(const patch of [{direction:'backwards'},{direction:'url(evil)'},{letterSpacing:7},{letterSpacing:NaN},{layers:[{type:'solid',color:'#ffffff',blendMode:'color-dodge'}]},{glow:Infinity},{depth:1.5},{outlineColor:'red'},{textureId:'https://evil/file.gif'},{layers:[]},{shadows:[{x:90,y:0,blur:0,color:'#ffffff'}]}])assert.equal(normalizeCosmetic({...cosmetic,recipe:{...cosmetic.recipe,...patch}}),null);
});
test('SDK preserves new animation, playback, spacing and allowlisted blend modes',()=>{
  const input={...cosmetic,recipe:{...cosmetic.recipe,animation:'spectrum',direction:'alternate-reverse',letterSpacing:1.5,layers:[{type:'solid',color:'#ffffff80',blendMode:'screen'}]}};
  const clean=normalizeCosmetic(input);assert.equal(clean.recipe.animation,'spectrum');assert.equal(clean.recipe.direction,'alternate-reverse');assert.equal(clean.recipe.letterSpacing,1.5);assert.equal(clean.recipe.layers[0].blendMode,'screen');
  assert.equal(normalizeCosmetic(cosmetic).recipe.direction,undefined,'legacy recipes do not acquire optional fields');
});
test('SDK separates platforms, batches deduplicated identities, omits credentials and negative-caches misses',async()=>{
  const requests=[],changes=[];let time=0;
  const client=new NameflareClient({now:()=>time,batchDelay:60000,onChange:(...v)=>changes.push(v),fetchImpl:async(url,options)=>{
    const data=JSON.parse(options.body);requests.push({url,options,data});return response(data.ids.filter(id=>id==='123').map(id=>user(data.provider,id)));
  }});
  try{
    client.get('twitch','123');client.get('twitch','123');client.get('kick','123');client.get('twitch','456');client.get('youtube','video-id');await client.flush();
    assert.equal(requests.length,2);assert.deepEqual(requests[0].data.ids,['123','456']);assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.redirect,'error');
    assert.equal(client.get('twitch','123').id,'paint-1');assert.equal(client.get('twitch','456'),null);assert.equal(client.pending.size,0);
    time=12001;client.expire();assert.ok(changes.some(([key,value])=>key==='twitch:123' && value===null));assert.equal(client.get('twitch','123'),null);
  }finally{client.close();}
});
test('SDK expires revoked and unreachable paints rather than serving stale; unknown response IDs cannot inject',async()=>{
  let time=0,mode='approved';const client=new NameflareClient({now:()=>time,batchDelay:60000,fetchImpl:async()=>{
    if(mode==='offline')throw new Error('offline');return response(mode==='approved'?[user('twitch','1')]:mode==='injected'?[user('twitch','2'),user('kick','1')]:[]);
  }});
  try{
    client.get('twitch','1');await client.flush();assert.ok(client.get('twitch','1'));
    time=12001;mode='offline';assert.equal(client.get('twitch','1'),null);await client.flush();assert.equal(client.get('twitch','1'),null);
    time=18002;mode='approved';client.get('twitch','1');await client.flush();assert.ok(client.get('twitch','1'));
    time=31000;mode='injected';client.get('twitch','1');await client.flush();assert.equal(client.get('twitch','1'),null);assert.equal(client.cache.has('twitch:2'),false);
  }finally{client.close();}
});
test('SDK refreshes before expiry without an unstyled gap and still fails closed',async()=>{
  let time=0,resolve,mode='deferred';const changes=[];
  const client=new NameflareClient({now:()=>time,batchDelay:60000,onChange:(...args)=>changes.push(args),fetchImpl:()=>mode==='offline'?Promise.reject(new Error('offline')):new Promise(r=>{resolve=r;})});
  try{
    client.get('twitch','1');let pending=client.flush();resolve(response([user('twitch','1')]));await pending;
    changes.length=0;time=7000;client.expire();assert.equal(client.pending.size,1);assert.ok(client.get('twitch','1'));assert.deepEqual(changes,[]);
    pending=client.flush();time=8000;assert.ok(client.get('twitch','1'));resolve(response([user('twitch','1')]));await pending;
    assert.ok(changes.every(([,value])=>value?.id===cosmetic.id));
    time=14000;client.expire();pending=client.flush();resolve(response([]));await pending;assert.equal(client.get('twitch','1'),null,'Revocation clears immediately');
    time=27000;client.get('twitch','1');pending=client.flush();resolve(response([user('twitch','1')]));await pending;
    time=34000;client.expire();mode='offline';await client.flush();assert.equal(client.get('twitch','1'),null,'Failure never extends verified state');
    mode='deferred';time=40000;client.get('twitch','1');pending=client.flush();resolve(response([user('twitch','1')]));await pending;
    time=47000;client.expire();pending=client.flush();time=52001;client.expire();assert.equal(client.get('twitch','1'),null,'A hanging refresh cannot keep expired state');resolve(response([user('twitch','1')]));await pending;
  }finally{client.close();}
});

test('SDK batches at most 100 IDs and prevents cancelled/old origin responses from restoring paints',async()=>{
  const sizes=[];const client=new NameflareClient({batchDelay:60000,fetchImpl:async(url,options)=>{sizes.push(JSON.parse(options.body).ids.length);return response([]);}});
  try{for(let i=0;i<205;i++)client.get('twitch',String(i));await client.flush();assert.deepEqual(sizes,[100,100,5]);}finally{client.close();}
  let resolve;const race=new NameflareClient({batchDelay:60000,fetchImpl:()=>new Promise(r=>resolve=r)});
  race.get('twitch','1');const pending=race.flush();race.clear();resolve(response([user('twitch','1')]));await pending;assert.equal(race.cache.size,0);race.close();
});
