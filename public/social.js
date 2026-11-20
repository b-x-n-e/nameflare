export function compactNumber(value) {
  const number = Number(value) || 0, absolute = Math.abs(number);
  if (absolute < 1000) return String(Math.round(number));
  if (absolute < 10000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (absolute < 1000000) return `${Math.round(number / 1000)}k`;
  return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
}

export function timeAgo(value, now = Date.now()) {
  const moment = new Date(value), time = moment.getTime();
  if (!Number.isFinite(time)) return '';
  const difference = Math.max(0, now - time), minute = 60000, hour = 3600000, day = 86400000;
  if (difference < minute) return 'just now';
  if (difference < hour) return `${Math.floor(difference / minute)}m ago`;
  if (difference < day) return `${Math.floor(difference / hour)}h ago`;
  if (difference < 7 * day) return `${Math.floor(difference / day)}d ago`;
  if (difference < 30 * day) return `${Math.floor(difference / (7 * day))}w ago`;
  return moment.toLocaleDateString(undefined, { month:'short', day:'numeric', year:moment.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function shortDay(value) {
  const moment = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(moment.getTime()) ? moment.toLocaleDateString(undefined, { month:'short', day:'numeric', timeZone:'UTC' }) : value;
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch {}
  }
  const area = document.createElement('textarea');
  area.value = value; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  area.remove();
  return copied;
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; }
    catch (error) { if (error.name === 'AbortError') return 'cancelled'; }
  }
  return await copyText(url) ? 'copied' : 'failed';
}

// Profile pictures come only from the platforms' own image hosts (the CSP
// allows exactly these). Shared by app.js and rail.js.
export const AVATAR_HOSTS = { twitch:['static-cdn.jtvnw.net'], kick:['files.kick.com','kick.com','www.kick.com','pfp.kick.com'], youtube:['yt3.ggpht.com','yt3.googleusercontent.com','lh3.googleusercontent.com'] };
export function avatarImage(profile) {
  try {
    const url = new URL(profile?.avatar_url);
    const provider = profile.profile_provider || profile.provider || profile.identities?.[0]?.provider;
    // Without a known platform, any platform's own image host is still safe.
    const hosts = provider ? AVATAR_HOSTS[provider] : Object.values(AVATAR_HOSTS).flat();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts?.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}
