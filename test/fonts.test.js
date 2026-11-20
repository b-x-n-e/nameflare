import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewFonts,validateFontCatalog,googleFontURL,createFontLoader,initializeFontPicker } from '../public/fonts.js';
const catalog=JSON.parse(readFileSync(new URL('../public/google-fonts.json',import.meta.url),'utf8'));

test('complete generated Google Fonts catalog has unique safe names, weights, source and no font binaries',()=>{
  const families=validateFontCatalog(catalog);assert.ok(families.size>1900);assert.equal(families.size,catalog.families.length);
  assert.match(catalog.source,/fontsource\/google-font-metadata/);assert.match(catalog.source_sha256,/^[a-f0-9]{64}$/);
  for(const name of ['Roboto','Open Sans','Noto Sans JP','Bricolage Grotesque','Molle'])assert.ok(families.has(name),name);
  assert.equal(families.get('Molle').italicOnly,true);
  for(const data of [{families:[]},{families:[{family:'bad";color:red',weights:[400]}]},{families:[{family:'Good',weights:[NaN]}]},{families:[{family:'Same',weights:[400]},{family:'Same',weights:[400]}]}])assert.throws(()=>validateFontCatalog(data));
  assert.equal('files' in catalog.families[0],false);assert.ok(Object.isFrozen(previewFonts));
});

test('Google CSS2 URLs encode names safely and request available weights, including italic-only families',()=>{
  const url=new URL(googleFontURL({family:'Noto Sans JP',weights:[100,400,900]}));
  assert.equal(url.origin,'https://fonts.googleapis.com');assert.equal(url.pathname,'/css2');assert.equal(url.searchParams.get('family'),'Noto Sans JP:wght@100;400;900');assert.equal(url.searchParams.get('display'),'swap');
  const odd=new URL(googleFontURL({family:'A&B',weights:[400]}));assert.equal(odd.searchParams.size,2);assert.equal(odd.searchParams.get('family'),'A&B:wght@400');
  assert.equal(new URL(googleFontURL({family:'Molle',weights:[400],italicOnly:true})).searchParams.get('family'),'Molle:ital,wght@1,400');
});
function fakeDocument() {
  const links=[],loads=[];
  const doc={createElement(tag){return {tag,remove(){this.removed=true;}};},head:{append(link){links.push(link);}},fonts:{async load(css){loads.push(css);return [{}];}}};
  return {doc,links,loads};
}
test('fonts load only after selection, replace the stylesheet, and local fonts remove external loading',async()=>{
  const {doc,links,loads}=fakeDocument(),load=createFontLoader(doc),font={family:'Roboto',weights:[400,700]};
  assert.equal(links.length,0);const flight=load(font);assert.equal(links.length,1);assert.equal(links[0].referrerPolicy,'no-referrer');links[0].onload();assert.equal(await flight,true);assert.equal(loads.length,1);assert.match(loads[0],/Roboto/);
  const another=load({...font,family:'Open Sans'});assert.equal(links[0].removed,true);links[1].onload();assert.equal(await another,true);
  assert.equal(await load(null),true);assert.equal(links[1].removed,true);assert.equal(links.length,2);
});
test('font loading rejects failures/timeouts and ignores stale selection completions',async()=>{
  const {doc,links}=fakeDocument(),load=createFontLoader(doc,15),font={family:'Roboto',weights:[400]};
  const first=load(font),second=load({...font,family:'Open Sans'});assert.equal(await first,false);links[1].onload();assert.equal(await second,true);
  const failed=load(font);links[2].onerror();await assert.rejects(failed,/download/);assert.equal(links[2].removed,true);
  await assert.rejects(load(font),/timed out/);
  let resolveBytes;doc.fonts.load=()=>new Promise(resolve=>{resolveBytes=resolve;});
  const stale=load(font);links.at(-1).onload();await Promise.resolve();await load(null);resolveBytes([{}]);assert.equal(await stale,false);
});
function control(properties={}) {
  const events={};return {...properties,events,addEventListener(name,fn){events[name]=fn;}};
}
test('searchable picker reads only local metadata, filters every family, keeps local fallbacks and retries catalog errors',async()=>{
  const {doc,links}=fakeDocument();let requests=0,fail=true,changes=[];
  const select=control({options:[{value:'system',textContent:'System sans-serif'},{value:'bricolage',textContent:'Bricolage Grotesque (local)'}],value:'system',replaceChildren(...options){this.options=options;}});
  const search=control({value:''}),status={},retry=control({hidden:true});
  const picker=initializeFontPicker({select,search,status,retry,doc,request:async path=>{assert.equal(path,'/google-fonts.json');requests++;return {ok:!fail,json:async()=>catalog};},onChange:(...values)=>changes.push(values)});
  assert.equal(requests,0);await picker.catalog();assert.equal(retry.hidden,false);assert.match(status.textContent,/Local fonts still work/);
  fail=false;await picker.catalog();assert.equal(requests,2);assert.equal(select.options.length,catalog.families.length+2);assert.equal(links.length,0,'Catalog does not load font CSS');
  search.value='noto sans jp';search.events.input();assert.ok(select.options.some(o=>o.value==='google:Noto Sans JP'));assert.ok(select.options.length<10);assert.equal(select.value,'system');
  select.value='google:Noto Sans JP';const choosing=picker.change();links[0].onload();await choosing;assert.match(changes.at(-1)[0],/Noto Sans JP/);assert.match(status.textContent,/preview only/);
  search.value='not-a-font';search.events.input();assert.ok(select.options.some(o=>o.value===select.value),'Selected font remains available while searching');
  select.value='system';await picker.change();assert.equal(changes.at(-1)[0],previewFonts.system);assert.equal(links[0].removed,true);assert.equal(requests,2);
});
