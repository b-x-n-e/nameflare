import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';
const recipe={colors:['#ff1a35','#ffffff'],animation:'none',speed:4,angle:90,glow:0};
const profile=(id)=>({provider:'twitch',id,login:`user${id}`,name:`User ${id}`,avatar_url:'https://static-cdn.jtvnw.net/avatar.png'});

test('additive SQLite avatar migration preserves existing accounts and sessions across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-upgrade-')),path=join(dir,'database.sqlite');
  const old=new DatabaseSync(path);
  old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',equipped TEXT,created_at TEXT NOT NULL);
    CREATE TABLE identities (provider TEXT NOT NULL,provider_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),login TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(provider,provider_id),UNIQUE(user_id,provider));
    INSERT INTO users VALUES ('existing','Existing','user',NULL,'2026-01-01T00:00:00.000Z');
    INSERT INTO identities VALUES ('twitch','42','existing','existing','Existing');
    CREATE TABLE cosmetics (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,recipe TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT,reviewer_id TEXT);
    INSERT INTO cosmetics VALUES ('legacy','existing','Legacy Flare','', '{"colors":["#ff1a35","#ffffff"],"animation":"none","speed":4,"angle":90,"glow":0}', 'approved','','2026-01-01',NULL,NULL);`);old.close();
  let store=new Store(path);
  try{
    assert.equal(store.getCosmetic('legacy').listed,1);assert.equal(store.catalog({listedOnly:true})[0].id,'legacy');
    assert.equal(store.account('existing').name,'Existing');assert.equal(store.account('existing').avatar_url,'');assert.equal(store.account('existing').bio,'');assert.equal(store.account('existing').profile_color,'#ff355e');
    const session=store.newSession('existing');assert.equal(store.linkIdentity(profile('42'),null,'1'),'existing');
    store.close();store=new Store(path);assert.equal(store.session(session.raw).id,'existing');
    assert.equal(store.account('existing').avatar_url,profile('42').avatar_url);
    assert.equal(store.account('existing').profile_provider,'twitch');
    store.linkIdentity({provider:'kick',id:'7',login:'kick',name:'Kick name',avatar_url:'https://files.kick.com/avatar.png'},'existing','1');
    assert.equal(store.account('existing').name,'User 42','linking another platform does not replace preferred profile');
    assert.equal(store.updateProfile('existing','kick').name,'Kick name');
    assert.throws(()=>store.updateProfile('existing','youtube'),error=>error.status===400);
    store.linkIdentity({...profile('42'),name:'Renamed Twitch'},'existing','1');assert.equal(store.account('existing').name,'Kick name');
    assert.equal(store.updateProfile('existing','twitch').name,'Renamed Twitch');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node three-Flare cap counts every status, preserves legacy records and exempts staff',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-quota-')),path=join(dir,'db.sqlite');let store=new Store(path);
  const ownerId=store.linkIdentity(profile('1'),null,'1'),id=store.linkIdentity(profile('2'),null,'1'),modId=store.linkIdentity(profile('3'),null,'1');store.setModerator(store.user(ownerId),'3',true);
  const session=store.newSession(id),app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,submit=(session,listed=true)=>fetch(base+'/api/cosmetics',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost',Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf},body:JSON.stringify({name:'Quota Flare',recipe,listed})});
  try{
    const results=await Promise.all([submit(session),submit(session,false),submit(session),submit(session)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,201,201,429]);
    const items=store.mine(id);assert.equal(items.length,3);store.review(store.user(ownerId),items[0].id,'approved','');store.review(store.user(ownerId),items[1].id,'rejected','Test feedback');
    assert.equal((await submit(session)).status,429,'Approval, rejection, and unlisting do not free slots');
    for(const staffId of [ownerId,modId])for(let i=0;i<5;i++)assert.equal((await submit(store.newSession(staffId))).status,201);
    const extra=store.submit(ownerId,'Legacy extra','',recipe);store.db.prepare('UPDATE cosmetics SET owner_id=? WHERE id=?').run(id,extra.id);
    assert.equal(store.mine(id).length,4);assert.equal((await submit(session)).status,429);
    store.deleteRejected(store.user(ownerId),items[1].id);assert.equal((await submit(session)).status,429,'Still three existing designs');
    store.review(store.user(ownerId),items[2].id,'rejected','Test deletion');store.deleteRejected(store.user(ownerId),items[2].id);assert.equal((await submit(session)).status,201,'Permanent deletion frees a slot');
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();}
  store=new Store(path);try{assert.equal(store.mine(id).length,3);assert.throws(()=>store.submit(id,'Fourth','',recipe),e=>e.status===429);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node owner grants artists a persistent 20-Flare budget without moderation privileges',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-artist-')),path=join(dir,'db.sqlite');let store=new Store(path);
  const ownerId=store.linkIdentity(profile('1'),null,'1'),id=store.linkIdentity({provider:'kick',id:'2',login:'artist',name:'Artist'},null,'1'),modId=store.linkIdentity(profile('3'),null,'1');
  store.setModerator(store.user(ownerId),'3',true);
  const owner=store.newSession(ownerId),creator=store.newSession(id),mod=store.newSession(modId);
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(path,data,session,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const grant=(enabled=true)=>call('/api/admin/artists',{id,enabled},owner);
  try{
    for(let i=0;i<3;i++)store.submit(id,`Existing ${i}`,'',recipe,i!==1);
    const initial=store.mine(id);store.review(store.user(ownerId),initial[0].id,'approved','');store.review(store.user(ownerId),initial[1].id,'rejected','Test feedback');
    assert.equal((await call('/api/cosmetics',{name:'Fourth',recipe},creator)).status,429);
    assert.equal((await call('/api/admin/artists',{id,enabled:true})).status,401);
    for(const session of [creator,mod])assert.equal((await call('/api/admin/artists',{id,enabled:true},session)).status,403);
    for(const headers of [{'X-CSRF-Token':'bad'},{Origin:'https://foreign.example'}])assert.equal((await call('/api/admin/artists',{id,enabled:true},owner,headers)).status,403);
    for(const data of [{id,enabled:'true'},{enabled:true},{id:'',enabled:true}])assert.equal((await call('/api/admin/artists',data,owner)).status,400);
    assert.equal((await call('/api/admin/artists',{id:'missing',enabled:true},owner)).status,404);
    for(const target of [ownerId,modId])for(const enabled of [true,false])assert.equal((await call('/api/admin/artists',{id:target,enabled},owner)).status,403);
    const granted=await grant();assert.equal(granted.status,200);assert.equal(granted.headers.get('Cache-Control'),'no-store');assert.equal((await granted.json()).user.role,'artist');
    assert.equal((await grant()).status,200);assert.equal(store.auditLog().filter(e=>e.action==='artist.added').length,1,'Repeated grants are idempotent');
    const me=await (await call('/api/me',undefined,creator)).json();assert.equal(me.user.role,'artist','Existing sessions see grants immediately');
    const read=async path=>(await (await call(path)).json());
    const publicUser=(await read(`/api/v1/profiles/${id}`)).user;assert.equal(publicUser.is_artist,true);assert.equal(publicUser.is_moderator,false);
    for(const key of ['role','ban_reason','banned_at','csrf'])assert.equal(publicUser[key],undefined);
    assert.equal((await read('/api/v1/profiles?q=Artist')).users[0].is_artist,true);
    store.setFollow(ownerId,id,true);assert.equal(store.followingProfiles(ownerId)[0].is_artist,true);
    assert.equal((await call('/api/admin/queue',undefined,creator)).status,403);
    assert.equal((await call('/api/admin/users',undefined,creator)).status,403);
    assert.equal((await call('/api/admin/ban',{id:modId,banned:true,reason:'Not allowed'},creator)).status,403);
    assert.equal((await call('/api/admin/users?status=staff',undefined,owner)).status,200);assert.ok(!store.adminUsers({status:'staff'}).some(u=>u.id===id));
    const results=await Promise.all(Array.from({length:22},(_,i)=>call('/api/cosmetics',{name:`Artist Flare ${i}`,recipe,listed:i%2===0},creator)));
    assert.equal(results.filter(r=>r.status===201).length,17);assert.equal(results.filter(r=>r.status===429).length,5);
    for(const response of results){const data=await response.json();if(response.status===201){assert.equal(data.cosmetic.status,'pending');assert.equal(data.cosmetic.reviewer_id,null);}else assert.match(data.error,/20 per account/);}
    assert.equal(store.mine(id).length,20);assert.equal(store.auditLog().filter(e=>e.action==='cosmetic.auto_approved' && e.actor_id===id).length,0);
    assert.equal((await grant(false)).status,200);assert.equal(store.session(creator.raw).role,'user');assert.equal((await read(`/api/v1/profiles/${id}`)).user.is_artist,false);
    const blocked=await call('/api/cosmetics',{name:'Demoted Flare',recipe},creator);assert.equal(blocked.status,429);assert.match((await blocked.json()).error,/3 per account/);assert.equal(store.mine(id).length,20);
    assert.equal((await grant()).status,200);assert.equal(store.auditLog().filter(e=>e.action==='artist.removed').length,1);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();}
  store=new Store(path);try{assert.equal(store.user(id).role,'artist');assert.equal(store.session(creator.raw).role,'artist');assert.equal(store.mine(id).length,20);assert.throws(()=>store.submit(id,'Twenty first','',recipe),e=>e.status===429 && /20 per account/.test(e.message));}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('artist showcase searches and paginates only active artists and previews only approved listed Flares',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-showcase-')),store=new Store();store.seedDemo();
  const owner=store.user('demo-owner');store.setArtist(owner,'demo-creator',true);
  const unlisted=store.submit('demo-creator','Unlisted artist design','',recipe,false);store.review(owner,unlisted.id,'approved','');
  const rejected=store.submit('demo-creator','Rejected artist design','',recipe);store.review(owner,rejected.id,'rejected','Not ready');
  store.equip('demo-creator',unlisted.id);
  const emptyId=store.linkIdentity({provider:'kick',id:'70001',login:'empty_artist',name:'Empty Artist'},null,'1001');store.setArtist(owner,emptyId,true);
  const bannedId=store.linkIdentity(profile('9'),null,'1001');store.setArtist(owner,bannedId,true);store.setBan(owner,bannedId,true,'Hidden artist');
  const ids=[];for(let i=0;i<26;i++){const id=store.linkIdentity({...profile(String(100+i)),name:`Artist ${String(i).padStart(2,'0')}`},null,'1001');store.setArtist(owner,id,true);ids.push(id);}
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,read=path=>fetch(base+path);
  try{
    assert.equal((await read('/artists')).status,200);
    const response=await read('/api/v1/artists');assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.match(response.headers.get('Cache-Control'),/public, max-age=15/);
    const first=await response.json();assert.equal(first.users.length,24);assert.equal(first.next_offset,24);
    const next=await (await read('/api/v1/artists?offset=24')).json();assert.equal(next.users.length,4);assert.equal(next.next_offset,null);
    const all=[...first.users,...next.users];assert.equal(new Set(all.map(u=>u.id)).size,28);assert.ok(all.every(u=>u.is_artist===true && u.is_moderator===false && u.flares.length<=3));
    assert.ok(!all.some(u=>u.id===bannedId || ['demo-owner','demo-mod'].includes(u.id)));
    const lumi=(await (await read('/api/v1/artists?q=lumi')).json()).users[0];assert.equal(lumi.id,'demo-creator');assert.equal(lumi.flares.length,3);assert.equal(lumi.stats.paints,4);
    for(const c of lumi.flares){assert.equal(store.getCosmetic(c.id).status,'approved');assert.equal(c.listed,true);assert.equal(c.owner_id,undefined);assert.equal(c.reason,undefined);assert.ok(![unlisted.id,rejected.id,'demo-pending'].includes(c.id));}
    for(const key of ['role','banned_at','ban_reason','csrf','following_ids'])assert.equal(lumi[key],undefined);
    assert.equal(lumi.cosmetic.id,unlisted.id,'Public profile’s existing equipped-Flare contract is preserved, but unlisted designs are never showcase previews');
    assert.equal((await (await read('/api/v1/artists?q=empty_artist')).json()).users[0].flares.length,0);
    assert.equal((await (await read('/api/v1/artists?q=70001')).json()).users[0].id,emptyId);
    assert.equal((await (await read('/api/v1/artists?q=unknown')).json()).users.length,0);
    for(const offset of ['-1','NaN','1.5','1000001'])assert.equal((await read(`/api/v1/artists?offset=${offset}`)).status,400);
    store.setArtist(owner,'demo-creator',false);assert.equal((await (await read('/api/v1/artists?q=lumi')).json()).users.length,0);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('artist role changes reject stale owners, banned accounts and staff; moderators can still ban artists',()=>{
  const store=new Store();store.seedDemo();
  try{
    const owner=store.user('demo-owner');
    store.setArtist(owner,'demo-creator',true);store.setBan(store.user('demo-mod'),'demo-creator',true,'Artist abuse');
    assert.throws(()=>store.setArtist(owner,'demo-creator',true),e=>e.status===403);
    store.setArtist(owner,'demo-creator',false);store.setBan(store.user('demo-mod'),'demo-creator',false,'');
    assert.throws(()=>store.setArtist(store.user('demo-mod'),'demo-creator',true),e=>e.status===403);
    store.db.prepare("UPDATE users SET role='user' WHERE id='demo-owner'").run();
    assert.throws(()=>store.setArtist(owner,'demo-creator',true),e=>e.status===403);
    assert.equal(store.user('demo-creator').role,'user');
  }finally{store.close();}
});

test('Node account and moderation endpoints preserve CSRF, staff account tables, pagination and immediate role removal',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-accounts-')),store=new Store();
  const ownerId=store.linkIdentity(profile('1'),null,'1'),creatorId=store.linkIdentity(profile('2'),null,'1'),modId=store.linkIdentity(profile('3'),null,'1');
  store.setModerator(store.user(ownerId),'3',true);
  const owner=store.newSession(ownerId),creator=store.newSession(creatorId),mod=store.newSession(modId);
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(path,data,session,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    assert.equal((await call('/api/admin/users')).status,401);assert.equal((await call('/api/admin/users',undefined,creator)).status,403);assert.equal((await call('/api/admin/users',undefined,mod)).status,200);
    const usersResponse=await call('/api/admin/users?q=user2',undefined,owner);assert.equal(usersResponse.headers.get('Cache-Control'),'no-store');
    const users=await usersResponse.json();assert.equal(users.users.length,1);assert.equal(users.users[0].twitch_id,'2');assert.equal(users.users[0].avatar_url,profile('2').avatar_url);assert.equal(users.users[0].csrf,undefined);
    assert.equal((await call('/api/account/profile',{provider:'youtube'},creator)).status,400);
    assert.equal((await call('/api/account/profile',{provider:'twitch'},creator,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await call('/api/account/profile',{provider:'twitch'},creator)).status,200);
    const paint=store.submit(creatorId,'Review detail','Artwork description',recipe);
    const pending=await (await call('/api/admin/queue',undefined,mod)).json();assert.equal(pending.cosmetics[0].creator_identities[0].provider_id,'2');assert.equal(pending.cosmetics[0].creator_avatar,profile('2').avatar_url);assert.ok(pending.cosmetics[0].created_at);assert.equal(pending.cosmetics[0].reviewer,null);
    assert.equal((await call('/api/admin/review',{id:paint.id,status:'rejected',reason:'x'},mod)).status,400);
    assert.equal((await call('/api/admin/review',{id:paint.id,status:'approved',reason:'Original and readable'},mod)).status,200);
    const approved=await (await call('/api/admin/queue?status=approved&q=Review',undefined,mod)).json();assert.equal(approved.cosmetics[0].reviewer,'User 3');assert.ok(approved.cosmetics[0].reviewed_at);
    const published=await (await call(`/api/v1/cosmetics/${paint.id}`)).json();assert.equal(published.cosmetic.creator_identities,undefined);assert.equal(published.cosmetic.creator_avatar,profile('2').avatar_url);assert.equal(published.cosmetic.owner_id,undefined);
    store.equip(creatorId,paint.id);assert.equal((await call('/api/admin/review',{id:paint.id,status:'rejected',reason:'Unsafe animation'},owner)).status,200);
    const rejected=await (await call('/api/admin/queue?status=rejected',undefined,mod)).json();assert.equal(rejected.cosmetics[0].reason,'Unsafe animation');assert.equal(rejected.stats.rejected,1);assert.equal(store.user(creatorId).equipped,null);
    for(const path of ['/api/admin/queue?status=invalid','/api/admin/queue?offset=-1','/api/admin/users?offset=NaN'])assert.equal((await call(path,undefined,owner)).status,400);
    for(let i=10;i<65;i++)store.linkIdentity(profile(String(i)),null,'1');
    const publicPage=await (await call('/api/v1/profiles')).json();assert.equal(publicPage.users.length,24);assert.equal(publicPage.next_offset,24);
    const publicNext=await (await call('/api/v1/profiles?offset=24')).json();assert.equal(publicNext.users.length,24);assert.ok(!publicPage.users.some(user=>user.id===publicNext.users[0].id));
    const page=await (await call('/api/admin/users',undefined,owner)).json();assert.equal(page.users.length,50);assert.equal(page.next_offset,50);
    const second=await (await call('/api/admin/users?offset=50',undefined,owner)).json();assert.equal(second.users.length,8);assert.equal(second.next_offset,null);
    assert.equal((await call('/api/admin/moderators',{twitchId:'1',enabled:false},owner)).status,403);
    assert.equal((await call('/api/admin/moderators',{twitchId:'3',enabled:false},owner)).status,200);assert.equal((await call('/api/admin/queue',undefined,mod)).status,403);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node public moderator indicators follow role changes without leaking account privileges',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-mod-badge-')),store=new Store();store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,read=async id=>(await (await fetch(`${base}/api/v1/profiles/${id}`)).json()).user;
  try{
    for(const [id,expected] of [['demo-creator',false],['demo-owner',false],['demo-mod',true]]){
      const user=await read(id);assert.equal(user.is_moderator,expected);
      for(const key of ['role','banned_at','ban_reason','equipped','csrf','following_ids'])assert.equal(user[key],undefined);
    }
    const list=await (await fetch(`${base}/api/v1/profiles?q=nova`)).json();assert.equal(list.users[0].is_moderator,true);
    store.setFollow('demo-creator','demo-mod',true);assert.equal(store.followingProfiles('demo-creator')[0].is_moderator,true);
    store.setModerator(store.user('demo-owner'),'1003',false);assert.equal((await read('demo-mod')).is_moderator,false);
    store.setModerator(store.user('demo-owner'),'1003',true);assert.equal((await read('demo-mod')).is_moderator,true);
    store.setBan(store.user('demo-owner'),'demo-mod',true,'Testing badge privacy');
    assert.equal((await fetch(`${base}/api/v1/profiles/demo-mod`)).status,404);
    assert.equal((await (await fetch(`${base}/api/v1/profiles?q=nova`)).json()).users.length,0);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('permanent bans survive restart, protect every linked identity and reject stale moderator privileges',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-permaban-')),path=join(dir,'database.sqlite');let store=new Store(path);store.seedDemo();
  try{
    store.linkIdentity({provider:'kick',id:'42',login:'linked',name:'Linked'},'demo-creator','1001');
    const state=store.state('kick','demo-creator','binding','verifier'),session=store.newSession('demo-creator');
    const actor=store.user('demo-mod');store.setBan(actor,'demo-creator',true,'Persistent abuse');
    const timestamp=store.user('demo-creator').banned_at,events=store.auditLog().length;
    store.setBan(actor,'demo-creator',true,'Duplicate request');
    assert.equal(store.user('demo-creator').banned_at,timestamp);assert.equal(store.user('demo-creator').ban_reason,'Persistent abuse');assert.equal(store.auditLog().length,events);
    assert.throws(()=>store.consumeState(state,'kick','binding'),e=>e.status===400);
    store.close();store=new Store(path);
    assert.equal(store.user('demo-creator').banned_at,timestamp);assert.equal(store.session(session.raw),null);
    for(const identity of store.identities('demo-creator'))assert.throws(()=>store.linkIdentity({provider:identity.provider,id:identity.provider_id,login:'renamed',name:'Renamed'},null,'1001'),e=>e.status===403);
    assert.equal(store.adminUsers({status:'banned'})[0].id,'demo-creator');
    assert.equal(store.adminUsers({status:'active'}).some(user=>user.id==='demo-creator'),false);
    assert.equal(store.adminUsers({status:'staff'}).length,2);
    store.setModerator(store.user('demo-owner'),'1003',false);
    assert.throws(()=>store.setBan(actor,'demo-creator',false),e=>e.status===403);
    store.setBan(store.user('demo-owner'),'demo-creator',false);
    assert.equal(store.adminUsers({status:'banned'}).length,0);assert.equal(store.session(session.raw),null);assert.equal(store.getCosmetic('demo-0').status,'rejected');
    assert.ok(store.newSession('demo-creator'));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node staff publishing, public profiles, bans, and owner exemptions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-roles-')),store=new Store();store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,owner=store.newSession('demo-owner'),mod=store.newSession('demo-mod'),creator=store.newSession('demo-creator');
  const call=(path,data,session,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    const staff=(await (await call('/api/cosmetics',{name:'Staff Flare',recipe,listed:false},mod)).json()).cosmetic;assert.equal(staff.status,'approved');assert.equal(staff.reviewer_id,'demo-mod');assert.ok(staff.reviewed_at);
    assert.equal((await call(`/api/v1/cosmetics/${staff.id}`)).status,200);
    assert.equal((await call('/api/admin/review',{id:staff.id,status:'rejected',reason:'Own review'},mod)).status,403);
    await call('/api/equip',{cosmeticId:staff.id},creator);
    const profiles=await (await call('/api/v1/profiles?q=lumi')).json();assert.equal(profiles.users.length,1);assert.equal(profiles.users[0].cosmetic.id,staff.id);assert.equal(profiles.users[0].role,undefined);assert.equal(profiles.users[0].ban_reason,undefined);
    assert.equal((await (await call('/api/v1/profiles?q=1002')).json()).users[0].id,'demo-creator');
    assert.equal((await call('/api/v1/profiles/demo-creator')).status,200);assert.equal((await call('/api/v1/profiles?offset=-1')).status,400);
    const own=store.submit('demo-owner','Owner Flare','',recipe);assert.equal(own.status,'approved');
    assert.equal((await call('/api/admin/review',{id:own.id,status:'rejected',reason:'Own review'},owner)).status,200);
    assert.equal((await call('/api/admin/review',{id:own.id,status:'approved'},owner)).status,200);
    assert.equal((await call('/api/cosmetics/publication',{id:staff.id,listed:true},owner)).status,200);
    for(const id of ['demo-owner','demo-mod'])assert.equal((await call('/api/admin/ban',{id,banned:true,reason:'Abuse'},mod)).status,403);
    assert.equal((await call('/api/admin/ban',{id:'demo-creator',banned:true,reason:'Abuse'},creator)).status,403);
    assert.equal((await call('/api/admin/ban',{id:'demo-creator',banned:true,reason:'Abuse'},mod,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await call('/api/admin/ban',{id:'demo-creator',banned:true,reason:'x'},mod)).status,400);
    store.equip('demo-mod','demo-0');
    assert.equal((await call('/api/admin/ban',{id:'demo-creator',banned:true,reason:'Abuse'},mod)).status,200);
    const bannedPage=await call('/api/admin/users?status=banned',undefined,mod);assert.equal(bannedPage.headers.get('Cache-Control'),'no-store');assert.equal(bannedPage.headers.get('Access-Control-Allow-Origin'),null);
    const bans=await bannedPage.json();assert.deepEqual(bans.users.map(user=>user.id),['demo-creator']);assert.equal(bans.users[0].ban_reason,'Abuse');assert.ok(bans.users[0].banned_at);
    assert.equal((await (await call('/api/admin/users?status=banned&q=1002',undefined,owner)).json()).users.length,1);
    assert.equal((await (await call('/api/admin/users?status=active&q=lumi',undefined,owner)).json()).users.length,0);
    assert.equal((await (await call('/api/admin/users?status=banned&q=demo-creator',undefined,owner)).json()).users.length,1);
    for(const status of ['invalid',"banned' OR 1=1",'__proto__'])assert.equal((await call(`/api/admin/users?status=${encodeURIComponent(status)}`,undefined,owner)).status,400);
    assert.equal((await call('/api/admin/users?status=banned')).status,401);assert.equal((await call('/api/admin/users?status=banned',undefined,creator)).status,401);
    assert.equal(store.session(creator.raw),null);assert.equal((await call('/api/equip',{cosmeticId:null},creator)).status,401);
    assert.throws(()=>store.linkIdentity({provider:'twitch',id:'1002',name:'lumi',login:'lumi'},null,'1001'),e=>e.status===403);assert.throws(()=>store.newSession('demo-creator'),e=>e.status===403);
    assert.equal((await call('/api/admin/review',{id:'demo-0',status:'approved'},owner)).status,403);
    assert.equal(store.user('demo-mod').equipped,null);assert.equal((await call('/api/v1/profiles/demo-creator')).status,404);assert.equal((await call('/api/v1/users/twitch/1002')).status,404);
    assert.equal((await (await call('/api/v1/resolve',{provider:'twitch',ids:['1002']})).json()).users.length,0);
    assert.equal((await call('/api/v1/cosmetics/demo-0')).status,404);assert.equal((await (await call('/api/v1/profiles?q=lumi')).json()).users.length,0);
    assert.equal((await call('/api/admin/ban',{id:'demo-creator',banned:false},mod)).status,200);assert.equal(store.getCosmetic('demo-0').status,'rejected');assert.ok(store.newSession('demo-creator'));
    assert.equal((await call('/api/admin/ban',{id:'demo-mod',banned:true,reason:'Abuse'},owner)).status,200);assert.equal(store.session(mod.raw),null);
    assert.ok(store.auditLog().some(row=>row.action==='account.banned'));
    for(let i=0;i<105;i++)store.submit('demo-owner',`Owner ${i}`,'',recipe);assert.equal(store.mine('demo-owner').length,106);
    for(let i=0;i<50;i++)store.addTexture(`owner-${i}`,'demo-owner');
    const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    assert.equal((await call('/api/textures',{data:gif},owner)).status,201);
    for(let i=0;i<45;i++)assert.equal((await call('/api/equip',{cosmeticId:null},owner)).status,200);
    assert.equal((await call('/api/cosmetics',{name:'Unsafe',recipe:{...recipe,glow:999}},owner)).status,400);
    assert.equal((await call('/api/equip',{cosmeticId:null},owner,{'X-CSRF-Token':'bad'})).status,403);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node created-Flare galleries paginate all own submissions and publish only listed approved designs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-gallery-')),store=new Store();store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,creator=store.newSession('demo-creator');
  const get=(path,session)=>fetch(base+path,{headers:session?{Cookie:`nameflare_session=${session.raw}`}:{}});
  try{
    // Model pre-cap legacy history using a staff creator, then transfer fixture ownership.
    const legacy=(name,listed=true)=>{const c=store.submit('demo-owner',name,'',recipe,listed);store.db.prepare('UPDATE cosmetics SET owner_id=? WHERE id=?').run('demo-creator',c.id);store.db.prepare("UPDATE cosmetics SET status='pending',reviewed_at=NULL,reviewer_id=NULL WHERE id=?").run(c.id);return store.getCosmetic(c.id);};
    for(let i=0;i<105;i++){const c=legacy(`Created ${i}`);store.review(store.user('demo-owner'),c.id,'approved','');}
    const unlisted=store.submit('demo-owner','Unlisted','',recipe,false),pending=legacy('Pending'),rejected=legacy('Rejected');
    store.db.prepare('UPDATE cosmetics SET owner_id=? WHERE id=?').run('demo-creator',unlisted.id);store.review(store.user('demo-owner'),rejected.id,'rejected','Needs changes');
    assert.equal((await get('/api/my/cosmetics?limit=24')).status,401);
    const mine=[];let offset=0;
    do{const page=await (await get(`/api/my/cosmetics?limit=24&offset=${offset}`,creator)).json();mine.push(...page.cosmetics);offset=page.next_offset;}while(offset!==null);
    assert.ok(mine.length>100);assert.equal(new Set(mine.map(c=>c.id)).size,mine.length);
    for(const c of [unlisted,pending,rejected])assert.ok(mine.some(item=>item.id===c.id));
    assert.ok(mine.every(c=>c.owner_id==='demo-creator'));
    const publicFlares=[];offset=0;
    do{const response=await get(`/api/v1/profiles/demo-creator/cosmetics?limit=24&offset=${offset}`);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');const page=await response.json();publicFlares.push(...page.cosmetics);offset=page.next_offset;}while(offset!==null);
    assert.equal(publicFlares.length,109);assert.equal(new Set(publicFlares.map(c=>c.id)).size,109);
    for(const c of [unlisted,pending,rejected])assert.equal(publicFlares.some(item=>item.id===c.id),false);
    assert.ok(publicFlares.every(c=>c.owner_id===undefined && c.reason===undefined && c.listed===true));
    for(const query of ['offset=-1','limit=101','limit=1.5']){assert.equal((await get(`/api/v1/profiles/demo-creator/cosmetics?${query}`)).status,400);assert.equal((await get(`/api/my/cosmetics?${query}`,creator)).status,400);}
    assert.equal((await get('/api/v1/profiles/missing/cosmetics')).status,404);
    store.setBan(store.user('demo-owner'),'demo-creator',true,'Abuse');assert.equal((await get('/api/v1/profiles/demo-creator/cosmetics')).status,404);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node creator follows are persistent, idempotent, private and feed only listed approved paints',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-follows-')),store=new Store(join(dir,'db.sqlite'));store.seedDemo();
  const creator=store.newSession('demo-creator'),owner=store.newSession('demo-owner'),mod=store.newSession('demo-mod');
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(path,data,session,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    const endpoint='/api/profiles/follow',target='demo-owner';
    assert.equal((await call(endpoint,{id:target,following:true})).status,401);
    for(const headers of [{'X-CSRF-Token':'bad'},{Origin:'https://evil.example'}])assert.equal((await call(endpoint,{id:target,following:true},creator,headers)).status,403);
    for(const following of [undefined,null,1,'true'])assert.equal((await call(endpoint,{id:target,following},creator)).status,400);
    assert.equal((await call(endpoint,{id:'demo-creator',following:true},creator)).status,400);
    assert.equal((await call(endpoint,{id:'missing',following:true},creator)).status,404);
    for(let i=0;i<2;i++)assert.deepEqual(await (await call(endpoint,{id:target,following:true},creator)).json(),{id:target,following:true});
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM creator_follows').get().n,1);
    assert.deepEqual((await (await call('/api/me',undefined,creator)).json()).following_ids,[target]);
    assert.deepEqual((await (await call('/api/me',undefined,owner)).json()).following_ids,[]);
    for(const path of ['/api/my/following','/api/my/feed']){assert.equal((await call(path)).status,401);for(const query of ['offset=-1','offset=NaN','limit=101','limit=1.5'])assert.equal((await call(`${path}?${query}`,undefined,creator)).status,400);}
    const publicUser=(await (await call(`/api/v1/profiles/${target}`)).json()).user;
    for(const key of ['following_ids','following','followers','follower_ids'])assert.equal(publicUser[key],undefined);
    const followed=await call('/api/my/following',undefined,creator);assert.equal(followed.headers.get('Cache-Control'),'no-store');assert.equal(followed.headers.get('Access-Control-Allow-Origin'),null);assert.deepEqual((await followed.json()).users.map(u=>u.id),[target]);
    assert.deepEqual((await (await call('/api/my/following?q=notfound',undefined,creator)).json()).users,[]);
    const secret=store.submit(target,'Hidden paint','',recipe,false),rejected=store.submit(target,'Rejected paint','',recipe);store.review(store.user(target),rejected.id,'rejected','Testing');
    const paints=[];for(let i=0;i<27;i++)paints.push(store.submit(target,`Followed ${i}`,'',recipe));
    store.db.prepare('UPDATE cosmetics SET reviewed_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',paints.at(-1).id);
    const first=await call('/api/my/feed?limit=24&sort=liked',undefined,creator);assert.equal(first.headers.get('Cache-Control'),'no-store');const page=await first.json();assert.equal(page.cosmetics.length,24);assert.equal(page.next_offset,24);assert.equal(page.cosmetics[0].id,paints.at(-1).id);
    const next=await (await call('/api/my/feed?limit=24&offset=24',undefined,creator)).json(),all=[...page.cosmetics,...next.cosmetics];assert.equal(new Set(all.map(c=>c.id)).size,27);assert.equal(next.next_offset,null);
    assert.ok(all.every(c=>c.creator_id===target && c.owner_id===undefined && c.listed));assert.ok(!all.some(c=>c.id===secret.id || c.id===rejected.id));
    assert.deepEqual((await (await call('/api/my/feed',undefined,mod)).json()).cosmetics,[]);
    assert.equal((await (await call('/api/my/feed?q=Followed%2026&effect=static',undefined,creator)).json()).cosmetics[0].id,paints.at(-1).id);
    assert.equal((await call('/api/my/feed?effect=invalid',undefined,creator)).status,400);
    assert.equal(store.likedIds('demo-creator').length,0);assert.equal(store.user('demo-creator').equipped,'demo-0');
    store.setPublication(target,paints.at(-1).id,false);assert.ok(!store.catalog({followedBy:'demo-creator'}).some(c=>c.id===paints.at(-1).id));
    await call(endpoint,{id:target,following:false},creator);await call(endpoint,{id:target,following:false},creator);assert.deepEqual(store.followingIds('demo-creator'),[]);assert.deepEqual((await (await call('/api/my/feed',undefined,creator)).json()).cosmetics,[]);
    await call(endpoint,{id:'demo-mod',following:true},creator);store.setBan(store.user(target),'demo-mod',true,'Testing');assert.deepEqual(store.followingIds('demo-creator'),[]);assert.equal((await call(endpoint,{id:'demo-mod',following:true},creator)).status,404);assert.deepEqual(store.catalog({followedBy:'demo-creator'}),[]);
    store.setBan(store.user(target),'demo-mod',false);assert.deepEqual(store.followingIds('demo-creator'),['demo-mod']);
    await call(endpoint,{id:target,following:true},creator);
    for(let i=200;i<226;i++){const id=store.linkIdentity(profile(String(i)),null,'1');store.setFollow('demo-creator',id,true);}
    const followedPage=await (await call('/api/my/following?limit=24',undefined,creator)).json(),followedNext=await (await call('/api/my/following?limit=24&offset=24',undefined,creator)).json();assert.equal(followedPage.users.length,24);assert.equal(followedPage.next_offset,24);assert.equal(followedNext.users.length,4);assert.equal(new Set([...followedPage.users,...followedNext.users].map(u=>u.id)).size,28);
    const reopened=new Store(join(dir,'db.sqlite'));try{assert.equal(reopened.followingIds('demo-creator').length,28);assert.ok(reopened.session(creator.raw));}finally{reopened.close();}
    store.setBan(store.user(target),'demo-creator',true,'Testing');assert.deepEqual(store.followingIds('demo-creator'),[]);assert.deepEqual(store.catalog({followedBy:'demo-creator'}),[]);assert.equal((await call('/api/my/feed',undefined,creator)).status,401);
    store.db.prepare("INSERT INTO users (id,name,created_at) VALUES ('temp','Temp','2026-01-01')").run();store.setFollow('demo-owner','temp',true);store.db.prepare("DELETE FROM users WHERE id='temp'").run();assert.deepEqual(store.followingIds('demo-owner'),[]);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node full profiles validate edits, preserve old clients, and expose only public creator stats',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-profile-')),store=new Store();
  const ownerId=store.linkIdentity(profile('1'),null,'1'),id=store.linkIdentity(profile('2'),null,'1'),viewerId=store.linkIdentity(profile('3'),null,'1');
  const owner=store.user(ownerId),creator=store.newSession(id);
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(path,data,session=creator,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    assert.equal((await call('/api/account/profile',{provider:'twitch',bio:'hello'},null)).status,401);
    assert.equal((await call('/api/account/profile',{provider:'twitch',bio:'hello'},creator,{'X-CSRF-Token':'bad'})).status,403);
    for(const input of [{bio:42},{bio:'a'.repeat(281)},{profile_color:'red'},{profile_color:'url(https://evil.example)'},{profile_color:null}])assert.equal((await call('/api/account/profile',{provider:'twitch',...input})).status,400);
    assert.equal(store.account(id).bio,'','invalid updates are atomic');
    const bio='<script>alert(1)</script>\nOriginal artist';
    assert.equal((await call('/api/account/profile',{provider:'twitch',bio,profile_color:'#AABBCC'})).status,200);
    await call('/api/account/profile',{provider:'twitch'});assert.equal(store.account(id).bio,bio,'old profile clients preserve optional fields');
    const publicPaint=store.submit(id,'Public paint','',recipe),privatePaint=store.submit(id,'Unlisted paint','',recipe,false),pending=store.submit(id,'Pending paint','',recipe);
    for(const paint of [publicPaint,privatePaint])store.review(owner,paint.id,'approved','');
    store.setLike(viewerId,publicPaint.id,true);store.equip(viewerId,publicPaint.id);store.equip(id,privatePaint.id);
    store.setLike(id,publicPaint.id,true);
    const result=await (await call(`/api/v1/profiles/${id}`,undefined,null)).json();
    assert.equal(result.user.bio,bio);assert.equal(result.user.profile_color,'#aabbcc');assert.deepEqual(result.user.stats,{paints:1,likes:2,wears:1});
    assert.equal(result.user.cosmetic.id,privatePaint.id,'equipped unlisted paints retain their existing public contract');
    for(const key of ['role','liked_ids','equipped','ban_reason','csrf'])assert.equal(result.user[key],undefined);
    const gallery=await (await call(`/api/v1/profiles/${id}/cosmetics`,undefined,null)).json();assert.deepEqual(gallery.cosmetics.map(c=>c.id),[publicPaint.id]);assert.equal(gallery.cosmetics[0].creator_id,id);assert.equal(gallery.cosmetics[0].owner_id,undefined);
    store.setBan(owner,viewerId,true,'Abuse');assert.deepEqual({...store.publicProfile(id).stats},{paints:1,likes:1,wears:0});
    store.setPublication(id,publicPaint.id,false);assert.deepEqual({...store.publicProfile(id).stats},{paints:0,likes:0,wears:0});
    assert.equal(store.getCosmetic(pending.id).status,'pending');
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node permanent Flare deletion enforces moderation, confirmation, rejected status and shared-image safety',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-delete-')),store=new Store(join(dir,'db.sqlite'));store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,owner=store.newSession('demo-owner'),mod=store.newSession('demo-mod'),creator=store.newSession('demo-creator');
  const call=(path,data,session,headers={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{Cookie:`nameflare_session=${session.raw}`} : {}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost','X-CSRF-Token':session?.csrf || ''}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const endpoint='/api/admin/cosmetics/delete',gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  try{
    const pending=store.mine('demo-creator').find(c=>c.status==='pending');
    assert.equal((await call(endpoint,{id:pending.id,confirm:true})).status,401);
    assert.equal((await call(endpoint,{id:pending.id,confirm:true},creator)).status,403);
    assert.equal((await call(endpoint,{id:pending.id,confirm:true},mod,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await call(endpoint,{id:pending.id,confirm:true},owner,{Origin:'https://evil.example'})).status,403);
    for(const confirm of [undefined,false,'true'])assert.equal((await call(endpoint,{id:pending.id,confirm},owner)).status,400);
    assert.equal((await call(endpoint,{id:'',confirm:true},owner)).status,400);
    assert.equal((await call(endpoint,{id:'unknown',confirm:true},owner)).status,404);
    assert.equal((await call(endpoint,{id:pending.id,confirm:true},mod)).status,409);
    assert.equal((await call(endpoint,{id:'demo-0',confirm:true},owner)).status,409);
    assert.ok(store.getCosmetic(pending.id));assert.ok(store.getCosmetic('demo-0'));
    const textureId=(await (await call('/api/textures',{data:gif},creator)).json()).id;
    // Deletion covers shared legacy assets beyond the current submission cap.
    const make=(name,r)=>{const c=store.submit('demo-owner',name,'',r);store.db.prepare("UPDATE cosmetics SET owner_id='demo-creator',status='pending',reviewed_at=NULL,reviewer_id=NULL WHERE id=?").run(c.id);return store.getCosmetic(c.id);};
    const rejected=make('Delete layered Flare',{...recipe,layers:[{type:'image',textureId,opacity:1},{type:'image',textureId,opacity:.5}]});
    const sharedApproved=make('Shared approved Flare',{...recipe,textureId});
    const sharedPending=make('Shared pending Flare',{...recipe,layers:[{type:'image',textureId,opacity:1}]});
    const sharedRejected=make('Shared rejected Flare',{...recipe,textureId});
    store.review(store.user('demo-owner'),sharedApproved.id,'approved','');
    store.equip('demo-creator',sharedApproved.id);
    store.review(store.user('demo-owner'),sharedRejected.id,'rejected','Test rejection');
    store.review(store.user('demo-owner'),rejected.id,'rejected','Test rejection');
    // Defense against a stale equipped reference even if an older integration wrote one.
    store.db.prepare('UPDATE users SET equipped=? WHERE id=?').run(rejected.id,'demo-mod');
    let response=await call(endpoint,{id:rejected.id,confirm:true},mod);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await response.json(),{ok:true,id:rejected.id,deleted_textures:[]});
    assert.equal(store.getCosmetic(rejected.id),null);assert.equal(store.user('demo-mod').equipped,null);
    assert.ok(existsSync(join(dir,'textures',textureId)));assert.ok(store.db.prepare('SELECT id FROM textures WHERE id=?').get(textureId));
    assert.equal((await call(`/textures/${textureId}`)).status,200);
    assert.equal((await call(endpoint,{id:rejected.id,confirm:true},owner)).status,404);
    assert.equal((await call('/api/admin/review',{id:rejected.id,status:'approved'},owner)).status,404);
    assert.equal((await call('/api/cosmetics/publication',{id:rejected.id,listed:true},creator)).status,404);
    assert.equal((await call('/api/equip',{cosmeticId:rejected.id},creator)).status,400);
    assert.equal((await call(`/api/v1/cosmetics/${rejected.id}`)).status,404);
    assert.equal((await (await call('/api/my/cosmetics',undefined,creator)).json()).cosmetics.some(c=>c.id===rejected.id),false);
    assert.equal((await (await call('/api/admin/queue?status=rejected',undefined,mod)).json()).cosmetics.some(c=>c.id===rejected.id),false);
    assert.ok(store.auditLog().some(entry=>entry.action==='flare.deleted' && entry.target===rejected.id && entry.detail===''));
    store.review(store.user('demo-owner'),sharedApproved.id,'rejected','Remove shared Flare');
    response=await call(endpoint,{id:sharedApproved.id,confirm:true},owner);assert.deepEqual((await response.json()).deleted_textures,[]);
    response=await call(endpoint,{id:sharedRejected.id,confirm:true},mod);assert.deepEqual((await response.json()).deleted_textures,[]);
    assert.ok(existsSync(join(dir,'textures',textureId)),'pending references also retain image files');
    store.review(store.user('demo-owner'),sharedPending.id,'rejected','Remove last Flare');
    response=await call(endpoint,{id:sharedPending.id,confirm:true},mod);assert.equal(response.status,200);assert.deepEqual((await response.json()).deleted_textures,[textureId]);
    assert.equal(existsSync(join(dir,'textures',textureId)),false);assert.equal(store.db.prepare('SELECT id FROM textures WHERE id=?').get(textureId),undefined);
    for(const session of [undefined,creator,mod,owner])assert.equal((await call(`/textures/${textureId}`,undefined,session)).status,404);
    assert.equal(store.resolve('twitch','1002').cosmetic,null);assert.equal(store.publicProfile('demo-creator').cosmetic,null);
    const missing=make('Missing image Flare',{...recipe,textureId});store.review(store.user('demo-owner'),missing.id,'rejected','Missing image');
    assert.equal((await call(endpoint,{id:missing.id,confirm:true},owner)).status,200,'already missing files are harmless');
    const failed=make('Failure Flare',{...recipe,textureId});store.review(store.user('demo-owner'),failed.id,'rejected','Test failure');
    assert.throws(()=>store.deleteRejected(store.user('demo-mod'),failed.id,()=>{throw new Error('Disk error');}),/Disk error/);
    assert.ok(store.getCosmetic(failed.id));assert.equal(store.auditLog().some(entry=>entry.target===failed.id && entry.action==='flare.deleted'),false);
    const unsafe=make('Legacy unsafe path',{...recipe,textureId:'../keep-me.txt'});store.review(store.user('demo-owner'),unsafe.id,'rejected','Invalid legacy image');
    writeFileSync(join(dir,'keep-me.txt'),'Do not delete');assert.equal((await call(endpoint,{id:unsafe.id,confirm:true},owner)).status,200);assert.ok(existsSync(join(dir,'keep-me.txt')));
    store.setModerator(store.user('demo-owner'),'1003',false);
    assert.equal((await call(endpoint,{id:failed.id,confirm:true},mod)).status,403);
    assert.throws(()=>store.deleteRejected({id:'demo-mod',role:'moderator'},failed.id),e=>e.status===403);
    // Owner may delete their own rejected Flare; moderators can delete their own once rejected too.
    const own=store.submit('demo-owner','Owner deleted Flare','',recipe);store.review(store.user('demo-owner'),own.id,'rejected','Own rejection');
    assert.equal((await call(endpoint,{id:own.id,confirm:true},owner)).status,200);
    const reopened=new Store(join(dir,'db.sqlite'));try{assert.equal(reopened.getCosmetic(rejected.id),null);assert.equal(reopened.getCosmetic(sharedPending.id),null);assert.ok(reopened.auditLog().some(entry=>entry.action==='flare.deleted'));}finally{reopened.close();}
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('first real OAuth sign-in creates a regular account, copies avatar, and returning login reuses it',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-signup-')),store=new Store(),originalFetch=globalThis.fetch;
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{TWITCH_CLIENT_ID:'client',TWITCH_CLIENT_SECRET:'secret',OWNER_TWITCH_ID:'1'}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  try{
    globalThis.fetch=(url,options)=>String(url).startsWith(base)?originalFetch(url,options):Promise.resolve(String(url).includes('/token')?Response.json({access_token:'not-persisted'}):Response.json({data:[{id:'42',login:'newcreator',display_name:'New Creator',profile_image_url:profile('42').avatar_url}]}));
    const login=async()=>{
      const start=await fetch(base+'/auth/twitch',{redirect:'manual'}),state=new URL(start.headers.get('Location')).searchParams.get('state'),binding=start.headers.get('Set-Cookie').split(';')[0];
      const callback=await fetch(`${base}/auth/twitch/callback?state=${state}&code=test`,{redirect:'manual',headers:{Cookie:binding}});assert.equal(callback.status,302);assert.equal(callback.headers.get('Location'),'/account');
      const session=callback.headers.getSetCookie().find(value=>value.startsWith('nameflare_session=')).split(';')[0];
      return (await (await fetch(base+'/api/me',{headers:{Cookie:session}})).json()).user;
    };
    const first=await login();assert.equal(first.role,'user');assert.equal(first.name,'New Creator');assert.equal(first.avatar_url,profile('42').avatar_url);assert.equal(first.identities[0].provider_id,'42');
    const returning=await login();assert.equal(returning.id,first.id);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    assert.equal(store.db.prepare('SELECT * FROM identities').get().access_token,undefined);
  }finally{globalThis.fetch=originalFetch;app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});
