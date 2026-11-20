import { createHash, randomBytes } from 'node:crypto';
import { assert, HttpError } from './cosmetics.js';
const token = () => randomBytes(32).toString('base64url');

// Provider-controlled image hosts only; never fetch arbitrary avatar URLs on the server.
const avatarHosts = {
  twitch: ['static-cdn.jtvnw.net'],
  kick: ['files.kick.com', 'kick.com', 'www.kick.com', 'pfp.kick.com'],
  youtube: ['yt3.ggpht.com', 'yt3.googleusercontent.com', 'lh3.googleusercontent.com']
};
export const avatarSources = [...new Set(Object.values(avatarHosts).flat())].map(host => `https://${host}`).join(' ');
export function safeAvatar(provider, value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return '';
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && avatarHosts[provider]?.includes(url.hostname) ? url.toString() : '';
  } catch { return ''; }
}

const providers = {
  twitch: { authorize: 'https://id.twitch.tv/oauth2/authorize', token: 'https://id.twitch.tv/oauth2/token', scope: '' },
  kick: { authorize: 'https://id.kick.com/oauth/authorize', token: 'https://id.kick.com/oauth/token', scope: 'user:read' },
  youtube: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/youtube.readonly' }
};
export function providerConfig(name, env = process.env) {
  const info = providers[name];
  assert(info, 404, 'Unknown identity provider.');
  const prefix = name.toUpperCase();
  return { ...info, clientId: env[`${prefix}_CLIENT_ID`], clientSecret: env[`${prefix}_CLIENT_SECRET`] };
}
export function beginOAuth(name, store, session, baseUrl, env = process.env) {
  const config = providerConfig(name, env);
  assert(config.clientId && config.clientSecret, 503, `${name} linking needs OAuth credentials from the service operator.`);
  const binding = token(), verifier = token();
  const state = store.state(name, session?.id, binding, verifier);
  return { url:authorizationURL(name,baseUrl,env,state,verifier), binding };
}
export function authorizationURL(name,baseUrl,env,state,verifier) {
  const config=providerConfig(name,env);
  const url = new URL(config.authorize);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${baseUrl}/auth/${name}/callback`, response_type: 'code', scope: config.scope, state }).toString();
  if (name !== 'twitch') {
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (name === 'youtube') url.searchParams.set('prompt', 'select_account');
  return url.toString();
}
async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new HttpError(502, 'The identity provider could not verify this account. Please try again.');
  return response.json();
}
export async function finishOAuth(name, code, verifier, baseUrl, env = process.env) {
  assert(typeof code === 'string' && code.length > 0 && code.length <= 4096, 400, 'Missing authorization code.');
  const config = providerConfig(name, env);
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: `${baseUrl}/auth/${name}/callback` });
  if (name !== 'twitch') body.set('code_verifier', verifier);
  const credentials = await request(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert(typeof credentials.access_token === 'string', 502, 'Provider did not return an access token.');
  const headers = { Authorization: `Bearer ${credentials.access_token}` };
  let profile;
  if (name === 'twitch') {
    headers['Client-Id'] = config.clientId;
    const result = await request('https://api.twitch.tv/helix/users', { headers });
    const user = result.data?.[0];
    profile = user && { provider: name, id: String(user.id), login: user.login, name: user.display_name, avatar_url: safeAvatar(name, user.profile_image_url) };
  } else if (name === 'kick') {
    const result = await request('https://api.kick.com/public/v1/users', { headers });
    const user = result.data?.[0];
    profile = user && { provider: name, id: String(user.user_id), login: user.name, name: user.name, avatar_url: safeAvatar(name, user.profile_picture) };
  } else {
    const result = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers });
    const channel = result.items?.[0];
    assert(channel, 400, 'This Google account has no YouTube channel. Create or select a channel first.');
    profile = { provider: name, id: channel.id, login: channel.snippet.customUrl || channel.snippet.title, name: channel.snippet.title, avatar_url: safeAvatar(name, channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url) };
  }
  assert(profile && profile.id && profile.login && profile.name, 502, 'Provider returned an incomplete identity.');
  // Tokens are used only for this identity check, never persisted or sent to the browser.
  return profile;
}
