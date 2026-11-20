export const previewFonts=Object.freeze({
  segoe:'"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif',
  system:'system-ui, sans-serif',arial:'Arial, sans-serif',verdana:'Verdana, sans-serif',
  georgia:'Georgia, serif',mono:'ui-monospace, monospace',bricolage:'"Bricolage Grotesque", sans-serif'
});
export function validateFontCatalog(data) {
  if(!Array.isArray(data?.families) || !data.families.length)throw new Error('The font catalog is unavailable.');
  const families=new Map();
  for(const item of data.families){
    if(typeof item.family!=='string' || !item.family.length || /["\\;\x00-\x1f]/.test(item.family) || families.has(item.family) || !Array.isArray(item.weights) || !item.weights.length || item.weights.some(w=>!Number.isInteger(w) || w<1 || w>1000))throw new Error('Invalid font catalog.');
    families.set(item.family,{...item,weights:[...new Set(item.weights)].sort((a,b)=>a-b)});
  }
  return families;
}
export function googleFontURL(font) {
  const url=new URL('https://fonts.googleapis.com/css2');
  url.searchParams.set('family',font.italicOnly?`${font.family}:ital,wght@${font.weights.map(w=>`1,${w}`).join(';')}`:`${font.family}:wght@${font.weights.join(';')}`);
  url.searchParams.set('display','swap');return url.href;
}
export function createFontLoader(doc,timeout=12000) {
  let revision=0,link,pending;
  return async function load(font) {
    const request=++revision;pending?.();link?.remove();link=null;
    if(!font)return true;
    const sheet=doc.createElement('link');link=sheet;sheet.rel='stylesheet';sheet.referrerPolicy='no-referrer';sheet.href=googleFontURL(font);
    try {
      await new Promise((resolve,reject)=>{
        let timer;
        const done=(error)=>{clearTimeout(timer);pending=null;sheet.onload=null;sheet.onerror=null;error?reject(error):resolve();};
        timer=setTimeout(()=>done(new Error('Font download timed out.')),timeout);
        pending=()=>done(new Error('Font selection changed.'));
        sheet.onload=()=>done();sheet.onerror=()=>done(new Error('Could not download this Google font.'));
        doc.head.append(sheet);
      });
      if(request!==revision)return false;
      // CSS loading is separate from the font bytes. Load the face used by the name.
      let timer;
      try {const faces=await Promise.race([doc.fonts.load(`${font.italicOnly?'italic ':''}400 18px ${JSON.stringify(font.family)}`),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Font download timed out.')),timeout);})]);if(!faces.length)throw new Error('This font is not available from Google Fonts.');}
      finally {clearTimeout(timer);}
      return request===revision;
    } catch(error) {if(request!==revision)return false;sheet.remove();link=null;throw error;}
  };
}
export function initializeFontPicker({select,search,status,retry,onChange,doc=document,request=fetch}) {
  let families=new Map(),catalogPromise,loaded=false,selection=0;
  const load=createFontLoader(doc);
  const locals=[...select.options].map(option=>({value:option.value,label:option.textContent}));
  function render() {
    const selected=select.value,query=search.value.trim().toLowerCase(),options=[];
    for(const item of locals)if(item.label.toLowerCase().includes(query) || item.value===selected)options.push(item);
    for(const family of families.keys())if(family.toLowerCase().includes(query) || `google:${family}`===selected)options.push({value:`google:${family}`,label:family});
    select.replaceChildren(...options.map(item=>{const option=doc.createElement('option');option.value=item.value;option.textContent=item.label;return option;}));
    select.value=selected;if(!select.value)select.selectedIndex=-1;
    status.textContent=`${families.size} Google Fonts available · ${options.length} matching choices. Only your selected font is downloaded.`;
  }
  async function catalog() {
    if(loaded){render();return;}
    if(catalogPromise)return catalogPromise;
    status.textContent='Loading the font catalog…';retry.hidden=true;
    catalogPromise=(async()=>{
      const response=await request('/google-fonts.json');if(!response.ok)throw new Error('Could not load the font catalog.');
      families=validateFontCatalog(await response.json());loaded=true;render();
    })().catch(error=>{status.textContent=error.message+' Local fonts still work.';retry.hidden=false;}).finally(()=>{catalogPromise=null;});
    return catalogPromise;
  }
  async function change() {
    const revision=++selection,key=select.value,font=families.get(key.slice(7));retry.hidden=true;
    if(Object.hasOwn(previewFonts,key)){await load(null);if(revision!==selection)return;onChange(previewFonts[key],false);status.textContent='Local preview font selected. No Google download.';return;}
    if(!key.startsWith('google:') || !font)return;
    onChange(previewFonts.system,false);status.textContent=`Loading ${font.family} from Google Fonts…`;
    try {
      if(await load(font) && revision===selection){onChange(`${JSON.stringify(font.family)}, sans-serif`,Boolean(font.italicOnly));status.textContent=`${font.family} loaded · preview only. Your saved Flare is unchanged.`;}
    } catch(error){if(revision===selection){onChange(previewFonts.system,false);status.textContent=`${error.message} Using system font. Retry or choose another font.`;retry.hidden=false;}}
  }
  search.addEventListener('focus',catalog);search.addEventListener('input',()=>{if(loaded)render();else catalog();});
  select.addEventListener('focus',()=>{if(!loaded)catalog();});select.addEventListener('change',change);
  retry.addEventListener('click',()=>{if(!loaded)catalog();else change();});
  return {catalog,change};
}
