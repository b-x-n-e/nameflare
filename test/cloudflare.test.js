import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare/worker.js';
import { D1Store } from '../cloudflare/store.js';
class LocalD1 {
  constructor(){this.db=new DatabaseSync(':memory:');for(const migration of ['0001_initial.sql','0002_profile_avatars.sql','0003_flare_publication.sql','0004_account_moderation.sql','0005_cosmetic_likes.sql','0006_full_profiles.sql','0007_creator_follows.sql','0008_flare_submission_limit.sql'])this.db.exec(readFileSync(new URL(`../cloudflare/migrations/${migration}`,import.meta.url),'utf8'));}
  prepare(sql){const db=this.db;let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args) || null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}
  async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
const recipe={colors:['#ff1a35','#ffffff'],animation:'none',speed:4,angle:120,glow:2};
const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function fixture(){
  const DB=new LocalD1(),objects=new Map();
  const env={DB,TEXTURES:{async put(id,bytes){objects.set(id,new Uint8Array(bytes));},async get(id){const bytes=objects.get(id);return bytes?{body:bytes}:null;}},ASSETS:{async fetch(request){return new Response(new URL(request.url).pathname);}},READ_LIMITER:{async limit(){return {success:true};}},WRITE_LIMITER:{async limit(){return {success:true};}},PUBLIC_BASE_URL:'https://nameflare.example',OWNER_TWITCH_ID:'1001',SOURCE_URL:'https://example.com/source',TWITCH_CLIENT_ID:'client',TWITCH_CLIENT_SECRET:'secret'};
  const store=new D1Store(DB);
  const request=(path,data,session,headers={})=>worker.fetch(new Request(env.PUBLIC_BASE_URL+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:env.PUBLIC_BASE_URL}),...(session?{Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)}),env);
  return {env,store,request,close:()=>DB.db.close()};
}
test('Workers creator → private R2 → approval → equip → revocation with CSRF and owner/mod guards',async()=>{
  const f=fixture();const {store,request}=f;
  try{
    const creatorId=await store.linkIdentity({provider:'twitch',id:'1002',name:'Creator',login:'creator'},null,'1001');
    const ownerId=await store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const creator=await store.newSession(creatorId),owner=await store.newSession(ownerId);
    assert.equal((await request('/api/config')).status,200);assert.equal((await (await request('/api/me',undefined,owner)).json()).user.role,'owner');
    assert.equal((await request('/api/textures',{data:gif},creator,{'X-CSRF-Token':'bad'})).status,403);
    const upload=await request('/api/textures',{data:gif},creator);assert.equal(upload.status,201);const {id}=await upload.json();
    assert.equal((await request(`/textures/${id}`)).status,401);
    assert.equal((await request('/api/cosmetics',{name:'Stolen',recipe:{...recipe,textureId:id}},owner)).status,400);
    const submitted=await request('/api/cosmetics',{name:'GIF stack',recipe:{...recipe,layers:[{type:'image',textureId:id,opacity:.7},{type:'solid',color:'#ff1a35',opacity:.2}]}},creator);assert.equal(submitted.status,201);const c=(await submitted.json()).cosmetic;
    assert.equal((await request('/api/admin/review',{id:c.id,status:'approved'},creator)).status,403);
    await store.run("UPDATE users SET role='moderator' WHERE id=?",creatorId);
    assert.equal((await request('/api/admin/review',{id:c.id,status:'approved'},creator)).status,403);
    assert.equal((await request('/api/admin/review',{id:c.id,status:'approved'},owner)).status,200);
    assert.equal((await request('/api/equip',{cosmeticId:c.id},creator)).status,200);
    const resolved=await (await request('/api/v1/resolve',{provider:'twitch',ids:['1002','unknown']})).json();assert.equal(resolved.users.length,1);assert.equal(resolved.users[0].cosmetic.id,c.id);
    const texture=await request(`/textures/${id}`);assert.equal(texture.headers.get('Cache-Control'),'public, max-age=15, must-revalidate');assert.equal(Buffer.from(await texture.arrayBuffer()).toString('base64'),gif.split(',')[1]);
    assert.equal((await request('/api/admin/review',{id:c.id,status:'rejected',reason:'Flashing'},owner)).status,200);
    assert.equal((await store.user(creatorId)).equipped,null);assert.equal((await request(`/textures/${id}`)).status,401);
    const revoked=await request(`/api/v1/cosmetics/${c.id}`);assert.equal(revoked.status,404);assert.equal(revoked.headers.get('Cache-Control'),'no-store');assert.equal(revoked.headers.get('Access-Control-Allow-Origin'),'*');
    assert.equal((await store.auditLog()).length,2);
    assert.equal((await request('/api/admin/moderators',{twitchId:'1002',enabled:false},owner)).status,200);assert.equal((await store.user(creatorId)).role,'user');
    assert.equal((await request('/api/overlay/events')).status,501);
  }finally{f.close();}
});
test('Workers accept safe enhanced effects and reject out-of-contract controls',async()=>{
  const f=fixture();try{
    const id=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001'),session=await f.store.newSession(id);
    const enhanced={...recipe,animation:'spectrum',direction:'reverse',letterSpacing:2,layers:[{type:'solid',color:'#ff00ff80',blendMode:'screen'}]};
    const result=await f.request('/api/cosmetics',{name:'Enhanced Flare',recipe:enhanced},session);assert.equal(result.status,201);const c=(await result.json()).cosmetic;
    const published=(await (await f.request(`/api/v1/cosmetics/${c.id}`)).json()).cosmetic;assert.equal(published.recipe.direction,'reverse');assert.equal(published.recipe.letterSpacing,2);assert.equal(published.recipe.layers[0].blendMode,'screen');
    for(const patch of [{direction:'backwards'},{letterSpacing:7},{layers:[{type:'solid',color:'#ffffff',blendMode:'url(evil)'}]}])assert.equal((await f.request('/api/cosmetics',{name:'Invalid effect',recipe:{...enhanced,...patch}},session)).status,400);
  }finally{f.close();}
});
test('Workers image-only and mixed Flare uploads enforce the same distinct asset limits',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001'),owner=await f.store.newSession(ownerId);
    const otherGif=Buffer.from(gif.split(',')[1],'base64');otherGif[13]=100;
    const ids=[];for(const data of [gif,`data:image/gif;base64,${otherGif.toString('base64')}`,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=']){
      const response=await f.request('/api/textures',{data},owner);assert.equal(response.status,201);ids.push((await response.json()).id);
    }
    const [a,b,c]=ids,image=textureId=>({type:'image',textureId});
    for(const patch of [{layers:[image(a),image(b)]},{textureId:a,layers:[image(b)]},{textureId:`${'e'.repeat(64)}.webp`,layers:[image(c)]}]){
      const response=await f.request('/api/cosmetics',{name:'Over limit',recipe:{...recipe,...patch}},owner);assert.equal(response.status,400);assert.match((await response.json()).error,/1 GIF and 1 image/);
    }
    for(const layers of [[image(c)],[image(a),image(c)],[image(a),image(a),image(c)]]){
      const response=await f.request('/api/cosmetics',{name:'Image only',recipe:{...recipe,glow:0,layers}},owner);assert.equal(response.status,201);const cosmetic=(await response.json()).cosmetic;
      const published=(await (await f.request(`/api/v1/cosmetics/${cosmetic.id}`)).json()).cosmetic;assert.equal(published.recipe.layers.length,layers.length);
    }
  }finally{f.close();}
});

test('Workers public moderator indicators match Node and update on demotion and bans',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const id=await f.store.linkIdentity({provider:'twitch',id:'3',name:'Moderator',login:'moderator'},null,'1001'),owner=await f.store.user(ownerId);
    const read=async id=>(await (await f.request(`/api/v1/profiles/${id}`)).json()).user;
    assert.equal((await read(id)).is_moderator,false);assert.equal((await read(ownerId)).is_moderator,false);
    await f.store.setModerator(owner,'3',true);
    const user=await read(id);assert.equal(user.is_moderator,true);
    for(const key of ['role','banned_at','ban_reason','equipped','csrf','following_ids'])assert.equal(user[key],undefined);
    assert.equal((await (await f.request('/api/v1/profiles?q=moderator')).json()).users[0].is_moderator,true);
    await f.store.setFollow(ownerId,id,true);assert.equal((await f.store.followingProfiles(ownerId))[0].is_moderator,true);
    await f.store.setModerator(owner,'3',false);assert.equal((await read(id)).is_moderator,false);
    await f.store.setModerator(owner,'3',true);await f.store.setBan(owner,id,true,'Testing badge privacy');
    assert.equal((await f.request(`/api/v1/profiles/${id}`)).status,404);
    assert.equal((await (await f.request('/api/v1/profiles?q=moderator')).json()).users.length,0);
  }finally{f.close();}
});

test('D1 constraints prevent races, identity takeover, quota bypass and replayed state',async()=>{
  const f=fixture();const {store}=f;
  try{
    const p=id=>({provider:'twitch',id,login:id,name:id});const one=await store.linkIdentity(p('1'),null,'1001'),two=await store.linkIdentity(p('2'),null,'1001');
    await assert.rejects(()=>store.linkIdentity(p('1'),two,'1001'),e=>e.status===409);
    await assert.rejects(()=>store.run('INSERT INTO identities (provider,provider_id,user_id,login,display_name) VALUES (?,?,?,?,?)','twitch','1',two,'stolen','stolen'),/Identity already linked/);
    const state=await store.state('kick',one,'browser','verifier');await assert.rejects(()=>store.consumeState(state,'kick','attacker'),e=>e.status===400);assert.equal((await store.consumeState(state,'kick','browser')).user_id,one);await assert.rejects(()=>store.consumeState(state,'kick','browser'),e=>e.status===400);
    for(let i=0;i<3;i++)await store.submit(one,`Flare ${i}`,'',recipe);await assert.rejects(()=>store.submit(one,'Fourth','',recipe),e=>e.status===429);
    await assert.rejects(()=>store.run('UPDATE users SET equipped=? WHERE id=?','unknown',one),/Only approved/);
  }finally{f.close();}
});
test('Workers enforce the three-Flare cap atomically across status and staff changes',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001'),id=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Artist',login:'artist'},null,'1001');
    const session=await f.store.newSession(id),owner=await f.store.user(ownerId);
    const responses=await Promise.all(Array.from({length:5},(_,i)=>f.request('/api/cosmetics',{name:`Flare ${i}`,recipe,listed:i!==1},session)));
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,201,201,429,429]);const items=await f.store.mine(id);assert.equal(items.length,3);
    await f.store.review(owner,items[0].id,'approved','');await f.store.review(owner,items[1].id,'rejected','Test feedback');
    assert.equal((await f.request('/api/cosmetics',{name:'Fourth',recipe},session)).status,429);
    await assert.rejects(()=>f.store.run("INSERT INTO cosmetics (id,owner_id,name,description,recipe,status,created_at) VALUES (?,?,?,?,?,'approved','2026-01-01')",'bypass',id,'Bypass','',JSON.stringify(recipe)),/Flare submission limit/);
    await f.store.setModerator(owner,'2',true);for(let i=0;i<5;i++)assert.equal((await f.request('/api/cosmetics',{name:`Staff ${i}`,recipe},session)).status,201);
    await f.store.setModerator(owner,'2',false);assert.equal((await f.store.mine(id)).length,8);assert.equal((await f.request('/api/cosmetics',{name:'Demoted',recipe},session)).status,429);
    for(let i=0;i<5;i++)await f.store.submit(ownerId,`Owner ${i}`,'',recipe);
  }finally{f.close();}
});

test('Workers OAuth callback binds provider/browser, rotates session and bootstraps only numeric owner',async()=>{
  const f=fixture(),originalFetch=globalThis.fetch;
  try{
    const started=await f.request('/auth/twitch');assert.equal(started.status,302);const auth=new URL(started.headers.get('Location'));assert.equal(auth.searchParams.get('redirect_uri'),'https://nameflare.example/auth/twitch/callback');
    const binding=started.headers.get('Set-Cookie').split(';')[0];assert.match(started.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax.*Secure/);
    globalThis.fetch=async url=>String(url).includes('/token')?Response.json({access_token:'temporary'}):Response.json({data:[{id:'1001',login:'bxne',display_name:'B_X_N_E',profile_image_url:'https://static-cdn.jtvnw.net/user.png'}]});
    const path=`/auth/twitch/callback?state=${auth.searchParams.get('state')}&code=test`;
    assert.equal((await f.request(path,undefined,undefined,{Cookie:'nameflare_oauth_twitch=wrong'})).status,400);
    const result=await f.request(path,undefined,undefined,{Cookie:binding});assert.equal(result.status,302);assert.equal(result.headers.get('Location'),'/account');
    const sessionCookie=result.headers.get('Set-Cookie').match(/nameflare_session=([^;]+)/)[1];const me=await (await f.request('/api/me',undefined,undefined,{Cookie:`nameflare_session=${sessionCookie}`})).json();assert.equal(me.user.role,'owner');assert.equal(me.user.avatar_url,'https://static-cdn.jtvnw.net/user.png');assert.equal(me.user.profile_provider,'twitch');
    assert.equal((await f.request(path,undefined,undefined,{Cookie:binding})).status,400);
  }finally{globalThis.fetch=originalFetch;f.close();}
});
test('Workers profile settings, private account table, and review history match Node permissions',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',login:'owner',name:'Owner'},null,'1001');
    const id=await f.store.linkIdentity({provider:'twitch',id:'42',login:'creator',name:'Creator',avatar_url:'https://static-cdn.jtvnw.net/a.png'},null,'1001');
    const owner=await f.store.newSession(ownerId),creator=await f.store.newSession(id);
    await f.store.linkIdentity({provider:'kick',id:'7',login:'kick',name:'Kick Creator',avatar_url:'https://files.kick.com/a.png'},id,'1001');
    assert.equal((await f.store.account(id)).name,'Creator');
    assert.equal((await f.request('/api/admin/users',undefined,creator)).status,403);
    assert.equal((await f.request('/api/account/profile',{provider:'kick'},creator,{'X-CSRF-Token':'bad'})).status,403);
    const updated=await (await f.request('/api/account/profile',{provider:'kick'},creator)).json();assert.equal(updated.user.name,'Kick Creator');assert.equal(updated.user.avatar_url,'https://files.kick.com/a.png');
    assert.equal((await f.request('/api/account/profile',{provider:'youtube'},creator)).status,400);
    const users=await (await f.request('/api/admin/users?q=creator',undefined,owner)).json();assert.equal(users.users.length,1);assert.equal(users.users[0].identities.length,2);assert.equal(users.users[0].twitch_id,'42');
    const paint=await f.store.submit(id,'History paint','Original',recipe);
    const pending=await (await f.request('/api/admin/queue',undefined,owner)).json();assert.equal(pending.cosmetics[0].creator_identities.length,2);assert.equal(pending.cosmetics[0].creator_avatar,'https://files.kick.com/a.png');
    await f.request('/api/admin/review',{id:paint.id,status:'approved',reason:'Readable'},owner);
    const approved=await (await f.request('/api/admin/queue?status=approved',undefined,owner)).json();assert.equal(approved.cosmetics[0].reviewer,'Owner');assert.ok(approved.cosmetics[0].reviewed_at);
    await f.request('/api/admin/review',{id:paint.id,status:'rejected',reason:'Rights concern'},owner);
    const rejected=await (await f.request('/api/admin/queue?status=rejected',undefined,owner)).json();assert.equal(rejected.stats.rejected,1);assert.equal(rejected.cosmetics[0].reason,'Rights concern');
    for(const path of ['/api/admin/queue?status=all','/api/admin/queue?offset=-1','/api/admin/users?offset=NaN'])assert.equal((await f.request(path,undefined,owner)).status,400);
    const role=await f.request('/api/admin/moderators',{twitchId:'42',enabled:true},owner);assert.equal(role.status,200);
    assert.equal((await f.request('/api/admin/queue',undefined,creator)).status,200);assert.equal((await f.request('/api/admin/users',undefined,creator)).status,200);
    await f.request('/api/admin/moderators',{twitchId:'42',enabled:false},owner);assert.equal((await f.request('/api/admin/queue',undefined,creator)).status,403);
  }finally{f.close();}
});

test('Workers creator follows keep mutations guarded and personalized reads private and approved-only',async()=>{
  const f=fixture();try{
    const profile=id=>({provider:'twitch',id,name:`Creator ${id}`,login:`creator${id}`});
    const ownerId=await f.store.linkIdentity(profile('1001'),null,'1001'),id=await f.store.linkIdentity(profile('2'),null,'1001'),other=await f.store.linkIdentity(profile('3'),null,'1001');
    const session=await f.store.newSession(id),otherSession=await f.store.newSession(other),endpoint='/api/profiles/follow';
    assert.equal((await f.request(endpoint,{id:ownerId,following:true})).status,401);
    for(const headers of [{'X-CSRF-Token':'bad'},{Origin:'https://evil.example'}])assert.equal((await f.request(endpoint,{id:ownerId,following:true},session,headers)).status,403);
    for(const following of [undefined,null,1,'true'])assert.equal((await f.request(endpoint,{id:ownerId,following},session)).status,400);
    assert.equal((await f.request(endpoint,{id,following:true},session)).status,400);assert.equal((await f.request(endpoint,{id:'missing',following:true},session)).status,404);
    for(let i=0;i<2;i++)assert.deepEqual(await (await f.request(endpoint,{id:ownerId,following:true},session)).json(),{id:ownerId,following:true});
    assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM creator_follows')).n,1);
    assert.deepEqual((await (await f.request('/api/me',undefined,session)).json()).following_ids,[ownerId]);assert.deepEqual((await (await f.request('/api/me',undefined,otherSession)).json()).following_ids,[]);
    const user=(await (await f.request(`/api/v1/profiles/${ownerId}`)).json()).user;for(const key of ['following_ids','following','followers','follower_ids'])assert.equal(user[key],undefined);
    for(const path of ['/api/my/feed','/api/my/following']){assert.equal((await f.request(path)).status,401);for(const query of ['limit=101','offset=-1','offset=NaN','limit=1.5'])assert.equal((await f.request(`${path}?${query}`,undefined,session)).status,400);}
    const secret=await f.store.submit(ownerId,'Hidden','',recipe,false);await f.store.submit(id,'Pending','',recipe);
    const paints=[];for(let i=0;i<27;i++)paints.push(await f.store.submit(ownerId,`Followed ${i}`,'',recipe));
    await f.store.run('UPDATE cosmetics SET reviewed_at=? WHERE id=?','2099-01-01T00:00:00.000Z',paints.at(-1).id);
    const response=await f.request('/api/my/feed?limit=24&sort=liked',undefined,session);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);const page=await response.json(),next=await (await f.request('/api/my/feed?limit=24&offset=24',undefined,session)).json();assert.equal(page.next_offset,24);assert.equal(next.next_offset,null);assert.equal(page.cosmetics[0].id,paints.at(-1).id);assert.equal(new Set([...page.cosmetics,...next.cosmetics].map(c=>c.id)).size,27);assert.ok([...page.cosmetics,...next.cosmetics].every(c=>c.id!==secret.id && c.listed && c.creator_id===ownerId && c.owner_id===undefined));
    assert.equal((await f.request('/api/my/feed?effect=invalid',undefined,session)).status,400);
    assert.equal((await (await f.request('/api/my/feed?q=Followed%2026&effect=glow',undefined,session)).json()).cosmetics[0].id,paints.at(-1).id);
    const list=await f.request('/api/my/following',undefined,session);assert.equal(list.headers.get('Cache-Control'),'no-store');assert.equal((await list.json()).users[0].id,ownerId);
    assert.deepEqual((await (await f.request('/api/my/feed',undefined,otherSession)).json()).cosmetics,[]);assert.deepEqual(await f.store.likedIds(id),[]);assert.equal((await f.store.user(id)).equipped,null);
    await f.store.setPublication(ownerId,paints.at(-1).id,false);assert.ok(!(await f.store.catalog({followedBy:id})).some(c=>c.id===paints.at(-1).id));
    await f.request(endpoint,{id:ownerId,following:false},session);await f.request(endpoint,{id:ownerId,following:false},session);assert.deepEqual(await f.store.followingIds(id),[]);
    await f.request(endpoint,{id:other,following:true},session);await f.store.setBan(await f.store.user(ownerId),other,true,'Testing');assert.deepEqual(await f.store.followingIds(id),[]);assert.deepEqual(await f.store.catalog({followedBy:id}),[]);assert.equal((await f.request(endpoint,{id:other,following:true},session)).status,404);
    await f.store.setBan(await f.store.user(ownerId),other,false);assert.deepEqual(await f.store.followingIds(id),[other]);
    for(let i=200;i<226;i++){const creator=await f.store.linkIdentity(profile(String(i)),null,'1001');await f.store.setFollow(id,creator,true);}
    const followedPage=await (await f.request('/api/my/following?limit=24',undefined,session)).json(),followedNext=await (await f.request('/api/my/following?limit=24&offset=24',undefined,session)).json();assert.equal(followedPage.next_offset,24);assert.equal(followedNext.next_offset,null);assert.equal(new Set([...followedPage.users,...followedNext.users].map(u=>u.id)).size,27);
    await f.store.setBan(await f.store.user(ownerId),id,true,'Testing');assert.deepEqual(await f.store.followingIds(id),[]);assert.deepEqual(await f.store.catalog({followedBy:id}),[]);assert.equal((await f.request('/api/my/feed',undefined,session)).status,401);
  }finally{f.close();}
});

test('Workers full profiles validate fields and keep public stats scoped to listed approved paints',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const id=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Artist',login:'artist'},null,'1001'),viewer=await f.store.linkIdentity({provider:'twitch',id:'3',name:'Viewer',login:'viewer'},null,'1001'),session=await f.store.newSession(id);
    assert.equal((await f.request('/api/account/profile',{provider:'twitch',bio:'test'})).status,401);
    assert.equal((await f.request('/api/account/profile',{provider:'twitch',bio:'test'},session,{'X-CSRF-Token':'bad'})).status,403);
    for(const input of [{bio:42},{bio:'a'.repeat(281)},{profile_color:'red'},{profile_color:null}])assert.equal((await f.request('/api/account/profile',{provider:'twitch',...input},session)).status,400);
    await f.request('/api/account/profile',{provider:'twitch',bio:'My style',profile_color:'#AABBCC'},session);
    await f.request('/api/account/profile',{provider:'twitch'},session);assert.equal((await f.store.account(id)).bio,'My style');
    const paint=await f.store.submit(id,'Public paint','',recipe),unlisted=await f.store.submit(id,'Unlisted','',recipe,false);await f.store.submit(id,'Pending','',recipe);
    for(const c of [paint,unlisted])await f.store.review(await f.store.user(ownerId),c.id,'approved','');
    await f.store.setLike(viewer,paint.id,true);await f.store.equip(viewer,paint.id);await f.store.equip(id,unlisted.id);
    const result=await (await f.request(`/api/v1/profiles/${id}`)).json();assert.equal(result.user.bio,'My style');assert.equal(result.user.profile_color,'#aabbcc');assert.deepEqual(result.user.stats,{paints:1,likes:1,wears:1});assert.equal(result.user.cosmetic.id,unlisted.id);
    for(const key of ['role','liked_ids','equipped','ban_reason','csrf'])assert.equal(result.user[key],undefined);
    const gallery=await (await f.request(`/api/v1/profiles/${id}/cosmetics`)).json();assert.deepEqual(gallery.cosmetics.map(c=>c.id),[paint.id]);assert.equal(gallery.cosmetics[0].creator_id,id);assert.equal(gallery.cosmetics[0].owner_id,undefined);
    await f.store.setBan(await f.store.user(ownerId),viewer,true,'Abuse');assert.deepEqual({...((await f.store.publicProfile(id)).stats)},{paints:1,likes:0,wears:0});
  }finally{f.close();}
});

test('Workers public/unlisted Flares preserve approval, creator controls, discovery and universal equips',async()=>{
  const f=fixture();try{
    const creatorId=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Artist',login:'artist'},null,'1');
    const viewerId=await f.store.linkIdentity({provider:'twitch',id:'3',name:'Viewer',login:'viewer'},null,'1');
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1',name:'Owner',login:'owner'},null,'1');
    const creator=await f.store.newSession(creatorId),viewer=await f.store.newSession(viewerId);
    const response=await f.request('/api/cosmetics',{name:'Hidden signal',description:'A shared Flare',recipe,listed:false},creator);
    assert.equal(response.status,201);const c=(await response.json()).cosmetic;assert.equal(c.listed,0);
    assert.equal((await f.request(`/api/v1/cosmetics/${c.id}`)).status,404);
    assert.equal((await f.request('/api/cosmetics/publication',{id:c.id,listed:true},viewer)).status,403);
    assert.equal((await f.request('/api/cosmetics/publication',{id:c.id,listed:true},creator,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await f.request('/api/cosmetics',{name:'Invalid',recipe,listed:'false'},creator)).status,400);
    await f.store.review(await f.store.user(ownerId),c.id,'approved','Readable');
    let catalog=await (await f.request('/api/v1/cosmetics')).json();assert.equal(catalog.cosmetics.length,0);
    const publicFlare=(await (await f.request(`/api/v1/cosmetics/${c.id}`)).json()).cosmetic;assert.equal(publicFlare.description,'A shared Flare');assert.equal(publicFlare.listed,false);assert.equal(publicFlare.owner_id,undefined);
    assert.equal((await f.request('/api/equip',{cosmeticId:c.id},viewer)).status,200);
    const resolved=await (await f.request('/api/v1/resolve',{provider:'twitch',ids:['3']})).json();assert.equal(resolved.users[0].cosmetic.id,c.id);
    assert.equal((await f.request('/api/cosmetics/publication',{id:c.id,listed:true},creator)).status,200);
    catalog=await (await f.request('/api/v1/cosmetics?effect=static&sort=popular&limit=1')).json();assert.equal(catalog.total,1);assert.equal(catalog.cosmetics[0].equipped_count,1);assert.equal(catalog.next_offset,null);
    assert.equal((await (await f.request('/api/v1/cosmetics?effect=depth')).json()).cosmetics.length,0);
    for(const query of ['effect=invalid','sort=invalid'])assert.equal((await f.request(`/api/v1/cosmetics?${query}`)).status,400);
    await f.store.setPublication(creatorId,c.id,false);assert.equal((await f.store.user(viewerId)).equipped,c.id);
    await f.store.review(await f.store.user(ownerId),c.id,'rejected','Rights concern');assert.equal((await f.store.user(viewerId)).equipped,null);
    await f.store.setPublication(creatorId,c.id,true);assert.equal((await f.request(`/api/v1/cosmetics/${c.id}`)).status,404);
  }finally{f.close();}
});

test('Workers created-Flare galleries preserve privacy and paginate beyond collection caps',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const creatorId=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Artist',login:'artist'},null,'1001'),creator=await f.store.newSession(creatorId);
    // Import a pre-cap legacy fixture through staff; regular submissions remain capped.
    const legacy=async(name,listed=true)=>{const c=await f.store.submit(ownerId,name,'',recipe,listed);await f.store.run("UPDATE cosmetics SET owner_id=?,status='pending' WHERE id=?",creatorId,c.id);return f.store.getCosmetic(c.id);};
    for(let i=0;i<105;i++){const c=await legacy(`Created ${i}`);await f.store.review(await f.store.user(ownerId),c.id,'approved','');}
    const unlisted=await legacy('Unlisted',false);await f.store.review(await f.store.user(ownerId),unlisted.id,'approved','');
    const pending=await legacy('Pending'),rejected=await legacy('Rejected');await f.store.review(await f.store.user(ownerId),rejected.id,'rejected','Needs changes');
    await f.store.submit(ownerId,'Other creator','',recipe);
    assert.equal((await f.request('/api/my/cosmetics?limit=24')).status,401);
    const mine=[];let offset=0;
    do{const page=await (await f.request(`/api/my/cosmetics?limit=24&offset=${offset}`,undefined,creator)).json();mine.push(...page.cosmetics);offset=page.next_offset;}while(offset!==null);
    assert.equal(mine.length,108);assert.equal(new Set(mine.map(c=>c.id)).size,108);assert.ok(mine.every(c=>c.owner_id===creatorId));
    for(const c of [unlisted,pending,rejected])assert.ok(mine.some(item=>item.id===c.id));
    const gallery=[];offset=0;
    do{const response=await f.request(`/api/v1/profiles/${creatorId}/cosmetics?limit=24&offset=${offset}`);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');const page=await response.json();gallery.push(...page.cosmetics);offset=page.next_offset;}while(offset!==null);
    assert.equal(gallery.length,105);assert.equal(new Set(gallery.map(c=>c.id)).size,105);
    for(const c of [unlisted,pending,rejected])assert.equal(gallery.some(item=>item.id===c.id),false);
    assert.ok(gallery.every(c=>c.owner_id===undefined && c.reason===undefined && c.listed===true));
    for(const query of ['offset=-1','limit=101','limit=1.5']){assert.equal((await f.request(`/api/v1/profiles/${creatorId}/cosmetics?${query}`)).status,400);assert.equal((await f.request(`/api/my/cosmetics?${query}`,undefined,creator)).status,400);}
    assert.equal((await f.request('/api/v1/profiles/missing/cosmetics')).status,404);
    await f.store.setBan(await f.store.user(ownerId),creatorId,true,'Abuse');assert.equal((await f.request(`/api/v1/profiles/${creatorId}/cosmetics`)).status,404);
  }finally{f.close();}
});

test('Workers staff publication, profiles, bans, and unlimited owner access',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const modId=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Moderator',login:'mod'},null,'1001');
    const userId=await f.store.linkIdentity({provider:'twitch',id:'3',name:'Artist',login:'artist'},null,'1001');
    const otherId=await f.store.linkIdentity({provider:'twitch',id:'4',name:'Viewer',login:'viewer'},null,'1001');
    await f.store.setModerator(await f.store.user(ownerId),'2',true);
    const owner=await f.store.newSession(ownerId),mod=await f.store.newSession(modId),user=await f.store.newSession(userId),other=await f.store.newSession(otherId);
    const post=(session,name,listed=true)=>f.request('/api/cosmetics',{name,recipe,listed},session);
    const staff=(await (await post(mod,'Staff Flare',false)).json()).cosmetic;assert.equal(staff.status,'approved');assert.ok(staff.reviewed_at);assert.equal(staff.reviewer_id,modId);
    assert.equal((await f.request(`/api/v1/cosmetics/${staff.id}`)).status,200);
    assert.equal((await f.request('/api/admin/review',{id:staff.id,status:'rejected',reason:'Own review'},mod)).status,403);
    await f.request('/api/equip',{cosmeticId:staff.id},user);
    const profiles=await (await f.request('/api/v1/profiles?q=artist')).json();assert.equal(profiles.users.length,1);assert.equal(profiles.users[0].cosmetic.id,staff.id);assert.equal(profiles.users[0].ban_reason,undefined);assert.equal(profiles.users[0].role,undefined);
    assert.equal((await (await f.request(`/api/v1/profiles/${userId}`)).json()).user.name,'Artist');
    assert.equal((await (await f.request('/api/v1/profiles?q=3')).json()).users[0].id,userId);
    assert.equal((await f.request('/api/v1/profiles?offset=-1')).status,400);
    const own=(await (await post(owner,'Owner Flare')).json()).cosmetic;assert.equal(own.status,'approved');
    assert.equal((await f.request('/api/admin/review',{id:own.id,status:'rejected',reason:'Owner review'},owner)).status,200);
    assert.equal((await f.request('/api/admin/review',{id:own.id,status:'approved'},owner)).status,200);
    assert.equal((await f.request('/api/cosmetics/publication',{id:staff.id,listed:true},owner)).status,200);
    const uploadId=(await (await f.request('/api/textures',{data:gif},user)).json()).id;
    const artwork=(await (await f.request('/api/cosmetics',{name:'Artist GIF',recipe:{...recipe,textureId:uploadId}},user)).json()).cosmetic;
    await f.request('/api/admin/review',{id:artwork.id,status:'approved'},mod);await f.request('/api/equip',{cosmeticId:artwork.id},other);
    for(const [session,id,expected] of [[user,otherId,403],[mod,ownerId,403],[mod,modId,403]])assert.equal((await f.request('/api/admin/ban',{id,banned:true,reason:'Abuse'},session)).status,expected);
    assert.equal((await f.request('/api/admin/ban',{id:userId,banned:true,reason:'Abuse'},mod,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await f.request('/api/admin/ban',{id:userId,banned:true,reason:'x'},mod)).status,400);
    assert.equal((await f.request('/api/admin/ban',{id:userId,banned:true,reason:'Abuse'},mod)).status,200);
    const bannedPage=await f.request('/api/admin/users?status=banned',undefined,mod);assert.equal(bannedPage.headers.get('Cache-Control'),'no-store');
    const bans=await bannedPage.json();assert.deepEqual(bans.users.map(account=>account.id),[userId]);assert.equal(bans.users[0].ban_reason,'Abuse');
    assert.equal((await (await f.request(`/api/admin/users?status=banned&q=${userId}`,undefined,owner)).json()).users.length,1);
    assert.equal((await (await f.request('/api/admin/users?status=active&q=artist',undefined,owner)).json()).users.length,0);
    assert.equal((await f.request('/api/admin/users?status=invalid',undefined,owner)).status,400);
    assert.equal((await f.request('/api/admin/users?status=__proto__',undefined,owner)).status,400);
    const bannedAt=(await f.store.user(userId)).banned_at,eventCount=(await f.store.auditLog()).length;
    await f.store.setBan(await f.store.user(modId),userId,true,'Duplicate');assert.equal((await f.store.user(userId)).banned_at,bannedAt);assert.equal((await f.store.auditLog()).length,eventCount);
    assert.equal(await f.store.session(user.raw),null);assert.equal((await f.request('/api/equip',{cosmeticId:null},user)).status,401);
    await assert.rejects(()=>f.store.linkIdentity({provider:'twitch',id:'3',login:'artist',name:'Artist'},null,'1001'),e=>e.status===403);
    await assert.rejects(()=>f.store.newSession(userId),e=>e.status===403);
    assert.equal((await f.request('/api/admin/review',{id:artwork.id,status:'approved'},owner)).status,403);
    assert.equal((await f.store.user(otherId)).equipped,null);assert.equal((await f.request(`/api/v1/profiles/${userId}`)).status,404);assert.equal((await f.request('/api/v1/users/twitch/3')).status,404);
    assert.equal((await (await f.request('/api/v1/resolve',{provider:'twitch',ids:['3']})).json()).users.length,0);
    assert.equal((await (await f.request('/api/v1/profiles?q=artist')).json()).users.length,0);assert.equal((await f.request(`/api/v1/cosmetics/${artwork.id}`)).status,404);assert.equal((await f.request(`/textures/${uploadId}`)).status,401);
    assert.equal((await f.request('/api/admin/ban',{id:userId,banned:false},mod)).status,200);assert.equal((await f.store.getCosmetic(artwork.id)).status,'rejected');
    assert.ok(await f.store.newSession(userId));
    assert.equal((await f.request('/api/admin/ban',{id:modId,banned:true,reason:'Abuse'},owner)).status,200);
    assert.equal((await f.request(`/api/v1/cosmetics/${staff.id}`)).status,404);
    assert.ok((await f.store.auditLog()).some(entry=>entry.action==='account.banned'));
    for(let i=0;i<105;i++)await f.store.submit(ownerId,`Owner ${i}`,'',recipe);
    assert.equal((await f.store.mine(ownerId)).length,106);
    for(let i=10;i<35;i++)await f.store.linkIdentity({provider:'twitch',id:String(i),name:`User ${i}`,login:`user${i}`},null,'1001');
    const profilePage=await (await f.request('/api/v1/profiles')).json();assert.equal(profilePage.users.length,24);assert.equal(profilePage.next_offset,24);
    const profileNext=await (await f.request('/api/v1/profiles?offset=24')).json();assert.equal(profileNext.next_offset,null);assert.ok(!profilePage.users.some(user=>user.id===profileNext.users[0].id));
    for(let i=0;i<50;i++)await f.store.run('INSERT INTO textures VALUES (?,?)',`owner-${i}`,ownerId);
    assert.equal((await f.request('/api/textures',{data:gif},owner)).status,409); // Ownership checks still apply.
    await f.store.run('DELETE FROM textures WHERE id=?',uploadId);
    assert.equal((await f.request('/api/textures',{data:gif},owner)).status,201);
    f.env.READ_LIMITER={async limit(){return {success:false};}};f.env.WRITE_LIMITER=f.env.READ_LIMITER;
    assert.equal((await f.request('/api/me',undefined,owner)).status,200);assert.equal((await f.request('/api/me',undefined,other)).status,429);
    assert.equal((await post(owner,'Unlimited owner')).status,201);
    assert.equal((await f.request('/api/equip',{cosmeticId:null},owner,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await f.request('/api/cosmetics',{name:'Unsafe',recipe:{...recipe,glow:999}},owner)).status,400);
  }finally{f.close();}
});

test('Workers post-style likes preserve uniqueness, CSRF, public counts and private liked galleries',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const userId=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Viewer',login:'viewer'},null,'1001'),user=await f.store.newSession(userId);
    const paint=await f.store.submit(ownerId,'Loved Flare','',recipe),second=await f.store.submit(ownerId,'Second Flare','',recipe),unlisted=await f.store.submit(ownerId,'Unlisted','',recipe,false);
    const like=(id,liked=true,headers={})=>f.request('/api/cosmetics/like',{id,liked},user,headers);
    assert.equal((await f.request('/api/cosmetics/like',{id:paint.id,liked:true})).status,401);
    assert.equal((await like(paint.id,true,{'X-CSRF-Token':'bad'})).status,403);assert.equal((await like(paint.id,true,{Origin:'https://evil.example'})).status,403);
    assert.equal((await like(paint.id,'true')).status,400);assert.equal((await like(unlisted.id)).status,404);
    assert.equal((await (await like(paint.id)).json()).like_count,1);assert.equal((await (await like(paint.id)).json()).like_count,1);
    await like(second.id);
    assert.deepEqual(new Set((await (await f.request('/api/me',undefined,user)).json()).liked_ids),new Set([paint.id,second.id]));
    assert.equal((await f.request('/api/my/likes')).status,401);
    const page=await (await f.request('/api/my/likes?limit=1',undefined,user)).json();assert.equal(page.total,2);assert.equal(page.cosmetics.length,1);assert.equal(page.next_offset,1);
    assert.equal((await f.request('/api/my/likes?offset=-1',undefined,user)).status,400);
    const catalog=await (await f.request('/api/v1/cosmetics?sort=liked')).json();assert.equal(catalog.cosmetics[0].like_count,1);assert.equal(catalog.cosmetics[0].liked,undefined);
    assert.equal((await (await like(paint.id,false)).json()).like_count,0);assert.equal((await (await like(paint.id,false)).json()).like_count,0);
    await f.store.setPublication(ownerId,second.id,false);assert.deepEqual(await f.store.likedIds(userId),[]);assert.equal((await like(second.id)).status,404);
    await f.store.setPublication(ownerId,second.id,true);await f.store.setBan(await f.store.user(ownerId),userId,true,'Abuse');assert.equal((await f.store.getCosmetic(second.id)).like_count,0);assert.equal((await like(second.id)).status,401);
  }finally{f.close();}
});

test('Workers trending separates recent likes from lifetime popularity',async()=>{
  const f=fixture();try{
    const ownerId=await f.store.linkIdentity({provider:'twitch',id:'1001',name:'Owner',login:'owner'},null,'1001');
    const viewerId=await f.store.linkIdentity({provider:'twitch',id:'2',name:'Viewer',login:'viewer'},null,'1001');
    const old=await f.store.submit(ownerId,'Old favorite','',recipe),recent=await f.store.submit(ownerId,'Fresh favorite','',recipe);
    await f.store.setLike(ownerId,old.id,true);await f.store.setLike(viewerId,old.id,true);
    await f.store.run("UPDATE cosmetic_likes SET created_at='2020-01-01T00:00:00.000Z' WHERE cosmetic_id=?",old.id);
    await f.store.setLike(viewerId,recent.id,true);
    const page=await (await f.request('/api/v1/cosmetics?sort=trending&limit=1')).json();assert.equal(page.cosmetics[0].id,recent.id);assert.equal(page.cosmetics[0].recent_like_count,1);
    assert.equal((await f.store.catalog({sort:'liked',limit:1}))[0].id,old.id);
  }finally{f.close();}
});

test('Workers fail closed on canonical origin, missing limiter and unavailable OAuth; static routing works',async()=>{
  const f=fixture();try{
    assert.equal((await worker.fetch(new Request('https://wrong.example/api/me'),f.env)).status,421);
    for(const path of ['/discover','/profiles/creator-id','/studio','/account/settings','/guide/effects'])assert.equal(await (await f.request(path)).text(),'/index.html');assert.equal(await (await f.request('/overlay')).text(),'/overlay.html');
    assert.equal((await f.request('/auth/kick')).status,503);
    delete f.env.READ_LIMITER;assert.equal((await f.request('/api/config')).status,503);
  }finally{f.close();}
});
