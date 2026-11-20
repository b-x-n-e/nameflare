import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateRecipe,validateTexture } from '../lib/cosmetics.js';
import { sanitizeImage } from '../lib/images.js';
import { normalizeLayers,normalizeShadows,validateTextureLimits,layerBackground,paintPalette } from '../public/paints.js';
import { applyCosmetic, updateCosmeticText, createFrameUpdate, createPreviewNameBinding } from '../public/renderer.js';
import { Store } from '../lib/store.js';
import { createApp } from '../server.js';
const base={colors:['#ff1a35','#ffd4dc'],angle:90,glow:4,speed:4,animation:'shimmer'};
const linear={type:'linear',opacity:.6,stops:[{at:1,color:'#ffffff'},{at:0,color:'#ff000080'},{at:.4,color:'#00000000'}],angle:120,repeat:true};
const textureId=`${'a'.repeat(64)}.gif`;

test('complex recipe bounds layers, RGBA stops, image IDs, shadow stacks, and text weight',()=>{
  const r=validateRecipe({...base,layers:[linear,{type:'radial',opacity:1,stops:linear.stops,shape:'circle'}, {type:'image',textureId,opacity:.4}],shadows:[{x:3,y:-2,blur:8,color:'#ff1a3580'}],fontWeight:700});
  assert.equal(r.layers.length,3);assert.equal(r.layers[0].stops[0].at,0);assert.equal(r.shadows[0].color,'#ff1a3580');assert.equal(r.fontWeight,700);
  for(const invalid of [
    {layers:[]},{layers:Array(7).fill(linear)},{layers:[{...linear,opacity:2}]},{layers:[{...linear,stops:[{at:0,color:'red'},{at:1,color:'#ffffff'}]}]},
    {layers:[{type:'image',textureId:'https://evil.test/a.gif'}]},{layers:[{...linear,canvasRepeat:'url(evil)'}]},{layers:[{...linear,size:[Infinity,100]}]},
    {layers:[{...linear,stops:[{at:0,color:'#ff0000'},{at:0,color:'#ffffff'}]}]},{shadows:Array(9).fill({x:0,y:0,blur:1,color:'#ffffff'})},{shadows:[{x:0,y:0,blur:80,color:'#ffffff'}]},{fontWeight:1000}
  ])assert.throws(()=>validateRecipe({...base,...invalid}),error=>error.status===400);
  assert.throws(()=>normalizeLayers([{type:'image',image_url:'https://evil'}]),/upload/);
  assert.equal(normalizeLayers([{type:'image'}],{allowEmptyImages:true})[0].textureId,undefined);
  assert.throws(()=>normalizeShadows(null));
});
test('Flare submissions allow one unique GIF plus one PNG/WebP including legacy references',()=>{
  const gif=textureId,secondGif=`${'b'.repeat(64)}.gif`,png=`${'c'.repeat(64)}.png`,webp=`${'d'.repeat(64)}.webp`,image=textureId=>({type:'image',textureId});
  assert.deepEqual(validateTextureLimits({textureId:gif,layers:[image(gif),image(gif),image(png)]}),{gif:1,image:1});
  for(const layers of [[image(png)],[image(webp)],[image(gif)],[image(gif),image(png)],[image(png),image(png)]])assert.ok(validateRecipe({...base,animation:'none',glow:0,layers}));
  for(const patch of [{layers:[image(gif),image(secondGif)]},{layers:[image(png),image(webp)]},{textureId:secondGif,layers:[image(gif)]},{textureId:png,layers:[image(webp)]}])assert.throws(()=>validateRecipe({...base,...patch}),e=>e.status===400&&/1 GIF and 1 image/.test(e.message));
  assert.deepEqual(validateTextureLimits({layers:[{type:'solid',color:'#ffffff',textureId:secondGif},image(gif)]}),{gif:1,image:0},'Dormant attachments do not count');
  assert.equal(normalizeLayers([image(gif),image(secondGif)]).length,2,'Legacy published designs can still be read/rendered');
});

test('layer backgrounds are safe typed CSS with repeating gradients and alpha',()=>{
  const [layer]=normalizeLayers([linear]);assert.match(layerBackground(layer),/^repeating-linear-gradient\(120deg/);assert.match(layerBackground(layer),/0\.5020/);
  assert.match(layerBackground(normalizeLayers([{...linear,type:'radial',shape:'circle'}])[0]),/^repeating-radial-gradient/);
  assert.match(layerBackground(normalizeLayers([{...linear,type:'conic'}])[0]),/^repeating-conic-gradient/);
});
test('tile swatches use visible layer colors, not fallback colors or hidden fills',()=>{
  const fallback={colors:['#ffffff','#ffffff']};
  assert.deepEqual(paintPalette(fallback),['#ffffff']);
  assert.deepEqual(paintPalette({...fallback,layers:[{type:'linear',stops:[{color:'#FF0000'},{color:'#00ff0080'},{color:'#ffffff00'},{color:'#ff0000'}]}]}),['#ff0000','#00ff0080']);
  assert.deepEqual(paintPalette({...fallback,layers:[{type:'solid',color:'#000000',opacity:0},{type:'solid',color:'#0000ff'},{type:'solid',color:'#ff0000'}]}),['#0000ff']);
  assert.deepEqual(paintPalette({...fallback,layers:[{type:'image',textureId}]}),[]);
});
test('preview names follow account identity, preserve custom input, and reset on account switch',()=>{
  const handlers={},input={value:'B_X_N_E',addEventListener:(type,fn)=>handlers[type]=fn};
  const sync=createPreviewNameBinding(input);
  sync(null);assert.equal(input.value,'yourname');sync({id:'a',name:'Alice'});assert.equal(input.value,'Alice');
  input.value='Custom';handlers.input();sync({id:'a',name:'Alice'});assert.equal(input.value,'Custom');
  sync({id:'b',name:'Bob'});assert.equal(input.value,'Bob');sync({id:'b',name:'Robert'});assert.equal(input.value,'Robert');
  sync(null);assert.equal(input.value,'yourname');
});
test('flow closes linear/radial palettes and advances by exactly their repeat period',()=>{
  for(const type of ['linear','radial'])for(const angle of [0,35,90,180,359])for(const size of [[1,500],[100,100],[300,150]]) {
    const [layer]=normalizeLayers([{...linear,type,angle,size,repeat:false}]),original=structuredClone(layer);
    const css=layerBackground(layer,null,{flow:true});
    assert.match(css,new RegExp(`^repeating-${type}-gradient`));
    const stops=[...css.matchAll(/(rgba\([^)]+\)) calc\(([\d.]+)% \+ var\(--nameflare-phase, 0\) \* ([\d.]+)%\)/g)];
    assert.equal(stops.length,layer.stops.length+1);assert.equal(stops[0][1],stops.at(-1)[1]);
    const period=Number(stops[0][3]);assert.equal(period,Number(stops.at(-1)[2])-Number(stops[0][2]));assert.ok(period>0);
    // A one-period shift must wrap every point to the same segment and weight.
    const wrap=x=>((x-Number(stops[0][2]))%period+period)%period;
    for(const x of [-500,-13.3,0,22.5,100,901])assert.ok(Math.abs(wrap(x)-wrap(x-period))<1e-9);
    assert.deepEqual(layer,original,'Rendering never rewrites exported stop positions');
  }
  const [closed]=normalizeLayers([{...linear,stops:[{at:.1,color:'#ff0000'},{at:.5,color:'#ffffff'},{at:.9,color:'#ff0000'}]}]);
  const css=layerBackground(closed,null,{flow:true});assert.equal((css.match(/rgba\(/g)||[]).length,3);assert.match(css,/\* 80%/);
  const conic=layerBackground(normalizeLayers([{...linear,type:'conic'}])[0],null,{flow:true});assert.match(conic,/from calc\(120deg \+ var\(--nameflare-phase, 0\) \* 360deg\)/);
  assert.doesNotMatch(layerBackground(closed),/nameflare-phase/);
  assert.doesNotMatch(layerBackground({type:'image'},'https://example.com/texture.gif',{flow:true}),/nameflare-phase/);
});
test('enhanced recipe controls are bounded, allowlisted and optional for old designs',()=>{
  const enhanced=validateRecipe({...base,animation:'spectrum',direction:'alternate-reverse',letterSpacing:-1,layers:[{...linear,blendMode:'soft-light'}]});
  assert.equal(enhanced.direction,'alternate-reverse');assert.equal(enhanced.letterSpacing,-1);assert.equal(enhanced.layers[0].blendMode,'soft-light');
  const old=validateRecipe(base);assert.equal(old.direction,undefined);assert.equal(old.letterSpacing,undefined);
  for(const patch of [{direction:'url(evil)'},{direction:null},{letterSpacing:6.1},{letterSpacing:-1.1},{letterSpacing:'2'},{letterSpacing:Infinity},{layers:[{...linear,blendMode:'color-dodge'}]}])assert.throws(()=>validateRecipe({...base,...patch}),e=>e.status===400);
  const css=readFileSync(new URL('../public/effects.css',import.meta.url),'utf8');
  assert.match(css,/@property --nameflare-phase\{syntax:'<number>';inherits:true;initial-value:0\}/);
  assert.match(css,/@keyframes nameflare-flow\{from\{--nameflare-phase:0\}to\{--nameflare-phase:1\}\}/);
  assert.match(css,/@keyframes nameflare-shimmer\{from\{--nameflare-phase:0\}to\{--nameflare-phase:1\}\}/);assert.match(css,/animation:nameflare-shimmer var\(--nameflare-speed,4s\) linear infinite/);assert.match(css,/hue-rotate\(360deg\)/);assert.match(css,/var\(--nameflare-filter\) hue-rotate/);
  assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/animation-play-state:paused/);
});
test('layered renderer preserves text, removes stale layers, clamps fonts, and honors reduced motion',()=>{
  const previousDoc=globalThis.document,previousWindow=globalThis.window;
  const children=[],values=new Map(),classes=new Set();
  globalThis.document={createElement:()=>({dataset:{},style:{},setAttribute(){},remove(){const i=children.indexOf(this);if(i>=0)children.splice(i,1);}})};
  globalThis.window={matchMedia:()=>({matches:false})};
  const element={textContent:'B_X_N_E',dataset:{},append:child=>children.push(child),classList:{add:(...k)=>k.forEach(x=>classes.add(x)),remove:(...k)=>k.forEach(x=>classes.delete(x))},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)}};
  try{
    const r=validateRecipe({...base,animation:'flow',direction:'reverse',letterSpacing:1.5,layers:[{...linear,blendMode:'screen'},{type:'image',textureId,opacity:.5}],shadows:[{x:2,y:3,blur:8,color:'#ffffff80'}],fontWeight:700});applyCosmetic(element,{recipe:r},'https://example.com');assert.equal(children.length,2);assert.equal(children[0].dataset.text,'B_X_N_E');assert.equal(element.textContent,'B_X_N_E');assert.equal(children[0].style.opacity,.6);assert.equal(children[0].style.mixBlendMode,'screen');assert.match(children[0].style.backgroundImage,/nameflare-phase/);assert.equal(element.style.letterSpacing,'1.5px');assert.equal(values.get('--nameflare-direction'),'reverse');assert.match(children[1].style.backgroundImage,/example.com\/textures/);assert.match(values.get('--nameflare-shadows'),/2px 3px 8px/);
    applyCosmetic(element,{recipe:r},'https://example.com',{previewTextures:{[textureId]:'blob:https://example.com/local'}});assert.equal(children.length,2);assert.match(children[1].style.backgroundImage,/blob:/);
    const originalLayers=[...children],originalStyles=children.map(child=>({...child.style}));
    element.firstChild={nodeType:3,data:'B_X_N_E'};
    const animations=[{animationName:'nameflare-flow',currentTime:1234}];element.getAnimations=()=>animations;
    applyCosmetic(element,{recipe:r},'https://example.com',{previewTextures:{[textureId]:'blob:https://example.com/local'}});
    assert.equal(children[0],originalLayers[0],'Identical renders retain paint nodes and animation');assert.equal(animations[0].currentTime,1234);
    applyCosmetic(element,{recipe:{...r,glow:7}},'https://example.com',{previewTextures:{[textureId]:'blob:https://example.com/local'}});assert.equal(animations[0].currentTime,1234,'Style edits retain animation phase');
    applyCosmetic(element,{recipe:r},'https://example.com',{previewTextures:{[textureId]:'blob:https://example.com/local'}});
    originalLayers.splice(0,originalLayers.length,...children);
    element.firstChild={nodeType:3,data:'B_X_N_E'};
    updateCosmeticText(element,'<script>not HTML</script>');
    assert.equal(element.firstChild.data,'<script>not HTML</script>');assert.equal(element.dataset.text,'<script>not HTML</script>');
    assert.equal(children.length,2);for(const [i,child] of children.entries()){assert.equal(child,originalLayers[i]);assert.equal(child.dataset.text,'<script>not HTML</script>');assert.deepEqual(child.style,originalStyles[i]);}
    assert.equal(element.dataset.animation,'flow');assert.equal(element.dataset.paused,'false');assert.match(values.get('--nameflare-shadows'),/0 0 4px #ff1a35/);
    // Host chat clients often replace textContent before reapplying an unchanged API recipe.
    element.contains=child=>children.includes(child);children.splice(0);element.firstChild={nodeType:3,data:'Renamed'};element.textContent='Renamed';
    applyCosmetic(element,{recipe:r},'https://example.com',{previewTextures:{[textureId]:'blob:https://example.com/local'}});
    assert.equal(children.length,2,'Detached fills are rebuilt instead of leaving an invisible name');assert.equal(children[0].dataset.text,'Renamed');assert.equal(animations[0].currentTime,1234);
    window.matchMedia=()=>({matches:true});applyCosmetic(element,{recipe:r},'https://example.com');assert.doesNotMatch(children[1].style.backgroundImage,/url/);assert.doesNotMatch(children[0].style.backgroundImage,/nameflare-phase/);
    applyCosmetic(element,{recipe:{...r,animation:'spectrum'}},'https://example.com',{paused:true});assert.equal(element.dataset.paused,'true');assert.doesNotMatch(children[1].style.backgroundImage,/url/);assert.equal(values.get('--nameflare-filter'),'brightness(1)');
    applyCosmetic(element,null,'https://example.com');assert.equal(children.length,0);assert.equal(classes.has('nameflare-name'),false);
  }finally{if(previousDoc===undefined)delete globalThis.document;else globalThis.document=previousDoc;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
test('text-only renderer updates preserve plain text and avoid redundant DOM writes',()=>{
  let writes=0;const text={nodeType:3,_data:'Initial',get data(){return this._data;},set data(value){writes++;this._data=value;}};
  const element={firstChild:text,dataset:{text:'Initial',animation:'flow',paused:'true'}};
  updateCosmeticText(element,'New name');assert.equal(text.data,'New name');assert.equal(element.dataset.text,'New name');assert.equal(writes,1);
  updateCosmeticText(element,'New name');assert.equal(writes,1);assert.equal(element.dataset.animation,'flow');assert.equal(element.dataset.paused,'true');
  updateCosmeticText(element,'');assert.equal(text.data,'');assert.equal(element.dataset.text,'');
  const plain={textContent:'Plain',dataset:{}};updateCosmeticText(plain,'<img src=x>');assert.equal(plain.textContent,'<img src=x>');assert.equal(plain.dataset.text,undefined);
});
test('rapid preview input batches into one frame and renders only the latest value',()=>{
  const frames=[],rendered=[];let value='';
  const schedule=createFrameUpdate(()=>rendered.push(value),callback=>frames.push(callback));
  for(const name of ['B','B_','B_X','B_X_N_E']){value=name;schedule();}
  assert.equal(frames.length,1);assert.deepEqual(rendered,[]);frames.shift()();assert.deepEqual(rendered,['B_X_N_E']);
  value='Next';schedule();assert.equal(frames.length,1);frames.shift()();assert.deepEqual(rendered,['B_X_N_E','Next']);
});
test('Node image-only submissions and mixed textures enforce per-Flare limits even for the owner',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nameflare-image-limits-')),store=new Store();store.seedDemo();
  const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`,owner=store.newSession('demo-owner');
  const request=(path,data)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost',Cookie:`nameflare_session=${owner.raw}`,'X-CSRF-Token':owner.csrf},body:JSON.stringify(data)});
  try{
    const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),otherGif=Buffer.from(gif);otherGif[13]=100;
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4X8AAAAASUVORK5CYII=','base64');
    // Upload endpoint remains an account library; quotas apply to the referenced Flare assets.
    const ids=[];for(const [type,bytes] of [['gif',gif],['gif',otherGif],['png',png]]){const response=await request('/api/textures',{data:`data:image/${type};base64,${bytes.toString('base64')}`});assert.equal(response.status,201);ids.push((await response.json()).id);}
    const image=textureId=>({type:'image',textureId}),[a,b,c]=ids;
    for(const patch of [{layers:[image(a),image(b)]},{textureId:a,layers:[image(b)]},{textureId:`${'e'.repeat(64)}.webp`,layers:[image(c)]}]){
      const response=await request('/api/cosmetics',{name:'Over limit',recipe:{...base,...patch}});assert.equal(response.status,400);assert.match((await response.json()).error,/1 GIF and 1 image/);
    }
    for(const layers of [[image(c)],[image(a),image(c)],[image(a),image(a),image(c)]]){
      const response=await request('/api/cosmetics',{name:'Image fill',recipe:{...base,animation:'none',glow:0,layers}});assert.equal(response.status,201);const cosmetic=(await response.json()).cosmetic;assert.equal(cosmetic.recipe.layers.length,layers.length);assert.equal(cosmetic.status,'approved');
    }
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('animated GIF image layers remain private until approved and become private after revocation',async()=>{
  // Valid 1×1 GIF header plus two graphics-control/image frames; rebuilding keeps both.
  const single=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const bytes=Buffer.concat([single.subarray(0,19),single.subarray(19,-1),single.subarray(19)]);
  const data=`data:image/gif;base64,${bytes.toString('base64')}`;assert.equal(validateTexture(data).bytes.equals(bytes),true);
  const dir=mkdtempSync(join(tmpdir(),'nameflare-layer-'));const store=new Store();store.seedDemo();store.db.prepare("UPDATE cosmetics SET owner_id='demo-owner' WHERE owner_id='demo-creator'").run();const app=createApp({store,dataDir:dir,baseUrl:'http://localhost',env:{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const creator=store.newSession('demo-creator'),owner=store.newSession('demo-owner');
  const request=(path,data,session)=>fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost'}),...(session?{Cookie:`nameflare_session=${session.raw}`,'X-CSRF-Token':session.csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  try{
    const upload=await request('/api/textures',{data},creator);assert.equal(upload.status,201);const id=(await upload.json()).id;
    const r={...base,layers:[{type:'image',textureId:id,opacity:.8},linear],shadows:[{x:3,y:3,blur:5,color:'#ff1a3580'}]};
    assert.equal((await request('/api/cosmetics',{name:'Stolen texture',description:'',recipe:r},owner)).status,400);
    const submitted=await request('/api/cosmetics',{name:'Animated complex paint',description:'Two GIF frames',recipe:r},creator);assert.equal(submitted.status,201);const c=(await submitted.json()).cosmetic;
    assert.equal((await request(`/textures/${id}`)).status,401);assert.equal((await request('/api/admin/review',{id:c.id,status:'approved',reason:''},owner)).status,200);
    const asset=await request(`/textures/${id}`);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/gif');const served=Buffer.from(await asset.arrayBuffer()),rebuilt=sanitizeImage('gif',bytes);assert.equal(served.equals(rebuilt.bytes),true,'The stored file is the rebuilt one');assert.equal(rebuilt.frames,2,'Both frames survive');
    const publicC=await (await request(`/api/v1/cosmetics/${c.id}`)).json();assert.equal(publicC.cosmetic.recipe.layers.length,2);
    assert.equal((await request('/api/admin/review',{id:c.id,status:'rejected',reason:'Unsafe flashing'},owner)).status,200);assert.equal((await request(`/textures/${id}`)).status,401);
    const html=await (await request('/')).text();assert.match(html,/A B_X_N_E project/);assert.match(html,/<nav id="studio-outline" class="st-outline" aria-label="Flare structure">/);for(const panel of ["layer","glow","outline","shadow","shadows","depth","motion","text","fallback"])assert.ok(html.includes(`data-panel="${panel}"`));assert.ok(html.includes('id="publish-dialog"'));assert.ok(html.includes('id="layer-inspector"'));
    for(const path of ['/paints.js','/editor.js'])assert.equal((await request(path)).status,200);
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});
