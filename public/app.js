import { applyCosmetic, updateCosmeticText, createFrameUpdate, createPreviewNameBinding } from './renderer.js';
import { paintPalette } from './paints.js';
import { currentRoute, navigate, installNavigation, preserveFeedScroll, isAppPath } from './routes.js';
import { initializeEditor, downloadDesign, presets } from './editor.js';
import { createLikeController } from './likes.js';
import { compactNumber, timeAgo, copyText, shareLink, AVATAR_HOSTS as avatarHosts, avatarImage } from './social.js';
import { initPreferences, openPreferences, cycleTheme } from './preferences.js';
import { renderInsights } from './insights.js';
import { setupDonate, renderDonate } from './donate.js';
import { loadRail, wireRailFilters, setRailStats, refreshRailIdentity } from './rail.js';
import { moveFeedIndicator, initFeedGeometry, initScrollState } from './experience.js';
const $ = selector => document.querySelector(selector);
const searchValue = () => String($('#catalog-search')?.value ?? '');
const previewName = () => String($('#catalog-name')?.value ?? $('#catalog-name')?.getAttribute('value') ?? '').trim();
const heroName = () => String($('#hero-preview-name')?.value ?? $('#hero-preview-name')?.getAttribute('value') ?? '').trim();
const state = { config:null,user:null,csrf:null,bootstrapped:false,likedIds:new Set(),followingIds:new Set(),followingCosmetics:[],followingNext:null,followingLoaded:false,likedOnly:false,feed:'discover',catalogLoaded:false,likedTotal:0,cosmetics:[],next:null,filter:'all',view:'discover',catalogPaused:false,collectionFilter:'all',mine:[],pendingEquip:null,reviewStatus:'pending',reviewQuery:'',reviewOffset:0,userQuery:'',userOffset:0,userStatus:'all',banQuery:'',banOffset:0,profileQuery:'',profileOffset:0,artistQuery:'',artistOffset:0,artistPaused:false,unread:0,notifications:[],notificationsNext:null,reportStatus:'open',reviewFilter:'all',reviewSort:'oldest',bulk:new Set(),liveSince:null,claims:[],decided:new Map(),knownPending:null,claimTarget:null,reportsStale:false };
history.scrollRestoration = 'manual';
// Web Awesome owns the interactive primitives. The helpers below create real
// custom elements so every generated control keeps the framework's semantics,
// focus handling, disabled state, and form participation.
function platformLogo(provider) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('platform-logo',`logo-${provider}`);svg.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`#logo-${provider}`);svg.append(use);return svg;
}
function icon(name,cls='') {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class',`ui-icon ${cls}`);svg.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`#icon-${name}`);svg.append(use);return svg;
}
const providerNames = { twitch:'Twitch', kick:'Kick', youtube:'YouTube' };
function avatar(profile, cls='') {
  const name=profile?.name || profile?.display_name || 'N';
  const fallback=name.slice(0,1).toUpperCase();
  const element=node('wa-avatar',`avatar ${cls}`);
  element.setAttribute('aria-hidden','true');element.setAttribute('initials',fallback);element.setAttribute('loading','lazy');
  let hue=0;for(const character of name)hue=(hue*31+character.codePointAt(0))%360;
  element.style.setProperty('--avatar-hue',String(hue));
  const image=avatarImage(profile);if(image)element.setAttribute('image',image);
  return element;
}
function moderatorBadge(user) {
  if(user.is_moderator!==true && user.role!=='moderator')return null;
  const badge=node('span','moderator-badge','Moderator');badge.prepend(icon('moderation'));badge.append(node('span','sr-only',' · Nameflare community role, not a platform chat role'));
  badge.title='Nameflare community moderator · not a platform chat role';return badge;
}
function artistBadge(user) {
  if(user.is_artist!==true && user.role!=='artist')return null;
  const badge=node('span','artist-badge','Artist');badge.prepend(icon('studio'));badge.append(node('span','sr-only',' · Nameflare creator role, not a platform chat role'));
  badge.title='Nameflare artist · up to 20 submitted Flares · not a platform chat role';return badge;
}
function date(value) { return value ? new Date(value).toLocaleString() : 'Not reviewed yet'; }
function fact(label, value) { const item=node('div');item.append(node('dt','',label),node('dd','',value));return item; }
let editor;
const hasTexture = cosmetic => Boolean(cosmetic.recipe.textureId || cosmetic.recipe.layers?.some(layer => layer.type === 'image'));
function node(tag, cls, content) {
  const el = document.createElement(tag); if (cls) el.className = cls; if (content !== undefined) el.textContent = content; return el;
}
function controlLabel(element,label) {
  const arrow=typeof label==='string' && /[↗→↓↑]$/.test(label);
  const check=typeof label==='string' && /✓$/.test(label);
  element.textContent=(arrow || check)?label.slice(0,-1).trimEnd():label;
  if(arrow)element.append(icon('arrow',label.endsWith('↗')?'arrow-external':label.endsWith('↓')?'arrow-down':label.endsWith('↑')?'arrow-up':''));
  else if(check)element.append(icon('check','check-icon'));
  return element;
}
for(const button of document.querySelectorAll('.button')) {
  if(!button.querySelector('svg') && /[↗→↓]$/.test(button.textContent))controlLabel(button,button.textContent);
}
// Focus inside a Web Awesome field lives in its shadow root, so walk down to
// the real focused element and treat field hosts themselves as typing targets.
const typingSelector='input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]),textarea,select,[contenteditable=""],[contenteditable="true"],wa-input,wa-textarea,wa-select,wa-combobox';
function isTyping(event) {
  const path=event?.composedPath?.() || [];
  if(path.some(node=>node instanceof Element && (node.matches(typingSelector) || node.isContentEditable)))return true;
  let element=document.activeElement;
  while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;
  if(!element)return false;
  if(element.isContentEditable || element.matches?.(typingSelector))return true;
  for(let host=element;host;host=host.getRootNode?.()?.host){if(host.closest?.(typingSelector))return true;}
  return false;
}
// Web Awesome is the primitive layer. `action` returns a real <wa-button> and
// keeps Nameflare's legacy class names for layout-specific styling.
function action(label, fn, cls='button subtle') {
  const button = node('wa-button');
  button.className = cls.split(/\s+/).filter(name => name && name !== 'button').join(' ');
  button.setAttribute('type','button');
  if (/\bprimary\b/.test(cls)) { button.setAttribute('variant','brand'); button.setAttribute('appearance','filled'); }
  else if (/\bdanger\b/.test(cls)) { button.setAttribute('variant','brand'); button.setAttribute('appearance','filled'); button.classList.add('danger'); }
  else if (/\bghost\b/.test(cls)) button.setAttribute('appearance','plain');
  else button.setAttribute('appearance','outlined');
  if (/\b(sm|small)\b/.test(cls)) button.setAttribute('size','s');
  if (/\bxs\b/.test(cls)) button.setAttribute('size','xs');
  controlLabel(button,label);
  button.addEventListener('click',() => run(async()=>{if(button.disabled)return;button.disabled=true;try{await fn();}finally{if(button.isConnected)button.disabled=false;}}));
  return button;
}
function link(label,href,cls='button primary') {
  if(!cls.includes('button')){const el=node('a',cls,label);el.href=href;return el;}
  const el=node('wa-button',cls);el.setAttribute('href',href);
  if(/\bprimary\b/.test(cls)){el.setAttribute('variant','brand');el.setAttribute('appearance','filled');}
  else if(/\bdanger\b/.test(cls)){el.setAttribute('variant','brand');el.setAttribute('appearance','filled');el.classList.add('danger');}
  else if(/\bghost\b/.test(cls))el.setAttribute('appearance','plain');
  else if(/\bsubtle\b/.test(cls))el.setAttribute('appearance','outlined');
  if(/\bxs\b/.test(cls))el.setAttribute('size','xs');
  else if(/\b(sm|small)\b/.test(cls))el.setAttribute('size','s');
  controlLabel(el,label);return el;
}
function empty(container,title,description,href='/studio',label='Create a Flare') {
  const el=node('div','empty-state'); el.append(node('h3','',title),node('p','',description)); if(href) el.append(link(label,href));container.replaceChildren(el);
}
// Toasts live in a manual popover so they sit above open dialogs (the top
// layer); re-showing moves the stack above a dialog opened after it.
function showToastLayer(stack) {
  if(!stack.showPopover)return;
  try{if(stack.matches(':popover-open')){if(!document.querySelector('dialog[open]'))return;stack.hidePopover();}stack.showPopover();}catch{}
}
// Open once at start so the live region is always in the accessibility tree.
{const stack=document.getElementById('toasts');if(stack)showToastLayer(stack);}
function toast(message,error=false,retry=null,options={}) {
  const stack=$('#toasts');if(!stack)return;
  const key=options.key || message;for(const old of stack.querySelectorAll('.toast'))if(old.dataset.toastKey===key)old.remove();
  const item=node('div',`toast${error?' error':''}`),timer={id:null};let closing=false;item.dataset.toastKey=key;
  const close=()=>{
    if(closing)return;
    closing=true;clearTimeout(timer.id);item.classList.add('is-leaving');
    setTimeout(()=>item.remove(),150);
  };
  const addAction=(label,fn)=>{const button=controlLabel(node('button','toast-retry'),label);button.type='button';button.addEventListener('click',()=>{close();run(fn);});item.append(button);};
  item.dataset.toastInitialized='true';
  item.style.setProperty('--toast-duration',`${options.duration ?? (error?7000:5600)}ms`);
  item.append(icon(error?'close':'check','toast-icon'),node('span','toast-message',message));
  if(retry)addAction('Retry',retry);
  if(options.action)addAction(options.action.label,options.action.fn);
  const dismiss=node('button','toast-dismiss','×');dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss message');dismiss.addEventListener('click',close);item.append(dismiss);
  showToastLayer(stack);stack.append(item);
  while(stack.children.length>3)stack.firstElementChild.remove();
  timer.id=setTimeout(close,options.duration ?? (error?7000:5600));
}
async function run(fn) { try { await fn(); } catch(error) { toast(error.message,true); } }
const wait=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
async function api(path,data,signal) {
  const options = data === undefined ? {cache:'no-store',signal} : {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf || ''},body:JSON.stringify(data)};
  // Reads retry by themselves when the server is busy (429/503, honouring
  // Retry-After) or the connection blips, instead of leaving an empty page.
  for(let attempt=0;;attempt++){
    let response;
    try{response=await fetch(path,options);}
    catch(error){if(error.name==='AbortError' || data!==undefined || attempt>=2)throw error;await wait(600*(attempt+1),signal);continue;}
    if(data===undefined && attempt<2 && [429,502,503,504].includes(response.status)){
      const after=Number(response.headers.get('Retry-After'));await wait(Math.min(8000,Number.isFinite(after) && after>0?after*1000:1000*(attempt+1)),signal);continue;
    }
    let result;try{result=await response.json();}catch{result={};}
    if(!response.ok){const error=new Error(result.error || (response.status===429?'Lots of activity right now. Try again in a moment.':'Request failed.'));error.status=response.status;error.conflict=result.conflict;throw error;}
    return result;
  }
}
async function refreshAccount() {
  const result=await api('/api/me');if(state.user?.id!==result.user?.id){likes.reset();follows.reset();state.catalogLoaded=false;state.followingLoaded=false;state.followingCosmetics=[];state.followingNext=null;}state.user=result.user;state.csrf=result.csrf;state.unread=Number(result.notifications_unread || 0);
  state.followingIds=new Set(result.following_ids || []);
  for(const button of document.querySelectorAll('[data-follow-id]')){const value=follows.get(button.dataset.followId);if(value?.pending){if(value.liked)state.followingIds.add(value.id);else state.followingIds.delete(value.id);}follows.observe(button.dataset.followId,0,state.followingIds.has(button.dataset.followId));updateFollowButton(button);button.hidden=state.user?.id===button.dataset.followId;}
  $('#following-total').textContent=String(state.followingIds.size);
  for(const count of document.querySelectorAll('[data-following-count]')) count.textContent=String(state.followingIds.size);
  const composer=$('.composer-avatar');
  if(composer) composer.replaceWith(Object.assign(avatar({name:result.user?.name,avatar_url:result.user?.avatar_url,profile_provider:result.user?.profile_provider},'composer-avatar'),{className:'avatar composer-avatar'}));
  state.likedIds=new Set(result.liked_ids || []);
  for(const button of document.querySelectorAll('[data-like-id]')){const value=likes.get(button.dataset.likeId);if(value?.pending){if(value.liked)state.likedIds.add(value.id);else state.likedIds.delete(value.id);}}
  state.likedTotal=state.likedIds.size;
  $('#likes-total').textContent=String(state.likedTotal);
  for(const button of document.querySelectorAll('[data-like-id]')){likes.observe(button.dataset.likeId,Number(button.dataset.likeCount),state.likedIds.has(button.dataset.likeId));updateLikeButton(button);}
  document.body.classList.toggle('is-signed-in',Boolean(state.user));
  $('#sidebar-account').hidden=!state.user;
  $('#signin-button').hidden=Boolean(state.user);
  $('#signin-button').replaceChildren(document.createTextNode('Sign in'));$('#signin-button').title='Sign in';$('#signin-button').setAttribute('aria-label','Sign in');
  const topAvatar=$('#topbar-avatar');
  if(topAvatar){
    topAvatar.setAttribute('initials',(state.user?.name || 'N').slice(0,1).toUpperCase());topAvatar.setAttribute('label',state.user?.name || 'Your account');
    let avatarUrl='';try{const url=new URL(state.user?.avatar_url);if(url.protocol==='https:' && !url.username && !url.password && !url.port && avatarHosts[state.user?.profile_provider || state.user?.provider]?.includes(url.hostname))avatarUrl=url.href;}catch{}
    if(avatarUrl)topAvatar.setAttribute('image',avatarUrl);else topAvatar.removeAttribute('image');
    let hue=0;for(const character of state.user?.name || 'N')hue=(hue*31+character.codePointAt(0))%360;topAvatar.style.setProperty('--avatar-hue',String(hue));
  }
  $('#topbar-account').hidden=!state.user;$('#topbar-signin').hidden=Boolean(state.user);
  $('#topbar-account').setAttribute('aria-label',state.user?`Open ${state.user.name}’s account`:'Your account');
  $('[data-nav="moderation"]').hidden=!['owner','moderator'].includes(state.user?.role);
  if(!['owner','moderator'].includes(state.user?.role))$('#mod-badge').hidden=true;
  const label=$('#account-label');label.replaceChildren(document.createTextNode(state.user?.name || 'Your account'),node('small','',state.user ? `${state.user.role} account`:'Sign in to get started'));
  $('.account-button .avatar').replaceWith(avatar(state.user));
  for(const sync of previewNameBindings)sync(state.user);
  const value=heroName();
  for(const selector of ['#hero-name','#hero-display-name'])updateCosmeticText($(selector),value);
  updateCatalogNames();editor?.syncAccountName();updateNotificationBadge();syncShellHint();refreshModBadge();
  // Cards are reused across renders; keep every Equip control true to the account.
  syncAllEquipButtons(false);
}
// Staff see the pending-review count in the nav as soon as the page loads, not only after opening Moderation.
async function refreshModBadge(){
  const badge=$('#mod-badge');if(!badge)return;
  if(!['owner','moderator'].includes(state.user?.role)){badge.hidden=true;return;}
  try{
    const [result,reports]=await Promise.all([api('/api/admin/queue?status=pending&q=&offset=0'),state.config?.features?.reports?api('/api/admin/reports?status=open&offset=0').catch(()=>null):null]);
    const pending=Number(result?.stats?.pending||0),open=Number(reports?.open||0),total=pending+open;
    badge.textContent=String(total);badge.hidden=total===0;badge.title=`${pending} awaiting review · ${open} open ${open===1?'report':'reports'}`;
  }catch{}
}
// Remember the header's shape for the next first paint (see theme-init.js), then let the real state rule.
function syncShellHint(){
  const shell={signed:Boolean(state.user),staff:['owner','moderator'].includes(state.user?.role),demo:Boolean(state.config?.demo)};
  try{localStorage.setItem('nameflare.shell.v1',JSON.stringify(shell));}catch{}
  document.documentElement.dataset.shellReady='';
}
const notificationsDialog=$('#notifications-dialog');
function updateNotificationBadge() {
  const button=$('#notifications-open'),available=Boolean(state.user && state.config?.features?.notifications);
  if(!button)return;button.hidden=!available;
  const count=$('#notification-count');count.hidden=!state.unread;count.textContent=state.unread>99?'99+':String(state.unread);
  button.setAttribute('aria-label',state.unread?`Notifications, ${state.unread} unread`:'Notifications');
}
function notificationText(item) {
  const actor=item.actor?.name || 'Someone';
  if(item.kind==='like')return { title:`${actor} liked your Flare`,detail:item.detail || 'Your work is getting noticed.' };
  if(item.kind==='follow')return { title:`${actor} started following you`,detail:'Your newest public Flares now appear in their Following feed.' };
  if(item.kind==='approved')return { title:'Your Flare was approved',detail:item.detail ? `“${item.detail}” is live. Open it to wear or share it.` : 'It is live. Open it to wear or share it.' };
  if(item.kind==='rejected')return { title:'Your Flare needs changes',detail:item.detail ? `See the reviewer’s note on “${item.detail}” and revise it.` : 'See the reviewer’s note and revise it.' };
  if(item.kind==='role')return { title:'Your Nameflare role changed',detail:item.detail || 'Open your account to see what changed.' };
  return { title:`${actor} interacted with your work`,detail:item.detail || '' };
}
function notificationHref(item) {
  if(item.kind==='like' && item.target)return `/discover/${encodeURIComponent(item.target)}`;
  if(item.kind==='follow')return item.target?`/profiles/${encodeURIComponent(item.target)}`:'/profiles';
  if(item.kind==='rejected')return '/collection';
  if(item.kind==='approved')return item.target?`/discover/${encodeURIComponent(item.target)}`:'/collection';
  return '/account';
}
function renderNotifications() {
  const list=$('#notifications-list');if(!list)return;list.replaceChildren();
  const read=$('#notifications-read');read.hidden=state.unread===0;read.disabled=state.unread===0;read.textContent=`Mark all read (${state.unread})`;
  if(!state.notifications.length){const blank=node('div','notification-empty');blank.append(node('strong','','Nothing yet.'),node('p','','Likes, follows, and review decisions will land here.'));list.append(blank);return;}
  for(const item of state.notifications){
    const text=notificationText(item),row=node('a',`notification-item${item.read?'':' unread'}`);row.href=notificationHref(item);
    const copy=node('div','notification-copy');copy.append(node('strong','',text.title));if(text.detail)copy.append(node('p','',text.detail));
    const meta=node('div','notification-meta');if(!item.read)meta.append(node('span','notification-unread'));const time=node('time','notification-time',timeAgo(item.created_at));time.dateTime=item.created_at;meta.append(time);
    row.append(avatar(item.actor || {}),copy,meta);
    row.addEventListener('click',()=>{
      if(item.kind==='rejected')state.collectionFilter='rejected';
      notificationsDialog.close();
      if(item.read)return;
      item.read=true;state.unread=Math.max(0,state.unread-1);updateNotificationBadge();
      api('/api/notifications/read',{id:item.id}).then(result=>{state.unread=result.unread;updateNotificationBadge();}).catch(()=>{});
    });
    list.append(row);
  }
  if(state.notificationsNext!==null && state.notificationsNext!==undefined){
    const more=action('Load older activity',loadNotificationsMore,'button subtle notification-more');more.dataset.notificationMore='';
    list.append(more);
  }
}
async function loadNotificationsMore() {
  const more=document.querySelector('[data-notification-more]');
  if(more){more.disabled=true;more.textContent='Loading older activity…';}
  try {
    const result=await api(`/api/notifications?limit=30&offset=${encodeURIComponent(state.notificationsNext || 0)}`);
    if(!notificationsDialog.open)return;
    const seen=new Set(state.notifications.map(item=>item.id));
    for(const item of result.notifications || [])if(!seen.has(item.id))state.notifications.push(item);
    state.notificationsNext=result.next_offset;state.unread=Number(result.unread || 0);updateNotificationBadge();renderNotifications();
  } catch(error) {
    if(more){more.disabled=false;more.textContent='Load older activity';}
    toast(error.message,true);
  }
}
async function loadNotifications() {
  if(!state.user){openSignIn();return;}
  if(!notificationsDialog.open)notificationsDialog.showModal();
  const list=$('#notifications-list');list.replaceChildren(node('p','form-footnote','Loading activity…'));
  try {
    const result=await api('/api/notifications?limit=30');if(!notificationsDialog.open)return;
    state.notifications=result.notifications || [];state.unread=Number(result.unread || 0);state.notificationsNext=result.next_offset;updateNotificationBadge();renderNotifications();
  } catch(error) {
    if(!notificationsDialog.open)return;
    const blank=node('div','notification-empty');blank.append(node('strong','','Couldn’t load activity.'),node('p','',error.message));blank.append(action('Try again',loadNotifications,'button subtle'));list.replaceChildren(blank);
  }
}
async function pollNotifications() {
  refreshModBadge();
  if(!state.user || !state.config?.features?.notifications || document.hidden || notificationsDialog.open)return;
  try { const result=await api('/api/notifications?limit=1');if(result.unread!==state.unread){state.unread=Number(result.unread || 0);updateNotificationBadge();} } catch {}
}
setInterval(pollNotifications,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollNotifications();});
// Sign-in continuity (Baymard: 34% of sites lose the person's place). Remember
// why sign-in was asked and where from; after signing in (demo or a real OAuth
// round trip, which returns to /account) go back there and finish the action.
const INTENT_KEY='nameflare.intent';
function rememberIntent(kind,id=''){try{sessionStorage.setItem(INTENT_KEY,JSON.stringify({kind,id,route:currentRoute(),at:Date.now()}));}catch{}}
function peekIntent(){try{const value=JSON.parse(sessionStorage.getItem(INTENT_KEY)||'null');return value && Date.now()-value.at<15*60*1000?value:null;}catch{return null;}}
function takeIntent(){const value=peekIntent();try{sessionStorage.removeItem(INTENT_KEY);}catch{}return value;}
async function resumeIntent() {
  const intent=takeIntent();if(!intent || !state.user)return;
  if(intent.route && intent.route!==currentRoute() && isAppPath(intent.route)){navigate(intent.route);await new Promise(resolve=>setTimeout(resolve,60));}
  if(intent.kind==='equip' && intent.id)await equip(intent.id);
  if(intent.kind==='publish'){if(currentRoute()!=='/studio')navigate('/studio');editor.openPublish();}
}
const signInCopy={
  equip:'Sign in to wear this Flare. It goes on the moment you’re back.',
  publish:'Sign in to submit your Flare. Your design is saved and waits right here.',
  follow:'Sign in to follow this creator. We’ll finish your follow when you’re back.',
  like:'Sign in to save this Flare. We’ll finish saving it when you’re back.',
};
function openSignIn(intent) {
  if(intent==='publish')rememberIntent('publish');
  const options=$('#signin-options');options.replaceChildren();
  $('#signin-title').textContent=intent==='publish'?'Sign in to submit.':intent==='equip'?'Sign in to wear it.':'Sign in to Nameflare.';
  $('#signin-description').textContent=signInCopy[intent] || 'One account for your Flares, saves, and connected platforms. No password needed.';
  if(state.config.demo) {
    options.append(node('p','','Demo accounts only. No real OAuth or production access.'));
    for(const [role,label,hue] of [['creator','Creator · lumi',128],['owner','Owner · orbit',205],['mod','Moderator · nova',282]]) {
      const option=action(label,async() => {
        await api('/api/demo/login',{role});await refreshAccount();$('#signin-dialog').close();setNavigationOpen(false);editor.accountChanged();state.catalogLoaded=false;await renderView();toast(`Signed in as ${state.user.name} (demo)`);await resumeLikeIntent();await resumeFollowIntent();state.pendingEquip=null;await resumeIntent();
      },'button subtle');
      const badge=node('span','avatar demo-avatar',label.split('· ').at(-1)[0].toUpperCase());badge.style.setProperty('--avatar-hue',String(hue));option.prepend(badge);options.append(option);
    }
  } else {
    for(const [provider,title] of [['twitch','Twitch'],['kick','Kick'],['youtube','YouTube']]) {
      if(state.config.providers[provider]) {const option=link(`Continue with ${title} ↗`,`/auth/${provider}`,'button subtle');option.prepend(platformLogo(provider));option.addEventListener('click',()=>{if(!peekIntent())rememberIntent('return');if(state.view==='studio')editor.saveDraftQuietly();});options.append(option);}
      else { const button=node('button','button subtle',`${title} · setup required`);button.prepend(platformLogo(provider));button.disabled=true;options.append(button); }
    }
    if(!Object.values(state.config.providers).some(Boolean)) options.append(node('p','','The operator needs to configure OAuth credentials first. You can still try the editor without signing in.'));
  }
  $('#signin-dialog').showModal();
}
function accountClick() { if(state.user) navigate('/account');else openSignIn(); }
$('.skip-link').addEventListener('click',event=>{
  event.preventDefault();$('#main-content').focus({preventScroll:true});$('#main-content').scrollIntoView({block:'start'});
});
const appRail=$('.app-rail'),navToggle=$('#nav-toggle'),mobileNavigation=matchMedia('(max-width: 1000px)');
let navigationScroll=0,navigationScrollX=0,navigationLocked=false;
function lockNavigationPage() {
  if(navigationLocked)return;
  navigationScroll=window.scrollY;navigationScrollX=window.scrollX;navigationLocked=true;
  document.body.style.top=`-${navigationScroll}px`;
  document.body.classList.add('navigation-open');
}
function unlockNavigationPage() {
  if(!navigationLocked)return;
  navigationLocked=false;
  document.body.classList.remove('navigation-open');
  document.body.style.top='';
  window.scrollTo({top:navigationScroll,left:navigationScrollX,behavior:'instant'});
}
function navigationFocusables() {
  return [...appRail.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter(element => {
    const style=getComputedStyle(element);
    return element.getClientRects().length && style.visibility!=='hidden' && style.display!=='none';
  });
}
function setNavigationOpen(open) {
  if(open && !mobileNavigation.matches)open=false;
  appRail.classList.toggle('menu-open',open);
  if(open)lockNavigationPage();else unlockNavigationPage();
  navToggle.setAttribute('aria-expanded',String(open));
  const toggleIcon=$('#nav-toggle svg use'),toggleLabel=$('#nav-toggle .sr-only');
  if(toggleIcon)toggleIcon.setAttribute('href',open?'#icon-close':'#icon-menu');
  if(toggleLabel)toggleLabel.textContent=open?'Close menu':'Menu';
  const shell=$('.app-shell'),tabbar=$('.mobile-tabbar');
  if(open){
    appRail.scrollTop=0;
    shell?.setAttribute('inert','');
    tabbar?.setAttribute('inert','');
    requestAnimationFrame(()=>{
      if(!appRail.classList.contains('menu-open'))return;
      const firstLink=[...appRail.querySelectorAll('#site-navigation a')].find(link=>link.getClientRects().length);
      firstLink?.focus({preventScroll:true});
    });
  }else{
    shell?.removeAttribute('inert');
    tabbar?.removeAttribute('inert');
    if(appRail.contains(document.activeElement))navToggle.focus({preventScroll:true});
  }
  // The mobile menu sheet shows every secondary page; the desktop popover stays closed.
  $('.resource-menu').open=open;
}
navToggle.addEventListener('click',()=>setNavigationOpen(navToggle.getAttribute('aria-expanded')!=='true'));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && navToggle.getAttribute('aria-expanded')==='true') {
    setNavigationOpen(false);navToggle.focus();
  }else if(event.key==='Tab' && appRail.classList.contains('menu-open')){
    const items=navigationFocusables();if(!items.length)return;
    const first=items[0],last=items.at(-1);
    if(event.shiftKey && (document.activeElement===first || !appRail.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey && (document.activeElement===last || !appRail.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
});
mobileNavigation.addEventListener('change',()=>{if(!mobileNavigation.matches)setNavigationOpen(false);});
$('#site-navigation').addEventListener('click',event=>{
  if(event.target.closest('a')) {
    setNavigationOpen(false);$('.resource-menu').open=false;
    if(getComputedStyle($('#nav-toggle')).display!=='none')$('#main-content').focus({preventScroll:true});
  }
});
document.addEventListener('click',event=>{
  if(!$('.app-rail').classList.contains('menu-open'))return;
  if(event.target.closest('#nav-toggle, #site-navigation, .topbar'))return;
  setNavigationOpen(false);
});
$('#signin-button').addEventListener('click',accountClick);$('#sidebar-account').addEventListener('click',accountClick);$('#topbar-account').addEventListener('click',accountClick);$('#topbar-signin').addEventListener('click',()=>openSignIn());$('#command-open-mobile').addEventListener('click',()=>$('#command-open').click());
const resourceMenu=$('.resource-menu');
document.addEventListener('click',event=>{if(resourceMenu.open && !resourceMenu.contains(event.target) && !$('.app-rail').classList.contains('menu-open'))resourceMenu.open=false;});
resourceMenu.querySelector('.menu-panel')?.addEventListener('click',event=>{if(event.target.closest('button.resource-link, #rail-mood-open, a'))resourceMenu.open=false;});
resourceMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();resourceMenu.open=false;if(getComputedStyle($('#nav-toggle')).display!=='none'){setNavigationOpen(false);$('#nav-toggle').focus();}else resourceMenu.querySelector('summary').focus();}});
const commandDialog=$('#command-dialog'),commandQuery=$('#command-query');
const destinations=[['Discover','/discover','discover','Browse the collection'],['Following','/following','profiles','Your creators'],['Creators','/profiles','profiles','Find your people'],['Artists','/artists','studio','Artist showcase'],['Flare studio','/studio','studio','Create a Flare'],['My collection','/collection','collection','Your submissions'],['Insights','/analytics','insights','Your numbers & growth'],['My account','/account','account','Profile & connections'],['Guide','/guide','guide','Learn the basics'],['Integrations & API','/integrations','integrations','Take it to chat'],['Support Nameflare','/donate','donate','Donate to the project'],['Moderation','/moderation','moderation','Community workspace']];
function commandAction(label,description,iconName,fn) {
  const button=node('button','command-destination');button.type='button';button.prepend(icon(iconName));button.append(node('span','',label),node('small','',description));button.addEventListener('click',()=>{commandDialog.close();fn();});return button;
}
function renderCommands() {
  const query=commandQuery.value.trim().toLowerCase(),results=$('#command-results');results.replaceChildren();
  const matches=text=>!query || text.toLowerCase().includes(query),pages=document.createDocumentFragment();
  for(const [label,href,iconName,description] of destinations) {
    if(href==='/moderation' && !['owner','moderator'].includes(state.user?.role))continue;
    if(href==='/artists' && state.config?.runtime==='cloudflare')continue;
    if(href==='/analytics' && state.config?.features?.insights===false)continue;
    if(!matches(`${label} ${description}`))continue;
    const option=link(label,href,'command-destination');option.prepend(icon(iconName));option.append(node('small','',description));option.addEventListener('click',()=>commandDialog.close());pages.append(option);
  }
  const actions=[];
  if(matches('appearance theme themes color colour density motion preferences'))actions.push(commandAction('Appearance & themes','Colors, density, interface motion','palette',openPreferences));
  if(matches('cycle theme change color colour'))actions.push(commandAction('Cycle theme','Move to the next color mood','palette',()=>{const next=cycleTheme();toast(`${next.name} theme applied.`);}));
  if(state.user && state.config?.features?.notifications && matches('notifications activity likes follows'))actions.push(commandAction('Notifications','Recent likes, follows, and reviews','bell',loadNotifications));
  if(matches('keyboard shortcuts keys help'))actions.push(commandAction('Keyboard shortcuts','Every shortcut in one place','guide',openShortcuts));
  if(matches('share page link copy'))actions.push(commandAction('Share this page','Use the share sheet or copy a link','share',()=>run(shareCurrentPage)));
  // With no query, surface actions first so theme, share, and shortcuts are not
  // buried below long navigation lists. Typed searches keep pages first.
  if(query) results.append(pages, ...actions); else results.append(...actions, pages);
  if(query) {const search=action(`Search Flares for “${commandQuery.value.trim()}”`,searchFromCommand,'command-destination');search.prepend(icon('search'));results.append(search);}
}
async function searchFromCommand() {
  const query=commandQuery.value.trim();commandDialog.close();$('#catalog-search').value=query;
  state.feed='discover';state.likedOnly=false;state.catalogLoaded=false;updateFeedControls();
  history.replaceState(null,'','/discover');await renderView();
  $('#community').scrollIntoView({behavior:'auto',block:'start'});$('#catalog-search').focus({preventScroll:true});
}
function openCommands() {
  if(commandDialog.open){commandDialog.close();return;}
  if(document.querySelector('dialog[open]'))return;
  commandQuery.value='';renderCommands();commandDialog.showModal();commandQuery.focus();
}
$('#command-open').addEventListener('click',openCommands);$('#command-close').addEventListener('click',()=>commandDialog.close());
$('#command-menu')?.addEventListener('click',()=>{resourceMenu.open=false;openCommands();});
commandQuery.addEventListener('input',renderCommands);
commandQuery.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(commandQuery.value.trim())run(searchFromCommand);else $('#command-results a')?.click();}else if(event.key==='ArrowDown'){event.preventDefault();$('#command-results :is(a,button)')?.focus();}});
$('#command-results').addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;const options=[...$('#command-results').querySelectorAll('a,button')],index=options.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);if(next<0)commandQuery.focus();else options[Math.min(next,options.length-1)]?.focus();});
document.addEventListener('keydown',event=>{if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k'){event.preventDefault();openCommands();}});
const commandKbd=$('#command-open kbd');if(commandKbd)commandKbd.textContent=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
const commandTooltip=document.querySelector('wa-tooltip[for="command-open"]');if(commandTooltip && commandKbd)commandTooltip.textContent=`Search · ${commandKbd.textContent}`;
$('#demo-switch').addEventListener('click',openSignIn);$('#close-signin').addEventListener('click',() => $('#signin-dialog').close());
$('#close-detail').addEventListener('click',() => $('#detail-dialog').close());
$('#notifications-open').addEventListener('click',loadNotifications);$('#close-notifications').addEventListener('click',()=>notificationsDialog.close());
$('#notifications-read').addEventListener('click',()=>run(async()=>{const result=await api('/api/notifications/read',{});state.unread=Number(result.unread||0);for(const item of state.notifications)item.read=true;updateNotificationBadge();renderNotifications();toast('All caught up.');}));
let detailOrigin=null,detailReturnHash='/discover';
$('#detail-dialog').addEventListener('close',()=>{
  if(currentRoute().startsWith('/discover/')){
    const returnRoute=history.state?.detailReturnRoute || detailReturnHash;
    history.replaceState(null,'',returnRoute);
    if(renderedRoute!==returnRoute)run(renderRoute);
  }
  if(detailOrigin?.isConnected)detailOrigin.focus({preventScroll:true});detailOrigin=null;detailReturnHash='/discover';
});
for(const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click',event => {if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)dialog.close();}});

const likes=createLikeController({
  send:(id,liked)=>api('/api/cosmetics/like',{id,liked}),
  onChange:value=>{
    const changed=state.likedIds.has(value.id)!==value.liked;
    if(changed)state.likedTotal=Math.max(0,state.likedTotal+(value.liked?1:-1));
    if(value.liked)state.likedIds.add(value.id);else state.likedIds.delete(value.id);
    $('#likes-total').textContent=String(state.likedIds.size);
    if(changed){const creatorId=[...document.querySelectorAll('[data-paint-id]')].find(card=>card.dataset.paintId===value.id)?.dataset.creatorId;
      for(const profile of document.querySelectorAll('[data-profile-id]'))if(profile.dataset.profileId===creatorId){const count=profile.querySelector('[data-stat="likes"]');if(count)count.textContent=String(Math.max(0,Number(count.textContent)+(value.liked?1:-1)));}
    }
    for(const paint of [...state.cosmetics,...state.mine])if(paint.id===value.id)paint.like_count=value.count;
    for(const button of document.querySelectorAll('[data-like-id]'))if(button.dataset.likeId===value.id){button.dataset.likeCount=String(value.count);updateLikeButton(button);}
  },
  onError:(error,id)=>toast(error.status===401?'Your session expired. Sign in and try again.':`Like wasn’t saved. ${error.message}`,true,()=>{
    if(error.status===401){try{sessionStorage.setItem('nameflare.like',JSON.stringify({id,at:Date.now()}));}catch{}openSignIn('like');}
    else likes.toggle(id);
  }),
  onSettled:(value,error)=>{
    if(error)return;
    $('#like-announcement').textContent=value.liked?'Flare saved to Your likes.':'Flare removed from Your likes.';
    if(state.view==='discover' && state.likedOnly && !value.liked){
      state.cosmetics=state.cosmetics.filter(paint=>paint.id!==value.id);
      const cards=[...$('#catalog').querySelectorAll('.cosmetic-card')];
      for(const card of cards)if(card.dataset.paintId===value.id){const focused=card.contains(document.activeElement),next=card.nextElementSibling || card.previousElementSibling;card.remove();if(focused)(next?.querySelector('.heart-toggle') || $('#catalog-liked')).focus();}
      if(!state.cosmetics.length){state.next=null;renderCatalog();}else updateCatalogStatus();
    }
  }
});
const follows=createLikeController({
  send:async(id,following)=>{const result=await api('/api/profiles/follow',{id,following});if(result.id!==id || result.following!==following)throw new Error('Invalid follow response. Please try again.');return {id,liked:result.following,like_count:0};},
  onChange:value=>{if(value.liked)state.followingIds.add(value.id);else state.followingIds.delete(value.id);$('#following-total').textContent=String(state.followingIds.size);for(const count of document.querySelectorAll('[data-following-count]'))count.textContent=String(state.followingIds.size);for(const button of document.querySelectorAll('[data-follow-id]'))if(button.dataset.followId===value.id)updateFollowButton(button);},
  onError:(error,id)=>toast(`Follow wasn’t saved. ${error.message}`,true,()=>{if(error.status===401){try{sessionStorage.setItem('nameflare.follow',JSON.stringify({id,at:Date.now()}));}catch{}openSignIn('follow');}else requestFollow(id);}),
  onSettled:(value,error)=>{if(error)return;state.catalogLoaded=false;state.followingLoaded=false;$('#like-announcement').textContent=value.liked?'Creator followed. Their public Flares appear in Following.':'Creator unfollowed.';if(!value.liked && state.view==='following')run(()=>loadFollowing());
    if(!value.liked && currentRoute()==='/account/following'){const card=[...document.querySelectorAll('#account-content [data-profile-id]')].find(card=>card.dataset.profileId===value.id);if(card){const focused=card.contains(document.activeElement),next=card.nextElementSibling || card.previousElementSibling;card.remove();const more=document.querySelector('[data-following-more]');if(more?.dataset.followingOffset)more.dataset.followingOffset=String(Math.max(0,Number(more.dataset.followingOffset)-1));if(focused)(next?.querySelector('[data-follow-id]') || document.querySelector('.account-tabs [aria-current]')).focus();const grid=document.querySelector('.followed-creators'),status=document.querySelector('[data-following-status]');if(status)status.textContent=`${grid.querySelectorAll('[data-profile-id]').length} followed creators shown`;if(!grid.children.length && document.querySelector('[data-following-more]')?.hidden)empty(grid,'Your next favorite creator is out there.','Follow creators to build your personal Flare feed.','/profiles','Find creators');}}
  }
});
function updateFollowButton(button) {
  const value=follows.get(button.dataset.followId),following=Boolean(state.user && (value?.liked ?? state.followingIds.has(button.dataset.followId)));
  button.setAttribute('aria-pressed',String(following));button.setAttribute('aria-busy',String(Boolean(value?.pending)));button.setAttribute('aria-label',`Follow ${button.dataset.followName}`);controlLabel(button,following?'Following ✓':'Follow');button.title=following?'Unfollow creator':'See their public Flares in Following';
}
function requestFollow(id) {
  if(!state.user){try{sessionStorage.setItem('nameflare.follow',JSON.stringify({id,at:Date.now()}));}catch{}rememberIntent('follow',id);openSignIn('follow');return;}
  if(state.user.id===id)return;
  if(!follows.get(id))follows.observe(id,0,state.followingIds.has(id));follows.toggle(id);
}
function followButton(user,readRevision=follows.revision) {
  follows.observe(user.id,0,state.followingIds.has(user.id),readRevision);
  const button=node('wa-button','follow-button');button.setAttribute('appearance','outlined');button.setAttribute('size','xs');button.setAttribute('type','button');button.dataset.followId=user.id;button.dataset.followName=user.name;button.hidden=state.user?.id===user.id;button.addEventListener('click',()=>run(()=>requestFollow(user.id)));updateFollowButton(button);return button;
}
async function resumeFollowIntent() {
  if(!state.user)return;
  let intent;try{intent=JSON.parse(sessionStorage.getItem('nameflare.follow'));sessionStorage.removeItem('nameflare.follow');}catch{}
  if(!intent || typeof intent.id!=='string' || !Number.isFinite(intent.at) || Date.now()-intent.at>600000 || intent.at>Date.now() || intent.id===state.user.id)return;
  await api(`/api/v1/profiles/${encodeURIComponent(intent.id)}`);
  follows.observe(intent.id,0,state.followingIds.has(intent.id));if(!state.followingIds.has(intent.id)){follows.toggle(intent.id);await follows.flush(intent.id);}
}
// Share on a card. The label sits in its own span so narrow cards can show the
// icon alone; the accessible name and tooltip keep saying what it does.
function shareButton(cosmetic) {
  const button=action('Share',()=>copyFlareLink(cosmetic.id,{name:cosmetic.name}),'button ghost post-action-share'),glyph=icon('share');
  glyph.setAttribute('slot','start');button.replaceChildren(glyph,node('span','share-text','Share'));
  button.setAttribute('aria-label',`Share ${cosmetic.name}`);button.title='Copy link';return button;
}
function updateLikeButton(button) {
  const value=likes.get(button.dataset.likeId),liked=Boolean(state.user && (value?.liked ?? state.likedIds.has(button.dataset.likeId))),count=value?.count ?? Number(button.dataset.likeCount || 0);
  const wasLiked=button.getAttribute('aria-pressed')==='true',previous=button.querySelector('.heart-count').textContent;
  button.setAttribute('aria-pressed',String(liked));button.setAttribute('aria-label',`Like ${button.dataset.likeName}`);
  button.setAttribute('aria-busy',String(Boolean(value?.pending)));button.title=liked?'Remove from your likes':'Save to your likes';
  button.querySelector('.heart-count').textContent=compactNumber(count);button.querySelector('.heart-label').textContent='Like';button.classList.toggle('no-likes',!count);
  if(liked && !wasLiked && button.isConnected){button.classList.remove('heart-pop');void button.offsetWidth;button.classList.add('heart-pop');}
  if(previous!==String(count) && button.isConnected){const counter=button.querySelector('.heart-count');counter.classList.remove('count-pop');void counter.offsetWidth;counter.classList.add('count-pop');}
}
function requestLike(cosmetic) {
  if(!state.user){try{sessionStorage.setItem('nameflare.like',JSON.stringify({id:cosmetic.id,at:Date.now()}));}catch{}rememberIntent('like',cosmetic.id);openSignIn('like');return;}
  likes.toggle(cosmetic.id);
}
async function resumeLikeIntent() {
  if(!state.user)return;
  let intent;try{intent=JSON.parse(sessionStorage.getItem('nameflare.like'));sessionStorage.removeItem('nameflare.like');}catch{}
  if(!intent || typeof intent.id!=='string' || !Number.isFinite(intent.at) || Date.now()-intent.at>600000)return;
  const result=await api(`/api/v1/cosmetics/${encodeURIComponent(intent.id)}`),paint=result.cosmetic;
  likes.observe(paint.id,paint.like_count,state.likedIds.has(paint.id));if(!state.likedIds.has(paint.id)){likes.toggle(paint.id);await likes.flush(paint.id);}
}
function likeButton(cosmetic) {
  likes.observe(cosmetic.id,cosmetic.like_count || 0,state.likedIds.has(cosmetic.id),cosmetic.like_read_revision ?? likes.revision);
  const button=node('wa-button','heart-toggle');button.setAttribute('appearance','plain');button.setAttribute('size','s');button.setAttribute('type','button');button.addEventListener('click',()=>run(()=>requestLike(cosmetic)));
  button.dataset.likeId=cosmetic.id;button.dataset.likeName=cosmetic.name;button.dataset.likeCount=String(cosmetic.like_count || 0);
  const heart=icon('heart');
  const count=node('span','heart-count');count.setAttribute('slot','end');
  button.append(heart,node('span','heart-label sr-only','Like'),count);updateLikeButton(button);return button;
}
const catalogPreviews = new Map();
const showcasePreviews = new Map();
const followingPreviews = new Map();
const cardSignatures = new WeakMap();
const cardSignature = paint => JSON.stringify(paint,(key,value)=>key==='like_read_revision'?undefined:value);
function captureCardAnimations(cards) {
  const saved=[];
  for(const card of cards){
    for(const animation of card.getAnimations?.({subtree:true}) || []){
      const target=animation.effect?.target;
      if(!target || !animation.animationName || animation.currentTime==null)continue;
      saved.push({target,name:animation.animationName,pseudo:animation.effect.pseudoElement || '',time:animation.currentTime});
    }
  }
  return saved;
}
function restoreCardAnimations(saved) {
  for(const item of saved){
    if(!item.target.isConnected)continue;
    const animation=item.target.getAnimations?.().find(candidate=>candidate.animationName===item.name && (candidate.effect?.pseudoElement || '')===item.pseudo);
    if(animation)try{animation.currentTime=item.time;}catch{}
  }
}
// Short names can fill the stage; long ones shrink instead of truncating.
function fitPreviewName(element, text) {
  const length = [...String(text || '')].length || 1;
  element.style.setProperty('--name-scale', String(Math.min(22, 96 / (length * .56)).toFixed(2)));
  fitFlare(element);
}
// Every preview renders a Flare exactly as chat does: at 18px, then magnified
// with CSS zoom to the size its layout asks for. Glow, outline, shadows, depth
// and image fills therefore scale together and match the Studio's canvas.
const CHAT_PX = 18, fitParents = new WeakMap();
const unfitted = el => el.closest('#studio-name, #studio-chat-name, .mini-chat, .review-chat-line, .rail-identity-name-chat');
const fitResize = 'ResizeObserver' in window ? new ResizeObserver(entries => { for (const entry of entries) for (const el of fitParents.get(entry.target) || []) if (el.isConnected) fitFlare(el); }) : null;
function fitFlare(element) {
  if (!element?.isConnected || unfitted(element)) return;
  element.style.removeProperty('zoom'); element.style.removeProperty('font-size');
  const intended = parseFloat(getComputedStyle(element).fontSize) || CHAT_PX;
  element.style.fontSize = `${CHAT_PX}px`; element.style.zoom = String(Math.max(.5, intended / CHAT_PX).toFixed(3));
  // A .flare-chip sizes to its name, so measure the box around the chip instead.
  const parent = element.parentElement?.classList.contains('flare-chip') ? element.parentElement.parentElement : element.parentElement;
  // Long names stay on one line: if the preview is wider than its box, scale it down to fit.
  if (parent) {
    // Measure the text, not the box: a max-width cap clips the box while the name runs on past it.
    const style = getComputedStyle(parent), available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24, width = Math.max(element.getBoundingClientRect().width, element.scrollWidth * parseFloat(element.style.zoom || '1'));
    if (available > 0 && width > available) element.style.zoom = String(Math.max(.3, parseFloat(element.style.zoom) * available / width).toFixed(3));
  }
  if (parent && fitResize) { let set = fitParents.get(parent); if (!set) { set = new Set(); fitParents.set(parent, set); fitResize.observe(parent); } set.add(element); }
}
function fitFlaresIn(root) {
  if (!(root instanceof Element)) return;
  if (root.matches('.nameflare-name')) fitFlare(root);
  for (const el of root.querySelectorAll('.nameflare-name')) fitFlare(el);
}
new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') { if (record.target.classList?.contains('nameflare-name') && !record.target.style.zoom) fitFlare(record.target); continue; } for (const node of record.addedNodes) fitFlaresIn(node); } })
  .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
document.fonts?.ready.then(() => fitFlaresIn(document.body));
const updateCatalogNames = createFrameUpdate(() => {
  const input = previewName(),hint=$('#catalog-name-hint');syncTypedName();
  if(hint)hint.textContent=input?`Every preview now reads “${input}”`:'Showing each Flare’s own name';
  for (const previews of [catalogPreviews, followingPreviews, showcasePreviews]) for (const [element, cosmetic] of previews) {
    const text = input || cosmetic.name || cosmetic.creator || 'yourname';
    updateCosmeticText(element, text);fitPreviewName(element, text);
  }
});
// Image and GIF Flares have no gradient to sample, so UI tints (the Wearing button,
// hover glows) fall back to the Flare's fallback colours, then the accent.
function accentColors(recipe){const list=(recipe?.colors || []).filter(color=>/^#[0-9a-f]{6}$/i.test(color));return list.length?list:['#f15a20'];}
// While no name is typed, a plate already shows the Flare's own name, so the caption title steps aside.
function syncTypedName(){document.documentElement.toggleAttribute('data-typed-name',Boolean(previewName()));}
function card(cosmetic, collection=false, trackCatalog=true) {
  syncTypedName();
  const colors=paintPalette(cosmetic.recipe);
  const card=node('article',`cosmetic-card${collection?' collection-card':''}`);card.dataset.paintId=cosmetic.id;card.dataset.creatorId=cosmetic.creator_id || cosmetic.owner_id || '';const tint=colors.length?colors:accentColors(cosmetic.recipe);card.style.setProperty('--paint-color',tint[0] || 'transparent');card.style.setProperty('--paint-secondary',tint.at(-1) || 'transparent');card.classList.toggle('is-equipped',state.user?.equipped===cosmetic.id);
  const creatorId=cosmetic.creator_id || cosmetic.owner_id || '';
  const head=node('div','post-head');
  const author=node('a','post-author');author.href=`/profiles/${encodeURIComponent(creatorId)}`;
  author.append(avatar({name:collection ? state.user?.name : cosmetic.creator,avatar_url:collection ? state.user?.avatar_url : cosmetic.creator_avatar,profile_provider:collection ? state.user?.profile_provider : cosmetic.creator_provider}));
  const authorCopy=node('span','post-author-copy');authorCopy.append(node('strong','',collection ? (state.user?.name || 'yourname') : (cosmetic.creator || 'Creator')));
  const sub=node('span','post-sub');
  if(cosmetic.updated_at){const stamp=node('time','',timeAgo(cosmetic.updated_at));stamp.dateTime=cosmetic.updated_at;stamp.title=date(cosmetic.updated_at);sub.append(stamp);}
  authorCopy.append(sub);author.append(authorCopy);head.append(author);
  if(!collection && creatorId)head.append(followButton({id:creatorId,name:cosmetic.creator || 'this creator'},follows.revision));
  const menu=node('wa-dropdown','post-menu');menu.setAttribute('placement','bottom-end');menu.setAttribute('distance','6');
  // Open toward the side of the card with room: the trigger sits at the right edge in some layouts and mid-row in others.
  menu.addEventListener('wa-show',()=>{const box=menu.closest('.cosmetic-card')?.getBoundingClientRect(),at=menu.querySelector('[slot="trigger"]')?.getBoundingClientRect();if(box && at)menu.setAttribute('placement',at.left+at.width/2<box.left+box.width/2?'bottom-start':'bottom-end');});
  const menuTrigger=node('wa-button','post-more');menuTrigger.setAttribute('slot','trigger');menuTrigger.setAttribute('appearance','plain');menuTrigger.setAttribute('size','s');menuTrigger.setAttribute('type','button');menuTrigger.setAttribute('aria-label',`More options for ${cosmetic.name}`);menuTrigger.append(icon('more'),node('span','sr-only',`More options for ${cosmetic.name}`));
  const menuItem=(label,fn,iconName)=>{const item=node('wa-dropdown-item');const content=node('span','wa-menu-label');content.append(icon(iconName),node('span','',label));item.append(content);item.addEventListener('click',()=>{menu.open=false;run(fn);});return item;};
  const openItem=menuItem('Open Flare',()=>openDetails(cosmetic),'arrow'),copyItem=menuItem('Copy link',()=>copyFlareLink(cosmetic.id,{name:cosmetic.name}),'link');
  menu.append(menuTrigger,openItem,copyItem);
  if(!collection)menu.append(menuItem('Share…',()=>copyFlareLink(cosmetic.id,{share:true,name:cosmetic.name}),'share'));
  if(collection){
    menu.append(menuItem('Edit a copy',()=>editor.editCopy(cosmetic),'studio'));
    menu.append(menuItem(cosmetic.listed?'Make unlisted':'List publicly',async()=>{await api('/api/cosmetics/publication',{id:cosmetic.id,listed:!Boolean(cosmetic.listed)});await loadCatalog();if(state.view==='account')await renderAccount();else await renderCollection();toast(cosmetic.listed?'Flare is unlisted. Existing links and equips still work.':'Flare will appear in Discover once approved.');},'eye'));
  }
  const preview=node('button','card-preview');preview.type='button';preview.setAttribute('aria-label',`View ${cosmetic.name}`);
  const name=node('strong','',previewName() || cosmetic.name || cosmetic.creator || 'yourname');name.setAttribute('aria-hidden','true');fitPreviewName(name,name.textContent);applyCosmetic(name,cosmetic,location.origin,{paused:state.catalogPaused});
  if(!collection && trackCatalog)catalogPreviews.set(name,cosmetic);
  const type=hasTexture(cosmetic)?'Image':cosmetic.recipe.depth?'3D depth':cosmetic.recipe.animation==='none'?'Static':'Animated',typeLabel=node('wa-badge','corner-label',type);typeLabel.setAttribute('variant','neutral');typeLabel.setAttribute('appearance','outlined');typeLabel.setAttribute('pill','');typeLabel.setAttribute('aria-hidden','true');typeLabel.prepend(icon(hasTexture(cosmetic)?'layers':cosmetic.recipe.depth?'collection':cosmetic.recipe.animation==='none'?'spark':'motion'));
  const palette=node('span','preview-palette');palette.setAttribute('aria-hidden','true');for(const color of colors){const chip=node('i');chip.style.backgroundColor=color;palette.append(chip);}
  preview.append(name,typeLabel,palette);
  preview.addEventListener('click',() => run(() => openDetails(cosmetic)));
  const meta=node('div','card-meta');meta.append(node('h3','',cosmetic.name));
  if(cosmetic.description)meta.append(node('p','post-copy',cosmetic.description));
  const bottom=node('div','card-footer'),swatches=node('span','swatches');
  const paletteDescription=colors.length ? `Flare-layer colors: ${colors.join(', ')}. Glow, blending and hue animation may change the displayed color.`:'Image fill · colors come from the uploaded texture.';
  palette.title=paletteDescription;swatches.title=paletteDescription;swatches.setAttribute('aria-label',paletteDescription);
  for(const color of colors){const dot=node('i');dot.style.backgroundColor=color;swatches.append(dot);}
  if(!colors.length)swatches.append(node('small','','Image fill'));
  const effect=node('span','effect-caption',cosmetic.recipe.animation==='none'?'Static finish':`${cosmetic.recipe.speed}s ${cosmetic.recipe.animation}`);effect.prepend(icon(cosmetic.recipe.animation==='none'?'spark':'motion'));bottom.append(swatches,effect);meta.append(bottom);
  const actions=node('div','post-actions'),social=node('div','card-react');
  if(!collection){
    if((!cosmetic.status || cosmetic.status==='approved') && cosmetic.listed)social.append(likeButton(cosmetic));
    const shareAction=shareButton(cosmetic);social.append(shareAction);
    if((cosmetic.status==='approved' || !cosmetic.status) && Number(cosmetic.equipped_count || 0) > 0)sub.append(node('span','equip-stat',`${compactNumber(cosmetic.equipped_count)} wearing`));
    actions.append(social);
  }
  if(collection){
    const status=node('div','collection-status');
    const badge=node('span',`badge ${cosmetic.status}`,({pending:'In review',rejected:'Needs changes',approved:'Approved'}[cosmetic.status]));
    const submitted=node('span','card-note',`Submitted ${timeAgo(cosmetic.created_at)}`);submitted.title=date(cosmetic.created_at);
    status.append(badge,submitted,node('span','card-note',`${cosmetic.listed?'Public listing':'Unlisted · link only'}${cosmetic.status==='pending'?' after approval':''}`));
    meta.append(status);
    if(cosmetic.reviewed_at){const reviewed=node('p','card-note',`Reviewed by ${cosmetic.reviewer || 'a moderator'} · ${timeAgo(cosmetic.reviewed_at)}`);reviewed.title=date(cosmetic.reviewed_at);meta.append(reviewed);}
    if(cosmetic.reason){const note=node('p','collection-note');note.append(node('span','collection-note-label','Reviewer note'),document.createTextNode(cosmetic.reason));meta.append(note);}
    const buttons=node('div','card-actions'),social=node('div','card-react'),trailing=node('div','card-actions-end');
    if((!cosmetic.status || cosmetic.status==='approved') && cosmetic.listed)social.append(likeButton(cosmetic));
    // Only an approved Flare has a link worth sharing.
    if(cosmetic.status==='approved'){const share=shareButton(cosmetic);social.append(share);}
    // Needs changes: the way forward is one click away, with the note carried along.
    if(cosmetic.status==='rejected'){const revise=action('Revise',()=>editor.revise(cosmetic),'button revise-button');revise.title='Open this design in Flare studio to fix it and submit again';trailing.append(revise);}
    if(cosmetic.status==='approved'){const equipButton=action('Equip',() => equip(cosmetic.id),'button equip-button');equipButton.dataset.equipId=cosmetic.id;syncEquipButton(equipButton);trailing.append(equipButton);}
    // Same order as every other card: the main action, then the heart, then More at the very end.
    trailing.append(social,menu);buttons.append(trailing);meta.append(buttons);
  } else {
    const buttons=node('div','post-buttons'),equipButton=action('Equip',()=>equip(cosmetic.id),'button primary equip-button');equipButton.dataset.equipId=cosmetic.id;syncEquipButton(equipButton);buttons.append(equipButton);
    // Equip, then the heart, then More at the very end.
    actions.prepend(buttons);actions.append(menu);
  }
  const previewArrow=icon('arrow','preview-open-arrow');preview.append(previewArrow);
  card.append(head);
  if(collection)card.append(preview,meta);else card.append(meta,preview);
  if(!collection)card.append(actions);
  return card;
}
function updateCatalogStatus() {
  $('#load-more').hidden=state.next===null;
  $('#catalog-status').textContent=state.likedOnly?`${state.cosmetics.length} of ${state.likedTotal} liked Flares`:`${state.cosmetics.length} Flares${state.next!==null?' · more to discover':''}${state.feed==='trending'?' · ranked by likes in the last 7 days':''}`;
  $('#approved-count').textContent=state.config?.stats.public ?? 0;
  $('#clear-filters').hidden=!searchValue().trim() && state.filter==='all' && !activeAdvancedFilters().length;syncFilterUI();syncShowcaseVisibility();
  const end=$('#feed-end');if(end)end.hidden=!(state.cosmetics.length && state.next===null);
}
function starterGallery(container) {
  const section=node('section','starter-section'),heading=node('div','starter-heading');heading.append(node('h3','','Start with a spark'),node('p','','Studio presets—not community posts. Yours to make your own.'));section.append(heading);
  const grid=node('div','starter-grid');
  for(const key of ['sunset','aurora','retro']){const preset=presets[key],button=node('button','starter-paint');button.type='button';const name=node('strong','',state.user?.name || 'yourname');applyCosmetic(name,preset,location.origin,{paused:state.catalogPaused});catalogPreviews.set(name,preset);button.append(name,node('span','',preset.title),node('small','','Make it yours →'));button.addEventListener('click',()=>editor.editCopy({name:preset.title,description:'',recipe:preset.recipe}));grid.append(button);}
  section.append(grid);container.append(section);
}
function renderCatalog(append=false,added=[]) {
  const grid=$('#catalog');if(!append)catalogPreviews.clear();
  if(state.likedOnly && !state.user){
    empty(grid,'Keep the Flares that feel like you.','Sign in to save favorites, pick up where you left off, and build your own collection.',null);
    grid.firstElementChild.prepend(node('span','empty-glyph','♡'));grid.firstElementChild.append(action('Sign in to see your likes',()=>openSignIn(),'button primary'));state.next=null;
  } else if(!state.cosmetics.length){
    const filtered=Boolean(searchValue().trim() || state.filter!=='all');
    empty(grid,filtered?'No Flares match this mix.':state.likedOnly?'Your next favorite is out there.':'A new community starts with a spark.',filtered?'Try another name or effect. Your next favorite might be one filter away.':state.likedOnly?'Tap a heart on any public Flare. It’ll be waiting for you here.':'The first public Flares are still on their way. Explore a studio preset and create something worth sharing.',null);
    grid.firstElementChild.prepend(node('span','empty-glyph',state.likedOnly?'♡':'✦'));
    grid.firstElementChild.append(filtered?action('Reset search & filters',resetFilters,'button primary'):state.likedOnly?action('Explore Flares',()=>setFeed('discover'),'button primary'):link('Create the first spark','/studio'));
    if(!filtered && !state.likedOnly)starterGallery(grid);
  } else {
    const paints=append?added:state.cosmetics;
    if(append){
      const elements=paints.map((paint,index)=>{const element=card(paint);cardSignatures.set(element,cardSignature(paint));element.style.setProperty('--entry-delay',`${Math.min(index,5)*35}ms`);return element;});
      grid.append(...elements);
    }else{
      const existing=[...grid.querySelectorAll(':scope > .cosmetic-card')],byId=new Map(existing.map(element=>[element.dataset.paintId,element])),paintById=new Map(),elements=[];
      for(const paint of paints){
        const signature=cardSignature(paint),old=byId.get(paint.id);paintById.set(paint.id,paint);
        if(old && cardSignatures.get(old)===signature){byId.delete(paint.id);elements.push(old);}
        else{const element=card(paint);cardSignatures.set(element,signature);elements.push(element);}
      }
      const sameOrder=elements.length===existing.length && elements.every((element,index)=>element===existing[index]);
      if(!sameOrder){
        // Moving a node in the DOM restarts its CSS animations. Carry the
        // current time across the swap so a filter/tab change does not make
        // every Flare visibly restart.
        const saved=captureCardAnimations(elements.filter(element=>existing.includes(element)));
        grid.replaceChildren(...elements);
        restoreCardAnimations(saved);
      }
      // Fresh cards register their previews while being built; reused cards
      // need to be re-registered after the map was cleared above.
      for(const element of elements){const name=element.querySelector('.nameflare-name'),paint=paintById.get(element.dataset.paintId);if(name && paint)catalogPreviews.set(name,paint);}
    }
  }
  updateCatalogStatus();
}
function catalogSkeleton() {
  const article=node('article','cosmetic-card skeleton-card');article.setAttribute('aria-hidden','true');
  const head=node('div','skeleton-head'),avatar=node('wa-skeleton','skeleton-avatar');avatar.setAttribute('effect','sheen');
  const lines=node('span','skeleton-lines'),name=node('wa-skeleton','skeleton-line skeleton-line-name'),meta=node('wa-skeleton','skeleton-line skeleton-line-meta');name.setAttribute('effect','sheen');meta.setAttribute('effect','sheen');lines.append(name,meta);head.append(avatar,lines);
  const media=node('wa-skeleton','skeleton-media');media.setAttribute('effect','sheen');
  const foot=node('div','skeleton-foot'),title=node('wa-skeleton','skeleton-line skeleton-line-title');title.setAttribute('effect','sheen'),action=node('wa-skeleton','skeleton-line skeleton-line-action');action.setAttribute('effect','sheen');foot.append(title,action);
  article.append(head,media,foot);return article;
}
let catalogRequest=0,catalogAbort;
async function loadCatalog(append=false) {
  const request=++catalogRequest,readRevision=likes.revision;catalogAbort?.abort();catalogAbort=new AbortController();
  const query=searchValue().trim();
  if(!state.bootstrapped && state.likedOnly){
    $('#catalog-status').textContent='Finding your next signature…';$('#catalog').setAttribute('aria-busy','true');$('#catalog').classList.add('is-loading');$('#load-more').disabled=true;
    return;
  }
  if(state.likedOnly && !state.user){state.cosmetics=[];state.next=null;state.catalogLoaded=true;$('#catalog').setAttribute('aria-busy','false');$('#catalog').classList.remove('is-loading');$('#load-more').disabled=false;renderCatalog();return;}
  $('#catalog-status').textContent=append?'Finding more Flares…':'Finding your next signature…';$('#catalog').setAttribute('aria-busy','true');$('#catalog').classList.add('is-loading');$('#load-more').disabled=true;
  let skeletonTimer=setTimeout(()=>{if(request===catalogRequest && !state.catalogLoaded){$('#catalog').replaceChildren(...Array.from({length:3},catalogSkeleton));}},140);
  try {
    const result=await api(`${state.likedOnly?'/api/my/likes':'/api/v1/cosmetics'}?limit=24&offset=${append ? state.next || 0:0}&q=${encodeURIComponent(query)}&effect=${state.filter}${advancedFilterQuery()}&sort=${$('#catalog-sort').value}`,undefined,catalogAbort.signal);
    if(request!==catalogRequest)return;
    for(const paint of result.cosmetics){paint.like_read_revision=readRevision;const value=likes.observe(paint.id,paint.like_count,state.likedIds.has(paint.id),readRevision);paint.like_count=value.count;}
    if(state.likedOnly)state.likedTotal=result.total;else if(state.config)state.config.stats.public=result.total;
    const seen=new Set(state.cosmetics.map(paint=>paint.id)),added=append?result.cosmetics.filter(paint=>!seen.has(paint.id)):result.cosmetics;
    state.cosmetics=append?[...state.cosmetics,...added]:added;state.next=result.next_offset;state.catalogLoaded=true;renderCatalog(append,added);
  } catch(error) {
    if(error.name==='AbortError' || request!==catalogRequest)return;
    $('#catalog-status').textContent='Connection interrupted. Your last view is still here.';
    // A failed switch must not leave an empty or skeleton grid behind.
    if(!append && (!state.catalogLoaded || !$('#catalog .cosmetic-card'))){empty($('#catalog'),'Couldn’t load Flares.','Check your connection and try again.',null);$('#catalog').firstElementChild.append(action('Try again',()=>loadCatalog(),'button primary'));}
    toast('Couldn’t load Flares. Try again.',true,()=>loadCatalog());
  } finally {clearTimeout(skeletonTimer);if(request===catalogRequest){$('#catalog').setAttribute('aria-busy','false');$('#catalog').classList.remove('is-loading');$('#load-more').disabled=false;}}
}
let followingRequest=0,followingAbort;
function followingCard(paint) {
  const element=card(paint,false,false),name=element.querySelector('.nameflare-name');
  if(name)followingPreviews.set(name,paint);
  return element;
}
function updateFollowingStatus() {
  const status=$('#following-status');if(!status)return;
  const total=$('#following-total');if(total)total.textContent=String(state.followingIds.size);
  const count=state.followingCosmetics.length,end=$('#following-end'),more=$('#following-load-more');
  if(!state.user)status.textContent='Sign in to see your Following feed.';
  else if(!count)status.textContent=state.followingIds.size?'No public Flares from followed creators yet.':'You aren’t following anyone yet.';
  else status.textContent=`${count} Flare${count===1?'':'s'} from ${state.followingIds.size} followed creator${state.followingIds.size===1?'':'s'}${state.followingNext!==null?' · more available':''}`;
  if(more)more.hidden=!state.user || !count || state.followingNext===null;
  if(end)end.hidden=!(state.user && count>0 && state.followingNext===null);
}
function renderFollowing(append=false,added=[]) {
  const grid=$('#following-feed');if(!grid)return;
  if(!append)followingPreviews.clear();
  if(!state.user){
    empty(grid,'Your people. Their latest Flares.','Sign in to follow creators and keep their newest public Flares together.',null);
    const glyph=node('span','empty-glyph');glyph.append(icon('heart'));grid.firstElementChild.prepend(glyph);
    grid.firstElementChild.append(action('Sign in to start following',()=>openSignIn(),'button primary'),link('Browse creators','/profiles','button subtle'));
    state.followingNext=null;
  } else if(!state.followingCosmetics.length){
    empty(grid,state.followingIds.size?'Your creators are working on their next spark.':'Build a feed that feels like you.',state.followingIds.size?'Their approved public Flares will appear here, newest first.':'Follow a creator from their profile. Their public Flares will be waiting here.',null);
    const glyph=node('span','empty-glyph');glyph.append(icon(state.followingIds.size?'spark':'profiles'));grid.firstElementChild.prepend(glyph);
    grid.firstElementChild.append(link('Find creators','/profiles'),link('Manage following','/account/following','button subtle'));
  } else {
    const paints=append?added:state.followingCosmetics,elements=paints.map(followingCard);
    if(append)grid.append(...elements);else grid.replaceChildren(...elements);
  }
  updateFollowingStatus();
}
async function loadFollowing(append=false) {
  if(append && state.followingNext===null)return;
  const request=++followingRequest;followingAbort?.abort();
  const grid=$('#following-feed');if(!grid)return;
  if(!state.user){state.followingCosmetics=[];state.followingNext=null;state.followingLoaded=false;followingAbort=null;renderFollowing();return;}
  followingAbort=new AbortController();
  const readRevision=likes.revision,status=$('#following-status'),more=$('#following-load-more'),end=$('#following-end');
  if(status)status.textContent=append?'Finding more Flares…':'Gathering your Following feed…';
  if(end)end.hidden=true;
  grid.setAttribute('aria-busy','true');grid.classList.add('is-loading');if(more)more.disabled=true;
  let skeletonTimer=null;
  if(!append && !state.followingCosmetics.length)skeletonTimer=setTimeout(()=>{if(request===followingRequest && !state.followingLoaded){followingPreviews.clear();grid.replaceChildren(...Array.from({length:3},catalogSkeleton));}},140);
  try {
    const offset=append?state.followingNext||0:0,result=await api(`/api/my/feed?limit=24&offset=${offset}`,undefined,followingAbort.signal);
    if(request!==followingRequest)return;
    for(const paint of result.cosmetics){paint.like_read_revision=readRevision;const value=likes.observe(paint.id,paint.like_count,state.likedIds.has(paint.id),readRevision);paint.like_count=value.count;}
    const seen=new Set(state.followingCosmetics.map(paint=>paint.id)),added=append?result.cosmetics.filter(paint=>!seen.has(paint.id)):result.cosmetics;
    state.followingCosmetics=append?[...state.followingCosmetics,...added]:added;state.followingNext=result.next_offset ?? null;state.followingLoaded=true;renderFollowing(append,added);
  } catch(error) {
    if(error.name==='AbortError' || request!==followingRequest)return;
    state.followingLoaded=false;
    if(status)status.textContent='Connection interrupted. Your last view is still here.';
    if(end)end.hidden=true;if(more)more.hidden=true;
    if(!state.followingCosmetics.length){empty(grid,'Couldn’t load your Following feed.','Check your connection and try again.',null);grid.firstElementChild.append(action('Try again',()=>loadFollowing(),'button primary'));}
    toast('Couldn’t load your Following feed. Try again.',true,()=>loadFollowing(append));
  } finally {
    if(skeletonTimer)clearTimeout(skeletonTimer);
    if(request===followingRequest){grid.setAttribute('aria-busy','false');grid.classList.remove('is-loading');if(more)more.disabled=false;}
  }
}
// Advanced filters: color family, motion, and fill. They live in the URL so a
// filtered Discover view can be shared or reloaded.
const filterNames={color:{red:'Red',orange:'Orange',yellow:'Yellow',green:'Green',cyan:'Cyan',blue:'Blue',purple:'Purple',pink:'Pink',mono:'Black & white'},motion:{flow:'Flow',shimmer:'Shimmer',pulse:'Pulse',spectrum:'Spectrum',none:'Static motion'},fill:{gradient:'Gradient fill',solid:'Solid fill',image:'Image / GIF fill'}};
const effectNames={animated:'Animated',glow:'Glow',texture:'Image & GIF',depth:'3D depth',static:'Static'};
{const params=new URLSearchParams(location.search);for(const key of ['color','motion','fill']){const value=params.get(key);state[key]=value&&filterNames[key][value]?value:'all';}const effect=params.get('effect');if(effect&&effectNames[effect]){state.filter=effect;for(const b of document.querySelectorAll('[data-filter]')){const active=b.dataset.filter===effect;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}}if(['color','motion','fill'].some(key=>state[key]!=='all')){$('#catalog-filters')?.classList.add('is-open');$('#feed-filters-toggle')?.setAttribute('aria-expanded','true');}}
function activeAdvancedFilters(){return ['color','motion','fill'].filter(key=>state[key]&&state[key]!=='all');}
function advancedFilterQuery(){return activeAdvancedFilters().map(key=>`&${key}=${encodeURIComponent(state[key])}`).join('');}
function discoverPath(){const params=new URLSearchParams();if(state.filter&&state.filter!=='all')params.set('effect',state.filter);for(const key of activeAdvancedFilters())params.set(key,state[key]);const query=params.toString();return `/discover${query?`?${query}`:''}`;}
function syncFilterUI(){
  for(const key of ['color','motion','fill'])for(const button of document.querySelectorAll(`[data-${key}]`))button.setAttribute('aria-pressed',String(button.dataset[key]===(state[key]||'all')));
  const count=activeAdvancedFilters().length,badge=$('#filter-count');if(badge){badge.textContent=String(count);badge.hidden=!count;}
  const pills=$('#active-filters');if(!pills)return;
  const items=[];
  if(state.filter&&state.filter!=='all')items.push(['filter',effectNames[state.filter]]);
  for(const key of activeAdvancedFilters())items.push([key,filterNames[key][state[key]]]);
  if(searchValue().trim())items.push(['search',`“${searchValue().trim().slice(0,24)}”`]);
  pills.replaceChildren(...items.map(([key,label])=>{const b=node('button','filter-pill');b.type='button';b.setAttribute('aria-label',`Remove filter: ${label}`);b.append(node('span','',label),icon('close'));b.addEventListener('click',()=>run(()=>removeFilter(key)));return b;}));
  pills.hidden=!items.length;
}
function removeFilter(key){
  if(key==='search'){$('#catalog-search').value='';}
  else if(key==='filter'){state.filter='all';for(const b of document.querySelectorAll('[data-filter]')){const active=b.dataset.filter==='all';b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}}
  else state[key]='all';
  history.replaceState(null,'',discoverPath());return loadCatalog();
}
for(const key of ['color','motion','fill'])for(const button of document.querySelectorAll(`[data-${key}]`))button.addEventListener('click',()=>run(()=>{
  const value=button.dataset[key];state[key]=state[key]===value&&value!=='all'?'all':value;
  state.feed=state.feed==='likes'?'likes':state.feed;history.replaceState(null,'',discoverPath());syncFilterUI();return loadCatalog();
}));
// Trending showcase: the week's top Flares (or the most worn), large, on your name.
const showcaseCache=new Map();let showcaseKind='trending',showcaseRequest=0;
function showcaseTile(cosmetic,index,kind){
  const item=node('li','showcase-item'),tile=node('button','showcase-tile');tile.type='button';
  tile.setAttribute('aria-label',`${index+1}. ${cosmetic.name} by ${cosmetic.creator || 'the community'}. Open details`);
  const stage=node('span','showcase-stage'),palette=paintPalette(cosmetic.recipe),colors=palette.length?palette:accentColors(cosmetic.recipe);
  if(colors[0])stage.style.setProperty('--paint-color',colors[0]);if(colors.at(-1))stage.style.setProperty('--paint-secondary',colors.at(-1));
  const text=previewName() || cosmetic.name || cosmetic.creator,name=node('strong','',text);applyCosmetic(name,cosmetic,location.origin,{paused:state.catalogPaused});fitPreviewName(name,text);showcasePreviews.set(name,cosmetic);
  stage.append(node('span','showcase-rank',`#${index+1}`),name);
  const likes=Number((kind==='popular'?cosmetic.like_count:(cosmetic.recent_like_count || cosmetic.like_count)) || 0),wearing=Number(cosmetic.equipped_count || 0);
  const meta=node('span','showcase-meta'),title=node('strong','',cosmetic.name),sub=node('small','',`${cosmetic.creator || 'Community'} · ${kind==='popular'?(wearing?`${compactNumber(wearing)} wearing`:'Not worn yet'):(likes?`${compactNumber(likes)} like${likes===1?'':'s'} this week`:'New this week')}`);
  meta.append(title,sub);tile.append(stage,meta);tile.addEventListener('click',()=>openDetails(cosmetic));
  // The heart sits on the plate's corner; it is a sibling of the tile because a button can't hold a button.
  const like=likeButton(cosmetic);like.classList.add('showcase-heart');item.append(tile,like);return item;
}
// Trending loads on its own, as soon as config is in, and never depends on the
// rest of the page: before, it started only after the feed and the first view had
// rendered, so any failure there (or one dropped request here) left the row as
// grey placeholders or "quiet" for the whole visit. Failures retry quietly with
// backoff; after that the row says so and offers Try again.
let showcaseShown=false,showcaseRetry=0;
const showcaseSkeletons=()=>Array.from({length:3},()=>node('li','showcase-skeleton'));
async function loadShowcase(kind=showcaseKind,attempt=0){
  const track=$('#showcase-track');if(!track)return;showcaseKind=kind;const request=++showcaseRequest;clearTimeout(showcaseRetry);
  for(const b of document.querySelectorAll('[data-showcase]'))b.setAttribute('aria-pressed',String(b.dataset.showcase===kind));
  track.setAttribute('aria-busy','true');
  if(!showcaseCache.has(kind) && !track.querySelector('.showcase-item,.showcase-skeleton'))track.replaceChildren(...showcaseSkeletons());
  try{
    if(!showcaseCache.has(kind)){const result=await api(`/api/v1/cosmetics?sort=${kind}&limit=8`);showcaseCache.set(kind,result);}
    if(request!==showcaseRequest)return;
    const list=showcaseCache.get(kind).cosmetics||[];for(const el of showcasePreviews.keys())if(!el.isConnected)showcasePreviews.delete(el);
    if(!list.length){track.replaceChildren(node('li','showcase-empty',kind==='popular'?'Nobody is wearing a Flare yet.':'The first weekly trend is still forming.'));}
    else track.replaceChildren(...list.map((c,i)=>showcaseTile(c,i,kind)));
    showcaseShown=true;track.scrollLeft=0;syncShowcaseArrows();track.setAttribute('aria-busy','false');
  }catch{
    if(request!==showcaseRequest)return;
    if(attempt<3){showcaseRetry=setTimeout(()=>loadShowcase(kind,attempt+1),Math.min(12000,1500*2**attempt));return;}
    const note=node('li','showcase-empty');note.append(node('span','','Couldn’t load Trending.'),action('Try again',()=>loadShowcase(kind),'button'));
    track.replaceChildren(note);track.setAttribute('aria-busy','false');
  }
}
addEventListener('online',()=>{if(!showcaseShown)loadShowcase();});
function syncShowcaseArrows(){const track=$('#showcase-track');if(!track)return;const max=track.scrollWidth-track.clientWidth,start=track.scrollLeft<=2,end=track.scrollLeft>=max-2;$('#showcase-prev').disabled=start;$('#showcase-next').disabled=end;track.toggleAttribute('data-more-before',!start);track.toggleAttribute('data-more-after',!end);}
// Trending stays put while filters or search narrow the feed; it only folds away
// (height + fade) on Saved, and unfolds on leaving it, so chips never jump under the cursor.
let showcaseAnimation=null,showcaseSynced=false;
// The showcase stays on every feed tab: hiding it for Saved moved the whole
// page by its height on every switch.
function syncShowcaseVisibility(){
  const show=true;const section=$('#trending-showcase');if(!section)return;
  const want=show?'shown':'hidden';if(section.dataset.state===want)return;section.dataset.state=want;
  const first=!showcaseSynced;showcaseSynced=true;
  const style=getComputedStyle(section),from={height:section.hidden?0:section.getBoundingClientRect().height,opacity:section.hidden?0:Number(style.opacity),pad:section.hidden?0:parseFloat(style.paddingBottom)};
  showcaseAnimation?.cancel();showcaseAnimation=null;section.style.overflow='';section.inert=!show;
  if(first || reduceMotion() || state.view!=='discover' || !section.isConnected){section.hidden=!show;return;}
  section.hidden=false;
  const full=show?section.getBoundingClientRect().height:0,pad=show?parseFloat(getComputedStyle(section).paddingBottom):0;
  if(Math.abs(full-from.height)<1){section.hidden=!show;return;}
  section.style.overflow='clip';
  const animation=showcaseAnimation=section.animate([
    {height:`${from.height}px`,paddingBottom:`${from.pad}px`,opacity:from.opacity},
    {height:`${full}px`,paddingBottom:`${pad}px`,opacity:show?1:0}
  ],{duration:show?340:280,easing:show?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,.2,1)'});
  animation.onfinish=()=>{if(showcaseAnimation!==animation)return;showcaseAnimation=null;section.style.overflow='';section.hidden=!show;if(show)syncShowcaseArrows();};
}
for(const b of document.querySelectorAll('[data-showcase]'))b.addEventListener('click',()=>run(()=>loadShowcase(b.dataset.showcase)));
{const track=$('#showcase-track');if(track){const page=d=>track.scrollBy({left:d*Math.max(260,track.clientWidth*.8),behavior:reduceMotion()?'auto':'smooth'});$('#showcase-prev').addEventListener('click',()=>page(-1));$('#showcase-next').addEventListener('click',()=>page(1));track.addEventListener('scroll',syncShowcaseArrows,{passive:true});new ResizeObserver(syncShowcaseArrows).observe(track);}}
function resetFilters(){clearTimeout(searchTimer);$('#catalog-search').value='';state.filter='all';state.color='all';state.motion='all';state.fill='all';history.replaceState(null,'',discoverPath());for(const button of document.querySelectorAll('[data-filter]')){const active=button.dataset.filter==='all';button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}return loadCatalog();}
async function applyQuickFilter(filter) {
  state.feed='discover';state.likedOnly=false;state.filter=filter;state.catalogLoaded=false;
  history.replaceState(null,'',discoverPath());
  for(const button of document.querySelectorAll('[data-filter]')){const active=button.dataset.filter===filter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  updateFeedControls();await loadCatalog();
  $('#community')?.scrollIntoView({behavior:reduceMotion()?'auto':'smooth',block:'start'});
}
function setSort(value) {
  const select=$('#catalog-sort');if(!select)return;
  select.value=value;
  const option=[...select.options].find(item=>item.value===value);
  $('#catalog-sort-value').textContent=option?.textContent || 'Newest first';
  for(const item of document.querySelectorAll('.sort-dropdown [data-sort]')){
    const checked=item.dataset.sort===value;item.setAttribute('aria-checked',String(checked));if('checked' in item)item.checked=checked;
  }
}
function updateFeedControls() {
  const feed=state.feed;
  for(const button of document.querySelectorAll('[data-feed]')){const active=button.dataset.feed===feed;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  const locked=feed==='trending';
  setSort(feed==='trending'?'trending':'newest');
  $('#catalog-sort').disabled=locked;$('.sort-trigger').disabled=locked;
  requestAnimationFrame(()=>moveFeedIndicator());
}
let feedSwitch=0,feedPosition;
async function setFeed(feed) {
  if(state.feed===feed && state.catalogLoaded)return;
  feedPosition?.cancel();
  const request=++feedSwitch,position=feedPosition=preserveFeedScroll($('.feed-tabs'),$('#view-discover'));
  state.feed=feed;state.likedOnly=feed==='likes';history.replaceState(null,'',discoverPath());updateFeedControls();$('#page-label').textContent='Discover';document.title='Discover · Nameflare';for(const nav of document.querySelectorAll('[data-nav]')){const current=nav.dataset.nav==='discover';nav.classList.toggle('active',current);if(current)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current');}renderedRoute=currentRoute();position.restore();
  try{await loadCatalog();}finally{if(request===feedSwitch){if(state.view==='discover')position.finish();else position.cancel();feedPosition=null;}}
}
for(const button of document.querySelectorAll('[data-feed]'))button.addEventListener('click',()=>run(()=>setFeed(button.dataset.feed)));
$('#clear-filters').addEventListener('click',()=>run(resetFilters));
$('#browse-community')?.addEventListener('click',event=>{event.preventDefault();$('#community').scrollIntoView({behavior:reduceMotion()?'auto':'smooth',block:'start'});});
// Only the hero borrows the visitor's name automatically. The feed shows each
// creator's own name unless the visitor explicitly types a preview name.
const previewNameBindings=[createPreviewNameBinding($('#hero-preview-name'))];
let heroPreset='sunset',heroPaused=false,heroTransition;
function carryPreviewName() {
  const input=$('#preview-username'),value=heroName();
  if(!input || !value)return;
  input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
}
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion=()=>motionPreference.matches || document.documentElement.dataset.motion==='reduced';
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
const heroCanvas=$('#hero-canvas');
let heroVisible=true;
function resetHeroPointer() {
  heroCanvas.style.setProperty('--pointer-x','50%');
  heroCanvas.style.setProperty('--pointer-y','48%');
  heroCanvas.style.setProperty('--tilt-x','0deg');
  heroCanvas.style.setProperty('--tilt-y','0deg');
}
function syncHeroMotion() {
  const stopped=heroPaused || reduceMotion() || document.hidden || !heroVisible;
  heroCanvas.classList.toggle('motion-stopped',stopped);
  const note=$('#hero-motion-note');
  if(note)note.textContent=reduceMotion()?'Motion is reduced on this device.':'Type in “Preview as” to see your own name.';
  if(stopped){heroTransition?.cancel();resetHeroPointer();}
  for(const selector of ['#hero-name','#hero-display-name'])applyCosmetic($(selector),presets[heroPreset],location.origin,{paused:stopped});
}
document.addEventListener('visibilitychange',syncHeroMotion);
if('IntersectionObserver' in window) {
  const heroObserver=new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;syncHeroMotion();});heroObserver.observe(heroCanvas);
}
heroCanvas.addEventListener('pointermove',event=>{
  if(heroPaused || reduceMotion() || !finePointer.matches || document.hidden || !heroVisible)return;
  const rect=heroCanvas.getBoundingClientRect();
  if(!rect.width || !rect.height)return;
  const rx=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
  const ry=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
  heroCanvas.style.setProperty('--pointer-x',`${(rx*100).toFixed(1)}%`);
  heroCanvas.style.setProperty('--pointer-y',`${(ry*100).toFixed(1)}%`);
  heroCanvas.style.setProperty('--tilt-x',`${((0.5-ry)*3.2).toFixed(2)}deg`);
  heroCanvas.style.setProperty('--tilt-y',`${((rx-0.5)*4.2).toFixed(2)}deg`);
});
heroCanvas.addEventListener('pointerleave',resetHeroPointer);
motionPreference.addEventListener('change',()=>{syncHeroMotion();renderHero();});
function renderHero() {
  const preset=presets[heroPreset],value=heroName() || 'yourname';
  for(const selector of ['#hero-name','#hero-display-name']){updateCosmeticText($(selector),value);applyCosmetic($(selector),preset,location.origin,{paused:heroPaused});}
  $('#hero-paint-label').textContent=preset.title;$('#hero-style-name').textContent=preset.title;
  $('#hero-preset-index').textContent=`${heroKeys.indexOf(heroPreset)+1} / ${heroKeys.length}`;
  $('#hero-canvas').style.setProperty('--canvas-accent',preset.recipe.colors[0]);$('#hero-canvas').style.setProperty('--canvas-secondary',preset.recipe.colors.at(-1));
  for(const item of $('#hero-presets').children)item.setAttribute('aria-pressed',String(item.dataset.preset===heroPreset));
  syncHeroMotion();
}
const heroKeys=Object.keys(presets);
for(const key of heroKeys){
  const preset=presets[key],button=node('button','hero-preset');button.type='button';button.dataset.preset=key;button.setAttribute('aria-pressed',String(key===heroPreset));button.setAttribute('aria-label',preset.title);button.title=preset.title;
  const colors=preset.recipe.colors;button.style.setProperty('--swatch',`conic-gradient(from 210deg, ${colors.join(', ')}, ${colors[0]})`);button.addEventListener('click',()=>{if(heroPreset===key)return;heroPreset=key;renderHero();if(!reduceMotion() && !heroPaused){heroTransition?.cancel();heroTransition=$('#hero-display-name').animate([{opacity:.72,transform:'translateY(3px) scale(.985)'},{opacity:1,transform:'none'}],{duration:190,easing:'cubic-bezier(0.22, 1, 0.36, 1)'});}});$('#hero-presets').append(button);
}
$('#hero-preview-name').addEventListener('input',createFrameUpdate(()=>{
  const raw=String($('#hero-preview-name').value ?? '').trim(),catalog=$('#catalog-name');
  if(catalog && catalog.value!==raw)catalog.value=raw;
  const value=raw || 'yourname';updateCosmeticText($('#hero-name'),value);updateCosmeticText($('#hero-display-name'),value);updateCatalogNames();
}));
$('#hero-pause').addEventListener('click',()=>{heroPaused=!heroPaused;$('#hero-pause').setAttribute('aria-label',heroPaused?'Resume motion':'Pause motion');$('#hero-pause').setAttribute('aria-pressed',String(heroPaused));$('#hero-pause use')?.setAttribute('href',heroPaused?'#icon-play':'#icon-pause');renderHero();});
$('#hero-customize').addEventListener('click',event=>{event.preventDefault();const preset=presets[heroPreset];carryPreviewName();editor.editCopy({name:preset.title,description:'',recipe:structuredClone(preset.recipe)});});
for(const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click',() => {
  state.filter=button.dataset.filter;for(const b of document.querySelectorAll('[data-filter]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}history.replaceState(null,'',discoverPath());run(()=>loadCatalog());
});
let searchTimer;$('#catalog-search').addEventListener('input',() => {clearTimeout(searchTimer);searchTimer=setTimeout(() => run(() => loadCatalog()),250);});
$('#load-more').addEventListener('click',() => run(() => loadCatalog(true)));
$('#catalog-sort').addEventListener('change',()=>run(()=>loadCatalog()));
$('#feed-filters-toggle')?.addEventListener('click',()=>{const toggle=$('#feed-filters-toggle'),open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Hide more filters':'Show more filters');$('#catalog-filters')?.classList.toggle('is-open',open);});
const sortMenu=$('.sort-dropdown');
sortMenu?.addEventListener('click',event=>{
  const item=event.target.closest?.('[data-sort]');if(!item)return;
  const select=$('#catalog-sort');if(select.value===item.dataset.sort)return;
  setSort(item.dataset.sort);
  select.dispatchEvent(new Event('change'));
},true);
$('#catalog-name').addEventListener('input',createFrameUpdate(()=>{
  const raw=previewName(),hero=$('#hero-preview-name');
  if(hero && hero.value!==raw)hero.value=raw;
  const value=raw || 'yourname';updateCosmeticText($('#hero-name'),value);updateCosmeticText($('#hero-display-name'),value);updateCatalogNames();
}));
$('#catalog-pause').addEventListener('click',()=>{state.catalogPaused=!state.catalogPaused;{const pause=$('#catalog-pause'),label=state.catalogPaused?'Resume previews':'Pause previews';pause.setAttribute('aria-label',label);pause.title=label;pause.querySelector('use')?.setAttribute('href',state.catalogPaused?'#icon-play':'#icon-pause');}$('#catalog-pause').setAttribute('aria-pressed',String(state.catalogPaused));for(const map of [catalogPreviews, followingPreviews])for(const [element,paint] of map)applyCosmetic(element,paint,location.origin,{paused:state.catalogPaused});});
$('#following-load-more')?.addEventListener('click',()=>run(()=>loadFollowing(true)));
// Every Equip control carries data-equip-id; its label is only "Equip" ⇄
// "Wearing" ("Equip Flare" in the dialog), so nothing next to it shifts.
function syncEquipButton(button) {
  const equipped=Boolean(state.user && state.user.equipped===button.dataset.equipId);
  // Unchanged buttons keep their nodes, so a running check animation is not restarted.
  if(button.dataset.equipSynced===String(equipped)){button.closest('.cosmetic-card')?.classList.toggle('is-equipped',equipped);return equipped;}
  button.dataset.equipSynced=String(equipped);
  controlLabel(button,equipped?'Wearing ✓':(button.dataset.equipLong?'Equip Flare':'Equip'));
  button.setAttribute('aria-pressed',String(equipped));
  button.setAttribute('aria-label',equipped?'Wearing this Flare':'Equip this Flare');button.title=equipped?'Wearing this Flare':'';
  button.closest('.cosmetic-card')?.classList.toggle('is-equipped',equipped);
  return equipped;
}
function replayClass(element,cls,ms) { if(!element)return;element.classList.remove(cls);void element.offsetWidth;element.classList.add(cls);setTimeout(()=>element.classList.remove(cls),ms); }
function syncAllEquipButtons(celebrate) {
  for(const button of document.querySelectorAll('[data-equip-id]')){
    if(syncEquipButton(button) && celebrate){replayClass(button,'just-equipped',900);replayClass(button.closest('.cosmetic-card'),'just-equipped',1200);}
  }
}
async function equip(id) {
  if(!state.user){state.pendingEquip=id;rememberIntent('equip',id);openSignIn('equip');return false;}
  // Already wearing it: nothing to save, nothing to announce.
  if(id && state.user.equipped===id){syncAllEquipButtons(false);return true;}
  // Optimistic: the change shows at once and rolls back only if saving fails.
  const previous=state.user.equipped;state.user.equipped=id;syncAllEquipButtons(Boolean(id));
  try{await api('/api/equip',{cosmeticId:id});await refreshAccount();}
  catch(error){if(state.user)state.user.equipped=previous;syncAllEquipButtons(false);throw error;}
  state.pendingEquip=null;state.catalogLoaded=false;syncAllEquipButtons(false);
  const name=id && [...(state.cosmetics || []),...(state.mine || [])].find(item=>item.id===id)?.name;
  let firstWear=false;if(id)try{firstWear=!localStorage.getItem('nameflare.worn');localStorage.setItem('nameflare.worn','1');}catch{}
  toast(id?(name?`Now wearing ${name}.`:'Now wearing this Flare.'):'Flare removed. Your name shows in its platform style.',false,null,{key:'equip',...(firstWear?{action:{label:'Where it shows',fn:()=>navigate('/integrations')}}:{})});
  Promise.resolve(refreshRailIdentity({api,state})).then(()=>{if(id)replayClass($('#rail-identity-stage'),'is-revealing',900);}).catch(()=>{});
  if(state.view==='account')await renderAccount();return true;
}
async function copyFlareLink(id,{share=false,name=''}={}) {
  const url=`${location.origin}/discover/${encodeURIComponent(id)}`;
  if(share){
    const label=name || 'this Flare';
    const result=await shareLink({title:`${name || id} · Nameflare`,text:`See ${label} on Nameflare.`,url});
    if(result==='cancelled')return;
    toast(result==='shared'?'Flare shared.':result==='copied'?'Flare link copied. Anyone can view and equip after signing in.':'Couldn’t share the link. Copy it from your browser’s address bar.',result==='failed');
    return;
  }
  const copied=await copyText(url);
  toast(copied?'Flare link copied. Anyone can view and equip after signing in.':'Couldn’t copy the link. Select the address bar to copy it.',!copied);
}
async function shareProfile(user) {
  const url=`${location.origin}/profiles/${encodeURIComponent(user.id)}`;
  const result=await shareLink({title:`${user.name} · Nameflare`,text:`Explore ${user.name}’s public Flares on Nameflare.`,url});
  if(result==='cancelled')return;
  toast(result==='shared'?'Profile shared.':result==='copied'?'Public profile link copied.':'Couldn’t share the profile. Copy it from your browser’s address bar.',result==='failed');
}
async function shareCurrentPage() {
  const result=await shareLink({title:document.title,text:'On Nameflare',url:location.href});
  if(result==='cancelled')return;
  toast(result==='shared'?'Page shared.':result==='copied'?'Page link copied.':'Couldn’t share this page.',result==='failed');
}
async function openDetails(cosmetic) {
  if(!cosmetic.status || cosmetic.status==='approved'){
    const origin=document.activeElement,returnHash=currentRoute() || '/discover',readRevision=likes.revision;
    const result=await api(`/api/v1/cosmetics/${encodeURIComponent(cosmetic.id)}`);
    if(currentRoute()!==returnHash)return;
    result.cosmetic.like_read_revision=readRevision;detailOrigin=origin;detailReturnHash=returnHash;
    history.pushState({detailReturnRoute:returnHash},'',`/discover/${encodeURIComponent(cosmetic.id)}`);trackView();return showDetails(result.cosmetic);
  }
  return showDetails(cosmetic);
}
async function showDetails(cosmetic) {
  const container=$('#detail-content');container.replaceChildren();const stage=node('div','detail-stage');const typedName=previewName(),previewText=typedName || cosmetic.name || cosmetic.creator || 'yourname',name=node('strong','',previewText);stage.append(name);
  let paused=false;const update=()=>applyCosmetic(name,cosmetic,location.origin,{paused});update();
  const title=node('h2','',cosmetic.name);title.id='detail-title';
  stage.style.setProperty('--paint-color',cosmetic.recipe.colors[0]);
  const published=!cosmetic.status || cosmetic.status==='approved';
  const heading=node('div','detail-heading'),description=node('p','detail-description',cosmetic.description || 'An original community Flare.');
  const creator=node('div','review-creator detail-creator');creator.append(creatorLink(cosmetic));
  const detailNote=node('p','form-footnote detail-note',published?`${cosmetic.listed===false || cosmetic.listed===0?'Unlisted · share by link':'Public community Flare'} · ${compactNumber(cosmetic.equipped_count || 0)} equipped · Approved ${timeAgo(cosmetic.updated_at || cosmetic.reviewed_at) || 'recently'}`:'Not public yet · only you and reviewers can see this submission.');
  if(published)detailNote.title=`Approved ${date(cosmetic.updated_at || cosmetic.reviewed_at)}`;
  heading.append(title,description,creator,detailNote);container.append(stage,heading);
  // Preview tools live on the stage itself: your name, motion, backdrop.
  const tools=node('div','detail-stage-tools'),input=node('input');input.maxLength=30;input.value=typedName;input.setAttribute('aria-label','Try your name');input.placeholder='Try your name';
  input.addEventListener('input',createFrameUpdate(()=>{if(name.isConnected)updateCosmeticText(name,input.value.trim() || cosmetic.name || 'yourname');}));
  const stageButton=(iconName,label,fn)=>{const b=node('button','stage-tool');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.setAttribute('aria-pressed','false');b.append(icon(iconName));b.addEventListener('click',()=>fn(b));return b;};
  const pause=stageButton('pause','Pause motion',b=>{paused=!paused;b.setAttribute('aria-pressed',String(paused));b.setAttribute('aria-label',paused?'Resume motion':'Pause motion');b.title=b.getAttribute('aria-label');b.querySelector('use').setAttribute('href',paused?'#icon-play':'#icon-pause');update();});
  const backdrop=stageButton('eye','Light backdrop',b=>{const light=stage.classList.toggle('light');b.setAttribute('aria-pressed',String(light));b.setAttribute('aria-label',light?'Dark backdrop':'Light backdrop');b.title=b.getAttribute('aria-label');});
  tools.append(input,pause,backdrop);stage.append(tools);
  const actions=node('div','detail-actions detail-primary-actions');
  if(published){const equipButton=action('Equip Flare',() => equip(cosmetic.id),'button primary detail-equip');equipButton.dataset.equipId=cosmetic.id;equipButton.dataset.equipLong='1';equipButton.style.setProperty('--paint-color',cosmetic.recipe?.colors?.[0] || 'var(--accent)');syncEquipButton(equipButton);actions.append(equipButton);}
  if(published && cosmetic.listed)actions.append(likeButton(cosmetic));
  if(published)actions.append(action('Share',()=>copyFlareLink(cosmetic.id,{share:true,name:cosmetic.name}),'button subtle'));
  const remix=action('Remix',() => {editor.editCopy(cosmetic);$('#detail-dialog').close();},'button subtle');remix.title='Open an editable copy in Flare studio. Artwork rights and approval do not carry over.';actions.append(remix);
  const download=action('',()=>{downloadDesign(cosmetic);toast('JSON downloaded. Import it in Flare studio to edit a copy.');},'button ghost');download.classList.add('detail-download');download.setAttribute('aria-label','Download JSON');download.title='Download JSON (image files are not included)';download.append(icon('download'));actions.append(download);
  if(published && state.config?.features?.reports && cosmetic.creator_id!==state.user?.id){const report=action('',()=>openReport('cosmetic',cosmetic.id,cosmetic.name),'button ghost detail-report');report.setAttribute('aria-label','Report this Flare');report.title='Report this Flare';report.append(icon('flag'));actions.append(report);}
  container.append(actions);
  if((!cosmetic.status || cosmetic.status==='approved') && ['owner','moderator'].includes(state.user?.role) && (state.user.role==='owner' || cosmetic.owner_id!==state.user.id)) {
    const staff=node('details','detail-staff');staff.append(node('summary','','Moderator tools'));
    const label=node('label','','Revocation reason');const reason=node('input');reason.placeholder='Required to remove this Flare from the API';reason.maxLength=400;label.append(reason);
    const revoke=action('Revoke approval',async() => {if(reason.value.trim().length<3)throw new Error('Enter a revocation reason.');await api('/api/admin/review',{id:cosmetic.id,status:'rejected',reason:reason.value});$('#detail-dialog').close();await loadCatalog();toast('Approval revoked. Equipped Flares cleared.');},'button danger');
    staff.append(label,node('p','form-footnote','Revoking removes it from Discover and the API and unequips it for everyone.'),revoke);container.append(staff);
  }
  $('#detail-dialog').showModal();
}

editor = initializeEditor({ api, getUser:() => state.user, signIn:openSignIn, toast, setControlLabel:controlLabel, onSubmitted:() => { navigate('/collection'); } });

let collectionNext=null,collectionRequest=0;
function renderMyFlares(append=false,added=[]) {
  const flares=(append?added:state.mine).filter(c=>state.collectionFilter==='all' || c.status===state.collectionFilter),grid=$('#my-collection');
  $('#collection-status').textContent=`${state.mine.length} Flares · ${state.mine.filter(c=>c.status==='approved').length} approved · ${state.mine.filter(c=>c.status==='pending').length} in review${collectionNext!==null?' · more available':''}`;
  $('#collection-more').hidden=collectionNext===null;
  if(flares.length){if(append && !grid.querySelector('.empty-state'))grid.append(...flares.map(c=>card(c,true)));else grid.replaceChildren(...(append?state.mine.filter(c=>state.collectionFilter==='all' || c.status===state.collectionFilter):flares).map(c=>card(c,true)));}
  else if(!append){
    // Nothing made yet: one invitation, without filters for an empty list. A filter with no
    // matches says which status is empty and leaves the way out to the filters above.
    if(!state.mine.length && collectionNext===null)empty(grid,'You haven’t made a Flare yet.','Design one in Studio and submit it. It waits here while a moderator reviews it.');
    else empty(grid,{approved:'Nothing approved yet.',pending:'Nothing in review.',rejected:'Nothing needs changes.'}[state.collectionFilter] || 'No Flares in this view.',collectionNext!==null?'Load more submissions, or choose another status.':'Choose another status above to see the rest.',null);
  }
  $('#view-collection').classList.toggle('is-empty',!state.mine.length && collectionNext===null);
}
function syncCollectionFilters(){for(const item of document.querySelectorAll('[data-collection-filter]')){const active=item.dataset.collectionFilter===(state.collectionFilter || 'all');item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));}}
for(const b of document.querySelectorAll('[data-collection-filter]'))b.addEventListener('click',()=>{state.collectionFilter=b.dataset.collectionFilter;syncCollectionFilters();if(state.user)renderMyFlares();});
async function renderCollection(append=false) {
  const request=++collectionRequest;syncCollectionFilters();
  if(!state.user){$('#collection-status').textContent='';$('#collection-more').hidden=true;empty($('#my-collection'),'Your collection starts here.','Sign in to submit Flares, follow their review, and wear them.',null);$('#my-collection').firstElementChild.append(action('Sign in',()=>openSignIn(),'button primary'),link('Open Flare studio','/studio','button subtle'));return;}
  const more=$('#collection-more');more.disabled=true;$('#collection-status').textContent='Loading your submissions…';
  try {
    const userId=state.user.id,readRevision=likes.revision,result=await api(`/api/my/cosmetics?limit=24&offset=${append?collectionNext || 0:0}`);
    for(const paint of result.cosmetics)paint.like_read_revision=readRevision;if(request!==collectionRequest || state.view!=='collection' || state.user?.id!==userId)return;
    const seen=new Set(state.mine.map(c=>c.id)),added=append?result.cosmetics.filter(c=>!seen.has(c.id)):result.cosmetics;
    state.mine=append?[...state.mine,...added]:added;collectionNext=result.next_offset;controlLabel(more,'Load more submissions ↓');renderMyFlares(append,added);
  }catch(error){if(request===collectionRequest && state.view==='collection'){$('#collection-status').textContent='Could not load submissions. Your last view is still here.';more.hidden=false;more.textContent='Retry loading submissions';}throw error;}
  finally{if(request===collectionRequest)more.disabled=false;}
}
$('#collection-more').addEventListener('click',()=>run(()=>renderCollection(collectionNext!==null)));
function createdFlares(user, own=false) {
  const section=node('section','created-flares'),heading=node('div','section-heading'),copy=node('div');
  copy.append(node('h2','',own?'Your created Flares':'Flares'));if(own)copy.append(node('p','','All your submissions, including public, unlisted, and in-review designs.'));
  heading.append(copy);if(own)heading.append(link('Create a Flare','/studio','button subtle'));section.append(heading);
  const status=node('p','form-footnote'),grid=node('div','cosmetic-grid'),more=controlLabel(node('button','button subtle load-more'),'Load more Flares ↓');
  status.setAttribute('role','status');more.type='button';more.hidden=true;section.append(status,grid,more);
  let offset=0,shown=0,busy=false;
  async function load() {
    if(busy || !section.isConnected)return;
    busy=true;more.disabled=true;grid.setAttribute('aria-busy','true');status.textContent='Loading created Flares…';
    try {
      const path=own?'/api/my/cosmetics':`/api/v1/profiles/${encodeURIComponent(user.id)}/cosmetics`;
      const readRevision=likes.revision,result=await api(`${path}?limit=24&offset=${offset}`);
      for(const paint of result.cosmetics)paint.like_read_revision=readRevision;
      if(!section.isConnected || (own && state.user?.id!==user.id))return;
      if(!shown && !result.cosmetics.length){empty(grid,own?'You haven’t made a Flare yet.':'No public Flares yet.',own?'Design one in Studio. Everything you submit shows here, approved or not.':'This creator hasn’t published any listed Flares.',own?'/studio':null);section.classList.add('is-empty');}
      else grid.append(...result.cosmetics.map((c,i)=>{const el=card(c,own,false);el.style.setProperty('--entry-delay',`${Math.min(i,5)*30}ms`);return el;}));
      shown+=result.cosmetics.length;offset=result.next_offset;
      status.textContent=own?`${shown} created Flares shown`:'';
      controlLabel(more,'Load more Flares ↓');more.hidden=offset===null;
    } catch(error) {
      if(section.isConnected){status.textContent='Could not load created Flares. Try again.';controlLabel(more,'Retry loading Flares');more.hidden=false;}
      throw error;
    } finally {busy=false;more.disabled=false;grid.setAttribute('aria-busy','false');}
  }
  more.addEventListener('click',()=>run(load));
  return {section,load};
}
let accountRequest=0,accountShell=null;
async function renderAccount(chapter=(currentRoute().split('/')[2] || 'overview')) {
  const request=++accountRequest,container=$('#account-content');
  if(!state.user){
    accountShell=null;
    empty(container,'Your account starts with one sign-in.','Anyone can join through an enabled provider. Your first sign-in creates your account; returning sign-ins reopen it. No separate password or invitation.',null);
    container.firstChild.append(action('Sign in or create an account',openSignIn,'button primary'),node('p','form-footnote','Already have an account? Use the same provider. Link other platforms while signed in to keep one account.'));return;
  }
  const user=state.user,tab=['overview','settings','platforms','following','privacy'].includes(chapter)?chapter:'overview';
  if(!accountShell || accountShell.userId!==user.id || accountShell.container!==container || !accountShell.layout.isConnected){
    container.replaceChildren();
    const layout=node('div','account-layout'),aside=node('aside','account-aside'),main=node('div','account-main');
    const tabs=node('nav','account-tabs');tabs.setAttribute('aria-label','Account sections');
    const tabLinks=new Map(),shortTab={overview:'Overview',settings:'Profile',platforms:'Platforms',following:'Following',privacy:'Data'};
    for(const [key,title,tabIcon] of [['overview','Overview','discover'],['settings','Edit profile','studio'],['platforms','Connected platforms','link'],['following','Following','heart'],...(state.config.features?.data_export?[['privacy','Your data','lock']]:[])]){const item=link('',`/account/${key}`,'feed-tab');item.append(icon(tabIcon),node('span','tab-label-full',title),node('span','tab-label-short',shortTab[key]));tabLinks.set(key,item);tabs.append(item);}
    const content=node('div','account-tab-content');
    main.append(tabs,content);layout.append(aside,main);container.append(layout);
    accountShell={userId:user.id,container,layout,aside,main,content,tabLinks};
  }
  const shell=accountShell,aside=shell.aside,content=shell.content;
  const summary=node('div','panel account-summary');
  summary.style.setProperty('--profile-color',user.profile_color || '#ff355e');
  const identity=node('div','profile-heading'),nameRow=node('div','profile-name-row');nameRow.append(node('h2','',user.name));const badge=moderatorBadge(user) || artistBadge(user);if(badge)nameRow.append(badge);
  identity.append(nameRow,node('p','form-footnote account-joined-line',`Joined ${joined(user.created_at)}`));
  const identityHead=node('div','account-identity-head');identityHead.append(avatar(user,'avatar-large'),identity);
  // One clear primary action, two secondary ones side by side, and sign out set apart at the foot.
  const summaryActions=node('div','profile-actions account-actions');
  const secondary=[...(state.config.features?.insights!==false?[link('Insights','/analytics','button subtle')]:[]),link(state.config.features?.data_export?'Your data':'Settings',state.config.features?.data_export?'/account/privacy':'/account/settings','button subtle')];
  summaryActions.append(link('View public profile',`/profiles/${encodeURIComponent(user.id)}`,'button primary'),...secondary);
  const signOut=action('Sign out',async()=>{await api('/api/logout',{});await refreshAccount();editor.accountChanged();await renderView();toast('Signed out. Your account and Flares are saved.');},'button ghost account-signout');{const glyph=icon('logout');glyph.setAttribute('slot','start');signOut.prepend(glyph);}
  const platforms=node('div','account-platforms');
  for(const item of user.identities)platforms.append(platformLink(item,{cls:'account-plat'}));
  if(!user.identities.length)platforms.append(node('span','form-footnote','No platforms linked yet.'));
  const summaryFoot=node('div','account-summary-foot');summaryFoot.append(signOut);summary.append(identityHead,platforms,summaryActions,summaryFoot);aside.replaceChildren(summary);
  for(const [key,item] of shell.tabLinks){const current=key===tab;item.classList.toggle('active',current);if(current)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
  content.replaceChildren();
  if(tab==='overview') {
    const equipped=node('section','panel equipped-panel'),head=node('div','equipped-head'),headCopy=node('div','equipped-head-copy');
    headCopy.append(node('h2','','Currently wearing'));head.append(headCopy);equipped.append(head);content.append(equipped);
    const platformNames=[...new Set(user.identities.map(item=>providerNames[item.provider]).filter(Boolean))];
    const platformList=platformNames.length>2?`${platformNames.slice(0,-1).join(', ')} and ${platformNames[platformNames.length-1]}`:platformNames.join(' and ');
    if(user.equipped){
      equipped.append(node('p','form-footnote equipped-loading','Loading your equipped Flare…'));
      try{const result=await api(`/api/v1/cosmetics/${encodeURIComponent(user.equipped)}`);if(request!==accountRequest || state.user?.id!==user.id || state.view!=='account')return;
        const stage=node('div','detail-stage equipped-stage'),name=node('strong','',user.name);stage.style.setProperty('--paint-color',result.cosmetic.recipe.colors[0]);applyCosmetic(name,result.cosmetic);stage.append(name);
        const info=node('div','equipped-info');info.append(node('h3','',result.cosmetic.name),creatorLink(result.cosmetic));
        const meta=node('div','equipped-meta');meta.append(node('span','equipped-chip',result.cosmetic.listed===false || result.cosmetic.listed===0 ? 'Unlisted' : 'Public Flare'));
        if(Number(result.cosmetic.equipped_count || 0)>0)meta.append(node('span','equipped-chip',`${compactNumber(result.cosmetic.equipped_count)} wearing`));
        const actions=node('div','detail-actions equipped-actions');actions.append(action('View Flare',()=>openDetails(result.cosmetic),'button primary'),action('Change Flare',()=>{navigate('/discover');},'button subtle'),action('Remove Flare',()=>equip(null),'button remove-quiet'));
        info.append(meta,actions,whereItShows(platformList));
        const body=node('div','equipped-body');body.append(stage,info);equipped.replaceChildren(head,body);
      }catch{if(request!==accountRequest)return;const loading=equipped.querySelector('.equipped-loading');if(loading)loading.textContent='Your Flare could not be loaded.';equipped.append(action('Retry',()=>renderAccount()));}
    }else{
      const stage=node('div','detail-stage equipped-stage is-empty');stage.append(node('strong','',user.name));
      const actions=node('div','detail-actions equipped-actions');actions.append(link('Browse Flares','/discover','button primary'),link('Create a Flare','/studio','button subtle'));
      const info=node('div','equipped-info');info.append(node('h3','','Nothing equipped yet'),node('p','equipped-copy','Your name shows in its original platform style. Pick an approved Flare to change that.'),actions,whereItShows(platformList));
      const body=node('div','equipped-body');body.append(stage,info);equipped.append(body);
    }
    const gallery=createdFlares(user,true);content.append(gallery.section);await run(gallery.load);return;
  }
  if(tab==='following') {
    {const head=node('div','tab-head'),copy=node('div','tab-head-copy');copy.append(node('h2','','Your corner of the community'),node('p','form-footnote','Your follow list is private. Following a creator adds their approved public Flares to your feed; it does not like or equip them.'));head.append(copy,link('Open Following feed','/following','button subtle'));content.append(head);}
    const grid=node('div','cosmetic-grid followed-creators'),status=node('p','form-footnote'),more=action('Load more creators ↓',()=>load());status.setAttribute('role','status');status.dataset.followingStatus='';more.dataset.followingMore='';more.hidden=true;content.append(status,grid,more);
    let offset=0,busy=false,shown=0;
    async function load(){if(busy)return;busy=true;more.disabled=true;status.textContent='Loading followed creators…';
      try{if(more.dataset.followingOffset)offset=Number(more.dataset.followingOffset);const readRevision=follows.revision,result=await api(`/api/my/following?limit=24&offset=${offset}`);if(request!==accountRequest || state.user?.id!==user.id || !grid.isConnected)return;
        if(!shown && !result.users.length)empty(grid,'Your next favorite creator is out there.','Explore the community and follow someone whose Flares fit your style.','/profiles','Find creators →');
        else {const seen=new Set([...grid.querySelectorAll('[data-profile-id]')].map(card=>card.dataset.profileId));grid.append(...result.users.filter(creator=>!seen.has(creator.id)).map(creator=>profileCard(creator,false,readRevision)));}shown=grid.querySelectorAll('[data-profile-id]').length;offset=result.next_offset;if(offset!==null)more.dataset.followingOffset=String(offset);else delete more.dataset.followingOffset;status.textContent=`${shown} followed creators shown`;controlLabel(more,'Load more creators ↓');more.hidden=offset===null;
      }catch(error){if(grid.isConnected){status.textContent='Could not load following. Try again.';controlLabel(more,'Retry loading creators');more.hidden=false;}throw error;}finally{busy=false;more.disabled=false;}
    }
    await run(load);return;
  }
  if(tab==='privacy') { renderYourData(content,user);return; }
  if(tab==='settings') {
  const settings=node('form','panel profile-settings');settings.append(node('h2','','Make your profile yours'),node('p','form-footnote','Your bio and accent are public. Your name and avatar come from a connected platform; they refresh when you sign in with it again. This does not rename your platform account.'));
  const label=node('label','','Name and avatar source'),select=node('select');select.name='provider';
  for(const item of user.identities){const option=node('option','',`${providerNames[item.provider]} · ${item.display_name}`);option.value=item.provider;select.append(option);}
  select.value=user.profile_provider || user.identities[0]?.provider;label.append(select);
  const bioLabel=node('label','','About you'),bio=node('textarea');bio.name='bio';bio.rows=4;bio.maxLength=280;bio.value=user.bio || '';bio.placeholder='Tell the community a little about your style.';bioLabel.append(bio);
  const count=node('p','form-footnote',`${bio.value.length}/280 characters`);bio.setAttribute('aria-describedby','bio-count');count.id='bio-count';bio.addEventListener('input',()=>count.textContent=`${bio.value.length}/280 characters`);
  const colorLabel=node('label','','Profile accent'),color=node('input');color.type='color';color.name='profile_color';color.value=user.profile_color || '#ff355e';colorLabel.append(color);
  const preview=node('div','profile-edit-preview');preview.style.setProperty('--profile-color',color.value);preview.append(avatar(user,'avatar-large'),node('strong','',user.name),node('p','',bio.value || 'Your story goes here.'));
  color.addEventListener('input',()=>preview.style.setProperty('--profile-color',color.value));bio.addEventListener('input',()=>preview.lastChild.textContent=bio.value || 'Your story goes here.');
  const save=node('button','button primary','Save profile');save.type='submit';settings.append(preview,label,bioLabel,count,colorLabel,save,node('p','form-footnote','Favorites, pending submissions, and review notes stay private. Approved unlisted Flares can still be seen when equipped or shared by link.'));
  settings.addEventListener('submit',event=>{event.preventDefault();run(async()=>{save.disabled=true;try{await api('/api/account/profile',{provider:select.value,bio:bio.value,profile_color:color.value});await refreshAccount();if(request===accountRequest && state.view==='account'){summary.style.setProperty('--profile-color',state.user.profile_color);identity.querySelector('h2').textContent=state.user.name;toast('Profile saved. Your public page is up to date.');}}finally{if(save.isConnected)save.disabled=false;}});});content.append(settings);return;
  }
  const linked=user.identities.length,total=Object.keys(providerNames).length;
  const head=node('div','plat-head');head.append(node('h2','account-section-title','Connected platforms'),node('span','plat-count',`${linked} of ${total} linked`));
  content.append(head,node('p','form-footnote','Link each platform while signed in so your Flares follow you everywhere. Linked channels show on your public profile.'));
  const list=node('div','plat-rows');
  for(const [provider,title] of Object.entries(providerNames)){
    const connected=user.identities.find(item=>item.provider===provider),row=node('div',`plat-row plat-${provider}${connected?' is-linked':''}`);
    const logo=node('span','plat-tile');logo.append(platformLogo(provider));
    const detail=node('div','plat-detail'),titleRow=node('div','plat-title');titleRow.append(node('h3','',title));
    if(connected){const status=node('span','plat-status','Connected');status.prepend(icon('check'));titleRow.append(status);}
    detail.append(titleRow);
    if(connected){
      const href=platformUrl(connected),handle=platformHandle(connected),line=node('p','plat-handle-line');
      if(href){const out=node('a','plat-channel',href.replace(/^https:\/\/(www\.)?/,''));out.href=href;out.target='_blank';out.rel='noopener noreferrer';out.title=`Open ${handle} on ${title}`;out.append(icon('external'));line.append(out);}
      else line.append(node('span','',handle));
      line.append(node('span','plat-id',`ID ${connected.provider_id}`));detail.append(line);
    } else detail.append(node('p','plat-handle-line',state.config.demo?'Not linked · linking is off in the demo':state.config.providers[provider]?'Not linked':'Not available on this server'));
    const actions=node('div','plat-actions');
    if(connected){const href=platformUrl(connected);if(href){const open=link('Open channel',href,'button subtle sm');open.setAttribute('target','_blank');open.setAttribute('rel','noopener noreferrer');actions.append(open);}if(!state.config.demo)actions.append(platformMenu(user,provider,title,row,actions));}
    else if(!state.config.demo && state.config.providers[provider])actions.append(link(`Link ${title}`,`/auth/${provider}`,'button primary sm'));
    row.append(logo,detail,actions);list.append(row);
  }
  const foot=state.config.features?.identity_changes
    ? 'Switching takes you to the platform to pick the other account. If it signs you straight back in as the same one, sign out on that site first. An account already linked to another Nameflare account must be unlinked there first. Never share sign-in links.'
    : 'Refresh must use the same linked identity. Automatic merging and unlinking are not supported. Never share OAuth callback links or credentials.';
  content.append(list,node('p','form-footnote plat-foot',foot));
}
// Change menu for a linked platform: refresh it, switch it to another account
// on the same platform, or unlink it (after an inline confirmation).
function platformMenu(user,provider,title,row,actions){
  const changes=state.config.features?.identity_changes;
  if(!changes)return link('Refresh',`/auth/${provider}`,'button ghost sm');
  const menu=node('details','row-menu'),summary=node('summary','button ghost sm','Change');summary.setAttribute('aria-label',`Change linked ${title} account`);
  const panel=node('div','row-menu-panel');
  const go=(label,href,hint)=>{const item=node('a','menu-item');item.href=href;item.append(node('span','',label));if(hint)item.append(node('small','',hint));return item;};
  panel.append(go('Refresh name & picture',`/auth/${provider}`,`Sign in to ${title} again with the same account`),go(`Switch to another ${title} account`,`/auth/${provider}?mode=replace`,'Your Flare moves to the new account'));
  const staffTwitch=provider==='twitch' && ['owner','moderator'].includes(user.role),only=user.identities.length<2;
  const why=only?'You need at least one linked platform to sign in':staffTwitch?(user.role==='owner'?'The owner account keeps Twitch linked':'Staff accounts keep Twitch linked'):'';
  const unlink=node('button','menu-item danger');unlink.type='button';unlink.append(node('span','',`Unlink ${title}`));if(why){unlink.disabled=true;unlink.append(node('small','',why));}
  unlink.addEventListener('click',()=>{menu.open=false;confirmUnlink(provider,title,row,actions);});
  panel.append(unlink);menu.append(summary,panel);return menu;
}
function confirmUnlink(provider,title,row,actions){
  const bar=node('div','plat-confirm');bar.setAttribute('role','group');bar.setAttribute('aria-label',`Unlink ${title}`);
  const text=node('p','',`Unlink ${title}? Your Flare stops showing there, and you can no longer sign in with it.`);
  const keep=node('button','button ghost sm','Keep it');keep.type='button';
  const remove=node('button','button danger sm',`Unlink ${title}`);remove.type='button';
  keep.addEventListener('click',()=>{bar.remove();actions.hidden=false;actions.querySelector('summary')?.focus();});
  remove.addEventListener('click',()=>run(async()=>{remove.disabled=keep.disabled=true;try{await api('/api/account/identities/unlink',{provider});await refreshAccount();toast(`${title} unlinked.`);if(state.view==='account')await renderAccount('platforms');}finally{if(remove.isConnected)remove.disabled=keep.disabled=false;}}));
  const buttons=node('div','plat-confirm-actions');buttons.append(keep,remove);bar.append(text,buttons);
  actions.hidden=true;row.after(bar);remove.focus();
}
// Coming back from a platform's sign-in page: say what happened, then tidy the address.
const authOutcomes={
  linked:p=>[`${p} linked. Your Flare now shows there too.`],
  refreshed:p=>[`${p} name and picture refreshed.`],
  switched:p=>[`Switched to your other ${p} account.`],
  same:p=>[`That’s the ${p} account already linked. To switch, sign out on ${p} first, then try again.`,true],
  taken:p=>[`That ${p} account is linked to a different Nameflare account. Sign in to that account and unlink it there first.`,true],
  occupied:p=>[`You already have a ${p} account linked. Use Change → Switch to replace it.`,true],
  owner:p=>[`This ${p} account makes you the owner, so it can’t be switched.`,true],
  nochannel:p=>[`That Google account has no YouTube channel. Create one on YouTube, then try again.`,true],
  banned:p=>[`That ${p} account is banned from Nameflare.`,true],
  cancelled:p=>[`${p} sign-in was cancelled. Nothing changed.`],
  expired:p=>[`That ${p} sign-in took too long or was opened twice. Please try again.`,true],
  restart:p=>[`You switched Nameflare accounts during the ${p} sign-in. Please start again.`,true],
  failed:p=>[`${p} couldn’t be linked right now. Please try again.`,true]
};
function showAuthOutcome(){
  const params=new URLSearchParams(location.search),outcome=authOutcomes[params.get('auth')];if(!params.has('auth'))return;
  const name={twitch:'Twitch',kick:'Kick',youtube:'YouTube'}[params.get('provider')] || 'The platform';
  params.delete('auth');params.delete('provider');history.replaceState(history.state,'',location.pathname+(params.size?`?${params}`:'')+location.hash);
  if(outcome){const [message,error]=outcome(name);toast(message,Boolean(error));}
}
function renderYourData(content,user) {
  const days=state.config.retention || {};
  const intro=node('section','panel data-panel'),lede=node('p','','Everything Nameflare keeps about your account, and how to take it with you or remove it. ');lede.append(link('How Nameflare handles your data','/guide/privacy','text-link'));intro.append(node('h2','','Your data'),lede);
  const exportRow=node('div','data-row'),exportText=node('div');exportText.append(node('h3','','Download my data'),node('p','form-footnote','One JSON file with your profile, connected platforms, Flares and their recipes, uploads, likes, follows, notifications and reports you sent. It never includes passwords, tokens or other people’s data.'));
  const download=link('Download my data','/api/account/export','button primary');download.setAttribute('download','nameflare-account.json');download.prepend(icon('download'));exportRow.append(exportText,download);intro.append(exportRow);
  const kept=node('section','panel data-panel');kept.append(node('h2','','How long things are kept'));
  const list=node('dl','retention-list');
  for(const [label,value] of [['Notifications',`${days.notifications_days || 180} days`],['Page-view counts (no personal data)',`${Math.round((days.page_view_days || 400)/30)} months`],['Disapproved Flares',`${days.rejected_flare_days || 365} days after the decision`],['Uploads no Flare uses',`${days.orphan_texture_days || 7} days`],['Details of closed reports',`${days.closed_report_detail_days || 90} days`],['Moderation history',`${Math.round((days.audit_days || 730)/365)} years`],['Sign-in sessions','7 days'],['Network fingerprints (hashed, for bans)',`${days.network_days || 90} days`]]){const item=node('div');item.append(node('dt','',label),node('dd','',value));list.append(item);}
  kept.append(list);
  const danger=node('section','panel data-panel data-danger');danger.append(node('h2','','Delete my account'));
  if(user.role==='owner'){danger.append(node('p','form-footnote','The owner account cannot be deleted. Hand ownership to another account first.'));content.append(intro,kept,danger);return;}
  danger.append(node('p','','This removes your profile, connected platforms, every Flare you made (including ones other people are wearing), your uploaded images, likes, follows and notifications. It happens straight away and cannot be undone.'),node('p','form-footnote','Reports you sent stay, without your name. The moderation log notes that an account was deleted. Nightly backups roll off within 14 days.'));
  const label=node('label','',`Type ${user.name} to confirm`),input=node('input');input.autocomplete='off';input.spellcheck=false;input.maxLength=80;label.append(input);
  const remove=action('Delete my account forever',()=>run(async()=>{remove.disabled=true;try{await api('/api/account/delete',{confirm:input.value.trim()});await refreshAccount();editor.accountChanged();navigate('/discover');toast('Your account and everything in it has been deleted.');}finally{if(remove.isConnected)remove.disabled=input.value.trim()!==user.name;}}),'button danger');
  remove.disabled=true;input.addEventListener('input',()=>{remove.disabled=input.value.trim()!==user.name;});
  danger.append(label,remove);content.append(intro,kept,danger);
}
// The question every wearer asks: who sees it?
function whereItShows(platformList) {
  const line=node('p','where-it-shows');line.append(icon('integrations'),node('span','',`Shows${platformList?` for your ${platformList} name`:''} in Nameflare chat overlays and apps that use the Nameflare API. `),link('Set up an overlay','/integrations','where-it-shows-link'));
  return line;
}
// First visit, signed out: one line of orientation, dismissible for good.
function syncFirstRun() {
  const strip=$('#first-run');if(!strip)return;
  let dismissed=false;try{dismissed=localStorage.getItem('nameflare.first-run')==='done';}catch{}
  strip.hidden=Boolean(state.user) || dismissed || state.view!=='discover';
}
$('#first-run-try')?.addEventListener('click',()=>{const input=$('#catalog-name');input?.focus();input?.select?.();});
$('#first-run-close')?.addEventListener('click',()=>{try{localStorage.setItem('nameflare.first-run','done');}catch{}$('#first-run').hidden=true;});
function creatorLink(cosmetic) {
  const id=cosmetic.creator_id || cosmetic.owner_id,name=cosmetic.creator || state.user?.name || 'creator';
  const element=id?link(`by ${name}`,`/profiles/${encodeURIComponent(id)}`,'creator-link'):node('span','creator-link',`by ${name}`);
  element.prepend(avatar({name,avatar_url:cosmetic.creator_avatar,profile_provider:cosmetic.creator_provider}));return element;
}
function joined(value) { return new Date(value).toLocaleDateString(undefined,{month:'long',year:'numeric'}); }
// Stats read as "4 Flares · 1 Likes · 1 Wearing": number first, label after.
// [data-stat] stays on the number so live like updates keep working.
function profileStats(user, cls='') {
  const stats=node('dl',`profile-stat-row ${cls}`.trim());
  for(const [key,label] of [['paints','Flares'],['likes','Likes'],['wears','Wearing']]){const item=fact(label,compactNumber(user.stats?.[key] || 0));item.querySelector('dd').dataset.stat=key;stats.append(item);}
  return stats;
}
// A creator's name rendered in the Flare they wear: the identity is the hero.
function profileStage(user, cls) {
  const stage=node('div',`profile-stage ${cls}`),name=node('strong','',user.name);name.setAttribute('aria-hidden','true');
  if(user.cosmetic){applyCosmetic(name,user.cosmetic);const colors=user.cosmetic.recipe.colors || [];if(colors[0])stage.style.setProperty('--paint-color',colors[0]);if(colors[1])stage.style.setProperty('--paint-secondary',colors[1]);}
  else stage.classList.add('is-plain');
  stage.append(name);fitPreviewName(name,user.name);return stage;
}
function profileBadge(user) { return moderatorBadge(user) || artistBadge(user); }
// Public channel URL for a linked platform, or null when the stored login is
// not a safe, known shape. Twitch/Kick use the login; YouTube uses the channel ID.
function platformUrl(identity) {
  const login=String(identity?.login || '');
  if(identity?.provider==='twitch' && /^[a-zA-Z0-9_]{1,40}$/.test(login))return `https://www.twitch.tv/${encodeURIComponent(login.toLowerCase())}`;
  if(identity?.provider==='kick' && /^[a-zA-Z0-9_-]{1,40}$/.test(login))return `https://kick.com/${encodeURIComponent(login.toLowerCase())}`;
  if(identity?.provider==='youtube' && /^UC[a-zA-Z0-9_-]{22}$/.test(String(identity.provider_id || '')))return `https://www.youtube.com/channel/${identity.provider_id}`;
  return null;
}
function platformHandle(identity) {
  const login=String(identity?.login || '');
  if(identity?.provider==='youtube')return login.startsWith('@')?login:(identity.display_name || login);
  return login || identity?.display_name || '';
}
// One platform as a pill: brand-coloured logo, handle, platform name, and an
// external-link arrow when it opens the channel. `compact` drops the text.
function platformLink(identity, {compact=false, cls=''}={}) {
  const href=platformUrl(identity),name=providerNames[identity.provider] || identity.provider,handle=platformHandle(identity);
  const el=node(href?'a':'span',`plat-link plat-${identity.provider}${compact?' is-compact':''} ${cls}`.trim());
  const logo=node('span','plat-logo');logo.append(platformLogo(identity.provider));el.append(logo);
  if(!compact){const text=node('span','plat-text');text.append(node('span','plat-handle',handle),node('span','plat-name',name));el.append(text);}
  if(href){el.href=href;el.target='_blank';el.rel='noopener noreferrer';el.title=`Open ${handle} on ${name}`;el.setAttribute('aria-label',`${handle} on ${name} (opens in a new tab)`);if(!compact)el.append(icon('external','plat-out'));}
  else{el.title=`${handle} on ${name}`;if(compact)el.setAttribute('aria-label',`${handle} on ${name}`);}
  return el;
}
function platformLinks(identities, options) { const list=node('div','plat-list');for(const identity of identities || [])list.append(platformLink(identity,options));return list; }
function profileCard(user, detail=false, readRevision=follows.revision) { return detail?profileHero(user,readRevision):creatorCard(user,readRevision); }
// Names on profile cards stay on one line: a name that does not fit is set a
// little smaller, step by step, down to 62% of its size (then it ellipsizes).
const lineFitObserver='ResizeObserver' in window?new ResizeObserver(entries=>{for(const entry of entries)for(const el of entry.target.querySelectorAll('[data-fit-line]'))fitLine(el);}):null;
function fitLine(el) {
  if(!el.isConnected)return;
  el.style.fontSize='';
  if(el.scrollWidth<=el.clientWidth+1)return;
  const base=parseFloat(getComputedStyle(el).fontSize),min=base*.62;
  let size=Math.max(min,Math.floor(base*el.clientWidth/el.scrollWidth*10)/10);el.style.fontSize=`${size}px`;
  while(size>min && el.scrollWidth>el.clientWidth+1){size=Math.max(min,size-.5);el.style.fontSize=`${size}px`;}
}
function fitName(el) {
  el.dataset.fitLine='';el.classList.add('fit-line');
  requestAnimationFrame(()=>{fitLine(el);if(el.parentElement)lineFitObserver?.observe(el.parentElement);});
  return el;
}
document.fonts?.ready.then(()=>{for(const el of document.querySelectorAll('[data-fit-line]'))fitLine(el);});
function creatorCard(user, readRevision) {
  const href=`/profiles/${encodeURIComponent(user.id)}`,card=node('article','creator-tile');card.dataset.profileId=user.id;card.style.setProperty('--profile-color',user.profile_color || '#ff355e');
  const stage=profileStage(user,'cc-stage');stage.append(node('span','cc-wearing',user.cosmetic?user.cosmetic.name:'No Flare yet'));
  const body=node('div','cc-body'),who=node('div','cc-who'),text=node('div','cc-text'),nameRow=node('div','cc-name');
  nameRow.append(fitName(link(user.name,href,'cc-link')));
  // The badge sits on the second line so the name keeps the whole first line.
  const sub=node('div','cc-sub');if(user.identities?.length){sub.append(platformLink(user.identities[0],{cls:'cc-plat'}));for(const extra of user.identities.slice(1))sub.append(platformLink(extra,{compact:true,cls:'cc-plat'}));}else sub.append(node('span','',`Joined ${joined(user.created_at)}`));
  const badge=profileBadge(user);if(badge)sub.append(badge);
  text.append(nameRow,sub);who.append(avatar(user,'cc-avatar'),text,followButton(user,readRevision));body.append(who);
  if(user.bio)body.append(node('p','cc-bio',user.bio));
  body.append(profileStats(user,'cc-stats'));card.append(stage,body);return card;
}
function profileHero(user, readRevision) {
  const hero=node('article','profile-hero');hero.dataset.profileId=user.id;hero.style.setProperty('--profile-color',user.profile_color || '#ff355e');
  const stage=profileStage(user,'ph-stage');
  if(user.cosmetic){const wearing=action('',()=>openDetails(user.cosmetic),'ghost ph-wearing');controlLabel(wearing,`Wearing ${user.cosmetic.name}`);wearing.setAttribute('aria-label',`View ${user.cosmetic.name}, the Flare ${user.name} is wearing`);wearing.append(icon('arrow','ph-wearing-arrow'));stage.append(wearing);}
  const body=node('div','ph-body'),top=node('div','ph-top'),identity=node('div','ph-identity'),nameRow=node('div','ph-name');
  const title=node('h1','',user.name);title.tabIndex=-1;title.id='profile-title';nameRow.append(fitName(title));const badge=profileBadge(user);if(badge)nameRow.append(badge);
  const meta=node('div','ph-meta');meta.append(node('span','ph-joined',`Joined ${joined(user.created_at)}`));
  identity.append(nameRow,meta);if(user.identities?.length)identity.append(platformLinks(user.identities,{cls:'ph-plat'}));
  const actions=node('div','ph-actions');
  if(state.user?.id===user.id)actions.append(link('Edit profile','/account/settings','button subtle'));
  const share=action('Share',()=>shareProfile(user),'button subtle ph-share');const glyph=icon('share');glyph.setAttribute('slot','start');share.prepend(glyph);
  const follow=followButton(user,readRevision);follow.setAttribute('size','s');actions.append(share,follow);
  if(state.config?.features?.reports && state.user?.id!==user.id){const report=action('',()=>openReport('user',user.id,user.name),'button ghost ph-report');report.setAttribute('aria-label',`Report ${user.name}`);report.title='Report this profile';report.append(icon('flag'));actions.append(report);}
  top.append(avatar(user,'ph-avatar'),identity,actions);body.append(top);
  if(user.bio)body.append(node('p','ph-bio',user.bio));
  body.append(profileStats(user,'ph-stats'));hero.append(stage,body);return hero;
}
let profileRequest=0;
async function loadProfiles(id) {
  const request=++profileRequest,readRevision=follows.revision,hash=currentRoute(),grid=$('#profile-results');$('#profile-status').textContent=id?'Loading creator…':'Finding creators…';
  $('#profile-directory-heading').hidden=Boolean(id);$('#profile-search-tools').hidden=Boolean(id);$('#profile-back').hidden=!id;grid.classList.toggle('profile-detail-grid',Boolean(id));grid.setAttribute('aria-busy','true');
  let result;
  try { result=await api(id?`/api/v1/profiles/${encodeURIComponent(id)}`:`/api/v1/profiles?q=${encodeURIComponent(state.profileQuery)}&offset=${state.profileOffset}`); }
  catch(error){if(request===profileRequest && state.view==='profiles' && currentRoute()===hash){empty(grid,'Profile unavailable.','This profile may be unavailable, or your connection was interrupted.',null);grid.firstChild.append(action('Try again',()=>loadProfiles(id),'button primary'),link('Browse creators','/profiles','button subtle'));$('#profile-status').textContent='Could not load profiles.';grid.setAttribute('aria-busy','false');$('#profile-pagination').replaceChildren();}throw error;}
  if(request!==profileRequest || state.view!=='profiles' || currentRoute()!==hash)return;
  const users=id?[result.user]:result.users;grid.replaceChildren(...users.map(user=>profileCard(user,Boolean(id),readRevision)));grid.setAttribute('aria-busy','false');
  if(id){document.title=`${result.user.name} · Nameflare`;$('#page-label').textContent=result.user.name;$('#profile-title').focus({preventScroll:true});}
  if(id){const gallery=createdFlares(result.user);gallery.section.classList.add('profile-created-flares');grid.append(gallery.section);await run(gallery.load);if(request!==profileRequest || state.view!=='profiles' || currentRoute()!==hash)return;}
  if(!users.length)empty(grid,'No matching profiles.','Try another name, platform login, or platform ID.',null);
  $('#profile-status').textContent=id?'':`${users.length} profiles shown`;
  const paging=$('#profile-pagination');paging.replaceChildren();
  if(!id && state.profileOffset>0)paging.append(action('← Previous',()=>{state.profileOffset=Math.max(0,state.profileOffset-24);return loadProfiles();}));
  if(!id && result.next_offset!==null)paging.append(action('Next →',()=>{state.profileOffset=result.next_offset;return loadProfiles();}));
}
let profileTimer;$('#profile-search').addEventListener('input',()=>{clearTimeout(profileTimer);state.profileQuery=$('#profile-search').value;state.profileOffset=0;profileTimer=setTimeout(()=>run(()=>{if(currentRoute()!=='/profiles')navigate('/profiles');else return loadProfiles();}),250);});
const artistPreviews=new Map();
function artistCard(user,readRevision) {
  const panel=node('article','panel artist-card'),heading=node('div','profile-header'),identity=node('div','profile-heading'),nameRow=node('div','profile-name-row');
  panel.dataset.profileId=user.id;nameRow.append(fitName(link(user.name,`/profiles/${encodeURIComponent(user.id)}`,'profile-link')),artistBadge(user));
  identity.append(nameRow,node('p','form-footnote',`${compactNumber(user.stats.paints)} public Flares · ${compactNumber(user.stats.likes)} likes received`));heading.append(avatar(user,'avatar-large'),identity);panel.append(heading);
  if(user.bio)panel.append(node('p','profile-bio',user.bio));
  const flares=node('div','artist-flares');
  for(const cosmetic of user.flares){
    const preview=action('',()=>openDetails(cosmetic),'artist-flare'),name=node('strong','',user.name);
    preview.setAttribute('aria-label',`View ${cosmetic.name} by ${user.name}`);applyCosmetic(name,cosmetic,location.origin,{paused:state.artistPaused});artistPreviews.set(name,cosmetic);
    preview.append(name,node('span','',cosmetic.name));flares.append(preview);
  }
  if(!user.flares.length)flares.append(node('p','form-footnote','Their next signature is on its way. Public Flares will appear here after approval.'));
  const actions=node('div','profile-actions');actions.append(followButton(user,readRevision),link('Explore artist →',`/profiles/${encodeURIComponent(user.id)}`,'button subtle'));panel.append(flares,actions);return panel;
}
let artistRequest=0,artistTimer;
async function loadArtists() {
  const request=++artistRequest,route=currentRoute(),grid=$('#artist-results'),paging=$('#artist-pagination'),status=$('#artist-status'),readRevision=follows.revision,likeRevision=likes.revision;
  grid.setAttribute('aria-busy','true');status.textContent='Finding artists…';paging.replaceChildren();
  try {
    if(state.config.runtime==='cloudflare')throw new Error('The artist showcase is available on the official Oracle/Node service.');
    const result=await api(`/api/v1/artists?q=${encodeURIComponent(state.artistQuery)}&offset=${state.artistOffset}`);
    if(request!==artistRequest || state.view!=='artists' || currentRoute()!==route)return;
    artistPreviews.clear();for(const user of result.users)for(const cosmetic of user.flares)cosmetic.like_read_revision=likeRevision;
    if(result.users.length)grid.replaceChildren(...result.users.map(user=>artistCard(user,readRevision)));
    else empty(grid,state.artistQuery?'No matching artists.':'The artist spotlight is warming up.',state.artistQuery?'Try a different name, platform login, or ID.':'Owner-selected artists will appear here. In the meantime, explore the community’s public Flares.','/discover','Explore Flares →');
    status.textContent=`${result.users.length} artists shown${result.next_offset!==null?' · more to explore':''}`;
    if(state.artistOffset>0)paging.append(action('← Previous',()=>{state.artistOffset=Math.max(0,state.artistOffset-24);return loadArtists();}));
    if(result.next_offset!==null)paging.append(action('Next →',()=>{state.artistOffset=result.next_offset;return loadArtists();}));
  } catch(error) {
    if(request===artistRequest && state.view==='artists' && currentRoute()===route){artistPreviews.clear();empty(grid,'Couldn’t load the artist showcase.',error.message,null);grid.firstChild.append(action('Try again',loadArtists,'button primary'));status.textContent='Artist showcase unavailable.';}
    throw error;
  } finally {if(request===artistRequest)grid.setAttribute('aria-busy','false');}
}
$('#artist-search').addEventListener('input',()=>{clearTimeout(artistTimer);state.artistQuery=$('#artist-search').value;state.artistOffset=0;artistTimer=setTimeout(()=>{if(state.view==='artists')run(loadArtists);},250);});
$('#artist-pause').addEventListener('click',()=>{state.artistPaused=!state.artistPaused;$('#artist-pause').textContent=state.artistPaused?'Resume previews':'Pause previews';$('#artist-pause').setAttribute('aria-pressed',String(state.artistPaused));for(const [element,cosmetic] of artistPreviews)applyCosmetic(element,cosmetic,location.origin,{paused:state.artistPaused});});
function reviewCard(cosmetic) {
  const article=node('article','review-card');article.dataset.paintId=cosmetic.id;
  const preview=node('div','review-preview'),name=node('strong','',cosmetic.creator);applyCosmetic(name,cosmetic);preview.append(name);
  const controls=node('div','review-preview-controls');let paused=false;
  const pause=action('Pause motion',()=>{paused=!paused;pause.textContent=paused?'Resume motion':'Pause motion';pause.setAttribute('aria-pressed',String(paused));applyCosmetic(name,cosmetic,location.origin,{paused});});pause.setAttribute('aria-pressed','false');
  const backdrop=action('Light backdrop',()=>{const light=preview.classList.toggle('light');backdrop.textContent=light?'Dark backdrop':'Light backdrop';backdrop.setAttribute('aria-pressed',String(light));});backdrop.setAttribute('aria-pressed','false');controls.append(pause,backdrop);
  const meta=node('div','card-meta');meta.append(node('span',`badge ${cosmetic.status}`,({pending:'Awaiting review',approved:'Approved',rejected:'Disapproved'}[cosmetic.status])),node('h3','',cosmetic.name));
  const creator=node('div','review-creator');creator.append(avatar({name:cosmetic.creator,avatar_url:cosmetic.creator_avatar,profile_provider:cosmetic.creator_provider}),node('strong','',cosmetic.creator));meta.append(creator,node('p','card-note',cosmetic.description || 'No description supplied.'));
  const facts=node('dl','review-facts');facts.append(fact('Submitted',date(cosmetic.created_at)),fact('Reviewed',date(cosmetic.reviewed_at)),fact('Reviewer',cosmetic.reviewer || 'Awaiting review'),fact('Flare ID',cosmetic.id),fact('Creator account',cosmetic.owner_id),fact('Publication',cosmetic.listed?'Public · Discover after approval':'Unlisted · link only after approval'));
  for(const identity of cosmetic.creator_identities || [])facts.append(fact(providerNames[identity.provider],`${identity.display_name} · ${identity.provider_id}`));
  const inspection=node('details','recipe-details');inspection.append(node('summary','','Submission & account details'),facts);meta.append(node('p','card-note',`Submitted ${date(cosmetic.created_at)} · ${cosmetic.listed?'Public listing':'Unlisted'}`),inspection);
  if(cosmetic.reason)meta.append(node('p','review-feedback',`Decision note: ${cosmetic.reason}`));
  const recipe=node('details','recipe-details');recipe.append(node('summary','','Inspect full Flare recipe'),node('pre','',JSON.stringify(cosmetic.recipe,null,2)));meta.append(recipe,creatorPanel(cosmetic));
  if(cosmetic.status!=='rejected' || state.user.role==='owner'){
    const label=node('label','review-note',cosmetic.status==='approved'?'Revocation reason (required)':'Review note (required for disapproval)'),note=node('textarea');note.rows=3;note.maxLength=400;note.placeholder='Leave specific, constructive feedback…';label.append(note);meta.append(label);
    meta.append(quickNotes(note));
    const actions=node('div','card-actions');
    const decisions=(cosmetic.status==='pending' || cosmetic.status==='rejected')?[['approved','Approve ✓','button primary'],['rejected','Disapprove','button danger']]:[['rejected','Revoke approval','button danger']];
    for(const [status,title,cls] of decisions){
      const button=action(title,async()=>{
        if(status==='rejected'&&note.value.trim().length<3)throw new Error('Add a reason of at least 3 characters.');
        if(cosmetic.status==='approved'){
          const confirmed=await confirmModeration({title:'Revoke approval?',description:'This Flare will leave the public API and be unequipped for everyone.',label:'Revoke approval',onConfirm:()=>api('/api/admin/review',{id:cosmetic.id,status,reason:note.value.trim(),expect:'approved'})});
          if(confirmed){toast('Approval revoked. Equipped assignments cleared.',false,null,{action:{label:'Undo',fn:()=>undoDecision(cosmetic)}});await refreshModeration();}return;
        }
        for(const item of actions.querySelectorAll('button'))item.disabled=true;
        try{
          // `expect` makes a decision on stale state fail instead of overwriting someone else's.
          await api('/api/admin/review',{id:cosmetic.id,status,reason:note.value.trim(),expect:cosmetic.status});
          markDecided(cosmetic.id,{action:status==='approved'?'cosmetic.approved':'cosmetic.rejected',actor:state.user.name,at:new Date().toISOString(),mine:true});
          if(cosmetic.status==='pending')state.knownPending=Math.max(0,(state.knownPending ?? 1)-1);
          state.lastDecision=cosmetic;state.catalogLoaded=false;
          toast(status==='approved'?`Approved “${cosmetic.name}”.`:`Disapproved “${cosmetic.name}” with feedback.`,false,null,{action:{label:'Undo',fn:()=>undoDecision(cosmetic)}});
          const next=nextOpenIndex(state.reviewIndex);if(next!==null)selectReview(next);else{syncLiveMarks();empty($('#review-detail'),'You’re all caught up.','Everything in this view has a decision. New submissions show up here as they arrive.',null);}
        }
        catch(error){
          if(error.status===409){markDecided(cosmetic.id,{action:'cosmetic.'+(error.conflict?.status==='pending'?'reopened':error.conflict?.status || 'approved'),actor:error.conflict?.reviewer || 'another moderator',at:error.conflict?.reviewed_at || new Date().toISOString(),mine:false});syncLiveMarks();}
          for(const item of actions.querySelectorAll('button'))item.disabled=state.user?.role!=='owner' && cosmetic.owner_id===state.user?.id;throw error;
        }
      },cls);button.dataset.decision=status;button.disabled=state.user.role!=='owner' && cosmetic.owner_id===state.user.id;actions.append(button);
    }
    if(state.user.role!=='owner' && cosmetic.owner_id===state.user.id)meta.append(node('p','form-footnote','Another reviewer must decide on your own Flare.'));meta.append(actions);
  }
  if(cosmetic.media_flags?.length){const flag=node('p','review-flag');flag.append(icon('flag'),node('span','',`The image scanner asked for a closer look at ${cosmetic.media_flags.length===1?'this Flare’s image':`${cosmetic.media_flags.length} of its images`}.`));meta.prepend(flag);}
  if(cosmetic.open_reports){const flag=node('p','review-flag'),text=node('span','',`${cosmetic.open_reports} open ${cosmetic.open_reports===1?'report':'reports'} · `);text.append(link('See reports','/moderation/reports','text-button'));flag.append(text);meta.prepend(flag);}
  const hasImages=(cosmetic.recipe?.layers || []).some(layer=>layer.type==='image') || Boolean(cosmetic.recipe?.textureId);let blockImages=null;
  if(cosmetic.status==='rejected' && hasImages && state.config.features?.reports){const label=node('label','checkbox-label review-block');blockImages=node('input');blockImages.type='checkbox';label.append(blockImages,document.createTextNode(' Also block its images from being uploaded again'));meta.append(label);}
  if(cosmetic.status==='rejected' && state.config.runtime!=='cloudflare')meta.append(action('Permanently delete Flare',async()=>{
    const confirmed=await confirmModeration({title:'Delete this Flare forever?',description:`“${cosmetic.name}” and its unshared image files will be removed. There is no in-app undo. Audit history and existing backups remain.`,label:'Permanently delete Flare',onConfirm:()=>api('/api/admin/cosmetics/delete',{id:cosmetic.id,confirm:true,...(blockImages?.checked?{block_images:true}:{})})});
    if(!confirmed)return;
    const buttons=article.querySelectorAll('button');for(const button of buttons)button.disabled=true;
    try {
      article.remove();toast('Flare permanently deleted. Unshared image files removed.');
      await Promise.all([loadReviews(),loadAudit(),loadCatalog()]);
    } finally {for(const button of buttons)if(button.isConnected)button.disabled=false;}
  },'button danger'));
  if(state.user.role==='owner')meta.append(action(cosmetic.listed?'Make unlisted':'List publicly',async()=>{await api('/api/cosmetics/publication',{id:cosmetic.id,listed:!Boolean(cosmetic.listed)});await loadReviews();await loadAudit();await loadCatalog();}));
  const live=node('div','review-live');live.hidden=true;meta.prepend(live);
  const stage=node('div','review-stage'),stageBar=node('div','review-stage-bar');stageBar.append(node('span','review-stage-label','Name preview'),controls);const chat=node('p','review-chat-line'),chatName=node('strong','',cosmetic.creator);applyCosmetic(chatName,cosmetic);chat.append(chatName,document.createTextNode(' this one feels like me'));stage.append(stageBar,preview,chat);
  article.append(stage,meta);return article;
}
let reviewRequest=0,userRequest=0,banRequest=0;
let moderationConfirmation;
const moderationDialog=$('#moderation-dialog');
$('#moderation-cancel').addEventListener('click',()=>moderationDialog.close());
moderationDialog.addEventListener('cancel',event=>{if(moderationConfirmation?.busy)event.preventDefault();});
moderationDialog.addEventListener('click',event=>{if(moderationConfirmation?.busy)event.stopImmediatePropagation();},true);
moderationDialog.addEventListener('close',()=>{
  const current=moderationConfirmation;moderationConfirmation=null;current?.resolve(current.saved || false);
  if(current?.origin?.isConnected)current.origin.focus({preventScroll:true});
});
$('#moderation-confirm-form').addEventListener('submit',event=>{
  event.preventDefault();const current=moderationConfirmation;if(!current || current.busy)return;
  current.busy=true;$('#moderation-confirm').disabled=true;$('#moderation-cancel').disabled=true;$('#moderation-dialog-error').hidden=true;
  run(async()=>{
    try{await current.onConfirm($('#moderation-reason').value.trim());current.saved=true;moderationDialog.close();}
    catch(error){$('#moderation-dialog-error').textContent=error.message;$('#moderation-dialog-error').hidden=false;}
    finally{current.busy=false;$('#moderation-confirm').disabled=false;$('#moderation-cancel').disabled=false;}
  });
});
function confirmModeration({title,description,label,user,ban=false,reasonLabel='',onConfirm}) {
  if(moderationDialog.open)return Promise.resolve(false);
  $('#moderation-dialog-title').textContent=title;$('#moderation-dialog-description').textContent=description;
  const askReason=ban || Boolean(reasonLabel);$('#moderation-reason-label').firstChild.textContent=reasonLabel || 'Reason for permanent ban';$('#moderation-reason').placeholder=reasonLabel?'Why is this account being deleted? For example: spam account, or the person asked for it.':'Describe the policy violation. This is saved in the audit trail.';
  $('#moderation-confirm').textContent=label;$('#moderation-reason-label').hidden=!askReason;$('#moderation-reason').required=askReason;$('#moderation-reason').value='';
  const duration=$('#moderation-duration');duration.value='';$('#moderation-duration-label').hidden=!ban;
  const syncAck=()=>{const permanent=ban && !duration.value;$('#moderation-ack-label').hidden=!permanent;$('#moderation-ack').required=permanent;$('#moderation-confirm').textContent=ban?(permanent?'Permanently ban account':`Suspend for ${duration.value} ${duration.value==='1'?'day':'days'}`):label;};
  duration.onchange=syncAck;$('#moderation-ack').checked=false;syncAck();$('#moderation-dialog-error').hidden=true;
  const account=$('#moderation-dialog-account');account.replaceChildren();account.hidden=!user;
  if(user){const detail=node('div');detail.append(node('strong','',user.name),node('small','',user.id));account.append(avatar(user),detail);}
  return new Promise(resolve=>{moderationConfirmation={resolve,onConfirm,origin:document.activeElement};moderationDialog.showModal();$('#moderation-cancel').focus();});
}
async function refreshModeration(){await Promise.all([loadUsers(),loadUsers('banned'),loadReviews(),loadAudit(),loadReports()]);state.catalogLoaded=false;}
const reportReasonNames={rights:'Uses art without permission',sexual:'Sexual or graphic',hate:'Hateful or violent',harassment:'Harassment',impersonation:'Impersonation',spam:'Spam or scam',other:'Something else'};
async function loadReports() {
  const list=$('#moderation-reports');if(!list)return;const userId=state.user?.id,status=state.reportStatus;
  const result=await api(`/api/admin/reports?status=${status}&offset=0`);
  if(state.view!=='moderation' || state.user?.id!==userId || $('#moderation-reports')!==list || state.reportStatus!==status)return;
  list.replaceChildren();
  const openTab=document.querySelector('[data-report-status="open"] span');if(openTab)openTab.textContent=result.open?`Open · ${result.open}`:'Open';
  if(!result.groups.length){empty(list,status==='open'?'No open reports.':'Nothing resolved yet.',status==='open'?'When someone reports a Flare or a profile, it shows up here.':'Resolved reports stay here for a year; their details are cleared after 90 days.',null);return;}
  for(const group of result.groups)list.append(reportCard(group,status==='open'));
}
function reportCard(group,open) {
  const article=node('article','report-card'),head=node('div','report-head'),target=group.target,cosmetic=group.target_type==='cosmetic';
  const subject=node('div','report-subject');
  if(!target)subject.append(node('strong','',cosmetic?'Deleted Flare':'Deleted account'),node('small','',group.target_id));
  else if(cosmetic){
    const stage=node('div','report-stage'),name=node('strong','',target.creator);applyCosmetic(name,target,location.origin,{paused:true});stage.append(name);
    const detail=node('div','report-subject-text');detail.append(node('strong','',target.name),node('small','',`by ${target.creator} · ${({approved:'Approved',pending:'Awaiting review',rejected:'Disapproved'})[target.status]}`));
    const view=link('Open Flare',`/discover/${encodeURIComponent(target.id)}`,'text-button');subject.append(stage,detail,view);
  } else {
    const detail=node('div','report-subject-text');detail.append(node('strong','',target.name),node('small','',target.banned?'Banned account':'Profile'));
    subject.append(avatar(target),detail);if(!target.banned)subject.append(link('Open profile',`/profiles/${encodeURIComponent(target.id)}`,'text-button'));
  }
  head.append(subject,node('span','report-count',`${group.reports} ${group.reports===1?'report':'reports'}`));article.append(head);
  const items=node('ul','report-items');
  for(const item of group.items){
    const row=node('li'),top=node('div','report-item-head');top.append(node('strong','',reportReasonNames[item.reason] || item.reason),node('small','',`${item.reporter} · ${timeAgo(item.created_at) || date(item.created_at)}`));row.append(top);
    if(item.details)row.append(node('p','',item.details));
    if(!open && item.resolution)row.append(node('p','report-resolution',`${item.status==='dismissed'?'Dismissed':'Actioned'}${item.resolver?` by ${item.resolver}`:''}: ${item.resolution}`));
    items.append(row);
  }
  article.append(items);
  if(open && target){
    const form=node('div','report-actions'),label=node('label','report-note','Decision note'),note=node('textarea');note.rows=2;note.maxLength=400;note.placeholder='Required to remove or ban. Saved in the activity log.';label.append(note);form.append(label);
    const hasImages=cosmetic && ((target.recipe?.layers || []).some(layer=>layer.type==='image') || Boolean(target.recipe?.textureId));let block=null;
    if(hasImages){const option=node('label','checkbox-label');block=node('input');block.type='checkbox';option.append(block,document.createTextNode(' Block its images from being uploaded again'));form.append(option);}
    const buttons=node('div','card-actions');
    const resolve=(actionName)=>run(async()=>{
      if(actionName!=='dismiss' && note.value.trim().length<3){note.focus();throw new Error('Write a short decision note first.');}
      for(const button of buttons.querySelectorAll('button'))button.disabled=true;
      // Only the reports this moderator saw are closed; newer ones stay open.
      try{const result=await api('/api/admin/reports/resolve',{target_type:group.target_type,target_id:group.target_id,action:actionName,note:note.value,seen_through:Math.max(...group.items.map(item=>item.id)),...(block?.checked?{block_images:true}:{})});toast(`${actionName==='dismiss'?'Reports dismissed.':actionName==='remove'?'Flare removed. Reports resolved.':'Account banned. Reports resolved.'}${result.remaining?` ${result.remaining} new ${result.remaining===1?'report':'reports'} arrived meanwhile and ${result.remaining===1?'stays':'stay'} open.`:''}`);releaseClaim();await Promise.all([loadReports(),refreshModBadge()]);state.catalogLoaded=false;}
      catch(error){if(error.status===409){article.classList.add('is-resolved');run(loadReports);}throw error;}
      finally{for(const button of buttons.querySelectorAll('button'))if(button.isConnected)button.disabled=false;}
    });
    buttons.append(action('Dismiss',()=>resolve('dismiss'),'button subtle'));
    if(cosmetic && target.status!=='rejected')buttons.append(action('Remove Flare',()=>resolve('remove'),'button danger'));
    const owner=cosmetic?target.owner_id:target.id;
    if(owner!==state.user.id && !(!cosmetic && target.banned))buttons.append(action(cosmetic?'Ban creator':'Ban account',()=>resolve('ban'),'button danger'));
    form.append(buttons);article.append(form);
    article.addEventListener('focusin',()=>run(()=>claim(`report:${group.target_type}:${group.target_id}`)));
    const watchers=claimsOn(`report:${group.target_type}:${group.target_id}`);
    if(watchers.length)head.append(node('span','report-watch',`${watchers.map(w=>w.name).join(', ')} looking`));
  }
  return article;
}
const reportDialog=$('#report-dialog');let reportTarget=null;
function openReport(type,id,name) {
  if(!state.user){toast('Sign in to send a report.');openSignIn();return;}
  reportTarget={type,id};$('#report-form').reset();$('#report-error').hidden=true;
  $('#report-title').textContent=type==='cosmetic'?`Report “${name}”`:`Report ${name}`;
  reportDialog.showModal();
}
$('#report-cancel').addEventListener('click',()=>reportDialog.close());
$('#report-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget,submit=$('#report-submit'),error=$('#report-error');
  submit.disabled=true;error.hidden=true;
  api('/api/reports',{target_type:reportTarget.type,target_id:reportTarget.id,reason:form.elements.reason.value,details:form.elements.details.value})
    .then(result=>{reportDialog.close();toast(result.report.updated?'Report updated. Moderators will see the new details.':'Thanks. Your report went to the moderators.');})
    .catch(failure=>{error.textContent=failure.message;error.hidden=false;})
    .finally(()=>{submit.disabled=false;});
});
async function eraseAccount(user) {
  const confirmed=await confirmModeration({title:'Delete this account?',description:user.banned_at?'Removes the profile, connected platforms, Flares, images, likes and follows. This account is banned, so its platform identities stay banned. This cannot be undone.':'Removes the profile, connected platforms, Flares, images, likes and follows. This is not a ban: the person can sign up again later. This cannot be undone.',label:'Delete account',user,reasonLabel:'Reason (saved in the activity log)',onConfirm:reason=>api('/api/admin/accounts/delete',{id:user.id,confirm:true,reason})});
  if(!confirmed)return;toast('Account deleted.');state.catalogLoaded=false;await Promise.all([loadUsers(),loadUsers('banned'),loadAudit()]);
}

// ---- Moderating together (2026.11) ------------------------------------------
// Live sync: open moderation pages poll /api/admin/live every few seconds for
// other moderators' decisions, queue counts and who is looking at what
// ("claims"). Claims are advisory: they warn, they never lock.
let liveTimer=null,claimTimer=null;
function startModerationLive(){if(!liveTimer){liveTimer=setInterval(pollModerationLive,5000);}}
function stopModerationLive(){clearInterval(liveTimer);liveTimer=null;releaseClaim();}
async function pollModerationLive(){
  if(state.view!=='moderation' || !['owner','moderator'].includes(state.user?.role)){stopModerationLive();return;}
  if(document.hidden)return;
  try{const result=await api(`/api/admin/live${state.liveSince!==null?`?since=${state.liveSince}`:''}`);state.liveSince=result.last_event;applyLive(result);}catch{}
}
function applyLive(result){
  state.claims=result.claims || [];renderOverview(result.overview);
  const pendingCount=$('[data-review-status="pending"] .review-count');if(pendingCount && result.overview){pendingCount.textContent=String(result.overview.pending);pendingCount.toggleAttribute('data-zero',!result.overview.pending);}
  if(result.overview){$('#mod-badge').textContent=String(result.overview.pending+result.overview.open_reports);$('#mod-badge').hidden=!(result.overview.pending+result.overview.open_reports);}
  for(const event of result.events || []){
    if(event.actor_id===state.user?.id)continue;
    if(/^cosmetic\.(approved|rejected|reopened)$/.test(event.action))markDecided(event.target,{action:event.action,actor:event.actor,at:event.created_at,mine:false});
    if(/^report\./.test(event.action))state.reportsStale=true;
  }
  syncLiveMarks();
  if(state.reportsStale && $('#moderation-reports') && !document.activeElement?.closest?.('.report-card')){state.reportsStale=false;run(loadReports);}
  const pill=$('#review-new');
  if(pill && state.reviewStatus==='pending' && state.knownPending!==null){
    const extra=(result.overview?.pending ?? state.knownPending)-state.knownPending;
    pill.hidden=extra<=0;if(extra>0)pill.querySelector('span').textContent=`${extra} new ${extra===1?'submission':'submissions'}`;
  }
}
function renderOverview(overview){
  const strip=$('#mod-overview');if(!strip || !overview)return;
  const others=[...new Set((state.claims || []).filter(claim=>claim.user_id!==state.user?.id).map(claim=>claim.name))];
  const chip=(value,label,href,warn)=>{const item=href?link('',href,'mod-stat'):node('span','mod-stat');if(warn)item.classList.add('is-warn');item.append(node('strong','',String(value)),node('span','',label));return item;};
  const oldest=overview.oldest_pending_at?timeAgo(overview.oldest_pending_at):'';
  const live=node('span','mod-live');live.append(node('i'),node('span','',others.length?`Live · also here: ${others.join(', ')}`:'Live'));
  strip.replaceChildren(
    chip(overview.pending,overview.pending===1?'awaiting review':'awaiting review','/moderation/reviews',overview.pending>0),
    ...(oldest?[chip(oldest.replace(/ ago$/,''),'oldest wait')]:[]),
    chip(overview.open_reports,overview.open_reports===1?'open report':'open reports','/moderation/reports',overview.open_reports>0),
    ...(overview.suspended?[chip(overview.suspended,'suspended','/moderation/settings')]:[]),
    chip(overview.decided_today,'decided by you today'),live);
}
function claimsOn(target){return (state.claims || []).filter(claim=>claim.target===target && claim.user_id!==state.user?.id);}
async function claim(target){
  if(state.claimTarget===target && claimTimer)return;
  clearInterval(claimTimer);state.claimTarget=target;
  const beat=async()=>{if(state.view!=='moderation' || state.claimTarget!==target){clearInterval(claimTimer);return;}try{const result=await api('/api/admin/claims',{target});state.claims=[...(state.claims || []).filter(item=>item.target!==target || item.user_id===state.user?.id),...result.claims];syncLiveMarks();}catch{}};
  claimTimer=setInterval(beat,15000);await beat();
}
function releaseClaim(){clearInterval(claimTimer);claimTimer=null;const target=state.claimTarget;state.claimTarget=null;if(target)api('/api/admin/claims',{target,active:false}).catch(()=>{});}
const decisionWords={'cosmetic.approved':'Approved','cosmetic.rejected':'Disapproved','cosmetic.reopened':'Reopened'};
function markDecided(id,info){state.decided.set(id,info);}
// Queue items and the open card show who else is looking and who decided what.
function syncLiveMarks(){
  for(const item of document.querySelectorAll('.review-item')){
    const cosmetic=state.reviewItems?.[Number(item.dataset.index)];if(!cosmetic)continue;
    const decided=state.decided.get(cosmetic.id),watchers=claimsOn(`cosmetic:${cosmetic.id}`);
    item.classList.toggle('is-decided',Boolean(decided && decided.action!=='cosmetic.reopened'));
    let mark=item.querySelector('.review-item-live');if(!mark){mark=node('span','review-item-live');item.querySelector('.review-item-text')?.append(mark);}
    mark.textContent=decided?`${decisionWords[decided.action] || 'Changed'} by ${decided.mine?'you':decided.actor}`:watchers.length?`${watchers.map(w=>w.name).join(', ')} looking`:'';
    mark.dataset.kind=decided?'decided':watchers.length?'watching':'';
  }
  const card=$('#review-detail .review-card');if(!card)return;
  const cosmetic=state.reviewItems?.find(item=>item.id===card.dataset.paintId);if(!cosmetic)return;
  const banner=card.querySelector('.review-live');if(!banner)return;
  const decided=state.decided.get(cosmetic.id),watchers=claimsOn(`cosmetic:${cosmetic.id}`);
  banner.replaceChildren();banner.hidden=!(decided || watchers.length);
  if(decided && !decided.mine && decided.action!=='cosmetic.reopened'){
    banner.dataset.kind='decided';banner.append(node('span','',`${decisionWords[decided.action]} by ${decided.actor} ${timeAgo(decided.at) || 'just now'}.`));
    const badge=card.querySelector('.card-meta > .badge');if(badge){badge.className=`badge ${decided.action==='cosmetic.approved'?'approved':'rejected'}`;badge.textContent=decisionWords[decided.action];}
    const next=nextOpenIndex(state.reviewIndex);if(next!==null)banner.append(action('Next submission',()=>selectReview(next),'button subtle sm'));
    for(const button of card.querySelectorAll('[data-decision]'))button.disabled=true;
  } else if(watchers.length){banner.dataset.kind='watching';banner.append(node('span','',`${watchers.map(w=>w.name).join(' and ')} ${watchers.length===1?'is':'are'} also looking at this.`));}
}
// Next item nobody has decided and nobody else is looking at.
function nextOpenIndex(from){
  const items=state.reviewItems || [];
  for(let step=1;step<=items.length;step++){const index=(from+step)%items.length,item=items[index];if(!state.decided.has(item.id) && !claimsOn(`cosmetic:${item.id}`).length)return index;}
  return null;
}
// Creator history and staff notes, shown with every submission.
function creatorPanel(cosmetic){
  const context=cosmetic.creator_context;if(!context)return node('div');
  const panel=node('section','creator-panel'),head=node('div','creator-panel-head');
  head.append(node('strong','',cosmetic.creator),node('small','',`Joined ${joined(context.joined)}${context.role==='artist'?' · Artist':''}`));
  const stats=node('div','creator-panel-stats');
  for(const [value,label,warn] of [[context.approved,'approved'],[context.rejected,'disapproved',context.rejected>0],[context.pending,'pending'],[context.reports_against,'open reports',context.reports_against>0]]){const stat=node('span',warn?'is-warn':'');stat.append(node('strong','',String(value)),document.createTextNode(` ${label}`));stats.append(stat);}
  panel.append(head,stats);
  if(context.recent_rejections?.length){const list=node('ul','creator-panel-rejections');for(const item of context.recent_rejections){const row=node('li');row.append(node('strong','',item.name),node('span','',` · ${item.reason || 'No note'}`));list.append(row);}panel.append(node('p','creator-panel-label','Recent disapprovals'),list);}
  panel.append(notesPanel(cosmetic.owner_id,context.notes || []));
  return panel;
}
function notesPanel(userId,notes){
  const wrap=node('div','notes-panel');
  const render=list=>{
    wrap.replaceChildren(node('p','creator-panel-label',`Staff notes${list.length?` · ${list.length}`:''}`));
    const items=node('ul','notes-list');
    for(const note of list){
      const row=node('li'),meta=node('small','',`${note.author} · ${timeAgo(note.created_at) || date(note.created_at)}`);row.append(node('p','',note.body),meta);
      if(state.user?.role==='owner' || note.author_id===state.user?.id){const remove=node('button','note-delete','Delete');remove.type='button';remove.addEventListener('click',()=>run(async()=>{render((await api('/api/admin/notes/delete',{id:note.id})).notes);}));meta.append(remove);}
      items.append(row);
    }
    if(list.length)wrap.append(items);
    const form=node('form','notes-form'),input=node('textarea');input.rows=2;input.maxLength=1000;input.placeholder='Add a note for other moderators: warnings, context, follow-ups…';input.setAttribute('aria-label','New staff note');
    const add=node('button','button subtle sm','Add note');add.type='submit';form.append(input,add);
    form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!input.value.trim())return;add.disabled=true;try{render((await api('/api/admin/notes',{user:userId,body:input.value})).notes);toast('Note saved for the team.');}finally{add.disabled=false;}});});
    wrap.append(form);
  };
  render(notes);return wrap;
}
const notesDialog=$('#notes-dialog');
$('#close-notes')?.addEventListener('click',()=>notesDialog.close());
async function openNotes(user){
  $('#notes-title').textContent=`Notes on ${user.name}`;$('#notes-body').replaceChildren(node('p','form-footnote','Loading…'));notesDialog.showModal();
  const result=await api(`/api/admin/notes?user=${encodeURIComponent(user.id)}`);$('#notes-body').replaceChildren(notesPanel(user.id,result.notes));
}
// Quick notes: built-in ones plus each moderator's own, saved in this browser.
const QUICK_NOTES_KEY='nameflare.quicknotes.v1';
const builtInNotes=[['Artwork rights','Please provide evidence that you own or have permission to use this artwork.'],['Readability','Please improve text contrast and readability at chat size.'],['Motion safety','Please reduce flashing or rapid motion before resubmitting.'],['Hateful content','This design contains hateful or harassing imagery, which is not allowed.'],['Impersonation','This copies another creator’s or brand’s look closely enough to mislead people.'],['Duplicate','This is very close to an existing Flare. Please make it more distinct.']];
function savedNotes(){try{const list=JSON.parse(localStorage.getItem(QUICK_NOTES_KEY) || '[]');return Array.isArray(list)?list.filter(item=>typeof item==='string').slice(0,12):[];}catch{return [];}}
function storeNotes(list){try{localStorage.setItem(QUICK_NOTES_KEY,JSON.stringify(list.slice(0,12)));}catch{}}
function quickNotes(note){
  const group=node('div','review-reason-options');group.setAttribute('role','group');group.setAttribute('aria-label','Suggested review notes');
  const fill=message=>{note.value=message;note.dispatchEvent(new Event('input',{bubbles:true}));note.focus();};
  const render=()=>{
    group.replaceChildren();
    for(const [title,message] of builtInNotes)group.append(action(title,()=>fill(message),'review-reason-chip'));
    for(const message of savedNotes()){const chip=node('span','saved-note');const use=node('button','saved-note-use',message.length>28?`${message.slice(0,28)}…`:message);use.type='button';use.title=message;use.addEventListener('click',()=>fill(message));const remove=node('button','saved-note-remove','×');remove.type='button';remove.setAttribute('aria-label','Remove this quick note');remove.addEventListener('click',()=>{storeNotes(savedNotes().filter(item=>item!==message));render();});chip.append(use,remove);group.append(chip);}
    const save=node('button','saved-note-add','Save as quick note');save.type='button';save.addEventListener('click',()=>{const value=note.value.trim();if(value.length<3){toast('Write the note first, then save it.',true);return;}storeNotes([value,...savedNotes().filter(item=>item!==value)]);render();toast('Saved to your quick notes in this browser.');});group.append(save);
  };
  render();return group;
}
// Bulk decisions on the pending queue.
function syncBulkBar(){
  const bar=$('#review-bulk');if(!bar)return;const count=state.bulk.size;bar.hidden=!count;
  bar.querySelector('.review-bulk-count').textContent=`${count} selected`;
  for(const box of document.querySelectorAll('.review-select input'))box.checked=state.bulk.has(box.dataset.id);
}
async function bulkDecide(status){
  const ids=[...state.bulk];if(!ids.length)return;
  let reason='';
  if(status==='rejected'){
    let entered='';const confirmed=await confirmModeration({title:`Disapprove ${ids.length} ${ids.length===1?'Flare':'Flares'}?`,description:'Every creator gets this note. Flares someone else already decided are skipped.',label:'Disapprove all',reasonLabel:'Note sent to each creator',onConfirm:value=>{entered=value;}});
    if(!confirmed)return;reason=entered;
  }
  const result=await api('/api/admin/review/bulk',{ids,status,reason});
  for(const item of result.results)if(item.ok)markDecided(item.id,{action:status==='approved'?'cosmetic.approved':'cosmetic.rejected',actor:state.user.name,at:new Date().toISOString(),mine:true});
  state.bulk.clear();syncBulkBar();syncLiveMarks();
  const skipped=result.results.filter(item=>!item.ok);
  toast(`${result.done} ${status==='approved'?'approved':'disapproved'}${skipped.length?` · ${skipped.length} skipped: ${skipped[0].error}`:''}`,Boolean(skipped.length));
  state.knownPending=Math.max(0,(state.knownPending ?? 0)-result.done);
}

const reviewStatusNames={pending:'Awaiting review',approved:'Approved',rejected:'Disapproved'};
async function undoDecision(cosmetic){
  await api('/api/admin/review/undo',{id:cosmetic.id});state.decided.delete(cosmetic.id);state.catalogLoaded=false;
  toast(`“${cosmetic.name}” is back where it was.`);state.reviewSelected=cosmetic.id;await loadReviews();
}
function renderReviewQueue(grid,cosmetics) {
  state.reviewItems=cosmetics;
  const list=node('div','review-queue'),detail=node('div','review-detail');list.setAttribute('role','listbox');list.setAttribute('aria-label',`${reviewStatusNames[state.reviewStatus]} submissions`);detail.id='review-detail';
  const items=cosmetics.map((cosmetic,index)=>{
    const item=node('button','review-item');item.type='button';item.setAttribute('role','option');item.dataset.index=String(index);item.id=`review-item-${index}`;
    const swatch=node('span','review-item-preview'),sample=node('strong','',cosmetic.name.slice(0,1).toUpperCase()+cosmetic.name.slice(1,3).toLowerCase());applyCosmetic(sample,cosmetic,location.origin,{paused:true});swatch.append(sample);
    const text=node('span','review-item-text');text.append(node('strong','',cosmetic.name),node('small','',`${cosmetic.creator} · ${timeAgo(cosmetic.created_at)}`));
    item.append(swatch,text,node('span',`review-item-status status-${cosmetic.status}`,cosmetic.listed?'Public':'Unlisted'));
    item.addEventListener('click',()=>selectReview(index,{focusItem:false}));
    if(state.reviewStatus!=='pending')return item;
    // Pending items can be picked for a bulk decision.
    const row=node('div','review-row'),pick=node('label','review-select'),box=node('input');box.type='checkbox';box.dataset.id=cosmetic.id;box.checked=state.bulk.has(cosmetic.id);box.setAttribute('aria-label',`Select ${cosmetic.name}`);
    box.addEventListener('change',()=>{if(box.checked)state.bulk.add(cosmetic.id);else state.bulk.delete(cosmetic.id);syncBulkBar();});pick.append(box);row.append(pick,item);return row;
  });
  list.append(...items);grid.replaceChildren(list,detail);
  const remembered=cosmetics.findIndex(c=>c.id===state.reviewSelected);
  selectReview(remembered>=0?remembered:Math.min(state.reviewIndex || 0,cosmetics.length-1),{focusItem:false,scroll:false});
}
function selectReview(index,{focusItem=true,scroll=true}={}) {
  const items=[...document.querySelectorAll('.review-item')].sort((a,b)=>Number(a.dataset.index)-Number(b.dataset.index)),cosmetic=state.reviewItems?.[index],detail=$('#review-detail');if(!cosmetic || !detail)return;
  state.reviewIndex=index;state.reviewSelected=cosmetic.id;
  for(const item of items){const selected=Number(item.dataset.index)===index;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;}
  $('.review-queue')?.setAttribute('aria-activedescendant',`review-item-${index}`);
  const card=reviewCard(cosmetic);card.classList.add('is-entering');detail.replaceChildren(card);
  const position=node('p','review-position',`${index+1} of ${state.reviewItems.length}`);card.prepend(position);
  run(()=>claim(`cosmetic:${cosmetic.id}`));syncLiveMarks();
  if(focusItem)items[index]?.focus({preventScroll:true});
  if(scroll)items[index]?.scrollIntoView({block:'nearest'});
}
document.addEventListener('keydown',event=>{
  if(state.view!=='moderation' || !state.reviewItems?.length || !$('#review-detail') || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey)return;
  if(isTyping(event))return;
  const key=event.key.toLowerCase();
  if(['j','arrowdown'].includes(key)){event.preventDefault();selectReview(Math.min((state.reviewIndex||0)+1,state.reviewItems.length-1));}
  else if(['k','arrowup'].includes(key)){event.preventDefault();selectReview(Math.max((state.reviewIndex||0)-1,0));}
  else if(key==='a'){const approve=$('#review-detail [data-decision="approved"]');if(approve && !approve.disabled){event.preventDefault();approve.click();}}
  else if(key==='d'){const note=$('#review-detail .review-note textarea');if(note){event.preventDefault();note.focus();}}
  else if(key==='r'){const note=$('#review-detail .review-note textarea'),reject=$('#review-detail [data-decision="rejected"]');if(!reject || reject.disabled)return;event.preventDefault();if(note && note.value.trim().length<3)note.focus();else reject.click();}
  else if(key==='n'){const next=nextOpenIndex(state.reviewIndex || 0);if(next!==null){event.preventDefault();selectReview(next);}}
  else if(key==='x' && state.reviewStatus==='pending'){const item=state.reviewItems[state.reviewIndex];if(item){event.preventDefault();if(state.bulk.has(item.id))state.bulk.delete(item.id);else state.bulk.add(item.id);syncBulkBar();}}
  else if(key==='u' && state.lastDecision){event.preventDefault();run(()=>undoDecision(state.lastDecision));state.lastDecision=null;}
  else if(key==='/'){const search=document.querySelector('.review-search input');if(search){event.preventDefault();search.focus();}}
});
async function loadReviews() {
  const grid=$('#review-results');if(!grid)return;
  const request=++reviewRequest,userId=state.user?.id;grid.setAttribute('aria-busy','true');
  let result;
  try{result=await api(`/api/admin/queue?status=${state.reviewStatus}&q=${encodeURIComponent(state.reviewQuery)}&offset=${state.reviewOffset}&filter=${state.reviewFilter}&sort=${state.reviewStatus==='pending'?state.reviewSort:state.reviewSort==='oldest'?'newest':state.reviewSort}`);}
  catch(error){if(request===reviewRequest && grid.isConnected){empty(grid,'Couldn’t load the review queue.',error.message,null);grid.firstChild.append(action('Try again',loadReviews));}throw error;}
  finally{if(request===reviewRequest)grid.setAttribute('aria-busy','false');}
  if(request!==reviewRequest || state.view!=='moderation' || state.user?.id!==userId || $('#review-results')!==grid)return;
  $('#mod-badge').textContent=result.stats.pending;$('#mod-badge').hidden=result.stats.pending===0;
  state.claims=result.claims || [];state.decided.clear();state.knownPending=result.overview?.pending ?? null;if(state.liveSince===null)state.liveSince=result.last_event;
  for(const id of [...state.bulk])if(!result.cosmetics.some(item=>item.id===id))state.bulk.delete(id);
  renderOverview(result.overview);syncBulkBar();if($('#review-new'))$('#review-new').hidden=true;startModerationLive();
  state.config.stats.approved=result.stats.approved;state.config.stats.public=result.stats.public;$('#approved-count').textContent=result.stats.public;
  for(const key of ['pending','approved','rejected']){const count=$(`[data-review-status="${key}"] .review-count`);if(count){count.textContent=String(result.stats[key]);count.toggleAttribute('data-zero',!result.stats[key]);}}
  if(result.cosmetics.length)renderReviewQueue(grid,result.cosmetics);else{releaseClaim();state.reviewItems=[];empty(grid,state.reviewQuery?'No matching submissions.':state.reviewStatus==='pending'?'Inbox zero.':'Nothing here yet.',state.reviewQuery?'Try a different Flare or creator name.':state.reviewStatus==='pending'?'Every submission has a decision. New ones appear here automatically when you refresh.':'Decisions in this status will be listed here.',null);}
  for(const button of document.querySelectorAll('[data-review-status]')){const selected=button.dataset.reviewStatus===state.reviewStatus;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}
  const paging=$('#review-pagination');paging.replaceChildren(node('span','form-footnote',`Page ${Math.floor(state.reviewOffset/50)+1} · ${result.cosmetics.length} shown`));
  if(state.reviewOffset>0)paging.append(action('← Previous',()=>{state.reviewOffset=Math.max(0,state.reviewOffset-50);return loadReviews();}));
  if(result.next_offset!==null)paging.append(action('Next →',()=>{state.reviewOffset=result.next_offset;return loadReviews();}));
}
async function changeModerator(twitchId,enabled) {
  const confirmed=await confirmModeration({title:enabled?'Grant moderator access?':'Remove moderator access?',description:enabled?'This account will be able to review Flares, view account details, and permanently ban regular users.':'This account will lose moderation access immediately.',label:enabled?'Grant access':'Remove access',onConfirm:()=>api('/api/admin/moderators',{twitchId,enabled})});
  if(!confirmed)return;
  toast(enabled?'Moderator added.':'Moderator access removed.');await refreshModeration();
}
async function changeArtist(user) {
  const enabled=user.role!=='artist';
  const confirmed=await confirmModeration({user,title:enabled?'Grant artist role?':'Remove artist role?',description:enabled?'This account can submit up to 20 Flares and receives a blue Artist badge. Submissions still require review; no moderation access is granted.':'The submission limit returns to 3 immediately. Existing Flares are kept, but further submissions are blocked while at or above the limit.',label:enabled?'Make artist':'Remove artist',onConfirm:()=>api('/api/admin/artists',{id:user.id,enabled})});
  if(!confirmed)return;
  toast(enabled?'Artist role granted · 20-Flare limit.':'Artist role removed · 3-Flare limit.');await refreshModeration();
}
async function changeBan(user) {
  const banned=!user.banned_at;
  const confirmed=await confirmModeration({user,ban:banned,title:banned?'Ban or suspend this account?':user.ban_expires_at?'End this suspension early?':'Lift this permanent ban?',description:banned?'All linked identities will be blocked from signing in, and so will the networks (IP addresses) the account used in the last 90 days, for 90 days. Sessions end immediately, their profile is hidden, and their Flares are revoked for everyone. The account ban has no expiry.':'This account can sign in again. Old sessions and revoked Flare approvals will not be restored.',label:banned?'Permanently ban account':'Lift ban',onConfirm:reason=>{const days=Number($('#moderation-duration').value) || null;state.lastBanDays=days;return api('/api/admin/ban',{id:user.id,banned,reason:banned?reason:'',...(banned && days?{days}:{})});}});
  if(!confirmed)return;
  toast(banned?(state.lastBanDays?`Suspended for ${state.lastBanDays} ${state.lastBanDays===1?'day':'days'}. It ends by itself.`:'Account permanently banned. Sessions ended and Flares revoked.'):'Ban lifted. The account can sign in again.');await refreshModeration();
}
// One row per account, every row on the same column grid (see admin.css
// "Accounts table"), with every action behind one Manage menu so rows line up.
function accountRow(user,bannedList=false) {
  const article=node('article',`account-row${user.banned_at?' is-banned':''}`);article.setAttribute('role','row');
  const cell=(cls,...children)=>{const item=node('div',`account-cell ${cls}`);item.setAttribute('role','cell');item.append(...children);return item;};
  const detail=node('div','account-name');detail.append(user.banned_at?node('strong','',user.name):link(user.name,`/profiles/${encodeURIComponent(user.id)}`,'profile-link'),node('small','',user.id));
  const person=cell('account-person',avatar(user),detail);
  const platforms=cell('account-platforms');
  for(const identity of user.identities){const item=node('span','account-platform');item.title=`${providerNames[identity.provider]} · ${identity.login} · ID ${identity.provider_id}`;item.append(platformLogo(identity.provider),node('span','',identity.login));platforms.append(item);}
  if(!user.identities.length)platforms.append(node('span','form-footnote','None'));
  const roleNames={owner:'Owner',moderator:'Moderator',artist:'Artist',user:'Member'};
  const role=cell('account-role',user.role==='artist'?artistBadge(user):node('span',`role-chip role-${user.role}`,roleNames[user.role] || user.role));
  const status=cell('account-status',node('span',`badge ${user.banned_at?(user.ban_expires_at?'pending':'rejected'):'approved'}`,user.banned_at?(user.ban_expires_at?'Suspended':'Banned'):'Active'));
  const joinedCell=cell('account-joined',node('span','',new Date(user.created_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})));joinedCell.title=date(user.created_at);
  const items=[];
  if(user.role!=='owner'){
    if(!bannedList && state.user.role==='owner' && user.twitch_id && !user.banned_at)items.push(menuItem(user.role==='moderator'?'Remove moderator':'Make moderator',()=>changeModerator(user.twitch_id,user.role!=='moderator')));
    if(!bannedList && state.config.runtime!=='cloudflare' && state.user.role==='owner' && ['user','artist'].includes(user.role) && !user.banned_at)items.push(menuItem(user.role==='artist'?'Remove artist':'Make artist',()=>changeArtist(user)));
    items.push(menuItem('Staff notes',()=>openNotes(user)));
    if(user.id!==state.user.id && (state.user.role==='owner' || ['user','artist'].includes(user.role)))items.push(menuItem(user.banned_at?(user.ban_expires_at?'End suspension':'Lift ban'):'Ban or suspend…',()=>changeBan(user),!user.banned_at));
    if(user.id!==state.user.id && state.config.features?.account_deletion && (state.user.role==='owner' || ['user','artist'].includes(user.role)))items.push(menuItem('Delete account',()=>eraseAccount(user),true));
  }
  let actions;
  if(items.length){
    const menu=node('details','row-menu'),summary=node('summary','button subtle sm','Manage');summary.setAttribute('aria-label',`Manage ${user.name}`);const panel=node('div','row-menu-panel');panel.append(...items);
    for(const item of items)item.addEventListener('click',()=>{menu.open=false;});
    menu.append(summary,panel);actions=cell('account-actions',menu);
  } else actions=cell('account-actions',node('span','form-footnote',user.role==='owner'?'Protected':user.banned_at?'Owner only':'—'));
  article.append(person,platforms,role,status,joinedCell,actions);
  if(user.banned_at){const note=node('div','account-ban-note');note.append(node('strong','','Ban reason: '),document.createTextNode(user.ban_reason || 'No reason recorded'),node('small','',` · ${date(user.banned_at)} · ${user.ban_expires_at?`suspended until ${date(user.ban_expires_at)}`:'no expiry'}${user.networks_blocked?` · ${user.networks_blocked} ${user.networks_blocked===1?'network':'networks'} blocked`:''}`));article.append(note);}
  return article;
}
function menuItem(label,fn,danger=false) {
  const button=node('button',`menu-item${danger?' danger':''}`,label);button.type='button';
  button.addEventListener('click',()=>run(async()=>{button.disabled=true;try{await fn();}finally{if(button.isConnected)button.disabled=false;}}));return button;
}
function accountTableHead() {
  const head=node('div','account-row account-head');head.setAttribute('role','row');
  for(const title of ['Account','Platforms','Role','Status','Joined',''])head.append(Object.assign(node('div','account-cell',title),{role:'columnheader'}));
  for(const item of head.children)item.setAttribute('role','columnheader');
  return head;
}
// Close an open Manage menu on outside click or Escape.
document.addEventListener('click',event=>{for(const menu of document.querySelectorAll('.row-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const menu of document.querySelectorAll('.row-menu[open]')){menu.open=false;menu.querySelector('summary').focus();}});
async function loadUsers(kind='accounts') {
  const banned=kind==='banned',container=$(banned?'#banned-user-results':'#admin-user-results');if(!container)return;
  const request=banned?++banRequest:++userRequest,userId=state.user?.id,query=banned?state.banQuery:state.userQuery,offset=banned?state.banOffset:state.userOffset;
  container.setAttribute('aria-busy','true');
  try {
    const result=await api(`/api/admin/users?q=${encodeURIComponent(query)}&status=${banned?'banned':state.userStatus}&offset=${offset}`);
    if(request!==(banned?banRequest:userRequest) || state.view!=='moderation' || state.user?.id!==userId || !container.isConnected)return;
    if(result.users.length){container.setAttribute('role','table');container.replaceChildren(accountTableHead(),...result.users.map(user=>accountRow(user,banned)));}
    else empty(container,banned?'No banned accounts found.':'No matching accounts.',query?'Try a different name, platform login, or account ID.':banned?'Permanent bans appear here with the reason and date.':'Registered accounts will appear here.',null);
    const paging=$(banned?'#ban-pagination':'#user-pagination');paging.replaceChildren(node('span','form-footnote',`Page ${Math.floor(offset/50)+1} · ${result.users.length} ${result.users.length===1?'account':'accounts'} shown`));
    const page=value=>{if(banned)state.banOffset=value;else state.userOffset=value;return loadUsers(kind);};
    if(offset>0)paging.append(action('← Previous',()=>page(Math.max(0,offset-50))));
    if(result.next_offset!==null)paging.append(action('Next →',()=>page(result.next_offset)));
  } catch(error){if(request===(banned?banRequest:userRequest) && container.isConnected){empty(container,'Couldn’t load accounts.',error.message,null);container.firstChild.append(action('Try again',()=>loadUsers(kind)));}throw error;}
  finally{if(request===(banned?banRequest:userRequest))container.setAttribute('aria-busy','false');}
}
async function loadAudit() {
  const panel=$('#moderation-audit');if(!panel)return;const userId=state.user?.id;
  const audit=await api(`/api/admin/audit?actor=${encodeURIComponent(state.auditActor || '')}&q=${encodeURIComponent(state.auditQuery || '')}`);
  const filterBar=$('#audit-toolbar');
  if(filterBar && !filterBar.dataset.ready){
    filterBar.dataset.ready='1';const who=node('select'),search=node('input');who.setAttribute('aria-label','Moderator');search.type='search';search.placeholder='Search actions, targets, notes';search.maxLength=80;search.value=state.auditQuery || '';
    const everyone=node('option','','Everyone');everyone.value='';who.append(everyone);
    who.addEventListener('change',()=>{state.auditActor=who.value;run(loadAudit);});let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{state.auditQuery=search.value;run(loadAudit);},250);});
    const mine=node('button','button subtle sm','Only me');mine.type='button';mine.addEventListener('click',()=>{who.value=state.user.id;state.auditActor=state.user.id;run(loadAudit);});
    filterBar.append(who,search,mine);
  }
  const whoSelect=filterBar?.querySelector('select');if(whoSelect){for(const actor of audit.actors || [])if(![...whoSelect.options].some(option=>option.value===actor.id)){const option=node('option','',actor.name);option.value=actor.id;whoSelect.append(option);}whoSelect.value=state.auditActor || '';}
  if(state.view!=='moderation' || state.user?.id!==userId || $('#moderation-audit')!==panel)return;
  panel.replaceChildren();
  if(!audit.entries.length)empty(panel,'A clean slate.','Decisions, permanent bans, and access changes will appear here.',null);
  const labels={'account.banned':'Permanently banned an account','account.unbanned':'Lifted an account ban','cosmetic.approved':'Approved a Flare','cosmetic.rejected':'Disapproved a Flare','cosmetic.auto_approved':'Automatically approved a staff Flare','moderator.added':'Granted moderator access','moderator.removed':'Removed moderator access','artist.added':'Granted artist role','artist.removed':'Removed artist role','flare.deleted':'Permanently deleted a Flare','flare.publication':'Changed Flare publication','report.actioned':'Acted on a report','report.dismissed':'Dismissed a report','media.blocked':'Blocked images from being uploaded again','upload.blocked':'Stopped a flagged upload','account.deleted':'Deleted an account','account.suspended':'Suspended an account','cosmetic.reopened':'Undid a decision','identity.changed':'Switched a linked platform account','identity.unlinked':'Unlinked a platform'};
  if(!audit.entries.length)return;
  const kindOf=action=>/^(cosmetic|flare|report|media|upload)\./.test(action)?'decision':action.startsWith('account.')?'account':'access';
  const filters=node('div','audit-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filter activity');
  const timeline=node('div','audit-timeline');
  const apply=kind=>{for(const button of filters.children)button.setAttribute('aria-pressed',String(button.dataset.kind===kind));for(const row of timeline.querySelectorAll('.audit-row'))row.hidden=kind!=='all' && row.dataset.kind!==kind;for(const day of timeline.querySelectorAll('.audit-day'))day.hidden=![...day.querySelectorAll('.audit-row')].some(row=>!row.hidden);};
  for(const [kind,title] of [['all','Everything'],['decision','Flare decisions'],['account','Bans'],['access','Access changes']]){const count=kind==='all'?audit.entries.length:audit.entries.filter(entry=>kindOf(entry.action)===kind).length;const button=node('button','audit-filter');button.type='button';button.dataset.kind=kind;button.append(node('span','',title),node('span','review-count',String(count)));button.addEventListener('click',()=>apply(kind));filters.append(button);}
  let day=null,dayList=null;
  for(const entry of audit.entries){
    const key=new Date(entry.created_at).toDateString();
    if(key!==day){day=key;const group=node('section','audit-day');const label=new Date(entry.created_at).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});group.append(node('h3','audit-day-label',key===new Date().toDateString()?'Today':label));dayList=node('div','audit-day-list');group.append(dayList);timeline.append(group);}
    const row=node('article','audit-row'),heading=node('div','audit-heading');row.dataset.kind=kindOf(entry.action);row.dataset.action=entry.action;
    const time=node('time','',new Date(entry.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));time.dateTime=entry.created_at;time.title=date(entry.created_at);
    heading.append(node('strong','',labels[entry.action] || entry.action),time);row.append(heading,node('small','',`${entry.actor} · ${entry.target}`));if(entry.detail)row.append(node('p','',entry.detail));dayList.append(row);
  }
  panel.append(filters,timeline);apply('all');
}
function moderationSection(title,description) {
  const panel=node('section','moderation-section'),heading=node('div','moderation-section-heading');heading.append(node('h2','',title),node('p','',description));panel.append(heading);return panel;
}
function accountSearch(panel,banned=false) {
  const label=node('label','moderation-search',banned?'Search banned accounts':'Find an account'),input=node('input');input.type='search';input.maxLength=100;input.value=banned?state.banQuery:state.userQuery;input.placeholder='Name, platform login, or exact account ID';label.append(input);panel.append(label);let timer;
  input.addEventListener('input',()=>{clearTimeout(timer);if(banned){state.banQuery=input.value;state.banOffset=0;}else{state.userQuery=input.value;state.userOffset=0;}timer=setTimeout(()=>{if(input.isConnected)run(()=>loadUsers(banned?'banned':'accounts'));},250);});
  const results=node('div','moderation-accounts');results.id=banned?'banned-user-results':'admin-user-results';results.setAttribute('aria-live','polite');results.append(node('p','form-footnote','Loading accounts…'));
  const paging=node('div','dashboard-pagination');paging.id=banned?'ban-pagination':'user-pagination';panel.append(results,paging);
}
async function renderModeration() {
  ++reviewRequest;++userRequest;++banRequest;
  const container=$('#moderation-content');
  if(!['owner','moderator'].includes(state.user?.role)){empty(container,'This space is for reviewers.','The owner grants moderation access to registered, verified Twitch accounts.','/account','Go to your account ↗');return;}
  const requested=currentRoute().split('/')[2],section=['reports','accounts','settings','history'].includes(requested)?requested:'reviews';
  container.replaceChildren();const nav=node('nav','moderation-nav');nav.setAttribute('aria-label','Moderation sections');
  for(const [key,title] of [['reviews','Review queue'],...(state.config.features?.reports?[['reports','Reports']]:[]),['accounts','Accounts'],['settings','Bans & team'],['history','Activity log']]){const item=link(title,`/moderation/${key}`,'moderation-nav-link');item.prepend(icon({reviews:'moderation',reports:'flag',accounts:'profiles',settings:'ban',history:'motion'}[key]));if(key===section)item.setAttribute('aria-current','page');nav.append(item);}
  const overview=node('div','mod-overview');overview.id='mod-overview';overview.setAttribute('aria-live','polite');
  container.append(nav,overview);startModerationLive();run(pollModerationLive);
  const workspace=node('div','moderation-workspace');container.append(workspace);
  const refresh=action('Refresh',async()=>{await refreshAccount();if(!['owner','moderator'].includes(state.user?.role))return renderModeration();await refreshModeration();});
  if(section==='reviews'){
    const heading=moderationSection('Review queue','Give every submission a fair review. Approve great work; leave useful feedback when it needs changes.');heading.firstChild.append(refresh);workspace.append(heading);
    const toolbar=node('div','moderation-toolbar'),tabs=node('div','review-status-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Review status');
    for(const [status,title] of [['pending','Awaiting review'],['approved','Approved'],['rejected','Disapproved']]){const button=node('button','review-status-tab');button.type='button';button.append(node('span','',title),node('span','review-count','–'));button.addEventListener('click',()=>run(()=>{state.reviewStatus=status;state.reviewOffset=0;state.reviewIndex=0;state.reviewSelected=null;return loadReviews();}));button.dataset.reviewStatus=status;button.setAttribute('aria-pressed',String(state.reviewStatus===status));tabs.append(button);}
    const label=node('label','review-search','Search submissions'),search=node('input');search.type='search';search.maxLength=80;search.value=state.reviewQuery;search.placeholder='Flare or creator name';label.append(search);let timer;
    search.addEventListener('input',()=>{clearTimeout(timer);state.reviewQuery=search.value;state.reviewOffset=0;timer=setTimeout(()=>{if(search.isConnected)run(loadReviews);},250);});const keys=node('p','review-keys');keys.innerHTML='<kbd>J</kbd><kbd>K</kbd> move · <kbd>N</kbd> next free · <kbd>A</kbd> approve · <kbd>R</kbd> disapprove · <kbd>D</kbd> note · <kbd>X</kbd> select · <kbd>U</kbd> undo';
    const pickers=node('div','review-pickers');
    const picker=(labelText,key,options)=>{const wrap=node('label','review-picker'),select=node('select');wrap.append(node('span','sr-only',labelText),select);for(const [value,title] of options){const option=node('option','',title);option.value=value;select.append(option);}select.value=state[key];select.addEventListener('change',()=>run(()=>{state[key]=select.value;state.reviewOffset=0;state.reviewIndex=0;state.reviewSelected=null;return loadReviews();}));return wrap;};
    pickers.append(picker('Show','reviewFilter',[['all','All submissions'],['flagged','Flagged by the scanner'],['reported','Reported'],['images','Uses images'],['returning','Creator had a disapproval']]),picker('Order','reviewSort',[['oldest','Oldest first'],['submitted','Newest first'],['name','By name']]));
    toolbar.append(tabs,label,pickers,keys);workspace.append(toolbar);
    const fresh=node('button','review-new');fresh.id='review-new';fresh.type='button';fresh.hidden=true;fresh.append(node('span','','New submissions'),node('small','','Show'));fresh.addEventListener('click',()=>run(loadReviews));
    const bulk=node('div','review-bulk');bulk.id='review-bulk';bulk.hidden=true;bulk.append(node('strong','review-bulk-count','0 selected'),action('Approve all',()=>bulkDecide('approved'),'button primary sm'),action('Disapprove all…',()=>bulkDecide('rejected'),'button danger sm'),action('Clear',()=>{state.bulk.clear();syncBulkBar();},'button ghost sm'));
    workspace.append(fresh,bulk);
    const checklist=node('details','moderation-checklist');checklist.append(node('summary','','Review checklist & permissions'),node('p','','Check artwork rights, harmful content, impersonation, flashing, and readability on both backgrounds. Staff submissions are automatically approved. Moderators cannot manually review their own Flares; the owner can. Disapproval requires a reason. Revocation clears everyone’s equipped assignments. Permanent deletion of disapproved Flares removes unshared images; audit history remains.'));workspace.append(checklist);
    const grid=node('div','review-grid review-workspace');grid.id='review-results';grid.setAttribute('aria-live','polite');grid.append(node('p','form-footnote','Loading submissions…'));const paging=node('div','dashboard-pagination');paging.id='review-pagination';workspace.append(grid,paging);await loadReviews();
  }else if(section==='reports'){
    const panel=moderationSection('Reports','What the community flagged, grouped by Flare or profile, most-reported first. Act once for everything reported about it.');panel.firstChild.append(refresh);
    const tabs=node('div','review-status-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Report status');
    for(const [status,title] of [['open','Open'],['closed','Resolved']]){const button=node('button','review-status-tab');button.type='button';button.dataset.reportStatus=status;button.append(node('span','',title));button.setAttribute('aria-pressed',String(state.reportStatus===status));button.addEventListener('click',()=>run(()=>{state.reportStatus=status;for(const item of tabs.children)item.setAttribute('aria-pressed',String(item===button));return loadReports();}));tabs.append(button);}
    const list=node('div','report-list');list.id='moderation-reports';list.setAttribute('aria-live','polite');list.append(node('p','form-footnote','Loading reports…'));panel.append(tabs,list);workspace.append(panel);await loadReports();
  }else if(section==='accounts'){
    const panel=moderationSection('Community accounts','Search registered identities, manage access, or permanently ban an account. The owner and your own account are protected.');panel.firstChild.append(refresh);
    const filters=node('div','filters account-status-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Account status');
    for(const [value,title] of [['all','All accounts'],['active','Active'],['staff','Moderation team']]){const button=action(title,()=>{state.userStatus=value;state.userOffset=0;for(const item of filters.children){item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));}return loadUsers();});button.classList.toggle('active',state.userStatus===value);button.setAttribute('aria-pressed',String(state.userStatus===value));filters.append(button);}panel.append(filters,link('View banned accounts →','/moderation/settings','text-button'));accountSearch(panel);workspace.append(panel);await loadUsers();
  }else if(section==='settings'){
    const panel=moderationSection('Banned accounts','Permanent means no expiry. Bans persist until an authorized reviewer explicitly lifts them.');panel.firstChild.append(refresh);
    const notice=node('div','moderation-notice');notice.append(node('strong','','Account-wide protection'),node('p','','Every linked identity is blocked from signing in, and so are the networks (IP addresses) the account used in the last 90 days, for 90 days: no sign-in, new accounts or changes from them, though the site can still be browsed. Sessions are ended, public profiles are hidden, and the account’s Flares are revoked. Lifting a ban unblocks its networks but never restores old sessions or Flare approvals.'));panel.append(notice,link('Find an account to ban →','/moderation/accounts','text-button'));accountSearch(panel,true);workspace.append(panel);
    const team=moderationSection('Team & permissions','Moderators can ban regular users. Only the owner can change reviewer access or ban and unban moderators. The owner cannot be banned.');
    if(state.user.role==='owner'){
      const form=node('form','moderator-form'),label=node('label','','Grant reviewer access by Twitch ID'),input=node('input');input.required=true;input.pattern='[0-9]{1,30}';input.inputMode='numeric';input.placeholder='Numeric Twitch user ID';label.append(input);
      const add=node('button','button subtle','Add moderator');add.type='submit';form.append(label,add);form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{add.disabled=true;try{await changeModerator(input.value.trim(),true);}finally{add.disabled=false;}});});team.append(form,node('p','form-footnote','The Twitch account must have signed in to Nameflare first.'));
    }
    team.append(link('Manage moderation team →','/moderation/accounts','text-button'));workspace.append(team);await loadUsers('banned');
  }else{
    const panel=moderationSection('Activity log','The latest 100 recorded decisions, bans, deletions, and access changes. Exports include everything kept (two years).');
    const auditToolbar=node('div','audit-toolbar');auditToolbar.id='audit-toolbar';panel.append(auditToolbar);
    const exports=node('div','audit-exports');for(const [format,label] of [['csv','Export CSV'],['json','Export JSON']]){const item=link(label,`/api/admin/audit/export?format=${format}`,'button subtle sm');item.setAttribute('download','');item.prepend(icon('download'));exports.append(item);}
    exports.append(refresh);panel.firstChild.append(exports);const audit=node('div');audit.id='moderation-audit';panel.append(audit);workspace.append(panel);await loadAudit();
  }
}
let lastTrackedRoute='';
function trackView() {
  const dnt=navigator.doNotTrack;
  if(!state.bootstrapped || dnt==='1' || dnt==='yes' || window.globalPrivacyControl===true)return;
  if(!state.config?.features?.insights || state.view==='notfound')return;
  const route=currentRoute();
  if(route===lastTrackedRoute)return;
  lastTrackedRoute=route;
  if(/^\/(?:account|collection|analytics|moderation)(?:\/|$)/.test(route))return;
  fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:route}),keepalive:true}).catch(()=>{});
}
let renderedRoute='',firstViewRender=true;
function syncViewRoute() {
  const previousView=state.view,previousFeed=state.feed,previousRoute=renderedRoute;renderedRoute=currentRoute();
  const available=['discover','following','profiles','artists','studio','collection','account','analytics','moderation','integrations','guide','donate'];const [requested,chapter]=(currentRoute().slice(1)).split('/');state.view=available.includes(requested) ? requested:requested ? 'notfound':'discover';
  document.body.dataset.view=state.view;delete document.documentElement.dataset.bootView;
  const rail=document.querySelector('.right-rail');if(rail)rail.hidden=state.view!=='discover';
  for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==`view-${state.view}`;
  for(const nav of document.querySelectorAll('[data-nav]')){const current=nav.dataset.nav===state.view;nav.classList.toggle('active',current);if(current)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current');}
  $('#page-label').textContent={discover:'Discover',following:'Following',profiles:'Creators',artists:'Artists',studio:'Flare studio',collection:'Collection',account:'Account',analytics:'Insights',moderation:'Moderation',integrations:'Integrations & API',guide:'Guide',donate:'Support Nameflare',notfound:'Page not found'}[state.view];
  $('.topbar').classList.toggle('discovery-topbar',state.view==='discover');
  document.title=`${$('#page-label').textContent} · Nameflare`;
  for(const item of document.querySelectorAll('.guide-index a')) {
    if(item.pathname===currentRoute()){
      item.setAttribute('aria-current','location');
      // On narrow screens the chapters are one scrolling row: bring this one into view.
      const index=item.parentElement;if(index.scrollWidth>index.clientWidth)index.scrollLeft+=item.getBoundingClientRect().left-index.getBoundingClientRect().left-16;
    }else item.removeAttribute('aria-current');
  }
  return {previousView,previousFeed,previousRoute,requested,chapter};
}
async function renderView() {
  feedPosition?.cancel();feedPosition=null;
  const {previousView,previousFeed,previousRoute,chapter}=syncViewRoute();syncFirstRun();
  if(!(state.view==='discover' && chapter) && $('#detail-dialog').open)$('#detail-dialog').close();
  const routeChanged=previousRoute && previousRoute!==renderedRoute;
  const accountChapterChange=previousView==='account' && state.view==='account' && routeChanged;
  const viewChanged=previousView!==state.view || (routeChanged && (state.view==='profiles' || (state.view==='discover' && previousFeed!==state.feed)));
  // Switching a tab inside Account or Moderation keeps the tab bar where it was:
  // the old content's height is held while the new tab renders, then the bar is
  // put back at the same spot. Before, Moderation jumped to the top on every tab.
  const tabBar={account:'.account-tabs',moderation:'.moderation-nav'}[state.view];
  const tabSwitch=!firstViewRender && tabBar && previousView===state.view && routeChanged;
  const hold=tabSwitch?holdTabPosition(`#view-${state.view}`,tabBar):null;
  if(firstViewRender || (!tabSwitch && !accountChapterChange && viewChanged))window.scrollTo({top:0,behavior:'instant'});
  try{await renderViewContent(previousView,previousFeed,chapter);}finally{hold?.release();}
}
function holdTabPosition(viewSelector,barSelector){
  const view=$(viewSelector),bar=view?.querySelector(barSelector);if(!view || !bar)return null;
  const top=bar.getBoundingClientRect().top,minHeight=view.style.minHeight;
  view.style.minHeight=`${view.offsetHeight}px`;
  return {release(){
    const next=view.querySelector(barSelector);view.style.minHeight=minHeight;
    if(next && top>=0)window.scrollTo({top:Math.max(0,window.scrollY+next.getBoundingClientRect().top-top),left:window.scrollX,behavior:'instant'});
  }};
}
async function renderViewContent(previousView,previousFeed,chapter){
  firstViewRender=false;
  if(state.view==='discover') {
    if(previousFeed!==state.feed)state.catalogLoaded=false;
    updateFeedControls();
    if(state.bootstrapped && !showcaseShown && previousView!=='discover' && previousView)loadShowcase();
    if(state.bootstrapped && (!state.catalogLoaded || previousView!=='discover'))await loadCatalog();
    if(state.bootstrapped && chapter){const hash=currentRoute(),readRevision=likes.revision;try{const result=await api(`/api/v1/cosmetics/${encodeURIComponent(chapter)}`);result.cosmetic.like_read_revision=readRevision;if(currentRoute()===hash)await showDetails(result.cosmetic);}catch(error){if(currentRoute()===hash){$('#detail-dialog').close();navigate('/discover');toast('This Flare is unavailable or not approved.',true);}}}
  }
  if(state.view!=='discover' && $('#detail-dialog').open)$('#detail-dialog').close();
  if(state.view!=='moderation')stopModerationLive();
  if(state.view==='donate')renderDonate($('#view-donate'));
  if(state.view==='notfound')renderNotFound();
  if(!state.bootstrapped)return;
  if(state.view==='following' && (previousView!=='following' || !state.followingLoaded))await loadFollowing();
  if(state.view==='artists')await loadArtists();else artistPreviews.clear();
  if(state.view==='profiles')await loadProfiles(chapter);
  if(state.view==='guide' && chapter)document.getElementById(`guide-${chapter}`)?.scrollIntoView({block:'start'});
  if(state.view==='collection')await renderCollection();if(state.view==='account')await renderAccount(chapter);if(state.view==='analytics')await renderInsights({container:$('#insights-content'),api,state,signIn:openSignIn,toast});if(state.view==='moderation')await renderModeration();
  trackView();
}
// An address that matches no page: say which one, and offer the two ways back in.
function renderNotFound() {
  let path=location.pathname;try{path=decodeURI(path);}catch{}
  $('#notfound-path').textContent=path.length>60?`${path.slice(0,59)}…`:path;
  applyCosmetic($('#notfound-name'),presets.sunset,location.origin,{paused:reduceMotion()});
}
$('#notfound-search')?.addEventListener('click',()=>$('#command-open')?.click());
async function renderRoute() {
  // Swap views directly. Crossfading the old and new layouts painted two pages
  // together during width-changing routes such as Discover → Account.
  return renderView();
}
installNavigation();
setupDonate($('#view-donate'));
renderHero();
syncViewRoute();
if(state.view==='discover')updateFeedControls();
window.addEventListener('popstate',() => {
  if($('#detail-dialog').open && currentRoute()===detailReturnHash){$('#detail-dialog').close();return;}
  const route=currentRoute(),returnRoute=history.state?.detailReturnRoute;
  if(route.startsWith('/discover/') && returnRoute===renderedRoute){
    detailReturnHash=returnRoute;
    run(async()=>{
      const readRevision=likes.revision,result=await api(`/api/v1/cosmetics/${encodeURIComponent(route.split('/')[2])}`);
      if(currentRoute()!==route)return;
      result.cosmetic.like_read_revision=readRevision;trackView();await showDetails(result.cosmetic);
    });
    return;
  }
  run(renderRoute);
});
initPreferences();
document.addEventListener('nameflare:appearance',()=>{syncHeroMotion();renderHero();});
const shortcutsDialog=$('#shortcuts-dialog');
function openShortcuts(){if(document.querySelector('dialog[open]'))return;shortcutsDialog.showModal();$('#close-shortcuts')?.focus({preventScroll:true});}
$('#shortcuts-menu')?.addEventListener('click',()=>{resourceMenu.open=false;openShortcuts();});
$('#close-shortcuts')?.addEventListener('click',()=>shortcutsDialog.close());
const backToTop=$('#back-to-top');
function syncBackToTop(){backToTop.hidden=window.scrollY<600;}
window.addEventListener('scroll',syncBackToTop,{passive:true});syncBackToTop();
backToTop.addEventListener('click',()=>window.scrollTo({top:0,behavior:reduceMotion()?'auto':'smooth'}));
function syncConnectivity(){const banner=$('#offline-banner');if(!banner)return;banner.hidden=navigator.onLine;document.documentElement.classList.toggle('is-offline',!navigator.onLine);}
window.addEventListener('online',syncConnectivity);window.addEventListener('offline',syncConnectivity);syncConnectivity();
let gPrefix=false,gTimer;
document.addEventListener('keydown',event=>{
  // A page's own shortcut (such as N or / in the review queue) wins.
  if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey)return;
  if(isTyping(event)||document.querySelector('dialog[open]'))return;
  if(event.key==='?'){event.preventDefault();openShortcuts();return;}
  if(event.key.toLowerCase()==='t'){const next=cycleTheme();toast(`${next.name} theme applied.`);return;}
  if(event.key.toLowerCase()==='g'){gPrefix=true;clearTimeout(gTimer);gTimer=setTimeout(()=>{gPrefix=false;},1200);return;}
  if(gPrefix){const routes={d:'/discover',f:'/following',s:'/studio',c:'/collection',i:'/analytics',a:'/account',p:'/profiles'};const path=routes[event.key.toLowerCase()];gPrefix=false;clearTimeout(gTimer);if(path){event.preventDefault();navigate(path);}if(path)return;}
  if(event.key.toLowerCase()==='n'){event.preventDefault();navigate('/studio');}
});
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.defaultPrevented||isTyping(event)||document.querySelector('dialog[open]'))return;
  event.preventDefault();
  if(state.view==='discover'){$('#catalog-search').focus();return;}
  navigate('/discover');setTimeout(()=>$('#catalog-search')?.focus({preventScroll:true}),350);
});
// Feed or grid: a per-device browsing preference, never shared state.
function setFeedLayout(layout,remember=true){
  layout=layout==='feed'?'feed':'grid';$('#view-discover').dataset.layout=layout;
  for(const button of document.querySelectorAll('[data-layout]'))if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.layout===layout));
  if(remember)try{localStorage.setItem('nameflare.layout',layout);}catch{}
}
for(const button of document.querySelectorAll('.layout-toggle [data-layout]'))button.addEventListener('click',()=>setFeedLayout(button.dataset.layout));
try{setFeedLayout(localStorage.getItem('nameflare.layout'),false);}catch{setFeedLayout('grid',false);}
// Startup must survive a busy or briefly unreachable server. Before, one failed
// /api/config or /api/me left Discover empty for good: no Flares, endless
// placeholders, no message. Config retries with backoff while the feed says so;
// an account that can't be read yet shows the signed-out view and retries quietly.
function startupProblem(retry) {
  const grid=$('#catalog');if(!grid)return;
  $('#catalog-status').textContent='Can’t reach Nameflare right now. Retrying…';
  empty(grid,'Can’t reach Nameflare right now.','Retrying automatically. Your connection or the server may be busy.',null);
  grid.firstElementChild.append(action('Try again',retry,'button primary'));
}
async function loadConfig(){
  for(let attempt=0;;attempt++){
    try{return await api('/api/config');}
    catch(error){
      let skip;const pause=new Promise(resolve=>{skip=resolve;setTimeout(resolve,Math.min(20000,2000*2**attempt));});
      startupProblem(()=>skip());await pause;
    }
  }
}
function retryAccount(delay=3000){
  setTimeout(()=>run(async()=>{
    try{await refreshAccount();}catch{return retryAccount(Math.min(30000,delay*2));}
    editor.accountChanged();state.catalogLoaded=false;await renderView();
  }),delay);
}
async function init(){
  let accountFailed=false;
  const [config]=await Promise.all([loadConfig(),refreshAccount().catch(()=>{accountFailed=true;})]);
  state.config=config;state.bootstrapped=true;
  if(accountFailed)retryAccount();
  setRailStats(state.config.stats);
  $('#demo-banner').hidden=!state.config.demo;try{const shell=JSON.parse(localStorage.getItem('nameflare.shell.v1')||'{}');localStorage.setItem('nameflare.shell.v1',JSON.stringify({...shell,demo:Boolean(state.config.demo)}));}catch{}$('#approved-count').textContent=state.config.stats.public ?? state.config.stats.approved;$('#api-base').textContent=state.config.officialApi;
  $('[data-nav="artists"]').hidden=state.config.runtime==='cloudflare';
  $('[data-nav="analytics"]').hidden=!state.config.features?.insights;
  updateNotificationBadge();
  renderCommands();
  loadShowcase();
  editor.accountChanged();await renderView();showAuthOutcome();initFeedGeometry();initScrollState();wireRailFilters(filter=>run(()=>applyQuickFilter(filter)));loadRail({api,state,followButton});await resumeLikeIntent();await resumeFollowIntent();
  try{const legacy=sessionStorage.getItem('nameflare.equip');if(legacy){sessionStorage.removeItem('nameflare.equip');if(!peekIntent())sessionStorage.setItem(INTENT_KEY,JSON.stringify({kind:'equip',id:legacy,route:'/discover',at:Date.now()}));}await resumeIntent();}catch(error){toast(error.message,true);}
}
run(init);
