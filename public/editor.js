import { navigate } from './routes.js';
import { previewFonts, initializeFontPicker } from './fonts.js';
export { previewFonts } from './fonts.js';
import { applyCosmetic, updateCosmeticText, createFrameUpdate, createPreviewNameBinding } from './renderer.js';
import { normalizeLayers, normalizeShadows, validateTextureLimits, legacyLayer, layerBackground, rgbaColor, MAX_TEXTURE_BYTES, isColor, ANIMATIONS, PLAYBACK_DIRECTIONS, BLEND_MODES } from './paints.js';
const $ = s => document.querySelector(s);
const clone = value => JSON.parse(JSON.stringify(value));
export const defaultRecipe = { colors:['#ff1a35','#ff7185','#ffd4dc'],animation:'shimmer',speed:5,angle:120,glow:5,glowColor:'#ff1a35',shadowX:0,shadowY:0,shadowBlur:0,shadowOpacity:0,shadowColor:'#000000',outline:0,outlineColor:'#ffffff',depth:0,depthAngle:45,depthColor:'#4b1423',fontWeight:800,letterSpacing:0,direction:'normal' };
const defaults = defaultRecipe;
export function imageOnlyRecipe() {
  return {...defaultRecipe,animation:'none',glow:0,layers:[{type:'image',opacity:1,size:[100,100],at:[50,50],canvasRepeat:'no-repeat'}]};
}
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export function zoomImageLayer(layer, zoom) {
  if(!Number.isFinite(zoom))throw new Error('Invalid image zoom.');
  const size=layer.size || [100,100],factor=clamp(zoom/Math.max(...size),1/Math.min(...size),500/Math.max(...size));
  return size.map(value=>clamp(value*factor,1,500));
}
export function panImageLayer(layer, delta, viewport) {
  return (layer.at || [50,50]).map((at,axis)=>{
    const space=viewport[axis]*(1-(layer.size || [100,100])[axis]/100);
    return Math.abs(space)<.01 ? at:clamp(at+delta[axis]/space*100,0,100);
  });
}
export function coverImageSize(image, viewport) {
  if(![...image,...viewport].every(value=>Number.isFinite(value)&&value>0))throw new Error('Invalid image dimensions.');
  const scale=Math.max(viewport[0]/image[0],viewport[1]/image[1]);
  const size=image.map((value,axis)=>value*scale/viewport[axis]*100),factor=Math.min(1,500/Math.max(...size));
  return size.map(value=>clamp(value*factor,1,500));
}
export function planImageAttachment(layers, selectedLayer, textureId) {
  const index=layers.indexOf(selectedLayer);
  if(index<0)throw new Error('The selected layer was removed while the image was loading. Choose a layer and retry.');
  const next=layers.map(layer=>({...layer}));
  if(selectedLayer.type==='image')next[index].textureId=textureId;
  else {
    if(layers.length>=6)throw new Error('Six layers already. Select an image layer or remove a layer first.');
    next.unshift({type:'image',textureId,opacity:1,size:[100,100],at:[50,50],canvasRepeat:'no-repeat'});
  }
  validateTextureLimits({layers:next});
  return next;
}
// Keep dormant settings while changing type; publishing still strips fields through normalizeLayers.
export function changeLayerType(layer, type, fallback = defaultRecipe) {
  return { ...legacyLayer({...fallback,textureId:undefined}), ...layer, type, color:layer.color || fallback.colors[0] };
}
export function moveLayer(layers, layer, direction) {
  const from=layers.indexOf(layer),to=from+direction;
  if(from<0 || to<0 || to>=layers.length)return from;
  [layers[from],layers[to]]=[layers[to],layers[from]];
  return to;
}
export function exportDesign(cosmetic) {
  return {format:'nameflare-design',version:1,name:cosmetic.name || '',description:cosmetic.description || '',listed:cosmetic.listed !== false && cosmetic.listed !== 0,recipe:clone(cosmetic.recipe)};
}
export function importDesign(input) {
  if(input?.format !== 'nameflare-design')throw new Error('Choose a Nameflare Flare file exported from the studio.');
  if(input.version !== 1)throw new Error('Unsupported Nameflare design version.');
  if(!input.recipe || typeof input.recipe !== 'object' || Array.isArray(input.recipe))throw new Error('Nameflare JSON needs a recipe.');
  return {recipe:{...input.recipe,layers:input.layers || input.recipe.layers},name:input.name,warnings:[]};
}
export function downloadDesign(cosmetic) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportDesign(cosmetic),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;
  const filename=(cosmetic.name || 'nameflare-design').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'nameflare-design';
  a.download=`${filename}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Studio presets: each is one clear technique in the Studio's own layer model,
// with the gradient fitted to the name, so the gradient bar shows exactly the
// colours on screen and every value is a sensible place to start editing.
const fill=(type,stops,extra={})=>({type,opacity:1,angle:90,repeat:false,shape:'ellipse',size:[100,100],at:[50,50],canvasRepeat:'no-repeat',stops:stops.map(([color,at])=>({color,at})),...extra});
const look=(title,colors,layers,effects={})=>({title,recipe:{...defaults,colors,glow:0,glowColor:colors[0],animation:'none',layers,...effects}});
export const presets = {
  sunset:look('Sunset fade',['#ff5f6d','#ff9966','#ffc371'],[fill('linear',[['#ff5f6d',0],['#ff9966',.5],['#ffc371',1]])],{animation:'flow',speed:6,glow:4,glowColor:'#ff6a5a'}),
  aurora:look('Aurora',['#00f5a0','#00d9f5','#7a5cff'],[fill('linear',[['#00f5a0',0],['#00d9f5',.4],['#7a5cff',.75],['#00f5a0',1]])],{animation:'flow',speed:8,glow:6,glowColor:'#00e0c0'}),
  neon:look('Neon tube',['#fff4fd','#ff3fd2','#b14cff'],[fill('linear',[['#fff4fd',0],['#ffd1f6',1]])],{animation:'pulse',speed:3,glow:10,glowColor:'#ff3fd2',shadows:[{x:0,y:0,blur:18,color:'#b14cffaa'}]}),
  chrome:look('Liquid chrome',['#ffffff','#8e9bab','#3b4552'],[fill('linear',[['#ffffff',0],['#d6dde6',.42],['#4b5563',.5],['#c5ced9',.62],['#f4f7fb',1]],{angle:180})],{outline:.3,outlineColor:'#1f2937',depth:2,depthAngle:90,depthColor:'#1f2630'}),
  retro:look('Retro extrude',['#ffe259','#ffa751','#9c2f12'],[fill('linear',[['#ffe259',0],['#ffa751',1]],{angle:180})],{depth:6,depthAngle:45,depthColor:'#9c2f12'}),
  sticker:look('Sticker',['#7af0ff','#5b8cff','#a78bfa'],[fill('linear',[['#7af0ff',0],['#5b8cff',.55],['#a78bfa',1]],{angle:120})],{outline:.8,outlineColor:'#ffffff',shadowX:0,shadowY:2,shadowBlur:0,shadowOpacity:55,shadowColor:'#000000'}),
  prism:look('Prism',['#ff5e7e','#ffd166','#5ef0c5','#5ea8ff','#c77dff'],[fill('linear',[['#ff5e7e',0],['#ffd166',.25],['#5ef0c5',.5],['#5ea8ff',.75],['#c77dff',1]])],{animation:'flow',speed:5,glow:3,glowColor:'#c77dff'}),
  holo:look('Holo foil',['#ff6ec7','#7ee8fa','#b388ff'],[fill('linear',[['#ffffff00',0],['#ffffff99',.5],['#ffffff00',1]],{angle:110,blendMode:'soft-light'}),fill('conic',[['#ff6ec7',0],['#7ee8fa',.25],['#b388ff',.5],['#ffe57a',.75],['#ff6ec7',1]],{angle:0})],{animation:'flow',speed:7,glow:3,glowColor:'#b388ff'})
};
const numericKeys=['speed','angle','glow','shadowX','shadowY','shadowBlur','shadowOpacity','outline','depth','depthAngle','fontWeight','letterSpacing'];
const colorKeys=['glowColor','shadowColor','outlineColor','depthColor'];
const el=(tag,cls,text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export function studioShortcut(event) {
  if(event.defaultPrevented || event.isComposing || event.target?.isContentEditable)return null;
  const key=event.key.toLowerCase(),command=event.ctrlKey || event.metaKey;
  const tag=event.target?.tagName;
  const field=['TEXTAREA','SELECT'].includes(tag) || tag==='INPUT';
  if(command && !event.altKey && key==='s')return 'save';
  if(event.altKey && !command && ['1','2','3','4','5'].includes(key))return `tab-${key}`;
  if(field)return null;
  if(command && !event.altKey && key==='z')return event.shiftKey?'redo':'undo';
  if(command && !event.altKey && key==='y')return 'redo';
  if(command && !event.altKey && key==='d')return 'duplicate';
  if(event.altKey && !command && ['arrowup','arrowdown'].includes(key))return key==='arrowup'?'previous-layer':'next-layer';
  if(command || event.altKey)return null;
  if(key==='delete' || key==='backspace')return 'remove';
  if(key===' ' && !['BUTTON','A','SUMMARY'].includes(tag))return 'pause';
  if(['arrowup','arrowdown','arrowleft','arrowright'].includes(key) && !['BUTTON','A'].includes(tag))return key;
  return null;
}
export function initializeEditor({api,getUser,signIn,toast,setControlLabel=(element,text)=>{element.textContent=text;},onSubmitted}) {
  const form=$('#studio-form'),history=[],assets=new Map();let previewFont=previewFonts.segoe,previewItalic=false,index=-1,paused=false,layers=[legacyLayer(defaults)],shadows=[],activeLayer=0,uploadBusy=false,selectedPreset=null,selection='layer',activeStop=0;
  const run=fn => Promise.resolve().then(fn).catch(error=>toast(error.message,true));
  const icon=(name)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ui-icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`#icon-${name}`);svg.append(use);return svg;};
  const button=(text,fn,cls='st-btn')=>{const b=el('button',cls);b.type='button';if(text)setControlLabel(b,text);b.addEventListener('click',()=>run(fn));return b;};
  const iconButton=(name,label,fn,cls='st-icon')=>{const b=el('button',cls);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.append(icon(name));b.addEventListener('click',()=>run(fn));return b;};
  const typeNames={linear:'Linear gradient',radial:'Radial gradient',conic:'Conic gradient',solid:'Solid color',image:'Image'};
  const blendNames=mode=>mode==='normal'?'Normal':mode.replace('-',' ').replace(/^./,c=>c.toUpperCase());

  /* ---- Field primitives: one look for every slider and color ---------------- */
  function fillRange(input){const min=Number(input.min||0),max=Number(input.max||100),p=max>min?(Number(input.value)-min)/(max-min)*100:0;input.style.setProperty('--p',`${Math.max(0,Math.min(100,p))}%`);}
  function slider(label,value,min,max,step,format,onInput){
    const l=el('label','fld fld-range'),out=el('output'),input=el('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;
    const show=()=>{out.textContent=format(Number(input.value));fillRange(input);};show();
    input.addEventListener('input',()=>{show();onInput(Number(input.value));});input.addEventListener('change',remember);
    l.append(el('span','fld-label',label),out,input);return l;
  }
  function colorControl(value,update,label='Color'){
    const wrap=el('div','fld fld-color fld-rgba'),row=el('div','swatch-wrap'),picker=el('input'),hex=el('input'),alphaOut=el('output');
    picker.type='color';picker.value=value.slice(0,7);picker.setAttribute('aria-label',`${label} color`);
    hex.type='text';hex.value=value;hex.maxLength=9;hex.className='fld-hex-input';hex.setAttribute('aria-label','Hex color including optional alpha');hex.pattern='#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?';hex.spellcheck=false;
    const alpha=el('input');alpha.type='range';alpha.min=0;alpha.max=255;alpha.step=1;alpha.value=value.length===9?parseInt(value.slice(7),16):255;alpha.setAttribute('aria-label','Color alpha');alpha.className='alpha-range';
    const paint=()=>{alpha.style.setProperty('--c',picker.value);alphaOut.textContent=`${Math.round(Number(alpha.value)/255*100)}%`;fillRange(alpha);};
    const emit=()=>{const a=Number(alpha.value),next=a>=255?picker.value:picker.value+Math.round(a).toString(16).padStart(2,'0');hex.value=next;paint();update(next);};
    picker.addEventListener('input',emit);alpha.addEventListener('input',emit);
    hex.addEventListener('input',()=>{if(isColor(hex.value)){picker.value=hex.value.slice(0,7);alpha.value=hex.value.length===9?parseInt(hex.value.slice(7),16):255;paint();update(hex.value);}});
    for(const c of [picker,hex,alpha])c.addEventListener('change',remember);
    paint();row.append(picker,hex,alphaOut);wrap.append(el('span','fld-label',label),row,alpha);return wrap;
  }
  function segmented(label,value,options,onChange){
    const wrap=el('div','fld'),group=el('div','seg');group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
    for(const [v,t] of options){const b=el('button','',t);b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(v===value));b.addEventListener('click',()=>{if(b.getAttribute('aria-checked')==='true')return;for(const o of group.children)o.setAttribute('aria-checked',String(o===b));run(()=>onChange(v));});group.append(b);}
    wrap.append(el('span','fld-label',label),group);return wrap;
  }
  function syncFields(){
    for(const input of form.querySelectorAll('.fld-range input[type="range"]'))fillRange(input);
    for(const picker of form.querySelectorAll('.fld-color input[type="color"][name]')){const hex=picker.parentElement.querySelector('.fld-hex');if(hex)hex.textContent=picker.value;}
  }
  form.addEventListener('input',event=>{if(event.target.matches('.fld-range input[type="range"]'))fillRange(event.target);if(event.target.matches('input[type="color"][name]')){const hex=event.target.parentElement.querySelector('.fld-hex');if(hex)hex.textContent=event.target.value;}});

  /* ---- Recipe state ------------------------------------------------------------ */
  function design(){return {recipe:recipe(),layers:clone(layers)};}
  function recipe(){const r={colors:[1,2,3].map(n=>form.elements[`color${n}`].value),animation:form.elements.animation.value || 'none',direction:form.elements.direction.value || 'normal'};for(const key of numericKeys)r[key]=Number(form.elements[key].value);for(const key of colorKeys)r[key]=form.elements[key].value;r.layers=normalizeLayers(layers,{allowEmptyImages:true});r.shadows=clone(shadows);return r;}
  function remember(){const serialized=JSON.stringify({design:design(),preset:selectedPreset});if(history[index]===serialized)return;history.splice(index+1);history.push(serialized);if(history.length>50)history.shift();index=history.length-1;historyButtons();markDirty();}
  function historyButtons(){$('#undo-design').disabled=index<=0;$('#redo-design').disabled=index>=history.length-1;}
  let dirty=false;function markDirty(){if(index<=0)return;dirty=true;$('#draft-status').textContent='Unsaved changes';$('#draft-status').removeAttribute('title');}
  function textureMap(){return Object.fromEntries([...assets].map(([id,a])=>[id,a.url]));}
  const previewNames = ['#studio-name','#studio-chat-name','#publish-name-preview'].map(selector => $(selector));
  const syncPreviewName=createPreviewNameBinding($('#preview-username'));
  function syncAccountName(){syncPreviewName(getUser());for(const target of previewNames)updateCosmeticText(target,$('#preview-username').value);updateCropDisplay();}
  const updatePreviewName = createFrameUpdate(() => {
    const name = $('#preview-username').value || 'yourname';
    for (const target of previewNames) updateCosmeticText(target, name);
    updateCropDisplay();
  });
  const units={speed:'s',angle:'°',glow:'px',shadowX:'px',shadowY:'px',shadowBlur:'px',shadowOpacity:'%',outline:'px',depth:' layers',depthAngle:'°',fontWeight:'',letterSpacing:'px'};
  function update(){
    const r=recipe(),name=$('#preview-username').value || 'yourname';
    // Missing imported image layers use a gradient for preview, but cannot be published.
    const safeLayers=layers.map(l=>l.type==='image'&&!l.textureId ? legacyLayer({...r,textureId:undefined}):l);
    for(const target of previewNames){updateCosmeticText(target,name);applyCosmetic(target,{recipe:{...r,layers:safeLayers}},location.origin,{previewTextures:textureMap(),paused});}
    for(const key of numericKeys)$(`#${key}-value`).textContent=`${r[key]}${units[key]}`;
    $('#layer-count').textContent=`${layers.length} layer${layers.length===1?'':'s'} · ${paused?'paused':'live'}`;
    $('#add-layer').disabled=layers.length>=6;$('#add-shadow').disabled=shadows.length>=8;
    syncFields();syncSummaries(r);refreshLayerThumbs();syncPreview();updateTextureDisplay();
  }
  function syncPreview(){
    const size=Number($('#preview-chat-size').value),zoom=Number($('#preview-size').value);
    for(const selector of ['#studio-name','#studio-chat-name']){$(selector).style.fontSize=`${size}px`;$(selector).style.fontFamily=previewFont;$(selector).style.fontStyle=previewItalic?'italic':'normal';}
    $('.mini-chat').style.fontFamily=previewFont;$('.mini-chat').style.fontStyle=previewItalic?'italic':'normal';
    $('.mini-chat').style.fontSize=`${size}px`;
    $('#studio-name').style.zoom=String(zoom);
    $('#preview-chat-size-value').textContent=`${size}px`;$('#preview-size-value').textContent=`${zoom}×`;
    updateCropDisplay();
  }
  function setRecipe(input,record=true,{clearTextures=true}={}){
    if(!input||typeof input!=='object'||!Array.isArray(input.colors)||input.colors.length<2||input.colors.length>5||!input.colors.every(c=>/^#[a-f0-9]{6}$/i.test(c)))throw new Error('Design needs 2–5 hex fallback colors.');
    if(!ANIMATIONS.includes(input.animation))throw new Error('Unknown animation.');
    if(input.direction!==undefined&&!PLAYBACK_DIRECTIONS.includes(input.direction))throw new Error('Unknown playback direction.');
    const merged={...defaults,...input};
    for(const key of numericKeys){const v=merged[key],control=form.elements[key];if(!Number.isFinite(v)||v<Number(control.min)||v>Number(control.max)||(key==='depth'&&!Number.isInteger(v)))throw new Error(`Invalid ${key}.`);}
    for(const key of colorKeys)if(!/^#[a-f0-9]{6}$/i.test(merged[key]))throw new Error(`Invalid ${key}.`);
    const normalized=normalizeLayers(input.layers || [legacyLayer(input)],{allowEmptyImages:true});const normalizedShadows=normalizeShadows(input.shadows || []);
    layers=normalized.map((l,i)=>{const layer=clone(l);if(clearTextures&&layer.type==='image')delete layer.textureId;else if(!clearTextures)Object.assign(layer,clone(input.layers?.[i] || l));return layer;});shadows=normalizedShadows;activeLayer=Math.min(activeLayer,layers.length-1);activeStop=0;
    for(let i=1;i<=3;i++)form.elements[`color${i}`].value=input.colors[i-1] || input.colors.at(-1);
    for(const key of [...numericKeys,...colorKeys])form.elements[key].value=merged[key];
    form.elements.animation.value=merged.animation;form.elements.direction.value=merged.direction || 'normal';
    renderLayers();renderShadows();update();if(record)remember();
  }

  /* ---- Outline + selection ---------------------------------------------------- */
  const effectState={
    glow:{on:r=>r.glow>0,enable:()=>{form.elements.glow.value=lastValues.glow||8;},disable:()=>{lastValues.glow=Number(form.elements.glow.value);form.elements.glow.value=0;},summary:r=>r.glow>0?`${r.glow}px`:''},
    outline:{on:r=>r.outline>0,enable:()=>{form.elements.outline.value=lastValues.outline||.6;},disable:()=>{lastValues.outline=Number(form.elements.outline.value);form.elements.outline.value=0;},summary:r=>r.outline>0?`${r.outline}px`:''},
    shadow:{on:r=>r.shadowOpacity>0,enable:()=>{form.elements.shadowOpacity.value=lastValues.shadowOpacity||70;if(!Number(form.elements.shadowY.value)&&!Number(form.elements.shadowBlur.value)){form.elements.shadowY.value=3;form.elements.shadowBlur.value=6;}},disable:()=>{lastValues.shadowOpacity=Number(form.elements.shadowOpacity.value);form.elements.shadowOpacity.value=0;},summary:r=>r.shadowOpacity>0?`${r.shadowOpacity}%`:''},
    shadows:{on:()=>shadows.length>0,enable:()=>{if(!shadows.length)shadows.push({x:0,y:0,blur:10,color:`${form.elements.glowColor.value}aa`});renderShadows();},disable:()=>{lastShadows=clone(shadows);shadows=[];renderShadows();},summary:()=>shadows.length?`${shadows.length}`:''},
    depth:{on:r=>r.depth>0,enable:()=>{form.elements.depth.value=lastValues.depth||3;},disable:()=>{lastValues.depth=Number(form.elements.depth.value);form.elements.depth.value=0;},summary:r=>r.depth>0?`${r.depth}×`:''}
  };
  const lastValues={};let lastShadows=null;
  const animationNames={flow:'Flow',shimmer:'Shimmer',pulse:'Pulse',spectrum:'Spectrum',none:'Static'};
  function syncSummaries(r){
    for(const [key,state] of Object.entries(effectState)){
      const on=state.on(r),toggle=form.querySelector(`[data-effect="${key}"]`);if(toggle)toggle.checked=on;
      form.querySelector(`[data-select="${key}"]`)?.classList.toggle('is-off',!on);
      const out=form.querySelector(`[data-summary="${key}"]`);if(out)out.textContent=state.summary(r);
    }
    form.querySelector('[data-summary="motion"]').textContent=r.animation==='none'?'Static':`${animationNames[r.animation]} · ${r.speed}s`;
    form.querySelector('[data-summary="text"]').textContent=`${r.fontWeight} · ${r.letterSpacing}px`;
    const fb=form.querySelector('[data-summary="fallback"]');fb.replaceChildren(...r.colors.map(c=>{const dot=el('i');dot.style.background=c;return dot;}));
  }
  for(const toggle of form.querySelectorAll('[data-effect]'))toggle.addEventListener('change',()=>run(()=>{
    const state=effectState[toggle.dataset.effect];if(toggle.checked){if(toggle.dataset.effect==='shadows'&&lastShadows?.length&&!shadows.length){shadows=lastShadows;renderShadows();}else state.enable();}else state.disable();
    update();remember();select(toggle.dataset.effect,{focus:false});
  }));
  function select(kind,{focus=false,layer,scroll=true}={}){
    if(layer!==undefined)activeLayer=clamp(layer,0,layers.length-1);
    selection=kind;
    for(const panel of form.querySelectorAll('.insp'))panel.hidden=panel.dataset.panel!==kind;
    for(const row of form.querySelectorAll('[data-select]'))row.classList.toggle('is-selected',row.dataset.select===kind);
    for(const item of $('#layer-list').children)item.classList.toggle('is-selected',kind==='layer'&&Number(item.dataset.index)===activeLayer);
    $('#view-studio').dataset.section=kind;
    if(kind==='layer')renderLayerInspector();
    if(focus){const target=kind==='layer'?$('#layer-list').children[activeLayer]:form.querySelector(`[data-select-btn="${kind}"]`);target?.focus({preventScroll:true});}
    if(scroll && !focus && !$('#view-studio').hidden && matchMedia('(max-width: 1000px)').matches)$('.st-inspector').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  for(const b of form.querySelectorAll('[data-select-btn]'))b.addEventListener('click',()=>select(b.dataset.selectBtn));
  $('#tab-fill').addEventListener('click',()=>select('layer',{layer:0}));
  $('#tab-effects').addEventListener('click',()=>select('glow'));
  function switchTab(tab){
    if(tab==='publish'){openPublish();return;}
    select({fill:'layer',effects:'glow',motion:'motion',text:'text'}[tab] || 'layer');
  }

  /* ---- Layers: outline rows + one inspector ------------------------------------ */
  function layerFill(layer){return layerBackground(layer,assets.get(layer.textureId)?.url) || 'linear-gradient(135deg,#2a2a30,#17171b)';}
  function renderLayers(){
    const list=$('#layer-list');list.replaceChildren();
    layers.forEach((layer,i)=>{
      const item=el('button','st-layer');item.type='button';item.dataset.index=String(i);item.setAttribute('aria-label',`Layer ${i+1}: ${typeNames[layer.type]}, ${Math.round(layer.opacity*100)}% opacity`);
      const thumb=el('span','st-thumb');thumb.setAttribute('aria-hidden','true');
      const copy=el('span','st-layer-copy');copy.append(el('strong','',typeNames[layer.type]),el('small','',`${Math.round(layer.opacity*100)}%${layer.blendMode&&layer.blendMode!=='normal'?` · ${blendNames(layer.blendMode)}`:''}${layer.type==='image'&&!layer.textureId?' · needs a file':''}`));
      item.append(thumb,copy);item.addEventListener('click',()=>select('layer',{layer:i}));list.append(item);
    });
    refreshLayerThumbs();
    for(const item of list.children)item.classList.toggle('is-selected',selection==='layer'&&Number(item.dataset.index)===activeLayer);
    if(selection==='layer')renderLayerInspector();
  }
  function refreshLayerThumbs(){for(const item of $('#layer-list').children){const layer=layers[Number(item.dataset.index)];if(!layer)continue;const thumb=item.querySelector('.st-thumb');thumb.style.backgroundImage=layerFill(layer);thumb.style.opacity=String(Math.max(.3,layer.opacity));}}
  function refreshLayerRow(i){const item=$('#layer-list').children[i],layer=layers[i];if(!item||!layer)return;item.querySelector('small').textContent=`${Math.round(layer.opacity*100)}%${layer.blendMode&&layer.blendMode!=='normal'?` · ${blendNames(layer.blendMode)}`:''}${layer.type==='image'&&!layer.textureId?' · needs a file':''}`;refreshLayerThumbs();}
  function layerChanged(){refreshLayerRow(activeLayer);update();}
  function renderLayerInspector(){
    const box=$('#layer-inspector'),i=activeLayer,layer=layers[i];box.replaceChildren();if(!layer)return;
    const head=el('header','insp-head insp-head-row'),title=el('div');title.append(el('h2','',typeNames[layer.type]),el('p','',`Layer ${i+1} of ${layers.length} · top layer first`));
    const tools=el('div','insp-tools');
    const up=iconButton('chev-up',`Move layer ${i+1} up`,()=>{if(i===0)return;activeLayer=moveLayer(layers,layer,-1);renderLayers();update();remember();});up.disabled=i===0;
    const down=iconButton('chev-down',`Move layer ${i+1} down`,()=>{if(i===layers.length-1)return;activeLayer=moveLayer(layers,layer,1);renderLayers();update();remember();});down.disabled=i===layers.length-1;
    const dup=iconButton('copy','Duplicate layer',()=>{if(layers.length>=6)throw new Error('Maximum 6 layers.');layers.splice(i,0,clone(layer));activeLayer=i;renderLayers();update();remember();});dup.disabled=layers.length>=6;
    const del=iconButton('trash','Remove layer',()=>{if(layers.length===1)throw new Error('Keep at least one Flare layer.');layers.splice(i,1);activeLayer=Math.max(0,i-1);renderLayers();update();remember();},'st-icon st-danger');del.disabled=layers.length===1;
    tools.append(up,down,dup,del);head.append(title,tools);box.append(head);
    box.append(segmented('Type',layer.type,[['linear','Linear'],['radial','Radial'],['conic','Conic'],['solid','Solid'],['image','Image']],type=>{
      const replacement=changeLayerType(layer,type,recipe());try{validateTextureLimits({layers:layers.map((l,j)=>j===i?replacement:l)});}catch(error){renderLayerInspector();throw error;}
      layers[i]=replacement;activeStop=0;renderLayers();update();remember();
    }));
    if(['linear','radial','conic'].includes(layer.type))box.append(gradientEditor(layer));
    if(layer.type==='solid')box.append(colorControl(layer.color,v=>{layer.color=v;layerChanged();},'Fill color'));
    box.append(slider('Opacity',layer.opacity,0,1,.01,v=>`${Math.round(v*100)}%`,v=>{layer.opacity=v;layerChanged();}));
    const blend=el('label','fld'),blendSelect=el('select');for(const mode of BLEND_MODES){const o=el('option','',blendNames(mode));o.value=mode;blendSelect.append(o);}blendSelect.value=layer.blendMode || 'normal';
    blendSelect.addEventListener('change',()=>{layer.blendMode=blendSelect.value;layerChanged();remember();});blend.append(el('span','fld-label','Blend with layers below'),blendSelect);box.append(blend);
    const sizing=el('details','insp-more');sizing.append(el('summary','','Size, position & tiling'));
    const pair1=el('div','fld-pair'),pair2=el('div','fld-pair');
    pair1.append(slider('Width',layer.size[0],1,500,1,v=>`${v}%`,v=>{layer.size[0]=v;layerChanged();}),slider('Height',layer.size[1],1,500,1,v=>`${v}%`,v=>{layer.size[1]=v;layerChanged();}));
    pair2.append(slider('Position X',layer.at[0],0,100,1,v=>`${Math.round(v)}%`,v=>{layer.at[0]=v;layerChanged();}),slider('Position Y',layer.at[1],0,100,1,v=>`${Math.round(v)}%`,v=>{layer.at[1]=v;layerChanged();}));
    sizing.append(pair1,pair2,segmented('Tiling',layer.canvasRepeat,[['no-repeat','None'],['repeat','Both'],['repeat-x','Across'],['repeat-y','Down']],v=>{layer.canvasRepeat=v;layerChanged();remember();}));
    box.append(sizing);
    $('#texture-panel').hidden=layer.type!=='image';
    if(layer.type==='image'&&!layer.textureId)$('#upload-feedback').textContent='This image layer needs a GIF, PNG, or WebP before publishing.';
    updateTextureDisplay();
  }

  /* ---- Gradient bar: drag stops, click to add, Delete to remove --------------- */
  function gradientEditor(layer){
    const wrap=el('div','grad');
    const bar=el('div','grad-bar'),track=el('div','grad-track');bar.append(track);bar.setAttribute('aria-label','Gradient stops. Click to add a stop.');
    const stopTools=el('div','grad-stop-tools');
    const paintBar=()=>{track.style.backgroundImage=`linear-gradient(90deg, ${[...layer.stops].sort((a,b)=>a.at-b.at).map(s=>`${rgbaColor(s.color)} ${(s.at*100).toFixed(1)}%`).join(', ')})`;};
    const handles=()=>{
      for(const h of bar.querySelectorAll('.grad-stop'))h.remove();
      layer.stops.forEach((stop,j)=>{
        const h=el('button','grad-stop');h.type='button';h.style.left=`${stop.at*100}%`;h.style.setProperty('--c',rgbaColor(stop.color));h.setAttribute('aria-label',`Stop ${j+1} at ${Math.round(stop.at*100)}%`);h.setAttribute('aria-pressed',String(j===activeStop));
        h.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();activeStop=j;h.setPointerCapture(event.pointerId);refreshSelected();const rect=bar.getBoundingClientRect();
          const move=ev=>{stop.at=clamp((ev.clientX-rect.left)/rect.width,0,1);h.style.left=`${stop.at*100}%`;paintBar();positionField?.set(stop.at);layerChanged();};
          const up=()=>{h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up);h.removeEventListener('pointercancel',up);remember();h.setAttribute('aria-label',`Stop ${j+1} at ${Math.round(stop.at*100)}%`);};
          h.addEventListener('pointermove',move);h.addEventListener('pointerup',up);h.addEventListener('pointercancel',up);});
        h.addEventListener('keydown',event=>{
          if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();stop.at=clamp(stop.at+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?.1:.01),0,1);h.style.left=`${stop.at*100}%`;paintBar();positionField?.set(stop.at);layerChanged();remember();}
          if(['Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();removeStop(j);}
          if(['Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();stop.at=event.key==='Home'?0:1;h.style.left=`${stop.at*100}%`;paintBar();positionField?.set(stop.at);layerChanged();remember();}
        });
        h.addEventListener('focus',()=>{if(activeStop!==j){activeStop=j;refreshSelected();}});
        bar.append(h);
      });
    };
    let positionField=null;
    const removeStop=j=>run(()=>{if(layer.stops.length<=2)throw new Error('A gradient needs at least two stops.');layer.stops.splice(j,1);activeStop=Math.max(0,j-1);rebuild();layerChanged();remember();});
    const refreshSelected=()=>{
      for(const [j,h] of [...bar.querySelectorAll('.grad-stop')].entries())h.setAttribute('aria-pressed',String(j===activeStop));
      const stop=layer.stops[activeStop];stopTools.replaceChildren();if(!stop)return;
      const head=el('div','grad-stop-head');head.append(el('span','fld-label',`Stop ${activeStop+1} of ${layer.stops.length}`));
      const remove=iconButton('trash',`Remove stop ${activeStop+1}`,()=>removeStop(activeStop),'st-icon st-danger st-icon-sm');remove.disabled=layer.stops.length<=2;head.append(remove);
      stopTools.append(head,colorControl(stop.color,v=>{stop.color=v;paintBar();bar.querySelectorAll('.grad-stop')[activeStop]?.style.setProperty('--c',rgbaColor(v));layerChanged();},'Stop color'));
      const pos=slider('Position',Math.round(stop.at*100),0,100,1,v=>`${v}%`,v=>{stop.at=v/100;const h=bar.querySelectorAll('.grad-stop')[activeStop];if(h)h.style.left=`${v}%`;paintBar();layerChanged();});
      positionField={set:at=>{const input=pos.querySelector('input');input.value=Math.round(at*100);input.dispatchEvent(new Event('sync'));pos.querySelector('output').textContent=`${Math.round(at*100)}%`;fillRange(input);}};
      stopTools.append(pos);
    };
    const rebuild=()=>{paintBar();handles();refreshSelected();};
    bar.addEventListener('pointerdown',event=>{if(event.target.closest('.grad-stop'))return;run(()=>{
      if(layer.stops.length>=12)throw new Error('Maximum 12 stops per gradient.');
      const rect=bar.getBoundingClientRect(),at=clamp((event.clientX-rect.left)/rect.width,0,1);
      const sorted=[...layer.stops].sort((a,b)=>Math.abs(a.at-at)-Math.abs(b.at-at));
      layer.stops.push({at,color:sorted[0]?.color || '#ffffff'});activeStop=layer.stops.length-1;rebuild();layerChanged();remember();
      bar.querySelectorAll('.grad-stop')[activeStop]?.focus();
    });});
    const geometry=el('div','fld-pair');
    if(layer.type!=='radial')geometry.append(angleDial(layer));
    else geometry.append(segmented('Shape',layer.shape,[['ellipse','Ellipse'],['circle','Circle']],v=>{layer.shape=v;layerChanged();remember();}));
    geometry.append(segmented('Bands',String(layer.repeat),[['false','Smooth'],['true','Repeat']],v=>{layer.repeat=v==='true';layerChanged();remember();}));
    const label=el('div','grad-head');label.append(el('span','fld-label','Gradient'),el('small','','Click the bar to add a stop · drag to move'));
    wrap.append(label,bar,stopTools,geometry);rebuild();return wrap;
  }
  function angleDial(layer){
    const fld=el('div','fld fld-dial'),dial=el('div','dial'),knob=el('span','dial-knob'),out=el('output');dial.append(knob);
    dial.tabIndex=0;dial.setAttribute('role','slider');dial.setAttribute('aria-label','Gradient angle');dial.setAttribute('aria-valuemin','0');dial.setAttribute('aria-valuemax','360');
    const show=()=>{dial.style.setProperty('--a',`${layer.angle}deg`);out.textContent=`${Math.round(layer.angle)}°`;dial.setAttribute('aria-valuenow',String(Math.round(layer.angle)));};
    const setFrom=event=>{const r=dial.getBoundingClientRect(),a=Math.atan2(event.clientX-(r.left+r.width/2),-(event.clientY-(r.top+r.height/2)))*180/Math.PI;let deg=(a+360)%360;if(event.shiftKey)deg=Math.round(deg/15)*15;layer.angle=Math.round(deg);show();layerChanged();};
    dial.addEventListener('pointerdown',event=>{event.preventDefault();dial.setPointerCapture(event.pointerId);dial.focus();setFrom(event);const move=ev=>setFrom(ev),up=()=>{dial.removeEventListener('pointermove',move);dial.removeEventListener('pointerup',up);remember();};dial.addEventListener('pointermove',move);dial.addEventListener('pointerup',up);});
    dial.addEventListener('keydown',event=>{const d={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[event.key];if(!d)return;event.preventDefault();event.stopPropagation();layer.angle=(layer.angle+d*(event.shiftKey?15:1)+360)%360;show();layerChanged();remember();});
    show();const row=el('div','dial-row');row.append(dial,out);fld.append(el('span','fld-label','Angle'),row);return fld;
  }

  /* ---- Shadow stack ---------------------------------------------------------- */
  function renderShadows(){const list=$('#shadow-list');list.replaceChildren();shadows.forEach((s,i)=>{const card=el('div','shadow-card'),head=el('div','grad-stop-head');head.append(el('span','fld-label',`Shadow ${i+1}`),iconButton('trash',`Remove shadow ${i+1}`,()=>{shadows.splice(i,1);renderShadows();update();remember();},'st-icon st-danger st-icon-sm'));card.append(head,colorControl(s.color,v=>{s.color=v;update();},'Color'));const row=el('div','fld-trio');for(const [key,title,min,max]of [['x','X',-20,20],['y','Y',-20,20],['blur','Blur',0,30]])row.append(slider(title,s[key],min,max,1,v=>`${v}px`,v=>{s[key]=v;update();}));card.append(row);list.append(card);});}
  $('#add-layer').addEventListener('click',()=>run(()=>{if(layers.length>=6)return;layers.push({...legacyLayer(recipe()),opacity:.65});activeLayer=layers.length-1;renderLayers();select('layer');update();remember();}));
  $('#add-shadow').addEventListener('click',()=>{if(shadows.length>=8)return;shadows.push({x:0,y:0,blur:8,color:'#ff1a3580'});renderShadows();update();remember();});

  /* ---- Templates ------------------------------------------------------------- */
  function syncPresetSelection(key){const selected=Boolean(key&&presets[key]);for(const b of $('#preset-gallery').children){const active=selected&&b.dataset.preset===key;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}const select=$('#preset-select');if(selected)select.value=key;else select.selectedIndex=-1;}
  function pop(){if(matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion==='reduced')return;$('#preview-stage').animate([{transform:'scale(.985)',filter:'brightness(1.25)'},{transform:'none',filter:'none'}],{duration:320,easing:'cubic-bezier(.16,1,.3,1)'});}
  function preset(key){selectedPreset=key;setRecipe(presets[key].recipe);syncPresetSelection(key);select('layer',{layer:0});pop();}
  for(const [key,p]of Object.entries(presets)){const b=el('button','preset-tile');b.type='button';b.dataset.preset=key;b.addEventListener('click',()=>run(()=>preset(key)));const name=el('strong','','Aa');applyCosmetic(name,{recipe:p.recipe},location.origin,{paused:true});b.addEventListener('pointerenter',()=>applyCosmetic(name,{recipe:p.recipe}));b.addEventListener('pointerleave',()=>applyCosmetic(name,{recipe:p.recipe},location.origin,{paused:true}));const stage=el('span','preset-stage');stage.append(name);b.append(stage,el('span','preset-label',p.title));$('#preset-gallery').append(b);}
  syncPresetSelection($('#preset-select').value);
  // Template strip: arrows, a visible scrollbar, and wheel-to-sideways scrolling.
  const gallery=$('#preset-gallery'),prev=$('#preset-prev'),next=$('#preset-next');
  const syncArrows=()=>{const max=gallery.scrollWidth-gallery.clientWidth;prev.disabled=gallery.scrollLeft<=2;next.disabled=gallery.scrollLeft>=max-2;gallery.classList.toggle('at-end',gallery.scrollLeft>=max-2);gallery.classList.toggle('at-start',gallery.scrollLeft<=2);};
  const page=direction=>gallery.scrollBy({left:direction*Math.max(160,gallery.clientWidth*.8),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  prev.addEventListener('click',()=>page(-1));next.addEventListener('click',()=>page(1));
  gallery.addEventListener('scroll',syncArrows,{passive:true});new ResizeObserver(syncArrows).observe(gallery);
  gallery.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;const max=gallery.scrollWidth-gallery.clientWidth;if(max<=0)return;const atEdge=(event.deltaY<0&&gallery.scrollLeft<=0)||(event.deltaY>0&&gallery.scrollLeft>=max);if(atEdge)return;event.preventDefault();gallery.scrollLeft+=event.deltaY;},{passive:false});
  syncArrows();
  $('#preset-select').addEventListener('change',event=>run(()=>preset(event.target.value)));
  $('#image-only-design').addEventListener('click',()=>run(()=>{selectedPreset=null;syncPresetSelection(null);setRecipe(imageOnlyRecipe());closeMenu();select('layer',{layer:0});$('#upload-feedback').textContent='Image-only Flare: choose a PNG, WebP, or GIF. No gradient layer or extra effects are added.';$('#texture-drop').scrollIntoView({block:'center'});$('#texture-drop').focus();}));
  $('#randomize-design').addEventListener('click',()=>run(()=>{selectedPreset=null;syncPresetSelection(null);const palettes=[['#ff1a35','#ff9c6b','#ffc6df'],['#ff74d3','#8e79ff','#e9aaff'],['#82e9ff','#487bff','#e0f9ff'],['#f4b649','#ff655f','#fff0b6'],['#7cffb2','#3fd0ff','#e8fff4'],['#ffb3ec','#ff5fa2','#fff1fb']];const colors=palettes[Math.floor(Math.random()*palettes.length)];setRecipe({...defaults,colors,glowColor:colors[0],angle:Math.floor(Math.random()*360),depth:Math.floor(Math.random()*5),animation:['flow','shimmer','pulse','spectrum'][Math.floor(Math.random()*4)]});pop();toast('A fresh starting point. Make it yours.');}));
  function restore(direction){const next=index+direction;if(next<0||next>=history.length)return;const saved=JSON.parse(history[next]),edit=saved.design||saved;setRecipe({...edit.recipe,layers:edit.layers},false,{clearTextures:false});selectedPreset=saved.preset&&presets[saved.preset]?saved.preset:null;syncPresetSelection(selectedPreset);index=next;historyButtons();}

  /* ---- Keyboard ------------------------------------------------------------- */
  document.addEventListener('keydown',event=>{
    if($('#view-studio').hidden || document.querySelector('dialog[open]') || event.target.closest?.('#image-crop-stage, .grad, .dial'))return;
    const action=studioShortcut(event);if(!action)return;
    event.preventDefault();if(event.repeat && !action.startsWith('arrow'))return;
    run(()=>{
      if(action==='undo' || action==='redo'){restore(action==='undo'?-1:1);return;}
      if(action==='save'){$('#save-draft').click();return;}
      if(action==='pause'){$('#pause-preview').click();return;}
      if(action.startsWith('tab-')){const tab=['fill','effects','motion','text','publish'][Number(action.at(-1))-1];switchTab(tab);if(tab!=='publish')select(selection,{focus:true});return;}
      if(action==='previous-layer' || action==='next-layer')activeLayer=clamp(activeLayer+(action==='previous-layer'?-1:1),0,layers.length-1);
      else if(action==='duplicate'){if(layers.length>=6)throw new Error('Maximum 6 layers.');layers.splice(activeLayer,0,clone(layers[activeLayer]));}
      else if(action==='remove'){if(layers.length===1)throw new Error('Keep at least one Flare layer.');layers.splice(activeLayer,1);activeLayer=Math.max(0,activeLayer-1);}
      else {const axis=['arrowleft','arrowright'].includes(action)?0:1,delta=(['arrowleft','arrowup'].includes(action)?-1:1)*(event.shiftKey?10:1);layers[activeLayer].at[axis]=clamp(layers[activeLayer].at[axis]+delta,0,100);}
      selection='layer';renderLayers();select('layer',{focus:true});update();remember();
      $('#studio-keyboard-status').textContent=`Layer ${activeLayer+1} of ${layers.length} selected. Position ${layers[activeLayer].at.join(', ')} percent.`;
    });
  });
  $('#undo-design').addEventListener('click',()=>run(()=>restore(-1)));$('#redo-design').addEventListener('click',()=>run(()=>restore(1)));
  const recipeFields=[...numericKeys,...colorKeys,'animation','direction','color1','color2','color3'];
  form.addEventListener('input',event=>{if(event.target.name&&recipeFields.includes(event.target.name))update();});
  form.addEventListener('change',event=>{if(event.target.name&&recipeFields.includes(event.target.name))remember();});

  /* ---- Canvas + preview ------------------------------------------------------ */
  $('#preview-username').addEventListener('input',updatePreviewName);$('#preview-size').addEventListener('input',syncPreview);$('#preview-chat-size').addEventListener('input',syncPreview);
  initializeFontPicker({select:$('#preview-font'),search:$('#preview-font-search'),status:$('#preview-font-status'),retry:$('#preview-font-retry'),onChange(font,italic){previewFont=font;previewItalic=italic;syncPreview();}});
  document.fonts?.addEventListener('loadingdone',updateCropDisplay);
  $('#preview-background').addEventListener('change',event=>{$('#preview-stage').classList.remove('light','transparent');if(event.target.value!=='dark')$('#preview-stage').classList.add(event.target.value);});
  for(const b of document.querySelectorAll('[data-backdrop]'))b.addEventListener('click',()=>{const select=$('#preview-background');select.value=b.dataset.backdrop;select.dispatchEvent(new Event('change'));for(const other of document.querySelectorAll('[data-backdrop]'))other.setAttribute('aria-pressed',String(other===b));});
  $('#pause-preview').addEventListener('click',()=>{paused=!paused;const b=$('#pause-preview');b.setAttribute('aria-pressed',String(paused));b.setAttribute('aria-label',paused?'Resume motion':'Pause motion');b.title=`${paused?'Resume':'Pause'} motion · Space`;b.querySelector('use')?.setAttribute('href',paused?'#icon-play':'#icon-pause');$('#preview-caption').textContent=paused?'Motion paused':'Magnified view';update();});

  /* ---- Title, menu, drafts, import/export ---------------------------------- */
  const title=$('#flare-title');
  function setFlareName(value){const v=String(value||'').slice(0,40);form.elements.name.value=v;title.value=v;}
  title.addEventListener('input',()=>{form.elements.name.value=title.value;});
  form.elements.name.addEventListener('input',()=>{title.value=form.elements.name.value;});
  const menu=$('.st-menu');function closeMenu(){if(menu)menu.open=false;}
  document.addEventListener('click',event=>{if(menu?.open&&!menu.contains(event.target))closeMenu();});
  menu?.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();menu.querySelector('summary').focus();}});
  // Drafts are also saved quietly before a sign-in leaves the page, so a
  // design is never lost to an OAuth round trip.
  function storeDraft(){localStorage.setItem('nameflare.draft.v1',JSON.stringify({...design(),name:form.elements.name.value,description:form.elements.description.value,listed:form.elements.listed.value==='public',preset:selectedPreset}));}
  $('#save-draft').addEventListener('click',()=>run(()=>{storeDraft();dirty=false;$('#draft-status').textContent=`Saved ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;$('#draft-status').title='Saved in this browser. Reattach image files after a reload.';toast('Draft saved in this browser.');}));
  $('#export-design').addEventListener('click',()=>run(()=>{closeMenu();downloadDesign({name:form.elements.name.value,description:form.elements.description.value,listed:form.elements.listed.value==='public',recipe:recipe()});toast('Design exported. Image files are separate.');}));
  for(const id of ['#import-design-button','#import-design-finish'])$(id).addEventListener('click',()=>{closeMenu();$('#import-design').click();});
  $('#import-design').addEventListener('change',event=>run(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>128000)throw new Error('Flare JSON must be under 128 KB.');const imported=JSON.parse(await file.text()),converted=importDesign(imported);selectedPreset=null;syncPresetSelection(null);setRecipe(converted.recipe);setFlareName(String(converted.name||'Imported Flare'));form.elements.description.value=String(imported.description||'').slice(0,400);form.elements.listed.value=imported.listed===false?'unlisted':'public';form.elements.rights.checked=false;const images=layers.filter(l=>l.type==='image').length;$('#import-status').textContent=[`Imported ${layers.length} layers and ${shadows.length} shadows.`,...converted.warnings,images?`Reattach ${images} image file(s).`:''].filter(Boolean).join(' ');$('#upload-feedback').textContent=converted.warnings.length?converted.warnings.join(' '):images?'Reattach the imported image file(s) before publishing.':'Preview images without signing in. Files upload when you publish.';select('layer',{layer:0});event.target.value='';toast(converted.warnings.length ? `Flare imported with ${converted.warnings.length} notice(s): ${converted.warnings[0]}`:'Flare imported as a new editable design.');}));

  /* ---- Textures + crop --------------------------------------------------------- */
  function updateTextureDisplay(){
    const layer=layers[activeLayer],asset=assets.get(layer?.textureId),attached=layers.filter(l=>assets.has(l.textureId));
    const counts=validateTextureLimits({layers});$('#texture-usage').textContent=`${counts.gif}/1 GIF · ${counts.image}/1 other image`;
    $('#texture-preview-row').hidden=!asset;
    if(asset){$('#texture-preview').src=asset.url;$('#texture-filename').textContent=asset.file.name;$('#texture-status').textContent=`${(asset.file.size/1024).toFixed(0)} KB · layer ${activeLayer+1} · ${layer.type==='image'?'active image':'saved for image type'} · ${asset.uploadedId?'uploaded privately':'local preview only'}`;}
    $('#texture-attachments').replaceChildren(...attached.filter(l=>l!==layer).map(l=>button(`${assets.get(l.textureId).file.name} · layer ${layers.indexOf(l)+1}`,()=>{select('layer',{layer:layers.indexOf(l)});})));
    updateCropDisplay();
  }
  const cropStage=$('#image-crop-stage');let cropGesture=null;
  function updateCropDisplay(){
    const layer=layers[activeLayer],asset=assets.get(layer?.textureId),panel=$('#image-crop-controls');
    panel.hidden=layer?.type!=='image'||!asset;if(panel.hidden)return;
    const name=$('#studio-name'),width=name.offsetWidth,height=name.offsetHeight;if(!width||!height)return;
    // The stage is the name's own box at a larger scale. The image is mapped onto it
    // exactly as the renderer maps it onto the name, dimmed outside the letters and
    // shown at full strength inside them (the same image, clipped to the text).
    cropStage.style.aspectRatio=`${width} / ${height}`;cropStage.style.width=`min(100%, ${(200*width/height).toFixed(1)}px)`;
    const fill={backgroundImage:`url("${asset.url}")`,backgroundSize:`${layer.size[0]}% ${layer.size[1]}%`,backgroundPosition:`${layer.at[0]}% ${layer.at[1]}%`,backgroundRepeat:layer.canvasRepeat};
    Object.assign(cropStage.style,fill);
    const text=$('#image-crop-name');text.textContent=$('#preview-username').value||'yourname';Object.assign(text.style,fill);
    text.style.fontSize=`${parseFloat(getComputedStyle(name).fontSize)*cropStage.clientWidth/width}px`;text.style.lineHeight=getComputedStyle(name).lineHeight==='normal'?'1.15':`${parseFloat(getComputedStyle(name).lineHeight)*cropStage.clientWidth/width}px`;
    text.style.fontFamily=getComputedStyle(name).fontFamily;text.style.fontStyle=getComputedStyle(name).fontStyle;text.style.fontWeight=name.style.fontWeight;text.style.letterSpacing=`${Number(form.elements.letterSpacing.value)*cropStage.clientWidth/width}px`;
    $('#image-crop-layer').textContent=`Layer ${activeLayer+1} · ${asset.file.name}`;
    $('#image-crop-zoom').value=Math.max(...layer.size);$('#image-crop-x').value=layer.at[0];$('#image-crop-y').value=layer.at[1];
    for(const [id,text] of [['#image-crop-zoom',`${Math.round(Math.max(...layer.size))}%`],['#image-crop-x',`${Math.round(layer.at[0])}%`],['#image-crop-y',`${Math.round(layer.at[1])}%`]]){const input=$(id);fillRange(input);const out=input.parentElement.querySelector('output');if(out)out.textContent=text;}
    $('#image-crop-values').textContent=`Size ${layer.size.map(n=>n.toFixed(0)).join(' × ')}% · position ${layer.at.map(n=>n.toFixed(0)).join(' / ')}%`;
  }
  function cropChanged(){update();}
  for(const [id,axis]of [['#image-crop-x',0],['#image-crop-y',1]]){
    $(id).addEventListener('input',event=>{const layer=layers[activeLayer];if(layer?.type!=='image')return;layer.at[axis]=Number(event.target.value);cropChanged();});$(id).addEventListener('change',()=>{renderLayers();remember();});
  }
  $('#image-crop-zoom').addEventListener('input',event=>{const layer=layers[activeLayer];if(layer?.type!=='image')return;layer.size=zoomImageLayer(layer,Number(event.target.value));cropChanged();});$('#image-crop-zoom').addEventListener('change',()=>{renderLayers();remember();});
  $('#image-crop-cover').addEventListener('click',()=>run(()=>{const layer=layers[activeLayer],asset=assets.get(layer?.textureId),name=$('#studio-name');if(layer?.type!=='image'||!asset)return;layer.size=coverImageSize([asset.width,asset.height],[name.offsetWidth,name.offsetHeight]);layer.at=[50,50];layer.canvasRepeat='no-repeat';renderLayers();cropChanged();remember();}));
  $('#image-crop-reset').addEventListener('click',()=>{const layer=layers[activeLayer];if(layer?.type!=='image')return;layer.size=[100,100];layer.at=[50,50];layer.canvasRepeat='no-repeat';renderLayers();cropChanged();remember();});
  function finishCrop(event,cancel=false){
    if(!cropGesture||event.pointerId!==cropGesture.pointerId)return;
    const gesture=cropGesture;cropGesture=null;
    if(cancel){gesture.layer.at=gesture.at;update();}else {renderLayers();remember();}
    if(cropStage.hasPointerCapture(event.pointerId))cropStage.releasePointerCapture(event.pointerId);
  }
  cropStage.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0)return;const layer=layers[activeLayer];if(layer?.type!=='image'||!assets.has(layer.textureId))return;event.preventDefault();cropStage.focus();cropStage.setPointerCapture(event.pointerId);const rect=cropStage.getBoundingClientRect();cropGesture={pointerId:event.pointerId,layer,at:[...layer.at],size:[...layer.size],x:event.clientX,y:event.clientY,viewport:[rect.width,rect.height]};});
  cropStage.addEventListener('pointermove',event=>{const g=cropGesture;if(!g||event.pointerId!==g.pointerId||layers[activeLayer]!==g.layer)return;g.layer.at=panImageLayer({size:g.size,at:g.at},[event.clientX-g.x,event.clientY-g.y],g.viewport);cropChanged();});
  cropStage.addEventListener('pointerup',event=>finishCrop(event));cropStage.addEventListener('pointercancel',event=>finishCrop(event,true));cropStage.addEventListener('lostpointercapture',event=>finishCrop(event,true));
  cropStage.addEventListener('keydown',event=>{const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key],layer=layers[activeLayer];if(!direction||layer?.type!=='image')return;event.preventDefault();const rect=cropStage.getBoundingClientRect();layer.at=panImageLayer(layer,direction.map(n=>n*(event.shiftKey?20:5)),[rect.width,rect.height]);renderLayers();cropChanged();remember();});
  // Wheel over the crop view zooms the image around its current position.
  let wheelCommit;
  cropStage.addEventListener('wheel',event=>{const layer=layers[activeLayer];if(layer?.type!=='image'||!assets.has(layer.textureId))return;event.preventDefault();layer.size=zoomImageLayer(layer,Math.max(...layer.size)*(event.deltaY<0?1.06:1/1.06));cropChanged();clearTimeout(wheelCommit);wheelCommit=setTimeout(()=>{renderLayers();remember();},250);},{passive:false});
  const cropResize=new ResizeObserver(()=>updateCropDisplay());cropResize.observe(cropStage);
  function imageDimensions(url){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});
      image.onerror=()=>reject(new Error('The browser could not decode this image.'));
      image.src=url;
    });
  }
  async function attachFile(file){
    if(!file)return;if(file.size>MAX_TEXTURE_BYTES)throw new Error('Choose an image under 2 MB.');
    // JPEG and BMP are rebuilt by the server (BMP is stored as PNG); the local ID only needs the stored type.
    const named=file.name.split('.').pop().toLowerCase(),extension={jpeg:'jpg',jpg:'jpg',jfif:'jpg',bmp:'png'}[named] || named,mime={gif:'image/gif',webp:'image/webp',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',bmp:'image/bmp'}[named];
    if(!mime)throw new Error('Choose a GIF, PNG, WebP, JPEG or BMP file.');
    if(layers[activeLayer]?.type!=='image'&&layers.length>=6)throw new Error('Six layers already. Select an image layer or remove a layer first.');
    const selectedLayer=layers[activeLayer];
    const bytes=await file.arrayBuffer(),view=new Uint8Array(bytes);
    const signature=new TextDecoder().decode(view.slice(0,6));
    if(extension==='gif'&&!['GIF87a','GIF89a'].includes(signature))throw new Error('This is not a valid GIF file.');
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    let width,height;
    try{const dimensions=await imageDimensions(url);width=dimensions.width;height=dimensions.height;if(width>2048||height>2048)throw new Error('Image canvas must be at most 2048 × 2048.');}
    catch(error){URL.revokeObjectURL(url);throw new Error(error.message.includes('2048')?error.message:'The browser could not decode this image.');}
    // File bytes are hashed locally; the authoritative server independently revalidates on upload.
    let id;
    try{
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');id=`${hash}.${extension}`;
      // Recheck the current recipe after decoding; rejected files never alter attachments.
      planImageAttachment(layers,selectedLayer,id);
      if(!assets.has(id)&&getUser()?.role!=='owner'&&assets.size>=30)throw new Error('Local preview limit reached. Save your draft and reload before adding more image files.');
    }catch(error){URL.revokeObjectURL(url);throw error;}
    const selectedIndex=layers.indexOf(selectedLayer),old=assets.get(id);
    if(old)URL.revokeObjectURL(old.url);assets.set(id,{file,url,mime,width,height,uploadedId:old?.uploadedId});
    if(selectedLayer.type!=='image'){layers.unshift({type:'image',textureId:id,opacity:1,size:[100,100],at:[50,50],canvasRepeat:'no-repeat'});activeLayer=0;}
    else {selectedLayer.textureId=id;activeLayer=selectedIndex;}
    renderLayers();select('layer');update();remember();$('#upload-feedback').textContent='Image is previewing locally. It uploads when you publish.';toast('Image added. Keep shaping your Flare.');pop();
  }
  $('#texture-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';run(()=>attachFile(file));});
  const drop=$('#texture-drop');drop.addEventListener('click',event=>{if(event.target.id!=='texture-file')$('#texture-file').click();});drop.addEventListener('keydown',event=>{if(event.target===drop&&['Enter',' '].includes(event.key)){event.preventDefault();$('#texture-file').click();}});
  for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('dragging');});for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragging');if(type==='drop')run(()=>attachFile(event.dataTransfer.files[0]));});
  // Dropping an image anywhere on the canvas attaches it, too.
  const canvasArea=$('.st-canvas');for(const type of ['dragenter','dragover'])canvasArea.addEventListener(type,event=>{if([...(event.dataTransfer?.types||[])].includes('Files')){event.preventDefault();canvasArea.classList.add('dragging');}});
  canvasArea.addEventListener('dragleave',event=>{if(!canvasArea.contains(event.relatedTarget))canvasArea.classList.remove('dragging');});
  canvasArea.addEventListener('drop',event=>{if(!event.dataTransfer?.files?.length)return;event.preventDefault();canvasArea.classList.remove('dragging');run(()=>attachFile(event.dataTransfer.files[0]));});
  $('#clear-texture').addEventListener('click',()=>{const layer=layers[activeLayer];if(layer?.textureId){delete layer.textureId;renderLayers();update();remember();$('#texture-file').value='';}});

  /* ---- Publish dialog ------------------------------------------------------------ */
  const publishDialog=$('#publish-dialog');
  function openPublish(){if(publishDialog.open)return;if(!title.value.trim()&&form.elements.name.value)title.value=form.elements.name.value;publishDialog.showModal();(form.elements.name.value?form.elements.description:form.elements.name).focus();}
  for(const b of document.querySelectorAll('[data-open-publish]'))b.addEventListener('click',()=>{if(!getUser()){signIn('publish');return;}openPublish();});
  for(const b of publishDialog.querySelectorAll('[data-close-publish]'))b.addEventListener('click',()=>publishDialog.close());
  publishDialog.addEventListener('click',event=>{if(event.target===publishDialog && !uploadBusy)publishDialog.close();});
  publishDialog.addEventListener('cancel',event=>{if(uploadBusy)event.preventDefault();});
  form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(uploadBusy)return;if(!getUser()){signIn();return;}switchTab('publish');
    for(const key of ['name','description','rights'])if(!form.elements[key].reportValidity())return;
    const submitted=recipe();normalizeLayers(submitted.layers);normalizeShadows(submitted.shadows);validateTextureLimits(submitted);
    if([...form.querySelectorAll('input')].some(input=>!input.validity.valid))throw new Error('Fix invalid hex colors or numeric fields before publishing.');
    for(const layer of submitted.layers)if(layer.type==='image'&&!assets.has(layer.textureId))throw new Error('Reattach every image file before publishing.');
    uploadBusy=true;const submit=$('#submit-cosmetic');submit.disabled=true;
    try{
      for(const id of new Set(submitted.layers.filter(l=>l.type==='image').map(l=>l.textureId))){const asset=assets.get(id);if(asset.uploadedId){for(const layer of submitted.layers)if(layer.textureId===id)layer.textureId=asset.uploadedId;continue;}submit.textContent='Uploading texture…';const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read texture.'));reader.readAsDataURL(asset.file);});const result=await api('/api/textures',{data:`data:${asset.mime};base64,${base64}`});asset.uploadedId=result.id;for(const layer of submitted.layers)if(layer.textureId===id)layer.textureId=result.id;}
      submit.textContent='Saving Flare…';const result=await api('/api/cosmetics',{name:form.elements.name.value,description:form.elements.description.value,listed:form.elements.listed.value==='public',recipe:submitted});publishDialog.close();toast(result.cosmetic.status==='approved'?(result.cosmetic.listed?'Flare published! Ready in Discover.':'Flare approved! Ready to share by link.'):'Submitted for review. It waits in your Collection until a moderator decides.');onSubmitted();
    }finally{uploadBusy=false;submit.disabled=false;setControlLabel($('#submit-cosmetic'),['owner','moderator'].includes(getUser()?.role)?'Publish Flare ↗':'Submit for review ↗');updateTextureDisplay();}
  });});

  /* ---- Boot ---------------------------------------------------------------------- */
  window.addEventListener('pagehide',()=>{cropResize.disconnect();for(const a of assets.values())URL.revokeObjectURL(a.url);});
  syncPreviewName(getUser());
  preset('sunset');
  try{const draft=JSON.parse(localStorage.getItem('nameflare.draft.v1')||'null');if(draft){selectedPreset=draft.preset&&presets[draft.preset]?draft.preset:null;syncPresetSelection(selectedPreset);setRecipe({...draft.recipe,layers:draft.layers || draft.recipe.layers});setFlareName(draft.name);form.elements.description.value=String(draft.description||'').slice(0,400);form.elements.listed.value=draft.listed===false?'unlisted':'public';$('#draft-status').textContent='Draft restored';$('#draft-status').title='Restored from this browser. Reattach any image files.';}}catch{$('#draft-status').textContent='Unable to restore draft. Start fresh or import a design.';}
  select('layer',{layer:0,scroll:false});
  $('.insp-back')?.addEventListener('click',()=>$('#studio-outline').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  return { openPublish(){if(getUser())openPublish();},
    saveDraftQuietly(){try{storeDraft();return true;}catch{return false;}},
    // A Flare that needs changes reopens as itself, not as a remix: same name,
    // description and listing, ready to fix and submit again.
    revise(cosmetic){selectedPreset=null;syncPresetSelection(null);setRecipe(cosmetic.recipe);setFlareName(cosmetic.name.slice(0,40));form.elements.description.value=cosmetic.description||'';form.elements.listed.value=cosmetic.listed===false||cosmetic.listed===0?'unlisted':'public';form.elements.rights.checked=false;select('layer',{layer:0});navigate('/studio');toast(cosmetic.reason?`Reviewer note: ${cosmetic.reason}`:'Make your changes, then submit again.',false,null,{key:'revise',duration:9000});},
    editCopy(cosmetic){selectedPreset=null;syncPresetSelection(null);setRecipe(cosmetic.recipe);setFlareName(`${cosmetic.name.slice(0,33)} remix`);form.elements.description.value=cosmetic.description||'';form.elements.listed.value='public';form.elements.rights.checked=false;select('layer',{layer:0});navigate('/studio');toast('New editable copy. Artwork rights and approval are not inherited.');}, syncAccountName, accountChanged(){syncAccountName();for(const a of assets.values())delete a.uploadedId;const role=getUser()?.role,staff=['owner','moderator'].includes(role);setControlLabel($('#submit-cosmetic'),staff?'Publish Flare ↗':'Submit for review ↗');$('#submission-policy').textContent=staff?'Your Flares are approved automatically. The three-Flare account limit does not apply to staff. Artwork rights are still required.':`You may submit ${role==='artist'?'20':'three'} Flares total, including pending, approved, rejected, and unlisted designs. Pending Flares stay private until moderator approval.`;update();}, update };
}
