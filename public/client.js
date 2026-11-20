// SPDX-License-Identifier: MIT OR AGPL-3.0-only
/*! Nameflare browser SDK — Copyright (c) 2026 Nameflare contributors.
 * MIT License: Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE. Alternatively available under AGPL-3.0-only; see LICENSE.
 */
import { normalizeLayers, normalizeShadows, isTextureId, ANIMATIONS, PLAYBACK_DIRECTIONS } from './paints.js';
export { applyCosmetic, updateCosmeticText } from './renderer.js';
export const OFFICIAL_ORIGIN='https://nameflare.bxne.dev';
export function serviceOrigin(value=OFFICIAL_ORIGIN) {
  try {
    const url=new URL(value),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname))return null;
    if(url.protocol!=='https:' && !(url.protocol==='http:' && local))return null;
    return url.origin;
  }catch{return null;}
}
export function identityKey(provider,id) {
  if(!['twitch','kick','youtube'].includes(provider) || typeof id!=='string')return null;
  if(provider==='youtube'?!/^UC[a-zA-Z0-9_-]{22}$/.test(id):!/^\d{1,30}$/.test(id))return null;
  return `${provider}:${id}`;
}
export function normalizeCosmetic(value) {
  if(!value || typeof value.id!=='string' || value.id.length>100 || !value.recipe)return null;
  const input=value.recipe,recipe={};
  if(!Array.isArray(input.colors) || input.colors.length<2 || input.colors.length>5 || !input.colors.every(c=>typeof c==='string' && /^#[a-f0-9]{6}$/i.test(c)))return null;
  if(!ANIMATIONS.includes(input.animation))return null;
  if(input.direction!==undefined){if(!PLAYBACK_DIRECTIONS.includes(input.direction))return null;recipe.direction=input.direction;}
  recipe.colors=[...input.colors];recipe.animation=input.animation;
  const bounds={speed:[1,20],angle:[0,360],glow:[0,20],shadowX:[-12,12],shadowY:[-12,12],shadowBlur:[0,20],shadowOpacity:[0,100],outline:[0,2],depth:[0,8],depthAngle:[0,360],fontWeight:[400,900],letterSpacing:[-1,6]};
  for(const [key,[min,max]]of Object.entries(bounds)) {
    if(input[key]===undefined && !['speed','angle','glow'].includes(key))continue;
    if(!Number.isFinite(input[key]) || input[key]<min || input[key]>max || (key==='depth' && !Number.isInteger(input[key])))return null;
    recipe[key]=input[key];
  }
  for(const key of ['glowColor','shadowColor','outlineColor','depthColor'])if(input[key]!==undefined){if(typeof input[key]!=='string' || !/^#[a-f0-9]{6}$/i.test(input[key]))return null;recipe[key]=input[key];}
  try {
    if(input.layers!==undefined)recipe.layers=normalizeLayers(input.layers);
    if(input.shadows!==undefined)recipe.shadows=normalizeShadows(input.shadows);
  }catch{return null;}
  if(input.textureId!==undefined){if(!isTextureId(input.textureId))return null;recipe.textureId=input.textureId;}
  return {id:value.id,recipe,updated_at:typeof value.updated_at==='string'?value.updated_at:''};
}
async function readJSON(response) {
  if(!response.ok || !(response.headers.get('Content-Type') || '').includes('application/json'))throw new Error('Nameflare unavailable.');
  const reader=response.body.getReader(),chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1000000){await reader.cancel();throw new Error('Nameflare response too large.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export class NameflareClient {
  // live: follow GET /api/v1/changes. While the feed is healthy, verified
  // results are kept for 90s instead of 12s and a change (equip, revocation,
  // ban) is applied within one poll. Any feed failure or reset falls back to
  // the short timings at once, so revocation stays fail-closed.
  constructor({origin=OFFICIAL_ORIGIN,fetchImpl=globalThis.fetch,now=Date.now,onChange=()=>{},batchDelay=80,live=false}={}) {
    this.origin=serviceOrigin(origin);if(!this.origin)throw new Error('Use an HTTPS service origin, or HTTP on localhost.');
    // Native window.fetch requires its receiver; never invoke it as a client method.
    this.fetch=(...args)=>fetchImpl(...args);this.now=now;this.onChange=onChange;this.batchDelay=batchDelay;
    this.cosmeticCache=new Map();this.cosmeticRequests=new Map();
    this.cache=new Map();this.pending=new Map();this.inflight=new Set();this.controllers=new Set();this.timer=null;this.generation=0;this.closed=false;
    this.live=Boolean(live);this.feedTimer=null;this.feedEpoch=null;this.feedCursor=null;this.feedBaseline=null;this.feedOkAt=-Infinity;this.feedDelay=4000;
  }
  // A result fetched after the feed's baseline is covered by the feed: every
  // later change to it arrives as an event, so it can be trusted for longer.
  feedCovers(started){return this.live && this.feedBaseline!==null && started>=this.feedBaseline && this.now()-this.feedOkAt<10000;}
  timing(started,ok) {
    if(!ok)return {expires:started+5000,refreshAt:started+5000};
    return this.feedCovers(started) ? {expires:started+90000,refreshAt:started+60000} : {expires:started+12000,refreshAt:started+7000};
  }
  // Pull every result back to the short, fail-closed timings (feed lost or reset).
  degrade() {
    const time=this.now();this.feedBaseline=null;
    for(const map of [this.cache,this.cosmeticCache])for(const value of map.values()){value.refreshAt=Math.min(value.refreshAt,time);value.expires=Math.min(value.expires,time+12000);}
  }
  startFeed() {
    if(!this.live || this.closed || this.feedTimer!==null)return;
    this.feedTimer=setTimeout(()=>{this.feedTimer=null;void this.pollFeed();},0);
  }
  async pollFeed() {
    if(!this.live || this.closed)return;
    const generation=this.generation,controller=new AbortController();this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),4000);let delay=Math.min(30000,Math.max(4000,this.feedDelay*2));
    try {
      const query=new URLSearchParams({since:this.feedCursor===null?'':String(this.feedCursor),epoch:this.feedEpoch || ''});
      const response=await this.fetch(`${this.origin}/api/v1/changes?${query}`,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
      // Servers without the feed keep the plain revalidation timings.
      if(response.status===404){this.live=false;return;}
      const data=await readJSON(response);
      if(typeof data.epoch!=='string' || !Number.isInteger(data.cursor) || data.cursor<0 || !Array.isArray(data.identities) || !Array.isArray(data.cosmetics) || data.identities.length>1000 || data.cosmetics.length>1000)throw new Error('Invalid Nameflare changes.');
      if(generation!==this.generation || this.closed)return;
      if(data.reset || data.epoch!==this.feedEpoch) {
        // Unknown history: anything kept on long timings must be rechecked.
        if(this.feedEpoch!==null)this.degrade();
        this.feedBaseline=this.now();
      } else {
        const stale=new Set(data.identities.map(item=>identityKey(item?.provider,item?.provider_id)).filter(Boolean)),flares=new Set(data.cosmetics.filter(id=>typeof id==='string'));
        for(const [key,value]of this.cache)if(stale.has(key) || (value.cosmetic && flares.has(value.cosmetic.id))){value.refreshAt=0;const [provider,id]=key.split(':');this.queue(key,{provider,id});}
        for(const id of flares)if(this.cosmeticCache.has(id)){this.cosmeticCache.get(id).refreshAt=0;this.refreshCosmetic(id);}
      }
      // After a failed poll, an unbroken cursor means nothing was missed: results
      // fetched from now on are covered again.
      if(this.feedBaseline===null)this.feedBaseline=this.now();
      this.feedEpoch=data.epoch;this.feedCursor=data.cursor;this.feedOkAt=this.now();
      delay=Math.min(30000,Math.max(2000,Number.isFinite(data.poll_ms)?data.poll_ms:4000));
    } catch {
      if(generation===this.generation && !this.closed && this.feedBaseline!==null)this.degrade();
    } finally {
      clearTimeout(timer);this.controllers.delete(controller);this.feedDelay=delay;
      if(this.live && !this.closed && this.feedTimer===null)this.feedTimer=setTimeout(()=>{this.feedTimer=null;void this.pollFeed();},delay);
    }
  }
  async resolveCosmetic(query) {
    if(this.closed || typeof query!=='string' || !query.trim() || query.length>100)throw new Error('Enter a Nameflare paint name or ID.');
    const controller=new AbortController(),generation=this.generation;
    this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),4000);
    try {
      const options={credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal};
      const isId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(query);
      let cosmetic=null;
      if(isId) {
        const response=await this.fetch(`${this.origin}/api/v1/cosmetics/${encodeURIComponent(query)}`,options);
        if(response.status!==404)cosmetic=normalizeCosmetic((await readJSON(response)).cosmetic);
      }
      if(!cosmetic) {
        // Exact-name lookup; older servers answer 404 and fall back to search.
        const lookup=query.trim().length<=40 ? await this.fetch(`${this.origin}/api/v1/cosmetics/lookup?name=${encodeURIComponent(query.trim())}`,options) : null;
        if(lookup && lookup.status!==404) {
          const data=await readJSON(lookup);
          if(!Array.isArray(data.cosmetics) || data.cosmetics.length>100)throw new Error('Invalid Nameflare catalog.');
          cosmetic=normalizeCosmetic(data.cosmetics.find(p=>typeof p?.name==='string' && p.name.toLowerCase()===query.trim().toLowerCase()));
        }
      }
      if(!cosmetic && !isId) {
        const data=await readJSON(await this.fetch(`${this.origin}/api/v1/cosmetics?limit=100&q=${encodeURIComponent(query)}`,options));
        if(!Array.isArray(data.cosmetics) || data.cosmetics.length>100)throw new Error('Invalid Nameflare catalog.');
        const match=data.cosmetics.find(p=>p.id===query || (typeof p.name==='string' && p.name.toLowerCase()===query.toLowerCase()));
        cosmetic=normalizeCosmetic(match);
      }
      if(generation!==this.generation || this.closed)throw new Error('Nameflare settings changed. Try again.');
      if(!cosmetic)throw new Error('Approved Nameflare paint not found. Use its exact name or ID.');
      const time=this.now();
      this.cosmeticCache.set(cosmetic.id,{cosmetic,expires:time+12000,refreshAt:time+7000});
      while(this.cosmeticCache.size>1000)this.cosmeticCache.delete(this.cosmeticCache.keys().next().value);
      return cosmetic;
    } finally {clearTimeout(timer);this.controllers.delete(controller);}
  }
  getCosmetic(id) {
    if(this.closed)return null;
    const cached=this.cosmeticCache.get(id);
    if(cached && cached.expires>this.now()) {
      if(cached.refreshAt<=this.now())this.refreshCosmetic(id);
      return cached.cosmetic;
    }
    this.refreshCosmetic(id);
    return null;
  }
  refreshCosmetic(id) {
    if(!this.cosmeticRequests.has(id)) {
      const generation=this.generation;
      // Revalidate exact IDs only: a revoked selection must never resolve to a namesake.
      const started=this.now(),controller=new AbortController();this.controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),4000);
      const request=(async()=>{
        let cosmetic=null;
        try {cosmetic=normalizeCosmetic((await readJSON(await this.fetch(`${this.origin}/api/v1/cosmetics/${encodeURIComponent(id)}`,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}))).cosmetic);}
        catch { /* Fail closed, with the normal platform-color fallback. */ }
        finally {clearTimeout(timer);this.controllers.delete(controller);}
        if(generation!==this.generation || this.closed)return;
        if(cosmetic?.id!==id)cosmetic=null;
        const expires=started+(cosmetic?12000:5000);
        if(expires<=this.now())cosmetic=null;
        this.cosmeticCache.set(id,{cosmetic,expires,refreshAt:started+(cosmetic?7000:5000)});
        this.cosmeticRequests.delete(id);this.onChange(id,cosmetic);
      })();
      this.cosmeticRequests.set(id,request);
    }
  }
  get(provider,id) {
    const key=identityKey(provider,id);if(!key || this.closed)return null;
    this.startFeed();
    const cached=this.cache.get(key);
    if(cached && cached.expires>this.now()) {
      if(cached.refreshAt<=this.now())this.queue(key,{provider,id});
      return cached.cosmetic;
    }
    if(cached){this.cache.delete(key);this.onChange(key,null);}
    this.queue(key,{provider,id});
    return null;
  }
  queue(key,identity) {
    if(this.closed || this.inflight.has(key))return;
    this.pending.set(key,identity);
    if(this.timer===null)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.batchDelay);
  }
  expire() {
    if(this.closed)return;
    if(this.feedBaseline!==null && this.now()-this.feedOkAt>=10000)this.degrade();
    for(const [key,value]of this.cache) {
      if(value.expires<=this.now()){this.cache.delete(key);this.onChange(key,null);}
      else if(value.refreshAt<=this.now()) {
        const [provider,id]=key.split(':');this.queue(key,{provider,id});
      }
    }
  }
  async flush() {
    if(this.closed)return;
    if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
    const generation=this.generation;
    const queued=[...this.pending.entries()];this.pending.clear();
    for(const [key]of queued)this.inflight.add(key);
    for(const provider of ['twitch','kick','youtube']) {
      const group=queued.filter(([,value])=>value.provider===provider);
      for(let i=0;i<group.length;i+=100) {
        const chunk=group.slice(i,i+100),started=this.now(),controller=new AbortController();this.controllers.add(controller);
        const timeout=setTimeout(()=>controller.abort(),4000);let users=null;
        try {
          const response=await this.fetch(`${this.origin}/api/v1/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,ids:chunk.map(([,value])=>value.id)}),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
          const data=await readJSON(response);
          if(!Array.isArray(data.users) || data.users.length>100)throw new Error('Invalid Nameflare identities.');
          users=new Map();
          for(const user of data.users){const key=identityKey(user.provider,user.provider_id);if(user.provider===provider && chunk.some(([wanted])=>wanted===key))users.set(key,normalizeCosmetic(user.cosmetic));}
        }catch{ /* A failed refresh must never resurrect an expired paint. */ }
        finally{clearTimeout(timeout);this.controllers.delete(controller);}
        if(generation!==this.generation || this.closed)return;
        for(const [key]of chunk) {
          this.inflight.delete(key);
          const cosmetic=users?.get(key) || null,{expires,refreshAt}=this.timing(started,Boolean(users));
          this.cache.set(key,{cosmetic:expires>this.now()?cosmetic:null,expires,refreshAt});
          this.onChange(key,this.cache.get(key).cosmetic);
        }
        while(this.cache.size>1000){const key=this.cache.keys().next().value;this.cache.delete(key);this.onChange(key,null);}
      }
    }
  }
  clear() {
    this.generation++;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;
    for(const controller of this.controllers)controller.abort();this.controllers.clear();this.pending.clear();this.inflight.clear();
    this.cosmeticCache.clear();this.cosmeticRequests.clear();this.feedBaseline=null;this.feedEpoch=null;this.feedCursor=null;
    const keys=[...this.cache.keys()];this.cache.clear();for(const key of keys)this.onChange(key,null);
  }
  close(){this.closed=true;if(this.feedTimer!==null)clearTimeout(this.feedTimer);this.feedTimer=null;this.clear();}
}
