import { timingSafeEqual } from 'node:crypto';
import { isAppPath } from '../public/routes.js';
const pageAliases={'/creators':'/profiles','/insights':'/analytics','/settings':'/account/settings','/support':'/donate'};
import { HttpError, assert, text, validateRecipe, validateTexture, publishingFlag, catalogFilters } from '../lib/cosmetics.js';
import { providerConfig, authorizationURL, finishOAuth, avatarSources } from '../lib/oauth.js';
import { D1Store, token } from './store.js';
const providers=['twitch','kick','youtube'];
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=(name,value,age,secure)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
const publicHeaders={'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=15, must-revalidate'};
async function body(request) {
  assert((request.headers.get('Content-Type') || '').split(';')[0]==='application/json',415,'Send application/json.');
  const reader=request.body?.getReader();assert(reader,400,'Expected a JSON object.');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2900000){await reader.cancel();throw new HttpError(413,'Request body is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const result=JSON.parse(new TextDecoder().decode(bytes));assert(result && typeof result==='object' && !Array.isArray(result),400,'Expected a JSON object.');return result;}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON.');}
}
function json(value,status=200,extra={}) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...extra}}); }
function redirect(to,cookies=[]) {
  const headers=new Headers({Location:to});for(const value of cookies)headers.append('Set-Cookie',value);
  return new Response(null,{status:302,headers});
}
export async function handleRequest(request,env) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const base=(env.PUBLIC_BASE_URL || '').replace(/\/$/,'');let canonical;
  try{canonical=new URL(base);}catch{throw new HttpError(503,'Operator must configure PUBLIC_BASE_URL.');}
  const local=env.LOCAL_DEV==='true' && ['127.0.0.1','localhost'].includes(canonical.hostname);
  assert(canonical.origin===base && (canonical.protocol==='https:' || local),503,'Configure one canonical HTTPS origin.');
  assert(url.origin===canonical.origin,421,'Use the canonical service hostname.');
  assert(/^\d{1,30}$/.test(env.OWNER_TWITCH_ID || ''),503,'Operator must configure a numeric owner Twitch ID.');
  const secure=!local,store=new D1Store(env.DB),cookies=Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(c=>c.trim().split('=')).filter(c=>c.length===2));
  const getSession=()=>store.session(cookies.nameflare_session);
  async function user() { const session=await getSession();assert(session,401,'Sign in to continue.');return session; }
  async function mod(owner=false) { const session=await user();assert(owner?session.role==='owner':['owner','moderator'].includes(session.role),403,owner?'Owner access required.':'Moderator access required.');return session; }
  async function mutation() {
    assert(request.headers.get('Origin')===base,403,'Requests must come from the official app origin.');
    const session=await user();assert(equal(request.headers.get('X-CSRF-Token'),session.csrf),403,'Invalid security token. Refresh the page.');return session;
  }
  if(method==='OPTIONS' && path.startsWith('/api/v1/'))return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}});
  if((path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/textures/')) && (await getSession())?.role!=='owner') {
    const limiter=method==='GET'?env.READ_LIMITER:env.WRITE_LIMITER;
    assert(limiter,503,'Operator must configure API rate-limit bindings.');
    const result=await limiter.limit({key:request.headers.get('CF-Connecting-IP') || 'local'});
    assert(result.success,429,'Too many requests. Try again in a minute.');
  }
  if(method==='GET' && path==='/healthz'){await store.first('SELECT 1');return json({status:'ok',runtime:'cloudflare'});}
  if(method==='GET' && path==='/license')return redirect('https://www.gnu.org/licenses/agpl-3.0.txt');
  if(method==='GET' && path==='/source') {
    let source;try{source=new URL(env.SOURCE_URL);}catch{}
    assert(source?.protocol==='https:',503,'The operator must publish corresponding source before launch.');return redirect(source.toString());
  }
  if(method==='GET' && path==='/api/config')return json({name:'Nameflare',owner:'B_X_N_E',demo:false,runtime:'cloudflare',officialApi:`${base}/api/v1`,providers:Object.fromEntries(providers.map(p=>{const c=providerConfig(p,env);return [p,Boolean(c.clientId && c.clientSecret)];})),stats:await store.stats(),features:{relay:false}});
  if(method==='GET' && path==='/api/me'){const session=await getSession();return json({user:session?await store.account(session.id):null,csrf:session?.csrf || null,liked_ids:session?await store.likedIds(session.id):[],following_ids:session?await store.followingIds(session.id):[]});}
  const auth=/^\/auth\/(twitch|kick|youtube)(\/callback)?$/.exec(path);
  if(method==='GET' && auth) {
    const provider=auth[1],session=await getSession(),config=providerConfig(provider,env);
    assert(config.clientId && config.clientSecret,503,`${provider} linking needs OAuth credentials from the service operator.`);
    if(!auth[2]) {
      const binding=token(),verifier=token(),state=await store.state(provider,session?.id,binding,verifier);
      return redirect(authorizationURL(provider,base,env,state,verifier),[cookie(`nameflare_oauth_${provider}`,binding,600,secure)]);
    }
    const state=await store.consumeState(url.searchParams.get('state'),provider,cookies[`nameflare_oauth_${provider}`]);
    assert(state.user_id?session?.id===state.user_id:!session,403,'Account changed during login. Please start again.');
    assert(!url.searchParams.has('error'),400,'Authorization was cancelled.');
    const profile=await finishOAuth(provider,url.searchParams.get('code'),state.verifier,base,env);
    const id=await store.linkIdentity(profile,state.user_id,env.OWNER_TWITCH_ID);
    await store.revokeSession(cookies.nameflare_session);const created=await store.newSession(id);
    return redirect('/account',[cookie('nameflare_session',created.raw,604800,secure),cookie(`nameflare_oauth_${provider}`,'',0,secure)]);
  }
  if(method==='POST' && path==='/api/logout'){await mutation();await store.revokeSession(cookies.nameflare_session);const response=json({ok:true});response.headers.append('Set-Cookie',cookie('nameflare_session','',0,secure));return response;}
  if(method==='POST' && path==='/api/account/profile') {
    const session=await mutation(),data=await body(request);
    assert(providers.includes(data.provider),400,'Choose a connected platform for your profile.');
    return json({user:await store.updateProfile(session.id,data.provider,data)});
  }
  if(method==='POST' && path==='/api/profiles/follow') {
    const session=await mutation(),data=await body(request);
    return json(await store.setFollow(session.id,text(data.id,1,100,'Creator ID'),data.following));
  }
  if(method==='GET' && (path==='/api/my/following' || path==='/api/my/feed')) {
    const session=await user(),offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 24);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
    const query=(url.searchParams.get('q') || '').slice(0,80);
    if(path==='/api/my/following'){
      const results=await store.followingProfiles(session.id,{offset,limit:limit+1,query});
      return json({users:results.slice(0,limit),next_offset:results.length>limit?offset+limit:null});
    }
    const results=await store.catalog({followedBy:session.id,offset,limit:limit+1,query,...catalogFilters(url.searchParams),sort:'newest'});
    return json({cosmetics:results.slice(0,limit).map(c=>store.publicCosmetic(c)),next_offset:results.length>limit?offset+limit:null});
  }
  if(method==='GET' && path==='/api/admin/users') {
    await mod();
    const offset=Number(url.searchParams.get('offset') || 0);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000,400,'Invalid pagination.');
    const users=await store.adminUsers({query:(url.searchParams.get('q') || '').slice(0,100),status:url.searchParams.get('status') || 'all',offset,limit:51});
    return json({users:users.slice(0,50),next_offset:users.length>50?offset+50:null});
  }
  if(method==='GET' && path==='/api/my/cosmetics') {
    const account=await user();
    if(!url.searchParams.has('offset') && !url.searchParams.has('limit'))return json({cosmetics:await store.mine(account.id)});
    const offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 24);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
    const results=await store.mine(account.id,{offset,limit:limit+1});
    return json({cosmetics:results.slice(0,limit),next_offset:results.length>limit?offset+limit:null});
  }
  if(method==='POST' && path==='/api/cosmetics') {
    const session=await mutation(),data=await body(request),recipe=validateRecipe(data.recipe);
    const textures=new Set([recipe.textureId,...(recipe.layers || []).filter(l=>l.type==='image').map(l=>l.textureId)].filter(Boolean));
    for(const id of textures)assert(await store.ownsTexture(id,session.id),400,'Upload every image layer from your own account first.');
    return json({cosmetic:await store.submit(session.id,text(data.name,2,40,'Name'),text(data.description || '',0,400,'Description'),recipe,publishingFlag(data.listed))},201);
  }
  if(method==='POST' && path==='/api/cosmetics/publication') {
    const session=await mutation(),data=await body(request);
    assert(typeof data.listed==='boolean',400,'Public listing must be true or false.');
    return json({cosmetic:await store.setPublication(session.id,text(data.id,1,100,'Flare ID'),data.listed)});
  }
  if(method==='POST' && path==='/api/cosmetics/like') {
    const session=await mutation(),data=await body(request);
    assert(typeof data.liked==='boolean',400,'Liked must be true or false.');
    return json(await store.setLike(session.id,text(data.id,1,100,'Flare ID'),data.liked));
  }
  if(method==='GET' && path==='/api/my/likes') {
    const session=await user(),offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 24);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
    const results=await store.catalog({likedBy:session.id,listedOnly:true,offset,limit:limit+1,query:(url.searchParams.get('q') || '').slice(0,80),...catalogFilters(url.searchParams),sort:url.searchParams.get('sort') || 'newest'});
    return json({total:(await store.likedIds(session.id)).length,cosmetics:results.slice(0,limit).map(c=>store.publicCosmetic(c)),next_offset:results.length>limit?offset+limit:null});
  }
  if(method==='POST' && path==='/api/textures') {
    const session=await mutation(),uploaded=validateTexture((await body(request)).data);
    const existing=await store.first('SELECT owner_id FROM textures WHERE id=?',uploaded.id);
    assert(!existing || existing.owner_id===session.id,409,'This texture is already owned by another creator.');
    const count=await store.first('SELECT COUNT(*) AS n FROM textures WHERE owner_id=?',session.id);
    assert(session.role==='owner' || existing || count.n<50,429,'Texture limit reached (50 per account).');
    // Only API-authorized requests can read R2; the bucket must have no public URL.
    await env.TEXTURES.put(uploaded.id,uploaded.bytes,{httpMetadata:{contentType:`image/${uploaded.id.split('.').pop()}`}});
    await store.run('INSERT OR IGNORE INTO textures VALUES (?,?)',uploaded.id,session.id);
    assert(await store.ownsTexture(uploaded.id,session.id),409,'This texture was claimed by another creator.');
    return json({id:uploaded.id},201);
  }
  if(method==='POST' && path==='/api/equip') {
    const session=await mutation(),data=await body(request);assert(data.cosmeticId===null || typeof data.cosmeticId==='string',400,'Invalid cosmetic ID.');
    await store.equip(session.id,data.cosmeticId);return json({ok:true});
  }
  if(method==='POST' && path==='/api/admin/ban') {
    const session=await mutation();await mod();const data=await body(request);
    assert(typeof data.banned==='boolean',400,'Provide a banned flag.');
    return json({user:await store.setBan(session,text(data.id,1,100,'Account ID'),data.banned,text(data.reason || '',data.banned?3:0,400,'Ban reason'))});
  }
  if(method==='GET' && path==='/api/admin/queue') {
    await mod();
    const status=url.searchParams.get('status') || 'pending',offset=Number(url.searchParams.get('offset') || 0);
    assert(['pending','approved','rejected'].includes(status),400,'Invalid review status.');
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000,400,'Invalid pagination.');
    const cosmetics=await store.moderationCatalog({status,offset,limit:51,query:(url.searchParams.get('q') || '').slice(0,80)});
    return json({cosmetics:cosmetics.slice(0,50),stats:await store.stats(),next_offset:cosmetics.length>50?offset+50:null});
  }
  if(method==='GET' && path==='/api/admin/audit'){await mod();return json({entries:await store.auditLog()});}
  if(method==='GET' && path==='/api/admin/moderators'){await mod(true);return json({moderators:await store.moderators()});}
  if(method==='POST' && path==='/api/admin/review') {
    const session=await mutation();await mod();const data=await body(request);assert(['approved','rejected'].includes(data.status),400,'Invalid review decision.');
    return json({cosmetic:await store.review(session,text(data.id,1,100,'Cosmetic ID'),data.status,text(data.reason || '',data.status==='rejected'?3:0,400,'Review note'))});
  }
  if(method==='POST' && path==='/api/admin/moderators') {
    const session=await mutation();await mod(true);const data=await body(request);assert(typeof data.enabled==='boolean' && typeof data.twitchId==='string' && /^\d{1,30}$/.test(data.twitchId),400,'Provide a numeric Twitch ID and enabled flag.');
    await store.setModerator(session,data.twitchId,data.enabled);return json({moderators:await store.moderators()});
  }
  if(method==='GET' && path==='/api/v1/cosmetics') {
    const offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 60);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
    const results=await store.catalog({offset,limit:limit+1,query:(url.searchParams.get('q') || '').slice(0,80),listedOnly:true,...catalogFilters(url.searchParams),sort:url.searchParams.get('sort') || 'newest'});
    return json({version:1,total:(await store.stats()).public,cosmetics:results.slice(0,limit).map(c=>store.publicCosmetic(c)),next_offset:results.length>limit?offset+limit:null},200,publicHeaders);
  }
  const cosmetic=/^\/api\/v1\/cosmetics\/([a-zA-Z0-9-]+)$/.exec(path);
  if(method==='GET' && cosmetic){const c=store.publicCosmetic(await store.getCosmetic(cosmetic[1]));assert(c,404,'Approved cosmetic not found.');return json({cosmetic:c},200,publicHeaders);}
  if(method==='GET' && path==='/api/v1/profiles') {
    const offset=Number(url.searchParams.get('offset') || 0);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000,400,'Invalid pagination.');
    const users=await store.searchProfiles({query:(url.searchParams.get('q') || '').slice(0,80),offset,limit:25});
    return json({users:users.slice(0,24),next_offset:users.length>24?offset+24:null},200,publicHeaders);
  }
  const profileFlares=/^\/api\/v1\/profiles\/([a-zA-Z0-9-]+)\/cosmetics$/.exec(path);
  if(method==='GET' && profileFlares) {
    assert(await store.publicProfile(profileFlares[1]),404,'Profile not found.');
    const offset=Number(url.searchParams.get('offset') || 0),limit=Number(url.searchParams.get('limit') || 24);
    assert(Number.isInteger(offset) && offset>=0 && offset<=1000000 && Number.isInteger(limit) && limit>=1 && limit<=100,400,'Invalid pagination.');
    const results=await store.catalog({owner:profileFlares[1],listedOnly:true,offset,limit:limit+1});
    return json({cosmetics:results.slice(0,limit).map(c=>store.publicCosmetic(c)),next_offset:results.length>limit?offset+limit:null},200,publicHeaders);
  }
  const profile=/^\/api\/v1\/profiles\/([a-zA-Z0-9-]+)$/.exec(path);
  if(method==='GET' && profile){const result=await store.publicProfile(profile[1]);assert(result,404,'Profile not found.');return json({user:result},200,publicHeaders);}
  const identity=/^\/api\/v1\/users\/(twitch|kick|youtube)\/([^/]+)$/.exec(path);
  if(method==='GET' && identity){const result=await store.resolve(identity[1],decodeURIComponent(identity[2]));assert(result,404,'No linked identity found.');return json({user:result},200,publicHeaders);}
  if(method==='POST' && path==='/api/v1/resolve') {
    const data=await body(request);assert(providers.includes(data.provider) && Array.isArray(data.ids) && data.ids.length<=100 && data.ids.every(id=>typeof id==='string' && id.length>0 && id.length<=100),400,'Provide a platform and up to 100 string user IDs.');
    return json({users:await store.resolveMany(data.provider,data.ids)},200,{'Access-Control-Allow-Origin':'*'});
  }
  const texture=/^\/textures\/([a-f0-9]{64}\.(gif|png|webp))$/.exec(path);
  if(method==='GET' && texture) {
    const id=texture[1],published=await store.publicTexture(id);
    if(!published){const session=await user();assert(['owner','moderator'].includes(session.role) || await store.ownsTexture(id,session.id),403,'This texture is awaiting approval.');}
    const object=await env.TEXTURES.get(id);assert(object,404,'Texture not found.');
    return new Response(object.body,{headers:{'Content-Type':`image/${id.split('.').pop()}`,...(published?publicHeaders:{})}});
  }
  if(path.startsWith('/api/overlay/'))throw new HttpError(501,'Relay streaming is not implemented on the Cloudflare runtime. Use direct Twitch or the Node relay.');
  if(path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/textures/'))throw new HttpError(404,'Not found.');
  if(method==='GET') {
    const alias=pageAliases[path.replace(/\/$/,'')];
    if(alias)return new Response(null,{status:301,headers:{Location:alias,'Cache-Control':'public, max-age=3600'}});
    const assetPath=isAppPath(path)?'/index.html':path==='/overlay'?'/overlay.html':path;
    const assetURL=new URL(request.url);assetURL.pathname=assetPath;
    const asset=await env.ASSETS.fetch(new Request(assetURL,request));
    // A browser asking for a page that does not exist gets the app's "Page not found" screen with a 404 status.
    if(asset.status===404 && /\btext\/html\b/.test(request.headers.get('Accept')||'') && !/\.[a-z0-9]{1,8}$/i.test(path)) {
      assetURL.pathname='/index.html';
      const page=await env.ASSETS.fetch(new Request(assetURL,{headers:{Accept:'text/html'}}));
      return new Response(page.body,{status:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }
    return asset;
  }
  throw new HttpError(404,'Not found.');
}
export default {
  async fetch(request,env) {
    let response;
    try{response=await handleRequest(request,env);}
    catch(error){
      const message=String(error.message || '');
      if(message.includes('Flare submission limit'))response=json({error:'Flare submission limit reached (3 per account).'},429);
      else if(message.includes('Pending submission limit') || message.includes('Texture limit'))response=json({error:'Account submission or texture limit reached.'},429);
      else if(message.includes('Only approved cosmetics'))response=json({error:'Only approved cosmetics can be equipped.'},400);
      else response=json({error:error instanceof HttpError?error.message:'Request failed. Please try again.'},error.status || 500);
    }
    const headers=new Headers(response.headers);
    if(!headers.has('Cache-Control'))headers.set('Cache-Control','no-store');
    if(new URL(request.url).pathname.startsWith('/api/v1/'))headers.set('Access-Control-Allow-Origin','*');
    headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: ${avatarSources}; connect-src 'self' wss://irc-ws.chat.twitch.tv; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if(new URL(request.url).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(event,env,ctx){ctx.waitUntil(new D1Store(env.DB).cleanup());}
};
