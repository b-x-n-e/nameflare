import { applyCosmetic } from './renderer.js';
const params=new URLSearchParams(location.search),status=document.querySelector('#overlay-status'),messages=document.querySelector('#messages');
const cache=new Map();let queue=Promise.resolve(),stopped=false;
const lifetime=Math.max(5,Math.min(300,Number(params.get('lifetime')) || 45))*1000;
const effects=params.get('effects')!=='0';
function report(text){status.textContent=text;}
async function resolveCosmetic(provider,id){
  const key=`${provider}:${id}`,entry=cache.get(key);
  if(entry && entry.expires>Date.now())return entry.cosmetic;
  try{
    const response=await fetch(`/api/v1/users/${provider}/${encodeURIComponent(id)}`);
    if(!response.ok && response.status!==404)throw new Error('API unavailable');
    const data=await response.json(),cosmetic=data.user?.cosmetic || null;
    if(cache.size>1000)cache.clear();cache.set(key,{cosmetic,expires:Date.now()+15000});return cosmetic;
  }catch{return null;}
}
function enqueue(data,recipe){queue=queue.then(() => showMessage(data,recipe)).catch(() => report('Could not render a chat message.'));}
async function showMessage(data,recipe){
  if(!['twitch','kick','youtube'].includes(data.provider)||typeof data.name!=='string'||typeof data.text!=='string'||typeof data.provider_id!=='string')return;
  const cosmetic=recipe || await resolveCosmetic(data.provider,data.provider_id);
  const row=document.createElement('article');row.className='message';row.dataset.providerId=data.provider_id;if(data.id)row.dataset.messageId=data.id;
  const platform=document.createElement('span');platform.className='platform';platform.textContent={twitch:'TW',kick:'K',youtube:'YT'}[data.provider];
  const name=document.createElement('strong');name.textContent=data.name.slice(0,80);if(effects)applyCosmetic(name,cosmetic);
  const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const text=document.createElement('span');text.className='text';text.textContent=data.text.slice(0,1000);row.append(platform,name,time,text);messages.append(row);
  while(messages.children.length>30)messages.firstChild.remove();setTimeout(() => row.remove(),lifetime);
}
function unescapeTag(value){return value.replace(/\\s/g,' ').replace(/\\:/g,';').replace(/\\r/g,'\r').replace(/\\n/g,'\n').replace(/\\\\/g,'\\');}
function parseIrc(line){
  let rest=line,tags={};
  if(rest.startsWith('@')){const split=rest.indexOf(' ');for(const tag of rest.slice(1,split).split(';')){const i=tag.indexOf('=');if(i>=0)tags[tag.slice(0,i)]=unescapeTag(tag.slice(i+1));}rest=rest.slice(split+1);}
  let prefix='';if(rest.startsWith(':')){const split=rest.indexOf(' ');prefix=rest.slice(1,split);rest=rest.slice(split+1);}
  const split=rest.indexOf(' :'),trailing=split<0 ? '':rest.slice(split+2),parts=(split<0 ? rest:rest.slice(0,split)).split(' ');
  return {tags,prefix,command:parts[0],trailing};
}
function directTwitch(channel){
  let attempts=0,socket,timer;
  const connect=() => {
    if(stopped)return;report(`Connecting to Twitch · ${channel}`);socket=new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    socket.addEventListener('open',() => {socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');socket.send('PASS SCHMOOPIIE\r\n');socket.send(`NICK justinfan${Math.floor(Math.random()*90000)+10000}\r\n`);socket.send(`JOIN #${channel}\r\n`);});
    socket.addEventListener('message',event => {
      for(const line of String(event.data).split('\r\n').filter(Boolean)){
        if(line.startsWith('PING')){socket.send(line.replace(/^PING/,'PONG')+'\r\n');continue;}
        const irc=parseIrc(line);
        if(irc.command==='JOIN' || irc.command==='366'){attempts=0;report('');}
        if(irc.command==='PRIVMSG' && irc.tags['user-id'])enqueue({provider:'twitch',provider_id:irc.tags['user-id'],name:irc.tags['display-name'] || irc.prefix.split('!')[0],text:irc.trailing,id:irc.tags.id});
        if(irc.command==='CLEARMSG'){const id=irc.tags['target-msg-id'];queue=queue.then(() => {for(const row of messages.children)if(row.dataset.messageId===id)row.remove();});}
        if(irc.command==='CLEARCHAT'){const id=irc.tags['target-user-id'];queue=queue.then(() => {for(const row of [...messages.children])if(!id || row.dataset.providerId===id)row.remove();});}
        if(irc.command==='RECONNECT')socket.close();
        if(irc.command==='NOTICE')report(irc.trailing.slice(0,150));
      }
    });
    socket.addEventListener('close',() => {if(stopped)return;report('Twitch disconnected. Reconnecting…');timer=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempts++,5)));});
    socket.addEventListener('error',() => socket.close());
  };
  connect();window.addEventListener('pagehide',() => {stopped=true;clearTimeout(timer);socket?.close();});
}
if(params.get('demo')==='1'){
  report('SAMPLE CHAT · not a live connection');
  let i=0;const sample=['okay this name is a whole vibe ✨','open source, main character energy','the glow is so good','made this in the Nameflare studio'];
  const tick=async() => {let cosmetic;try{const response=await fetch('/api/v1/cosmetics?limit=8');const result=await response.json();cosmetic=result.cosmetics?.[i%Math.max(1,result.cosmetics.length)];}catch{}
    enqueue({provider:'twitch',provider_id:'1002',name:['lumi','nova','orbit','moonchild'][i%4],text:sample[i%4]},cosmetic || {recipe:{colors:['#71f5bd','#b798ff'],animation:'flow',speed:4,angle:120,glow:4}});i++;};
  tick();const timer=setInterval(tick,4500);window.addEventListener('pagehide',() => clearInterval(timer));
}else if(/^[a-zA-Z0-9_]{1,25}$/.test(params.get('channel') || ''))directTwitch(params.get('channel').toLowerCase());
else report('Add ?channel=your_twitch_channel or ?demo=1.');
