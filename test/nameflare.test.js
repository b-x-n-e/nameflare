import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store, digest } from '../lib/store.js';
import { validateRecipe, validateTexture } from '../lib/cosmetics.js';
import { beginOAuth, finishOAuth, safeAvatar } from '../lib/oauth.js';
import { createApp, clientAddress } from '../server.js';
import { applyCosmetic } from '../public/renderer.js';

const recipe = () => ({ colors:['#71f5bd','#b798ff'],animation:'flow',speed:4,angle:120,glow:5 });
const profile = (id,name=id,provider='twitch') => ({provider,id,login:name,name});
const fails = (fn,status) => assert.throws(fn,error => error.status === status);
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test('CLI starts through a symlinked release directory and exits gracefully',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-release-'));
  const release=join(dir,'current');
  symlinkSync(fileURLToPath(new URL('../',import.meta.url)),release,process.platform==='win32'?'junction':'dir');
  const child=spawn(process.execPath,[join(release,'server.js')],{
    cwd:release,
    env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',PUBLIC_BASE_URL:'https://nameflare.example',OWNER_TWITCH_ID:'1001',DATA_DIR:join(dir,'data'),TRUST_PROXY_LOOPBACK:'false'},
    stdio:['ignore','pipe','pipe']
  });
  let output='';
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Symlinked CLI did not start: ${output}`)),10000);
      const finish=()=>clearTimeout(timer);
      child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Nameflare server ready at https://nameflare.example')){finish();resolve();}});
      child.stderr.on('data',chunk=>{output+=chunk;});
      child.once('error',error=>{finish();reject(error);});
      child.once('exit',(code,signal)=>{finish();reject(new Error(`CLI exited before startup (${code ?? signal}): ${output}`));});
    });
    child.kill('SIGTERM');
    assert.deepEqual(await exited,{code:0,signal:null});
  }finally{
    if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
    await exited;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('proxy client address is opt-in, loopback-only, single-IP, and canonicalized',()=>{
  const req=(peer,headers={})=>({socket:{remoteAddress:peer},headers});
  assert.equal(clientAddress(req('127.0.0.1',{'x-real-ip':'198.51.100.1'})),'127.0.0.1');
  assert.equal(clientAddress(req('198.51.100.2',{'x-real-ip':'198.51.100.1'}),true),'198.51.100.2');
  assert.equal(clientAddress(req('::ffff:198.51.100.2',{'x-real-ip':'198.51.100.1'}),true),'198.51.100.2');
  for(const peer of ['127.0.0.1','::1','::ffff:127.0.0.1','0:0:0:0:0:ffff:7f00:1']){
    assert.equal(clientAddress(req(peer,{'x-real-ip':'198.51.100.1','x-forwarded-for':'203.0.113.99',forwarded:'for=203.0.113.99'}),true),'198.51.100.1');
    for(const invalid of [undefined,'','junk','198.51.100.1, 203.0.113.1','198.51.100.1:123','[2001:db8::1]','2001:db8::1%eth0',['198.51.100.1','203.0.113.1']]){
      assert.equal(clientAddress(req(peer,{'x-real-ip':invalid,'x-forwarded-for':'203.0.113.1'}),true),peer==='::1'?'::1':'127.0.0.1');
    }
  }
  assert.equal(clientAddress(req('127.0.0.1',{'x-real-ip':'2001:0DB8:0000:0000:0000:0000:0000:0001'}),true),'2001:db8::1');
  assert.equal(clientAddress(req('127.0.0.1',{'x-real-ip':'::ffff:c633:6401'}),true),'198.51.100.1');
  assert.equal(clientAddress(req('127.0.0.1',{'x-forwarded-for':'198.51.100.1','forwarded':'for=198.51.100.1'}),true),'127.0.0.1');
  assert.equal(clientAddress(req('127.0.0.2',{'x-real-ip':'198.51.100.1'}),true),'127.0.0.2');
});

test('HTTP rate limiting separates verified clients, rejects header tricks, and preserves owner exemptions',async()=>{
  const run=async(env,verify)=>{
    const dir=mkdtempSync(join(tmpdir(),'nameflare-limiter-')),store=new Store();store.seedDemo();
    const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const call=(path='/healthz',ip,options={})=>fetch(base+path,{...options,headers:{...(ip?{'X-Real-IP':ip}:{}),...options.headers}});
    try{await verify(call,store);}finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
  };
  await run({TRUST_PROXY_LOOPBACK:'true'},async(call,store)=>{
    for(let i=0;i<600;i++)assert.equal((await call('/healthz','198.51.100.1')).status,200);
    let limited=await call('/healthz','198.51.100.1');assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>=1);assert.ok(Number(limited.headers.get('Retry-After'))<=60);
    assert.equal((await call('/healthz','198.51.100.2')).status,200,'another verified client does not share the exhausted bucket');
    assert.equal((await call('/healthz','::ffff:c633:6401')).status,429,'mapped IPv4 is the same bucket');
    assert.equal((await call('/healthz','198.51.100.1',{headers:{'X-Forwarded-For':'198.51.100.3'}})).status,429);
    for(let i=0;i<600;i++)assert.equal((await call('/healthz',undefined,{headers:{'X-Forwarded-For':`198.51.100.${i%250+1}`}})).status,200);
    assert.equal((await call('/healthz',undefined,{headers:{'X-Forwarded-For':'203.0.113.7'}})).status,429);
    assert.equal((await call('/healthz','not-an-ip')).status,429,'invalid real IP falls back to the socket bucket');
    assert.equal((await call('/healthz','198.51.100.9, 203.0.113.7')).status,429,'address lists cannot create new buckets');
    const creator=store.newSession('demo-creator'),owner=store.newSession('demo-owner');
    const mutation=session=>({method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf},body:JSON.stringify({cosmeticId:null})});
    for(let i=0;i<40;i++)assert.equal((await call('/api/equip','198.51.100.10',mutation(creator))).status,200);
    assert.equal((await call('/api/equip','198.51.100.10',mutation(creator))).status,429);
    assert.equal((await call('/api/equip','198.51.100.11',mutation(creator))).status,200);
    assert.equal((await call('/healthz','198.51.100.10')).status,200,'read and write quotas remain separate');
    assert.equal((await call('/api/equip','198.51.100.10',mutation(owner))).status,200);
    assert.equal((await call('/healthz','198.51.100.1',{headers:{Cookie:`nameflare_session=${owner.raw}`}})).status,200);
    store.db.prepare("UPDATE users SET role='user' WHERE id='demo-owner'").run();
    assert.equal((await call('/healthz','198.51.100.1',{headers:{Cookie:`nameflare_session=${owner.raw}`}})).status,429);
  });
  for(const env of [{},{TRUST_PROXY_LOOPBACK:'false'}])await run(env,async call=>{
    for(let i=0;i<600;i++)assert.equal((await call('/healthz',`198.51.100.${i%250+1}`)).status,200);
    assert.equal((await call('/healthz','203.0.113.7')).status,429,'unconfigured proxy never trusts client headers');
  });
  const store=new Store();try{fails(()=>createApp({store,env:{TRUST_PROXY_LOOPBACK:'yes'}}),500);}finally{store.close();}
});

test('recipe validates bounded effects, supplies legacy defaults, and strips executable properties',() => {
  const r=validateRecipe({...recipe(),depth:6,outline:.5,shadowOpacity:75,glowColor:'#ff00aa',css:'url(javascript:alert(1))'});
  assert.equal(r.depth,6);assert.equal(r.glowColor,'#ff00aa');assert.equal(r.shadowX,0);assert.equal(r.css,undefined);
  for(const invalid of [{depth:9},{depth:1.5},{shadowX:13},{shadowOpacity:101},{outline:3},{glowColor:'red;display:none'},{speed:NaN},{colors:['red','blue']},{animation:'flash'},{textureId:'https://evil.test/a.gif'}])fails(() => validateRecipe({...recipe(),...invalid}),400);
  assert.equal(validateRecipe(recipe()).depth,0);
});
test('raster upload validation rejects SVG, wrong signatures, and oversized dimensions',() => {
  assert.match(validateTexture(gif).id,/^[a-f0-9]{64}\.gif$/);
  fails(() => validateTexture('data:image/svg+xml;base64,PHN2Zz4='),400);
  fails(() => validateTexture('data:image/gif;base64,aW52YWxpZC1pbWFnZS1oZWFkZXI='),400);
  const bytes=validateTexture(gif).bytes;bytes.writeUInt16LE(4096,6);
  fails(() => validateTexture(`data:image/gif;base64,${bytes.toString('base64')}`),400);
});
test('safe renderer keeps separate 3D/shadow layers and rejects untrusted recipe fills',() => {
  globalThis.window={matchMedia:() => ({matches:false})};
  const values=new Map();const classes=new Set();
  const element={textContent:'myname',dataset:{},classList:{add:k => classes.add(k),remove:k => classes.delete(k)},style:{removeProperty:k => values.delete(k),setProperty:(k,v) => values.set(k,v)}};
  applyCosmetic(element,{recipe:validateRecipe({...recipe(),depth:4,shadowOpacity:60,shadowY:3,outline:1})},'https://api.example.com');
  assert.equal(element.dataset.text,'myname');assert.equal(element.dataset.animation,'flow');assert.equal(values.get('--nameflare-shadows').split('px 0 #303047').length,5);assert.match(values.get('--nameflare-shadows'),/0 0 5px #71f5bd/);assert.equal(element.style.filter,undefined,'glow must not blur gradient-clipped glyphs via a filter');assert.equal(element.style.webkitTextStroke,'1px #ffffff');
  applyCosmetic(element,{recipe:{...recipe(),colors:['url(evil)','red']}},'https://api.example.com');assert.equal(classes.has('nameflare-name'),false);
  const textureId=`${'a'.repeat(64)}.gif`;window.matchMedia=() => ({matches:true});applyCosmetic(element,{recipe:{...recipe(),textureId}},'https://api.example.com');assert.match(element.style.backgroundImage,/linear-gradient/);
  delete globalThis.window;
});
test('SQLite survives restart; owner bootstrap is explicit and identity takeover is blocked',() => {
  const dir=mkdtempSync(join(tmpdir(),'nameflare-store-'));const path=join(dir,'db.sqlite');
  let store=new Store(path);
  try{
    const owner=store.linkIdentity(profile('1','owner'),null,'1');assert.equal(store.user(owner).role,'owner');
    const user=store.linkIdentity(profile('2','user'),null,'1');assert.equal(store.user(user).role,'user');
    const kick=store.linkIdentity(profile('k1','kick-user','kick'),user,'1');assert.equal(kick,user);
    fails(() => store.linkIdentity(profile('2'),owner,'1'),409);
    fails(() => store.linkIdentity(profile('3'),user,'1'),409);
    const session=store.newSession(user);assert.equal(store.session(session.raw).id,user);assert.notEqual(store.db.prepare('SELECT hash FROM sessions').get().hash,session.raw);
    const c=store.submit(user,'Original','',validateRecipe(recipe()));assert.equal(store.publicCosmetic(c),null);
    fails(() => store.equip(user,c.id),400);fails(() => store.review(store.user(user),c.id,'approved',''),403);
    store.review(store.user(owner),c.id,'approved','');store.equip(user,c.id);
    assert.equal(store.resolve('kick','k1').cosmetic.id,c.id);
    store.close();store=new Store(path);assert.equal(store.resolve('twitch','2').cosmetic.id,c.id);
    store.review(store.user(owner),c.id,'rejected','Policy violation');assert.equal(store.resolve('twitch','2').cosmetic,null);assert.equal(store.user(user).equipped,null);
    assert.equal(store.auditLog().length,2);store.revokeSession(session.raw);assert.equal(store.session(session.raw),null);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('OAuth state is bound to browser/provider, expires, and cannot be replayed',() => {
  const store=new Store();try{
    const raw=store.state('kick',null,'browser','verifier');fails(() => store.consumeState(raw,'kick','attacker'),400);
    assert.equal(store.consumeState(raw,'kick','browser').verifier,'verifier');fails(() => store.consumeState(raw,'kick','browser'),400);
    const old=store.state('twitch',null,'browser','v');store.db.prepare('UPDATE oauth_states SET expires=0 WHERE hash=?').run(digest(old));fails(() => store.consumeState(old,'twitch','browser'),400);
    const config={KICK_CLIENT_ID:'client',KICK_CLIENT_SECRET:'secret'};const started=beginOAuth('kick',store,null,'https://example.com',config);const url=new URL(started.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('state'));assert.equal(url.searchParams.has('client_secret'),false);
  }finally{store.close();}
});
test('OAuth provider adapters verify immutable platform identities (mocked providers)',async() => {
  const original=globalThis.fetch;
  try{
    for(const provider of ['twitch','kick','youtube']){
      const seen=[];globalThis.fetch=async(url,options) => {
        seen.push({url,options});if(String(url).includes('/token'))return Response.json({access_token:'provider-token'});
        return Response.json(provider==='twitch' ? {data:[{id:'42',login:'name',display_name:'Name',profile_image_url:'https://static-cdn.jtvnw.net/avatar.png'}]}:provider==='kick' ? {data:[{user_id:42,name:'Name',profile_picture:'https://files.kick.com/avatar.png'}]}:{items:[{id:'UC42',snippet:{title:'Name',customUrl:'@name',thumbnails:{medium:{url:'https://yt3.ggpht.com/avatar.png'}}}}]});
      };
      const env={[`${provider.toUpperCase()}_CLIENT_ID`]:'client',[`${provider.toUpperCase()}_CLIENT_SECRET`]:'secret'};
      const result=await finishOAuth(provider,'code','verifier','https://example.com',env);
      assert.equal(result.id,provider==='youtube' ? 'UC42':'42');assert.equal(result.provider,provider);assert.ok(result.avatar_url.endsWith('/avatar.png'));
      if(provider==='kick')assert.equal(seen[0].options.body.get('code_verifier'),'verifier');
      if(provider==='twitch')assert.equal(seen[1].options.headers['Client-Id'],'client');
      if(provider==='youtube')assert.match(seen[1].url,/mine=true/);
    }
  }finally{globalThis.fetch=original;}
});

test('HTTP moderation, CSRF, API publication, texture privacy, and overlay guards',async() => {
  const dir=mkdtempSync(join(tmpdir(),'nameflare-http-'));const store=new Store();store.seedDemo();
  // Keep public demo history but give this creator room for the tested submission.
  store.db.prepare("UPDATE cosmetics SET owner_id='demo-owner' WHERE owner_id='demo-creator'").run();
  const env={OVERLAY_INGEST_TOKEN:'private-ingest',OVERLAY_ROOM_KEY:'private-room'};
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env});await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const creatorSession=store.newSession('demo-creator'),ownerSession=store.newSession('demo-owner'),modSession=store.newSession('demo-mod');
  const sessions={creator:creatorSession,owner:ownerSession,mod:modSession};
  const call=async(path,data,role,extras={}) => {
    const headers={...extras};if(data!==undefined)headers['Content-Type']='application/json';
    if(role){headers.Cookie=`nameflare_session=${sessions[role].raw}`;headers['X-CSRF-Token']=sessions[role].csrf;headers.Origin='http://localhost';}
    return fetch(base+path,{method:data===undefined ? 'GET':'POST',headers,body:data===undefined ? undefined:JSON.stringify(data)});
  };
  try{
    assert.equal((await call('/api/demo/login',{role:'owner'},'owner')).status,404);
    assert.equal((await call('/api/admin/queue')).status,401);assert.equal((await call('/api/admin/queue',undefined,'creator')).status,403);
    const csrfResponse=await fetch(base+'/api/equip',{method:'POST',headers:{Cookie:`nameflare_session=${creatorSession.raw}`,Origin:'http://localhost','Content-Type':'application/json','X-CSRF-Token':'wrong'},body:JSON.stringify({cosmeticId:'demo-0'})});assert.equal(csrfResponse.status,403);
    assert.equal((await call('/api/admin/moderators',{twitchId:'1002',enabled:true},'mod')).status,403);
    assert.equal((await call('/api/admin/moderators',{twitchId:1002,enabled:true},'owner')).status,400);
    assert.equal((await call('/api/admin/moderators',{twitchId:'1002',enabled:true},'owner')).status,200);
    assert.equal((await call('/api/admin/moderators',{twitchId:'1002',enabled:false},'owner')).status,200);
    assert.equal((await call('/api/admin/moderators',{twitchId:'1001',enabled:false},'owner')).status,403);
    const upload=await call('/api/textures',{data:gif},'creator');assert.equal(upload.status,201);const textureId=(await upload.json()).id;
    assert.equal((await call(`/textures/${textureId}`)).status,401);assert.equal((await call(`/textures/${textureId}`,undefined,'creator')).status,200);
    const submit=await call('/api/cosmetics',{name:'Shadow test',description:'Layered depth',recipe:{...recipe(),textureId,depth:5,shadowOpacity:75}},'creator');assert.equal(submit.status,201);const cosmetic=(await submit.json()).cosmetic;
    assert.equal((await call(`/api/v1/cosmetics/${cosmetic.id}`)).status,404);
    let catalog=await (await call('/api/v1/cosmetics')).json();assert.equal(catalog.cosmetics.some(c => c.id===cosmetic.id),false);
    assert.equal((await call('/api/equip',{cosmeticId:cosmetic.id},'creator')).status,400);
    assert.equal((await call('/api/admin/review',{id:cosmetic.id,status:'approved'},'creator')).status,403);
    assert.equal((await call('/api/admin/review',{id:cosmetic.id,status:'approved',reason:''},'mod')).status,200);
    const publicResponse=await call(`/api/v1/cosmetics/${cosmetic.id}`);assert.equal(publicResponse.status,200);assert.equal(publicResponse.headers.get('Access-Control-Allow-Origin'),'*');const published=(await publicResponse.json()).cosmetic;assert.equal(published.recipe.depth,5);assert.equal(published.owner_id,undefined);
    assert.equal((await call(`/textures/${textureId}`)).status,200);
    assert.equal((await call('/api/equip',{cosmeticId:cosmetic.id},'creator')).status,200);
    const resolution=await (await call('/api/v1/resolve',{provider:'twitch',ids:['1002']})).json();assert.equal(resolution.users[0].cosmetic.id,cosmetic.id);
    assert.equal((await call('/api/admin/review',{id:cosmetic.id,status:'rejected',reason:'Flashing artwork'},'owner')).status,200);
    assert.equal((await call(`/api/v1/cosmetics/${cosmetic.id}`)).status,404);assert.equal((await call(`/textures/${textureId}`)).status,401);
    assert.equal((await call('/api/v1/cosmetics?limit=NaN')).status,400);assert.equal((await call('/api/v1/resolve',{provider:'twitch',ids:[123]})).status,400);
    assert.equal((await call('/api/overlay/messages',{provider:'twitch',provider_id:'1002',name:'lumi',text:'hi'})).status,401);
    assert.equal((await call('/api/overlay/messages',{provider:'kick',provider_id:'5',name:'viewer',text:'hello'},undefined,{Authorization:'Bearer private-ingest'})).status,202);
    assert.equal((await call('/api/overlay/events?room=bad')).status,403);
    const streamResponse=await call('/api/overlay/events?room=private-room');assert.equal(streamResponse.status,200);const reader=streamResponse.body.getReader();await reader.read();
    await call('/api/overlay/messages',{provider:'youtube',provider_id:'UC123',name:'viewer',text:'stream event'},undefined,{Authorization:'Bearer private-ingest'});
    const event=await reader.read();assert.match(new TextDecoder().decode(event.value),/stream event/);await reader.cancel();
    const pendingOwn=store.submit('demo-owner','Owner design','',validateRecipe(recipe()));
    assert.equal(pendingOwn.status,'approved');assert.equal((await call('/api/admin/review',{id:pendingOwn.id,status:'approved',reason:''},'owner')).status,200);
    assert.equal((await call('/api/admin/review',{id:pendingOwn.id,status:'rejected',reason:''},'mod')).status,400);
    const crossOrigin=await fetch(base+'/api/equip',{method:'POST',headers:{Cookie:`nameflare_session=${creatorSession.raw}`,Origin:'https://attacker.example','Content-Type':'application/json','X-CSRF-Token':creatorSession.csrf},body:JSON.stringify({cosmeticId:'demo-0'})});assert.equal(crossOrigin.status,403);
    const preflight=await fetch(base+'/api/v1/resolve',{method:'OPTIONS',headers:{Origin:'https://overlay.example','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);
    for(const path of ['/','/app.js','/style.css','/effects.css','/overlay','/overlay.js','/license'])assert.equal((await call(path)).status,200);
    const source=await (await call('/source')).json();assert.ok(source.files['public/app.js']);assert.ok(source.files['LICENSE']);assert.ok(source.files['docs/ORACLE.md']);assert.ok(source.files['docs/oracle/nameflare.service']);assert.ok(source.files['docs/oracle/nameflare.nginx.conf']);assert.ok(source.files['docs/oracle/nameflare-http.nginx.conf']);assert.equal(source.files['.env'],undefined);assert.equal(Object.keys(source.files).some(p => /\.(key|pem)(\.pub)?$/.test(p)),false);assert.equal(Object.keys(source.files).some(p => p.includes('.sqlite')),false);
    assert.equal((await call('/api/me')).headers.get('Cache-Control'),'no-store');
  }finally{app.server.closeAllConnections();await new Promise(resolve => app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Node Flare publishing controls protect moderation and allow anyone to equip shared approved Flares',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-publishing-')),store=new Store();store.seedDemo();
  store.db.prepare("UPDATE cosmetics SET owner_id='demo-owner' WHERE owner_id='demo-creator'").run();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,creator=store.newSession('demo-creator'),viewer=store.newSession('demo-mod');
  const call=(path,data,session)=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost'}),...(session?{Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    const submitted=await call('/api/cosmetics',{name:'Link signal',description:'Only discoverable by link',recipe:recipe(),listed:false},creator);assert.equal(submitted.status,201);const c=(await submitted.json()).cosmetic;
    assert.equal((await call(`/api/v1/cosmetics/${c.id}`)).status,404);
    assert.equal((await call('/api/cosmetics/publication',{id:c.id,listed:true},viewer)).status,403);
    assert.equal((await call('/api/cosmetics/publication',{id:c.id,listed:true})).status,401);
    for(const listed of ['false',0,null])assert.equal((await call('/api/cosmetics',{name:'Invalid',recipe:recipe(),listed},creator)).status,400);
    assert.equal((await call('/api/cosmetics/publication',{id:c.id},creator)).status,400);
    store.review(store.user('demo-owner'),c.id,'approved','Readable');
    assert.equal((await (await call('/api/v1/cosmetics')).json()).cosmetics.some(row=>row.id===c.id),false);
    const shared=(await (await call(`/api/v1/cosmetics/${c.id}`)).json()).cosmetic;assert.equal(shared.description,'Only discoverable by link');assert.equal(shared.listed,false);assert.equal(shared.owner_id,undefined);
    assert.equal((await call('/api/equip',{cosmeticId:c.id},viewer)).status,200);
    assert.equal((await call('/api/cosmetics/publication',{id:c.id,listed:true},creator)).status,200);
    const catalog=await (await call('/api/v1/cosmetics?q=Link&effect=animated&sort=popular&limit=1')).json();assert.equal(catalog.cosmetics[0].id,c.id);assert.equal(catalog.cosmetics[0].equipped_count,1);assert.equal(catalog.total,9);
    const staticFlare=store.submit('demo-creator','Static signal','',{...recipe(),animation:'none',glow:0});store.review(store.user('demo-owner'),staticFlare.id,'approved','');
    assert.equal((await (await call('/api/v1/cosmetics?effect=static')).json()).cosmetics[0].id,staticFlare.id);
    for(const query of ['effect=unknown','sort=unknown'])assert.equal((await call(`/api/v1/cosmetics?${query}`)).status,400);
    const all=await (await call('/api/v1/cosmetics?sort=name&limit=1')).json();assert.equal(all.next_offset,1);
    store.setPublication('demo-creator',c.id,false);assert.equal(store.user('demo-mod').equipped,c.id);assert.equal(store.resolve('twitch','1003').cosmetic.id,c.id);
    store.review(store.user('demo-owner'),c.id,'rejected','Rights concern');store.setPublication('demo-creator',c.id,true);assert.equal(store.user('demo-mod').equipped,null);assert.equal((await call(`/api/v1/cosmetics/${c.id}`)).status,404);
    assert.ok(store.auditLog().some(row=>row.action==='flare.publication'));
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('post-style likes are unique, reversible, private to each account, persistent, and approval-gated',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-likes-')),dbPath=join(dir,'db.sqlite'),store=new Store(dbPath);store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,creator=store.newSession('demo-creator'),viewer=store.newSession('demo-mod');
  const call=(path,data,session,extra={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost'}),...(session?{Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const like=(id,liked=true,session=creator,extra={})=>call('/api/cosmetics/like',{id,liked},session,extra);
  try{
    assert.equal((await call('/api/cosmetics/like',{id:'demo-1',liked:true})).status,401);
    assert.equal((await like('demo-1',true,creator,{'X-CSRF-Token':'bad'})).status,403);
    assert.equal((await like('demo-1',true,creator,{Origin:'https://evil.example'})).status,403);
    for(const liked of [undefined,null,1,'true'])assert.equal((await call('/api/cosmetics/like',{id:'demo-1',liked},creator)).status,400);
    assert.equal((await like('unknown')).status,404);
    const pending=store.mine('demo-creator').find(c=>c.status==='pending');assert.equal((await like(pending.id)).status,404);
    let response=await like('demo-1');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{id:'demo-1',liked:true,like_count:1});
    assert.equal((await (await like('demo-1')).json()).like_count,1,'retrying a like never adds another vote');
    assert.equal((await (await like('demo-1',true,viewer)).json()).like_count,2);
    await like('demo-2');
    const me=await (await call('/api/me',undefined,creator)).json();assert.deepEqual(new Set(me.liked_ids),new Set(['demo-1','demo-2']));
    assert.deepEqual((await (await call('/api/me')).json()).liked_ids,[]);
    assert.equal((await call('/api/my/likes')).status,401);
    response=await call('/api/my/likes?limit=1&sort=liked',undefined,creator);assert.equal(response.headers.get('Cache-Control'),'no-store');let page=await response.json();assert.equal(page.total,2);assert.equal(page.cosmetics[0].id,'demo-1');assert.equal(page.next_offset,1);
    page=await (await call('/api/my/likes?limit=1&offset=1&sort=liked',undefined,creator)).json();assert.equal(page.cosmetics[0].id,'demo-2');assert.equal(page.next_offset,null);
    assert.equal((await (await call('/api/my/likes',undefined,viewer)).json()).total,1);
    assert.equal((await (await call('/api/my/likes?q=Solar',undefined,creator)).json()).cosmetics[0].id,'demo-1');
    assert.equal((await (await call('/api/my/likes?effect=static',undefined,creator)).json()).cosmetics.length,0);
    for(const query of ['limit=101','offset=-1','sort=unknown'])assert.equal((await call(`/api/my/likes?${query}`,undefined,creator)).status,400);
    response=await call('/api/v1/cosmetics?sort=liked&limit=1');assert.match(response.headers.get('Cache-Control'),/public/);const publicFlare=(await response.json()).cosmetics[0];assert.equal(publicFlare.id,'demo-1');assert.equal(publicFlare.like_count,2);assert.equal(publicFlare.liked,undefined);assert.equal(publicFlare.liked_ids,undefined);
    const reopened=new Store(dbPath);try{assert.equal(reopened.getCosmetic('demo-1').like_count,2);assert.deepEqual(new Set(reopened.likedIds('demo-creator')),new Set(['demo-1','demo-2']));assert.equal(reopened.session(creator.raw).id,'demo-creator');}finally{reopened.close();}
    assert.equal((await (await like('demo-1',false)).json()).like_count,1);assert.equal((await (await like('demo-1',false)).json()).like_count,1);
    store.setPublication('demo-mod','demo-1',false);assert.equal((await like('demo-1')).status,404);assert.equal(store.likedIds('demo-mod').includes('demo-1'),false);
    store.setPublication('demo-mod','demo-1',true);assert.equal(store.likedIds('demo-mod').includes('demo-1'),true);
    store.review(store.user('demo-owner'),'demo-1','rejected','Unsafe motion');assert.equal((await like('demo-1')).status,404);assert.equal(store.likedIds('demo-mod').includes('demo-1'),false);
    store.deleteRejected(store.user('demo-owner'),'demo-1');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cosmetic_likes WHERE cosmetic_id=?').get('demo-1').n,0);
    store.setBan(store.user('demo-owner'),'demo-creator',true,'Abuse');assert.equal((await like('demo-3')).status,401);assert.throws(()=>store.setLike('demo-creator','demo-3',true),e=>e.status===403);
    assert.equal(store.getCosmetic('demo-2').like_count,0,'banned accounts do not boost popularity');
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('weekly trending ranks recent unique likes before lifetime totals and excludes banned votes',()=>{
  const store=new Store();store.seedDemo();
  try{
    store.setLike('demo-creator','demo-1',true);store.setLike('demo-owner','demo-1',true);
    store.db.prepare("UPDATE cosmetic_likes SET created_at='2020-01-01T00:00:00.000Z' WHERE cosmetic_id='demo-1'").run();
    store.setLike('demo-creator','demo-3',true);
    let catalog=store.catalog({listedOnly:true,sort:'trending',limit:1});assert.equal(catalog[0].id,'demo-3');assert.equal(catalog[0].recent_like_count,1);
    assert.equal(store.catalog({listedOnly:true,sort:'liked',limit:1})[0].id,'demo-1');
    store.setLike('demo-mod','demo-3',true);store.setLike('demo-mod','demo-3',true);assert.equal(store.getCosmetic('demo-3').recent_like_count,2);
    store.setPublication('demo-mod','demo-3',false);assert.notEqual(store.catalog({listedOnly:true,sort:'trending',limit:1})[0].id,'demo-3');
    store.setPublication('demo-mod','demo-3',true);store.setBan(store.user('demo-owner'),'demo-creator',true,'Abuse');assert.equal(store.getCosmetic('demo-3').recent_like_count,1);
  }finally{store.close();}
});

test('provider avatars reject arbitrary hosts, insecure URLs, credentials and executable URLs',()=>{
  assert.equal(safeAvatar('kick','https://files.kick.com/a.png'),'https://files.kick.com/a.png');
  for(const url of ['javascript:alert(1)','http://static-cdn.jtvnw.net/a','https://evil.test/a','https://static-cdn.jtvnw.net.evil.test/a','https://user:pass@static-cdn.jtvnw.net/a','https://static-cdn.jtvnw.net:444/a'])assert.equal(safeAvatar('twitch',url),'');
  assert.equal(safeAvatar('unknown','https://files.kick.com/a.png'),'');
});

test('demo factory cannot be enabled with a public origin or production environment',() => {
  const store=new Store();try{
    fails(() => createApp({store,demo:true,baseUrl:'https://public.example.com',env:{}}),500);
    fails(() => createApp({store,demo:true,baseUrl:'http://localhost',env:{NODE_ENV:'production'}}),500);
  }finally{store.close();}
});
