import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { Store } from '../lib/store.js';
import { changeLayerType,moveLayer,defaultRecipe,presets,exportDesign,importDesign,imageOnlyRecipe,planImageAttachment,zoomImageLayer,panImageLayer,coverImageSize,studioShortcut,previewFonts } from '../public/editor.js';
import { validateRecipe } from '../lib/cosmetics.js';
import { normalizeCosmetic } from '../public/client.js';
import { legacyLayer,normalizeLayers } from '../public/paints.js';
import { isAppPath,currentRoute,legacyRoute,preserveFeedScroll } from '../public/routes.js';

const recipe={colors:['#ffaabb','#9988ff','#aaffdd'],animation:'spectrum',direction:'alternate-reverse',letterSpacing:1.5,speed:6,angle:90,glow:10,glowColor:'#aaffdd',shadowX:-2,shadowY:3,shadowBlur:5,shadowOpacity:70,shadowColor:'#111111',outline:.5,outlineColor:'#ffffff',depth:6,depthAngle:70,depthColor:'#332244'};

test('clean routes recognize app deep links without swallowing APIs or assets',()=>{
  for(const path of ['/','/index.html','/discover','/discover/paint-1','/profiles/user_2','/artists','/account/settings','/guide/effects','/guide/shortcuts','/following'])assert.equal(isAppPath(path),true,path);
  for(const path of ['/api/config','/auth/twitch','/textures/file.gif','/app.js','/unknown','/profiles/a/b','//evil.example'])assert.equal(isAppPath(path),false,path);
  assert.equal(currentRoute({pathname:'/'}),'/discover');assert.equal(currentRoute({pathname:'/profiles/'}),'/profiles');
  assert.equal(legacyRoute({hash:'#discover/paint-1'}),'/discover/paint-1');assert.equal(legacyRoute({hash:'#main-content'}),null);assert.equal(legacyRoute({hash:'#https://evil.example'}),null);
});

test('feed switches preserve the tab anchor across shrinking headers, never pad empty results, without undoing user scroll',()=>{
  let documentTop=1300,height=4000,pageHeight=4000;const calls=[];
  const viewport={scrollY:1200,scrollX:0,innerHeight:800,scrollTo(value){this.scrollY=value.top;calls.push(value);}};
  const container={style:{minHeight:'',overflowAnchor:''},get offsetHeight(){return height;}};
  const page={scrollingElement:{get scrollHeight(){return pageHeight;}}},anchor={getBoundingClientRect(){return {top:documentTop-viewport.scrollY};}};
  const position=preserveFeedScroll(anchor,container,viewport,page);assert.equal(container.style.minHeight,'4000px');
  documentTop=700;position.restore();assert.equal(viewport.scrollY,600,'Header collapse keeps tabs 100px from viewport top');
  height=1000;pageHeight=1000;position.finish();assert.equal(viewport.scrollY,200,'Short/empty results scroll back instead of padding the page with blank space');assert.equal(container.style.minHeight,'');assert.equal(container.style.overflowAnchor,'');
  height=4000;pageHeight=4000;const next=preserveFeedScroll(anchor,container,viewport,page);next.restore();viewport.scrollY=650;next.finish();assert.equal(viewport.scrollY,650,'User scroll during loading wins');
  assert.ok(calls.every(call=>call.behavior==='instant'));
  const cancelled=preserveFeedScroll(anchor,container,viewport,page);cancelled.cancel();assert.equal(container.style.overflowAnchor,'');
});

test('preview fonts are allowlisted presentation settings, not recipe fields',()=>{
  assert.deepEqual(Object.keys(previewFonts),['segoe','system','arial','verdana','georgia','mono','bricolage']);assert.equal(Object.isFrozen(previewFonts),true);
  assert.match(previewFonts.segoe,/Segoe UI/);assert.match(previewFonts.georgia,/serif/);assert.match(previewFonts.bricolage,/Bricolage Grotesque/);
  assert.equal('fontFamily' in exportDesign({recipe:defaultRecipe}).recipe,false);
});

test('studio shortcuts support editing while preserving typing and native control keys',()=>{
  const event=(key,options={})=>({key,target:{tagName:'DIV'},...options});
  assert.equal(studioShortcut(event('z',{ctrlKey:true})),'undo');assert.equal(studioShortcut(event('Z',{metaKey:true,shiftKey:true})),'redo');
  assert.equal(studioShortcut(event('y',{ctrlKey:true})),'redo');assert.equal(studioShortcut(event('d',{metaKey:true})),'duplicate');
  assert.equal(studioShortcut(event('Delete')),'remove');assert.equal(studioShortcut(event('ArrowLeft')),'arrowleft');assert.equal(studioShortcut(event('ArrowUp',{altKey:true})),'previous-layer');
  assert.equal(studioShortcut(event('2',{altKey:true})),'tab-2');assert.equal(studioShortcut(event(' ')),'pause');
  for(const tagName of ['INPUT','TEXTAREA','SELECT'])for(const key of ['Delete','ArrowLeft',' ','z'])assert.equal(studioShortcut(event(key,{ctrlKey:key==='z',target:{tagName}})),null);
  assert.equal(studioShortcut(event('s',{ctrlKey:true,target:{tagName:'INPUT'}})),'save');
  assert.equal(studioShortcut(event(' ',{target:{tagName:'BUTTON'}})),null);assert.equal(studioShortcut(event('z',{ctrlKey:true,isComposing:true})),null);
  assert.equal(studioShortcut(event('Delete',{target:{isContentEditable:true}})),null);
});

test('GIF layer retains its attachment, opacity and placement through reorder, duplication and type roundtrips',()=>{
  const id=`${'a'.repeat(64)}.gif`,image={type:'image',textureId:id,opacity:.4,size:[175,120],at:[20,60],canvasRepeat:'repeat'};
  const layers=[image,legacyLayer(defaultRecipe)];assert.equal(moveLayer(layers,image,1),1);assert.equal(layers[1].textureId,id);assert.equal(moveLayer(layers,image,-1),0);
  const gradient=changeLayerType(image,'radial');assert.equal(gradient.textureId,id);const restored=changeLayerType(gradient,'image');assert.deepEqual(normalizeLayers([restored])[0],image);
  const duplicate=structuredClone(restored);layers.splice(1,0,duplicate);moveLayer(layers,image,1);assert.equal(layers.filter(l=>l.textureId===id).length,2);
  assert.equal(normalizeLayers([gradient])[0].textureId,undefined,'dormant texture never leaks into a gradient recipe');
});

test('image-only creation, replacements and attachment limits preserve the current design',()=>{
  const recipe=imageOnlyRecipe(),empty=recipe.layers[0],gif=`${'a'.repeat(64)}.gif`,otherGif=`${'b'.repeat(64)}.gif`,png=`${'c'.repeat(64)}.png`,webp=`${'d'.repeat(64)}.webp`;
  assert.equal(recipe.animation,'none');assert.equal(recipe.glow,0);assert.equal(recipe.layers.length,1);assert.equal(empty.type,'image');assert.equal(recipe.shadowOpacity,0);assert.equal(recipe.depth,0);
  assert.throws(()=>validateRecipe(recipe),/uploaded/);
  const attached=planImageAttachment(recipe.layers,empty,png);assert.equal(validateRecipe({...recipe,layers:attached}).layers.length,1);assert.equal(empty.textureId,undefined);
  const imported=importDesign(exportDesign({name:'Image only',recipe:{...recipe,layers:attached}}));assert.deepEqual(validateRecipe(imported.recipe),validateRecipe({...recipe,layers:attached}));
  const gradient=legacyLayer(defaultRecipe),layers=[{...empty,textureId:gif},{...empty,textureId:png},gradient];
  assert.throws(()=>planImageAttachment(layers,gradient,otherGif),/1 GIF and 1 image/);
  assert.throws(()=>planImageAttachment(layers,gradient,webp),/1 GIF and 1 image/);
  assert.equal(planImageAttachment(layers,layers[0],otherGif)[0].textureId,otherGif,'Replacing the only GIF is allowed');
  assert.equal(planImageAttachment(layers,layers[1],webp)[1].textureId,webp,'PNG can be replaced with WebP');
  assert.equal(planImageAttachment(layers,gradient,gif).length,4,'Reusing a file across layers counts once');
  assert.equal(layers[0].textureId,gif);assert.equal(layers[1].textureId,png);assert.equal(layers.length,3,'Preflight never mutates the design');
  assert.throws(()=>planImageAttachment(layers,{},png),/removed/);
  assert.throws(()=>planImageAttachment(Array(6).fill(gradient),gradient,gif),/Six layers/);
  const duplicate={...layers[0]};assert.throws(()=>planImageAttachment([layers[0],duplicate],layers[0],otherGif),/1 GIF/,'Replacing one reused GIF cannot leave two unique GIFs');
});

test('visual image cropping maps zoom, drag and cover to bounded portable recipe fields',()=>{
  const source={...imageOnlyRecipe().layers[0],textureId:`${'a'.repeat(64)}.png`,size:[200,100],at:[50,50]},original=structuredClone(source);
  assert.deepEqual(zoomImageLayer(source,400),[400,200]);assert.deepEqual(zoomImageLayer(source,1000),[500,250]);assert.deepEqual(zoomImageLayer(source,0),[2,1]);assert.throws(()=>zoomImageLayer(source,NaN),/zoom/);
  assert.deepEqual(panImageLayer(source,[20,30],[200,100]),[40,50],'100% canvas has no pan space, oversized canvas follows drag direction');
  assert.deepEqual(panImageLayer(source,[1000,-1000],[200,100]),[0,50]);
  assert.deepEqual(panImageLayer({...source,size:[50,50]},[20,-10],[200,100]),[70,30],'Smaller fills use positive position space');
  assert.deepEqual(coverImageSize([100,100],[200,50]),[100,400]);assert.deepEqual(coverImageSize([400,100],[200,50]),[100,100]);
  assert.deepEqual(coverImageSize([1000,1],[200,50]),[500,2]);assert.throws(()=>coverImageSize([0,100],[200,50]),/dimensions/);
  const recipe={...imageOnlyRecipe(),layers:[{...source,size:zoomImageLayer(source,400),at:panImageLayer(source,[20,0],[200,100])}]};
  const validated=validateRecipe(recipe);assert.deepEqual(normalizeCosmetic({id:'crop',recipe:validated}).recipe.layers,validated.layers);
  assert.deepEqual(validateRecipe(importDesign(exportDesign({recipe})).recipe).layers,validated.layers);assert.deepEqual(source,original,'Crop helpers do not mutate attachments or source settings');
});

test('Flare JSON export round-trips layered recipes and metadata without account or approval data',()=>{
  const source={id:'private-id',owner_id:'secret-owner',status:'approved',reason:'private review',name:'Layered Flare',description:'Original design',listed:false,recipe:{...defaultRecipe,animation:'spectrum',direction:'alternate-reverse',letterSpacing:1.2,layers:[{type:'image',blendMode:'screen',textureId:`${'a'.repeat(64)}.gif`,opacity:.4,size:[150,120],at:[30,60],canvasRepeat:'repeat'},{type:'solid',color:'#abcdef80',opacity:.5}],shadows:[{x:2,y:-3,blur:8,color:'#11223380'}]}};
  const exported=exportDesign(source),json=JSON.parse(JSON.stringify(exported)),imported=importDesign(json);
  assert.deepEqual(imported.recipe,source.recipe);assert.equal(imported.name,source.name);assert.equal(json.description,source.description);assert.equal(json.listed,false);
  for(const key of ['id','owner_id','status','reason','rights'])assert.equal(key in json,false);
  exported.recipe.colors[0]='#000000';assert.notEqual(source.recipe.colors[0],'#000000','Export does not mutate the original Flare');
  const legacy=importDesign({...json,layers:[legacyLayer(defaultRecipe)]});assert.deepEqual(legacy.recipe.layers,[legacyLayer(defaultRecipe)]);
  assert.throws(()=>importDesign({...json,version:2}),/Unsupported/);assert.throws(()=>importDesign({name:'Not a Flare',layers:[]}),/Nameflare Flare file/);assert.throws(()=>importDesign({format:'nameflare-design',version:1}),/recipe/);
  assert.equal(exportDesign({...source,listed:0}).listed,false);
});

test('all eight presets validate and round-trip through the SDK and design format',()=>{
  assert.equal(Object.keys(presets).length,8);
  for(const [id,preset] of Object.entries(presets)){
    const recipe=validateRecipe(preset.recipe),clean=normalizeCosmetic({id,recipe});
    assert.ok(clean,id);assert.deepEqual(clean.recipe,recipe);assert.deepEqual(validateRecipe(importDesign(exportDesign({recipe})).recipe),recipe);
  }
});

test('local demo serves every effect control and creator → owner review → equip flow',async() => {
  const dir=mkdtempSync(join(tmpdir(),'nameflare-demo-test-'));const store=new Store();
  const app=createApp({store,dataDir:dir,demo:true,baseUrl:'http://localhost',env:{}});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,data,session) => fetch(base+path,{method:data===undefined ? 'GET':'POST',headers:{...(data===undefined ? {}:{'Content-Type':'application/json',Origin:'http://localhost'}),...(session ? {Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},body:data===undefined ? undefined:JSON.stringify(data)});
  const login=async role => {const response=await request('/api/demo/login',{role});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];const me=await (await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();return {cookie,csrf:me.csrf,user:me.user};};
  try{
    const html=await (await request('/')).text();
    for(const path of ['/discover','/studio','/profiles/user-123','/account/settings','/guide/effects']){const response=await request(path);assert.equal(response.status,200);assert.equal(await response.text(),html);}
    assert.equal((await request('/not-a-route')).status,404);assert.equal((await request('/api/unknown')).status,404);assert.equal((await request('/routes.js')).status,200);
    assert.ok(html.includes('Preview font'));assert.match(html,/<option value="segoe" selected>Segoe UI<\/option>/);assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/\bpaints?\b/i);
    assert.ok(html.includes('Keyboard shortcuts'));assert.ok(html.includes('id="studio-keyboard-status"'));
    assert.match(html,/href="\/discover"/);assert.doesNotMatch(html,/href="#(?:discover|profiles|studio|account|guide)/);
    for(const key of ['direction','letterSpacing','glow','glowColor','shadowX','shadowY','shadowBlur','shadowOpacity','shadowColor','outline','outlineColor','depth','depthAngle','depthColor'])assert.ok(html.includes(`name="${key}"`),`Missing editor field ${key}`);
    for(const id of ['view-guide','guide-troubleshooting','texture-attachments','texture-usage','image-only-design','image-crop-controls','image-crop-stage','image-crop-zoom','image-crop-x','image-crop-y','image-crop-cover','image-crop-reset','preview-font','preview-chat-size','preview-size-value','undo-design','redo-design','save-draft','export-design','import-design','import-design-button','import-design-finish','preview-size','preview-background','preset-select','preset-gallery','submit-cosmetic','layer-list','shadow-list','texture-drop','pause-preview','tab-fill','tab-effects','tab-publish'])assert.ok(html.includes(`id="${id}"`),`Missing editor action ${id}`);
    for(const id of ['logo-twitch','logo-kick','logo-youtube','catalog-sort','catalog-name','catalog-pause','collection-status','feed-discover','feed-trending','following-total','following-status','following-feed','following-load-more','catalog-liked','clear-filters','like-announcement','hero-presets','profile-directory-heading','profile-search-tools','profile-back','collection-more','moderation-dialog','moderation-confirm-form','moderation-reason','moderation-ack','moderation-dialog-error','hero-canvas','hero-display-name','hero-preview-name','hero-style-name','hero-pause','hero-customize','icon-spark','icon-layers','icon-motion'])assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes('name="listed"'));assert.ok(html.includes('Flare name'));assert.equal(html.includes('Cosmetic name'),false);
    assert.match(html,/<div class="feed-view-controls"><button id="catalog-pause" class="icon-toggle"/);
    assert.match(html,/<wa-dropdown class="catalog-sort-label sort-dropdown"/);
    assert.match(html,/<wa-dropdown-item data-sort="newest"[^>]*>Newest first/);
    assert.match(html,/Community-made name styles for Twitch, Kick, and YouTube\. Preview one, then make it yours\./);
    assert.match(html,/<h1 id="community-title">Discover<\/h1>/);assert.ok(html.includes('<h1>Creators</h1>'));
    assert.match(html,/<wa-input id="hero-preview-name"[^>]*maxlength="30"/);
    assert.match(html,/<button id="hero-pause"[^>]*aria-pressed="false"/);
    assert.equal(html.includes('class="canvas-art"'),false,'Preview keeps paint as the artwork, not decorative ribbons');
    assert.ok(html.includes('id="hero-presets"'));assert.ok(html.includes('id="rail-creators"'));assert.ok(html.includes('id="hero-canvas"'));
    assert.match(html,/<button id="nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
    assert.match(html,/<main id="main-content" tabindex="-1">/);
    assert.match(html,/data-filter="all"[^>]*aria-pressed="true"/);
    assert.equal((html.match(/data-filter="[^"]+"[^>]*aria-pressed="false"/g) || []).length,5);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(new Set(ids).size,ids.length,'Shared navigation and editor IDs must remain unique');
    for(const decorativeClass of ['hero-gradient','floating-tag','orbit-one','flow-strip'])assert.equal(html.includes(`class="${decorativeClass}"`),false);
    const logo=await request('/logo.svg');assert.equal(logo.status,200);assert.match(logo.headers.get('content-type'),/^image\/svg\+xml/);const svg=await logo.text();assert.match(svg,/<title id="title">Nameflare<\/title>/);assert.match(svg,/navy N/);assert.match(svg,/<linearGradient id="flame"/);assert.doesNotMatch(svg,/<image|data:image|<script|<rect|fill="#fff"/);assert.match(svg,/transparent background/);assert.match(html,/<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/logo.svg\?v=company-mark">/);assert.ok(html.includes('id="preview-username" value="yourname"'));assert.match(await (await request('/overlay')).text(),/rel="icon"[^>]*logo.svg\?v=company-mark/);assert.ok(html.includes('class="brand-symbol" src="/logo.svg"'));
    const appSource=await (await request('/app.js')).text();assert.ok(appSource.includes('/moderation/settings'));assert.ok(appSource.includes('Search banned accounts'));assert.ok(appSource.includes('Permanently ban account'));assert.equal(appSource.includes('window.prompt'),false);assert.equal(appSource.includes('window.confirm'),false);
    assert.ok(appSource.includes('function renderHero()'));assert.ok(appSource.includes('updateCosmeticText($(selector),value)'));assert.ok(appSource.includes('heroPaused=!heroPaused'));assert.ok(appSource.includes("event.key==='Escape'"));assert.ok(appSource.includes('Suggested review notes'));
    for(const id of ['command-open','command-dialog','command-query','command-results','command-close'])assert.ok(html.includes(`id="${id}"`),`Missing quick navigation control ${id}`);
    assert.ok(html.includes('class="app-rail site-header"'));assert.equal(html.includes('NF®'),false);
    assert.ok(appSource.includes('function moderatorBadge(user)'));assert.ok(appSource.includes("badge.title='Nameflare community moderator · not a platform chat role'"));assert.ok(appSource.includes("if(badge)nameRow.append(badge)"));
    for(const id of ['view-artists','artist-search','artist-results','artist-status','artist-pagination','artist-pause'])assert.ok(html.includes(`id="${id}"`));assert.ok(html.includes('href="/artists" data-nav="artists"'));assert.ok(appSource.includes('function artistCard(user,readRevision)'));assert.ok(appSource.includes('async function loadArtists()'));assert.ok(appSource.includes('/api/v1/artists?q='));assert.ok(appSource.includes('for(const cosmetic of user.flares)'));assert.ok(appSource.includes("$('#artist-pause').setAttribute('aria-pressed'"));
    assert.ok(appSource.includes('function artistBadge(user)'));assert.ok(appSource.includes("const badge=moderatorBadge(user) || artistBadge(user)"));assert.ok(appSource.includes("icon('studio')"));assert.ok(appSource.includes("badge.title='Nameflare artist · up to 20 submitted Flares · not a platform chat role'"));assert.ok(appSource.includes("api('/api/admin/artists',{id:user.id,enabled})"));assert.ok(appSource.includes("user.role==='artist'?'Remove artist':'Make artist'"));
    assert.ok(appSource.includes('function renderCommands()'));assert.ok(appSource.includes('heroTransition?.cancel()'));assert.ok(appSource.includes('document.hidden || !heroVisible'));
    assert.equal(html.includes('/fonts/BricolageGrotesque.ttf'),false,'No unused display-font preload');assert.equal(html.includes('class="hero-edition"'),false);assert.equal(html.includes('class="step-icon"'),false);
    assert.ok(html.includes('class="rail-create"') && html.includes('>Create a Flare<'));
    assert.ok(html.includes('class="btn button ghost">Sign in</button>'));assert.ok(html.includes('name="theme-color" content="#08070b"'));
    const font=await request('/fonts/BricolageGrotesque.ttf');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/ttf');assert.equal(Buffer.from(await font.arrayBuffer()).readUInt32BE(0),0x00010000);
    const fontLicense=await request('/fonts/OFL.txt');assert.equal(fontLicense.status,200);assert.match(await fontLicense.text(),/SIL OPEN FONT LICENSE/);
    const css=(await Promise.all(['/ui/tokens.css','/ui/shell.css','/ui/views.css'].map(async path => await (await request(path)).text()))).join('\n');
    assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css,/animation-duration: \.001ms !important/);
    for(const selector of ['.creator-cover','.cosmetic-card.is-equipped','.review-reason-chip','.collection-card .card-actions','.artist-badge','--font-display'])assert.ok(css.includes(selector),`Missing design hook ${selector}`);
    assert.match(css,/@font-face \{ font-family: 'Bricolage Grotesque'/);assert.equal(css.includes('font-variation-settings'),false);
    assert.ok(appSource.includes('function controlLabel(element,label)'));assert.ok(appSource.includes('setControlLabel:controlLabel'));
    assert.match(html,/Artists may submit 20/);
    const editorSource=await (await request('/editor.js')).text();assert.ok(editorSource.includes("${role==='artist'?'20':'three'} Flares total"));assert.ok(editorSource.includes("setControlLabel($('#submit-cosmetic')"));assert.ok(editorSource.includes('Move layer ${i+1} up'));assert.ok(editorSource.includes('Move layer ${i+1} down'));
    assert.equal((await request('/likes.js')).status,200);
    for(const id of ['preview-font-search','preview-font-status','preview-font-retry','preview-font-notice'])assert.ok(html.includes(`id="${id}"`));
    const fontModule=await request('/fonts.js');assert.equal(fontModule.status,200);assert.match(fontModule.headers.get('Content-Type'),/javascript/);
    const fontCatalog=await request('/google-fonts.json');assert.equal(fontCatalog.status,200);assert.match(fontCatalog.headers.get('Content-Type'),/application\/json/);assert.ok((await fontCatalog.json()).families.length>1900);
    const csp=fontCatalog.headers.get('Content-Security-Policy');assert.match(csp,/style-src[^;]*https:\/\/fonts.googleapis.com/);assert.match(csp,/font-src 'self' https:\/\/fonts.gstatic.com/);assert.match(csp,/script-src 'self';/);
    assert.ok(appSource.includes("preserveFeedScroll($('.feed-tabs'),$('#view-discover'))"));assert.equal(appSource.includes("previousView!==state.view || previousFeed!==state.feed ||"),false);
    assert.ok(html.includes('href="/guide/shortcuts"'));assert.ok(html.includes('id="guide-shortcuts"'));assert.ok(html.includes('Full keyboard shortcut guide'));const shortcutGuide=html.split('id="guide-shortcuts"')[1].split('<article id="guide-accounts"')[0];
    for(const text of ['Undo','Redo','Save a draft','Duplicate','Backspace','percentage point','10-point','Pause','previous / next layer','5 preview pixels','20 pixels','Text inputs','Home','End'])assert.ok(shortcutGuide.includes(text),`Guide missing ${text}`);
    assert.equal((await request('/guide/shortcuts')).status,200);
    const config=await (await request('/api/config')).json();assert.equal(config.name,'Nameflare');assert.equal(config.demo,true);
    assert.equal((await request('/auth/twitch')).status,403);
    // Give the regular creator a fresh submission budget; seeded history is tested separately.
    store.db.prepare("UPDATE cosmetics SET owner_id='demo-owner' WHERE owner_id='demo-creator'").run();
    const creator=await login('creator');assert.equal(creator.user.role,'user');
    const submitted=await request('/api/cosmetics',{name:'Editor effects',description:'All layered effects',recipe},creator);assert.equal(submitted.status,201);const c=(await submitted.json()).cosmetic;
    assert.deepEqual(c.recipe,recipe);assert.equal(c.status,'pending');
    assert.equal((await request(`/api/v1/cosmetics/${c.id}`)).status,404);
    const owner=await login('owner');assert.equal(owner.user.role,'owner');
    const queue=await (await request('/api/admin/queue',undefined,owner)).json();assert.ok(queue.cosmetics.some(cosmetic => cosmetic.id===c.id));
    assert.equal((await request('/api/admin/review',{id:c.id,status:'approved',reason:'Readable and original'},owner)).status,200);
    assert.equal((await request('/api/equip',{cosmeticId:c.id},creator)).status,200);
    const resolved=await (await request('/api/v1/users/twitch/1002')).json();assert.deepEqual(resolved.user.cosmetic.recipe,recipe);
    const yours=await (await request('/api/my/cosmetics',undefined,creator)).json();assert.ok(yours.cosmetics.some(cosmetic => cosmetic.id===c.id && cosmetic.status==='approved'));
    const sessionCookie=creator.cookie.split('=')[1];assert.ok(store.session(sessionCookie));
    assert.equal((await request('/api/logout',{},creator)).status,200);assert.equal(store.session(sessionCookie),null);
  }finally{app.server.closeAllConnections();await new Promise(resolve => app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});
