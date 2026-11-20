import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='https://raw.githubusercontent.com/fontsource/google-font-metadata/main/data/api-response.json';
const response=await fetch(source,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error(`Google Fonts catalog download failed (${response.status}).`);
const input=await response.text(),metadata=JSON.parse(input);
if(!Array.isArray(metadata) || metadata.length<1500)throw new Error('Incomplete Google Fonts metadata.');
const families=metadata.map(item=>{
  if(typeof item.family!=='string' || !item.family.length || /["\\;\x00-\x1f]/.test(item.family))throw new Error('Invalid font family.');
  const normal=item.variants.filter(v=>v==='regular' || /^\d+$/.test(v)),italicOnly=!normal.length;
  const variants=italicOnly?item.variants.map(v=>v==='italic'?'regular':v.replace(/italic$/,'')):normal;
  const weights=[...new Set(variants.map(v=>v==='regular'?400:Number(v)))].sort((a,b)=>a-b);
  if(!weights.length || weights.some(w=>!Number.isInteger(w) || w<1 || w>1000))throw new Error(`Invalid weights: ${item.family}`);
  return {family:item.family,weights,...(italicOnly?{italicOnly:true}:{})};
}).sort((a,b)=>a.family.localeCompare(b.family,'en'));
if(new Set(families.map(f=>f.family)).size!==families.length)throw new Error('Duplicate font families.');
const catalog={source,source_sha256:createHash('sha256').update(input).digest('hex'),generated_at:new Date().toISOString(),families};
await writeFile(new URL('../public/google-fonts.json',import.meta.url),JSON.stringify(catalog)+'\n');
console.log(`Generated ${families.length} Google Fonts families (metadata only; no font binaries).`);
