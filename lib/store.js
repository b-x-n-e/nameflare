import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { assert, catalogSelection, publishingFlag, profileFields, text } from './cosmetics.js';
import { safeAvatar } from './oauth.js';
const equippedCountSql = 'SELECT COUNT(*) FROM users e WHERE e.equipped=c.id';
// Banned accounts are few, so excluding their likes through that small set is
// far cheaper than joining every like row back to users.
const likeCountSql = 'SELECT COUNT(*) FROM cosmetic_likes l WHERE l.cosmetic_id=c.id AND l.user_id NOT IN (SELECT id FROM users WHERE banned_at IS NOT NULL)';
const recentLikeCountSql = `${likeCountSql} AND l.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`;
const paintSelect = `SELECT c.*, u.name AS creator, u.avatar_url AS creator_avatar, u.profile_provider AS creator_provider, r.name AS reviewer, (${equippedCountSql}) AS equipped_count, (${likeCountSql}) AS like_count, (${recentLikeCountSql}) AS recent_like_count FROM cosmetics c JOIN users u ON u.id=c.owner_id LEFT JOIN users r ON r.id=c.reviewer_id`;

export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
// How long each kind of record is kept. Documented in the Guide (Privacy &
// your data) and docs/PRIVACY.md; Store.retention() enforces it.
export const RETENTION = { network_days:90, network_ban_days:90, notifications_days:180, page_view_days:400, audit_days:730, closed_report_detail_days:90, closed_report_days:365, rejected_flare_days:365, orphan_texture_days:7 };
export const REPORT_REASONS = ['rights','sexual','hate','harassment','impersonation','spam','other'];
const textureIdPattern = /^[a-f0-9]{64}\.(gif|png|webp|jpg)$/;
// Image files a recipe uses. Never turns unvalidated legacy fields into paths.
export function recipeTextureIds(recipe) {
  return [...new Set([recipe?.textureId, ...(Array.isArray(recipe?.layers) ? recipe.layers : []).filter(layer => layer?.type === 'image').map(layer => layer.textureId)].filter(id => typeof id === 'string' && textureIdPattern.test(id)))];
}
// A deleted banned account leaves only this one-way hash of each identity, so
// the ban still holds if the same platform account signs in again.
const identityHash = (provider, id) => digest(`identity:${provider}:${id}`);
const now = () => new Date().toISOString();
function dateWindow(days) {
  const span = Math.max(1, Math.min(90, Math.floor(Number(days) || 1)));
  const end = new Date(); end.setUTCHours(0,0,0,0);
  const list = [];
  for (let i = span - 1; i >= 0; i--) { const day = new Date(end); day.setUTCDate(end.getUTCDate() - i); list.push(day.toISOString().slice(0,10)); }
  return list;
}
const fillSeries = (windowDays, rows) => { const map = new Map(rows.map(row => [row.day, Number(row.n)])); return windowDays.map(day => ({ day, count: map.get(day) || 0 })); };

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    // NORMAL is durable against corruption in WAL mode and avoids an fsync per
    // like or page view; cache_size keeps the hot pages (KiB, negative) in memory.
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-16000; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', equipped TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), login TEXT NOT NULL, display_name TEXT NOT NULL, PRIMARY KEY(provider,provider_id), UNIQUE(user_id,provider));
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, provider TEXT NOT NULL, user_id TEXT, binding TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cosmetics (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL, recipe TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, reviewed_at TEXT, reviewer_id TEXT);
      CREATE TABLE IF NOT EXISTS textures (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS cosmetic_likes (cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(cosmetic_id,user_id));
      CREATE INDEX IF NOT EXISTS cosmetic_likes_user ON cosmetic_likes(user_id,created_at);
      CREATE TABLE IF NOT EXISTS creator_follows (follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(follower_id,creator_id), CHECK(follower_id!=creator_id));
      CREATE INDEX IF NOT EXISTS creator_follows_creator ON creator_follows(creator_id);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', read_at TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,id DESC);
      CREATE TABLE IF NOT EXISTS page_views (day TEXT NOT NULL, path TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,path));
      CREATE INDEX IF NOT EXISTS cosmetic_status ON cosmetics(status,created_at);
      CREATE INDEX IF NOT EXISTS identity_user ON identities(user_id);
      -- Every Flare card counts its wearers and likes; without these each count
      -- scanned the whole users or likes table.
      CREATE INDEX IF NOT EXISTS users_equipped ON users(equipped) WHERE equipped IS NOT NULL;
      CREATE INDEX IF NOT EXISTS cosmetic_likes_rank ON cosmetic_likes(cosmetic_id,created_at,user_id);
      CREATE INDEX IF NOT EXISTS cosmetic_owner ON cosmetics(owner_id,created_at);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS textures_owner ON textures(owner_id);
      CREATE INDEX IF NOT EXISTS notifications_actor ON notifications(actor_id);`);
    // Additive migrations preserve existing production accounts, sessions, and paints.
    for (const [table, column, definition] of [['users','bio',"TEXT NOT NULL DEFAULT ''"],['users','profile_color',"TEXT NOT NULL DEFAULT '#ff355e'"],['users','banned_at','TEXT'],['users','ban_reason',"TEXT NOT NULL DEFAULT ''"],['users','avatar_url',"TEXT NOT NULL DEFAULT ''"],['users','profile_provider',"TEXT NOT NULL DEFAULT ''"],['identities','avatar_url',"TEXT NOT NULL DEFAULT ''"],['cosmetics','listed','INTEGER NOT NULL DEFAULT 1 CHECK(listed IN (0,1))']]) {
      if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    for (const [column, definition] of [['created_at','TEXT'],['scan',"TEXT NOT NULL DEFAULT 'unscanned'"],['source_hash',"TEXT NOT NULL DEFAULT ''"]]) {
      if (!this.db.prepare('PRAGMA table_info(textures)').all().some(row => row.name === column)) this.db.exec(`ALTER TABLE textures ADD COLUMN ${column} ${definition}`);
    }
    // Uploads from before upload dates were recorded get a fresh grace period.
    this.db.prepare('UPDATE textures SET created_at=? WHERE created_at IS NULL').run(now());
    // banned_at arrives through the migrations above on older databases.
    this.db.exec(`CREATE INDEX IF NOT EXISTS users_banned ON users(banned_at) WHERE banned_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL, target_type TEXT NOT NULL CHECK(target_type IN ('cosmetic','user')), target_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed')), created_at TEXT NOT NULL, resolved_at TEXT, resolver_id TEXT, resolution TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type,target_id,status);
      CREATE INDEX IF NOT EXISTS reports_status ON reports(status,resolved_at);
      CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(reporter_id,target_type,target_id) WHERE status='open';
      CREATE TABLE IF NOT EXISTS blocked_media (hash TEXT PRIMARY KEY, reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_bans (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      -- Relay rooms were removed (Banechat covers multi-platform overlays).
      DROP TABLE IF EXISTS overlay_rooms;
      CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at);
      CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS textures_created ON textures(created_at);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- Networks an account signs in or makes changes from: keyed hashes of the
      -- client address (an IPv6 /64 counts as one), never the address itself.
      CREATE TABLE IF NOT EXISTS account_networks (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(user_id, hash));
      CREATE INDEX IF NOT EXISTS account_networks_seen ON account_networks(last_seen);
      -- Networks blocked because an account that used them was banned.
      CREATE TABLE IF NOT EXISTS network_bans (hash TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(hash, user_id));
      CREATE INDEX IF NOT EXISTS network_bans_user ON network_bans(user_id);`);
    // The key for network hashes is made once per database and never leaves it.
    let secret = this.db.prepare("SELECT value FROM settings WHERE key='network_key'").get()?.value;
    if (!secret) { secret = randomBytes(32).toString('hex'); this.db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('network_key',?)").run(secret); secret = this.db.prepare("SELECT value FROM settings WHERE key='network_key'").get().value; }
    this.networkSecret = secret;
    // Sorting by likes or wearers needs a count for every Flare. Those counts
    // live in a connection-local table rebuilt at most every RANK_TTL, so a
    // sorted page costs the same as a newest-first page.
    this.db.exec('CREATE TEMP TABLE IF NOT EXISTS cosmetic_rank (cosmetic_id TEXT PRIMARY KEY, likes INTEGER NOT NULL, recent INTEGER NOT NULL, wearers INTEGER NOT NULL)');
    this.rankedAt = 0;
  }
  // Bumped by every write that changes what public endpoints show (moderation,
  // roles, publishing, profiles). Caches compare it to drop stale answers.
  generation = 0;
  changed() { this.generation++; }
  // Change events for integrations: {type:'user', id} when what a person wears
  // may have changed, {type:'cosmetic', id} when a Flare was moderated.
  listeners = new Set();
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch {} } }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  identities(id) { return this.db.prepare('SELECT provider, provider_id, login, display_name, avatar_url FROM identities WHERE user_id=?').all(id); }
  account(id) {
    const user = this.user(id);
    return user ? { ...user, identities: this.identities(id) } : null;
  }
  linkIdentity(profile, currentId, ownerTwitchId) {
    this.changed();
    return this.transaction(() => {
      assert(!this.db.prepare('SELECT 1 FROM identity_bans WHERE hash=?').get(identityHash(profile.provider, profile.id)), 403, 'This account is banned.');
      const existing = this.db.prepare('SELECT * FROM identities WHERE provider=? AND provider_id=?').get(profile.provider, profile.id);
      if (currentId && existing) assert(existing.user_id === currentId, 409, 'This identity belongs to another account. Sign out to access that account.');
      let id = currentId || existing?.user_id;
      if (!id) {
        id = randomUUID();
        this.db.prepare('INSERT INTO users (id,name,created_at) VALUES (?,?,?)').run(id, profile.name, now());
      }
      assert(!this.user(id)?.banned_at, 403, 'This account is banned.');
      const slot = this.db.prepare('SELECT * FROM identities WHERE user_id=? AND provider=?').get(id, profile.provider);
      assert(!slot || slot.provider_id === profile.id, 409, 'This account already has a different identity for this platform.');
      const avatar = safeAvatar(profile.provider, profile.avatar_url);
      this.db.prepare('INSERT INTO identities (provider,provider_id,user_id,login,display_name,avatar_url) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,provider_id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name, avatar_url=excluded.avatar_url').run(profile.provider, profile.id, id, profile.login, profile.name, avatar);
      this.db.prepare("UPDATE users SET profile_provider=?,name=?,avatar_url=? WHERE id=? AND (profile_provider='' OR profile_provider=?)").run(profile.provider, profile.name, avatar, id, profile.provider);
      if (profile.provider === 'twitch' && profile.id === ownerTwitchId) {
        this.db.prepare("UPDATE users SET role='owner' WHERE id=?").run(id);
      }
      this.emit({ type:'user', id });
      return id;
    });
  }
  updateProfile(id, provider, input = {}) {
    this.changed();
    const identity = this.identities(id).find(item => item.provider === provider);
    assert(identity, 400, 'Choose a connected platform for your profile.');
    const fields = profileFields(input);
    this.db.prepare('UPDATE users SET profile_provider=?,name=?,avatar_url=?,bio=COALESCE(?,bio),profile_color=COALESCE(?,profile_color) WHERE id=?').run(provider, identity.display_name, safeAvatar(provider, identity.avatar_url), fields.bio ?? null, fields.profile_color ?? null, id);
    return this.account(id);
  }
  adminUsers({ query = '', offset = 0, limit = 50, status = 'all' } = {}) {
    const filters = { all:'1=1', active:'u.banned_at IS NULL', banned:'u.banned_at IS NOT NULL', staff:"u.role IN ('owner','moderator')" };
    assert(Object.hasOwn(filters,status),400,'Invalid account status.');
    const rows = this.db.prepare(`SELECT u.*,i.provider_id AS twitch_id FROM users u LEFT JOIN identities i ON i.user_id=u.id AND i.provider='twitch' WHERE (${filters[status]}) AND (u.name LIKE ? OR u.id=? OR EXISTS (SELECT 1 FROM identities x WHERE x.user_id=u.id AND (x.login LIKE ? OR x.provider_id=?))) ORDER BY ${status === 'banned' ? 'u.banned_at':'u.created_at'} DESC,u.id LIMIT ? OFFSET ?`).all(`%${query}%`, query, `%${query}%`, query, limit, offset);
    return rows.map(row => ({ ...row, identities: this.identities(row.id), networks_blocked: row.banned_at ? this.db.prepare('SELECT COUNT(*) AS n FROM network_bans WHERE user_id=? AND expires_at>?').get(row.id, now()).n : 0 }));
  }
  publicProfile(id) {
    const user = this.user(id);
    if (!user || user.banned_at) return null;
    const stats = this.db.prepare(`SELECT COUNT(*) AS paints, COALESCE(SUM((SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL)),0) AS likes, COALESCE(SUM((SELECT COUNT(*) FROM users wearer WHERE wearer.equipped=c.id AND wearer.banned_at IS NULL)),0) AS wears FROM cosmetics c WHERE c.owner_id=? AND c.status='approved' AND c.listed=1`).get(id);
    return { id:user.id, name:user.name, is_moderator:user.role==='moderator', is_artist:user.role==='artist', bio:user.bio, profile_color:user.profile_color, avatar_url:user.avatar_url, profile_provider:user.profile_provider, created_at:user.created_at, stats, identities:this.identities(id), cosmetic:this.publicCosmetic(this.getCosmetic(user.equipped || '')) };
  }
  // ---- Public statistics and listings for the API (banned accounts never appear)
  profileSummary(id) {
    const user = this.user(id);
    if (!user || user.banned_at) return null;
    return { id:user.id, name:user.name, avatar_url:user.avatar_url, profile_provider:user.profile_provider, is_artist:user.role === 'artist', is_moderator:user.role === 'moderator', identities:this.identities(id) };
  }
  // People currently wearing an approved Flare.
  wearers(cosmeticId, { offset = 0, limit = 50 } = {}) {
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE equipped=? AND banned_at IS NULL').get(cosmeticId).n;
    const ids = this.db.prepare('SELECT id FROM users WHERE equipped=? AND banned_at IS NULL ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?').all(cosmeticId, limit, offset).map(row => row.id);
    return { total, users:ids.map(id => this.profileSummary(id)).filter(Boolean) };
  }
  cosmeticStats(id, days = 30) {
    const cosmetic = this.publicCosmetic(this.getCosmetic(id));
    if (!cosmetic) return null;
    const windowDays = dateWindow(days), since = windowDays[0];
    return {
      id, name:cosmetic.name, creator_id:cosmetic.creator_id,
      wearers:cosmetic.equipped_count, likes:cosmetic.like_count, likes_7d:cosmetic.recent_like_count,
      views_30d:this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM page_views WHERE path=? AND day>=?').get(`/discover/${id}`, since).n,
      approved_at:cosmetic.updated_at,
      series:{
        likes:fillSeries(windowDays, this.db.prepare('SELECT substr(l.created_at,1,10) AS day,COUNT(*) AS n FROM cosmetic_likes l JOIN users u ON u.id=l.user_id WHERE l.cosmetic_id=? AND u.banned_at IS NULL AND substr(l.created_at,1,10)>=? GROUP BY day').all(id, since)),
        views:fillSeries(windowDays, this.db.prepare('SELECT day,SUM(count) AS n FROM page_views WHERE path=? AND day>=? GROUP BY day').all(`/discover/${id}`, since))
      }
    };
  }
  profileStats(id) {
    const profile = this.publicProfile(id);
    if (!profile) return null;
    const followers = this.db.prepare('SELECT COUNT(*) AS n FROM creator_follows f JOIN users a ON a.id=f.follower_id WHERE f.creator_id=? AND a.banned_at IS NULL').get(id).n;
    const following = this.db.prepare('SELECT COUNT(*) AS n FROM creator_follows f JOIN users b ON b.id=f.creator_id WHERE f.follower_id=? AND b.banned_at IS NULL').get(id).n;
    return { id, public_flares:profile.stats.paints, likes_received:profile.stats.likes, wearers:profile.stats.wears, followers, following, wearing:profile.cosmetic?.id || null, joined_at:profile.created_at };
  }
  publicStats() {
    this.refreshRank();
    const scalar = (sql, ...params) => this.db.prepare(sql).get(...params).n;
    const top = (order, limit = 10) => this.db.prepare(`SELECT c.id FROM cosmetics c JOIN users u ON u.id=c.owner_id JOIN temp.cosmetic_rank k ON k.cosmetic_id=c.id WHERE c.status='approved' AND c.listed=1 AND u.banned_at IS NULL ORDER BY ${order} LIMIT ?`).all(limit).map(row => row.id);
    const brief = ids => this.cosmeticsByIds(ids).map(c => ({ id:c.id, name:c.name, creator:c.creator, creator_id:c.owner_id, wearers:c.equipped_count, likes:c.like_count, likes_7d:c.recent_like_count }));
    return {
      accounts:scalar('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NULL'),
      creators:scalar("SELECT COUNT(DISTINCT c.owner_id) AS n FROM cosmetics c JOIN users u ON u.id=c.owner_id WHERE c.status='approved' AND c.listed=1 AND u.banned_at IS NULL"),
      public_flares:scalar("SELECT COUNT(*) AS n FROM cosmetics c JOIN users u ON u.id=c.owner_id WHERE c.status='approved' AND c.listed=1 AND u.banned_at IS NULL"),
      wearing_now:scalar('SELECT COUNT(*) AS n FROM users WHERE equipped IS NOT NULL AND banned_at IS NULL'),
      likes:scalar('SELECT COUNT(*) AS n FROM cosmetic_likes l JOIN users u ON u.id=l.user_id WHERE u.banned_at IS NULL'),
      follows:scalar('SELECT COUNT(*) AS n FROM creator_follows f JOIN users a ON a.id=f.follower_id JOIN users b ON b.id=f.creator_id WHERE a.banned_at IS NULL AND b.banned_at IS NULL'),
      linked_accounts:Object.fromEntries(this.db.prepare('SELECT i.provider, COUNT(*) AS n FROM identities i JOIN users u ON u.id=i.user_id WHERE u.banned_at IS NULL GROUP BY i.provider').all().map(row => [row.provider, row.n])),
      most_worn:brief(top('k.wearers DESC, c.id')),
      most_liked:brief(top('k.likes DESC, c.id')),
      trending:brief(top('k.recent DESC, k.likes DESC, c.id'))
    };
  }
  userIdByIdentity(provider, providerId) {
    return this.db.prepare('SELECT i.user_id FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.provider_id=? AND u.banned_at IS NULL').get(provider, providerId)?.user_id || null;
  }
  countProfiles() { return this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NULL').get().n; }
  searchProfiles({ query = '', offset = 0, limit = 25, sort = 'name' } = {}) {
    const order = { name:'u.name COLLATE NOCASE,u.id', newest:'u.created_at DESC,u.id', oldest:'u.created_at,u.id' }[sort];
    assert(order,400,'Sort by name, newest, or oldest.');
    const rows = this.db.prepare(`SELECT u.id FROM users u WHERE u.banned_at IS NULL AND (u.name LIKE ? OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id=u.id AND (i.login LIKE ? OR i.display_name LIKE ? OR i.provider_id=?))) ORDER BY ${order} LIMIT ? OFFSET ?`).all(`%${query}%`,`%${query}%`,`%${query}%`,query,limit,offset);
    return rows.map(row => this.publicProfile(row.id));
  }
  artistShowcase({ query = '', offset = 0, limit = 25 } = {}) {
    const rows = this.db.prepare(`SELECT u.id FROM users u WHERE u.role='artist' AND u.banned_at IS NULL AND (u.name LIKE ? OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id=u.id AND (i.login LIKE ? OR i.display_name LIKE ? OR i.provider_id=?))) ORDER BY u.name COLLATE NOCASE,u.id LIMIT ? OFFSET ?`).all(`%${query}%`,`%${query}%`,`%${query}%`,query,limit,offset);
    return rows.map(row => ({ ...this.publicProfile(row.id), flares:this.catalog({owner:row.id,listedOnly:true,limit:3}).map(c => this.publicCosmetic(c)) }));
  }
  followingIds(id) {
    return this.db.prepare('SELECT f.creator_id FROM creator_follows f JOIN users creator ON creator.id=f.creator_id JOIN users follower ON follower.id=f.follower_id WHERE f.follower_id=? AND creator.banned_at IS NULL AND follower.banned_at IS NULL ORDER BY f.created_at DESC,f.creator_id').all(id).map(row=>row.creator_id);
  }
  followingProfiles(id, { offset=0, limit=25, query='' } = {}) {
    const rows=this.db.prepare('SELECT f.creator_id FROM creator_follows f JOIN users creator ON creator.id=f.creator_id JOIN users follower ON follower.id=f.follower_id WHERE f.follower_id=? AND creator.banned_at IS NULL AND follower.banned_at IS NULL AND creator.name LIKE ? ORDER BY f.created_at DESC,f.creator_id LIMIT ? OFFSET ?').all(id,`%${query}%`,limit,offset);
    return rows.map(row=>this.publicProfile(row.creator_id));
  }
  setFollow(id, creatorId, following) {
    assert(typeof following==='boolean',400,'Following must be true or false.');
    assert(id!==creatorId,400,'You cannot follow yourself.');
    return this.transaction(()=>{
      const follower=this.user(id),creator=this.user(creatorId);
      assert(follower && !follower.banned_at,403,'This account is banned.');
      assert(creator && !creator.banned_at,404,'Creator not found.');
      if(following){
        const inserted=this.db.prepare('INSERT OR IGNORE INTO creator_follows (follower_id,creator_id,created_at) VALUES (?,?,?)').run(id,creatorId,now());
        if(inserted.changes)this.notify(creatorId,id,'follow',creatorId,'');
      } else {
        this.db.prepare('DELETE FROM creator_follows WHERE follower_id=? AND creator_id=?').run(id,creatorId);
        this.db.prepare("DELETE FROM notifications WHERE user_id=? AND actor_id=? AND kind='follow' AND target=?").run(creatorId,id,creatorId);
      }
      return {id:creatorId,following};
    });
  }
  setBan(actor, id, banned, reason = '') {
    this.changed();
    return this.transaction(() => {
      actor = this.user(actor.id);
      assert(actor && !actor.banned_at && ['owner','moderator'].includes(actor.role),403,'Moderator access required.');
      assert(typeof banned === 'boolean',400,'Provide a banned flag.');
      reason = text(reason,banned ? 3:0,400,'Ban reason');
      const user = this.user(id);
      assert(user,404,'Account not found.');
      assert(user.role !== 'owner' && user.id !== actor.id,403,'The owner and your own account are protected.');
      assert(actor.role === 'owner' || ['user','artist'].includes(user.role),403,'Only the owner can ban or unban moderators.');
      // Bans never expire. Repeated requests preserve the original date, reason and audit event.
      if (Boolean(user.banned_at) === banned) return this.account(id);
      this.db.prepare('UPDATE users SET banned_at=?,ban_reason=? WHERE id=?').run(banned ? now():null,banned ? reason:'',id);
      if (banned) {
        // The ban follows the account to the networks it used recently.
        const expires = new Date(Date.now() + RETENTION.network_ban_days * 86400000).toISOString();
        this.db.prepare('INSERT OR REPLACE INTO network_bans (hash,user_id,created_at,expires_at) SELECT hash,user_id,?,? FROM account_networks WHERE user_id=?').run(now(), expires, id);
        this.db.prepare('UPDATE users SET equipped=NULL WHERE id=?').run(id);
        this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        this.db.prepare('DELETE FROM oauth_states WHERE user_id=?').run(id);
        const paints = this.db.prepare("SELECT id FROM cosmetics WHERE owner_id=? AND status!='rejected'").all(id);
        for (const paint of paints) {
          this.db.prepare("UPDATE cosmetics SET status='rejected',reason=?,reviewed_at=?,reviewer_id=? WHERE id=?").run(`Account banned: ${reason}`,now(),actor.id,paint.id);
          this.db.prepare('UPDATE users SET equipped=NULL WHERE equipped=?').run(paint.id);
          this.audit(actor.id,'cosmetic.rejected',paint.id,`Account banned: ${reason}`);
          this.emit({ type:'cosmetic', id:paint.id });
        }
      }
      if (!banned) this.db.prepare('DELETE FROM network_bans WHERE user_id=?').run(id);
      this.audit(actor.id,banned ? 'account.banned':'account.unbanned',id,reason);
      this.emit({ type:'user', id });
      return this.account(id);
    });
  }
  moderationCatalog(options) {
    return this.catalog(options).map(paint => {
      const ids = recipeTextureIds(paint.recipe);
      const flagged = ids.length ? this.db.prepare(`SELECT id FROM textures WHERE scan='review' AND id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(row => row.id) : [];
      return { ...paint, creator_identities: this.identities(paint.owner_id), media_flags: flagged, open_reports: this.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type='cosmetic' AND target_id=? AND status='open'").get(paint.id).n };
    });
  }
  newSession(id) {
    assert(this.user(id) && !this.user(id).banned_at,403,'This account is banned.');
    const raw = token(), csrf = token();
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(raw), id, csrf, Date.now() + 7 * 86400000);
    return { raw, csrf };
  }
  session(raw) {
    if (!raw) return null;
    return this.db.prepare('SELECT sessions.csrf, users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>? AND users.banned_at IS NULL').get(digest(raw), Date.now()) || null;
  }
  revokeSession(raw) { if (raw) this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(raw)); }
  state(provider, userId, binding, verifier) {
    const raw = token();
    this.db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?,?,?)').run(digest(raw), provider, userId || null, digest(binding), verifier, Date.now() + 600000);
    return raw;
  }
  consumeState(raw, provider, binding) {
    return this.transaction(() => {
      const state = this.db.prepare('SELECT * FROM oauth_states WHERE hash=?').get(digest(raw || ''));
      if (state) this.db.prepare('DELETE FROM oauth_states WHERE hash=?').run(state.hash);
      assert(state && state.provider === provider && state.expires > Date.now() && state.binding === digest(binding || ''), 400, 'Login expired or invalid. Please start again.');
      return state;
    });
  }
  cosmetic(row) {
    if (!row) return null;
    return { ...row, recipe: JSON.parse(row.recipe) };
  }
  getCosmetic(id) { return this.cosmetic(this.db.prepare(`${paintSelect} WHERE c.id=?`).get(id)); }
  cosmeticsByIds(ids) {
    if (!ids.length) return [];
    const rows = new Map(this.db.prepare(`${paintSelect} WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(row => [row.id, row]));
    return ids.map(id => this.cosmetic(rows.get(id))).filter(Boolean);
  }
  // Exact, case-insensitive name match among public Flares: most liked first,
  // then the earliest approved, so a well-known name resolves predictably.
  cosmeticsByName(name, limit = 10) {
    this.refreshRank();
    const ids = this.db.prepare(`SELECT c.id FROM cosmetics c JOIN users u ON u.id=c.owner_id LEFT JOIN temp.cosmetic_rank k ON k.cosmetic_id=c.id WHERE c.status='approved' AND c.listed=1 AND u.banned_at IS NULL AND c.name=? COLLATE NOCASE ORDER BY COALESCE(k.likes,0) DESC, COALESCE(c.reviewed_at,c.created_at), c.id LIMIT ?`).all(name, limit).map(row => row.id);
    return this.cosmeticsByIds(ids);
  }
  refreshRank(maxAge = 30000) {
    if (Date.now() - this.rankedAt < maxAge && this.rankGeneration === this.generation) return;
    this.db.exec(`DELETE FROM temp.cosmetic_rank;
      INSERT INTO temp.cosmetic_rank (cosmetic_id,likes,recent,wearers)
      SELECT c.id, COALESCE(l.likes,0), COALESCE(l.recent,0), COALESCE(w.n,0) FROM cosmetics c
      LEFT JOIN (SELECT cosmetic_id, COUNT(*) AS likes, SUM(created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS recent FROM cosmetic_likes WHERE user_id NOT IN (SELECT id FROM users WHERE banned_at IS NOT NULL) GROUP BY cosmetic_id) l ON l.cosmetic_id=c.id
      LEFT JOIN (SELECT equipped, COUNT(*) AS n FROM users WHERE equipped IS NOT NULL GROUP BY equipped) w ON w.equipped=c.id;`);
    this.rankedAt = Date.now(); this.rankGeneration = this.generation;
  }
  catalog({ status = 'approved', owner, offset = 0, limit = 60, query = '', listedOnly = false, likedBy, followedBy, effect = 'all', sort = 'newest', color = 'all', motion = 'all', fill = 'all' } = {}) {
    const selection = catalogSelection({effect,sort,color,motion,fill});
    const params = [status];
    let filter = `c.status=? AND (${selection.filter})${listedOnly ? ' AND c.listed=1' : ''}`;
    if (owner) { filter += ' AND c.owner_id=?'; params.push(owner); }
    if (likedBy) { filter += ' AND EXISTS (SELECT 1 FROM cosmetic_likes l WHERE l.cosmetic_id=c.id AND l.user_id=?)'; params.push(likedBy); }
    if (followedBy) { filter += " AND c.status='approved' AND c.listed=1 AND u.banned_at IS NULL AND EXISTS (SELECT 1 FROM creator_follows f JOIN users follower ON follower.id=f.follower_id WHERE f.creator_id=c.owner_id AND f.follower_id=? AND follower.banned_at IS NULL)"; params.push(followedBy); }
    if (query) { filter += ' AND (c.name LIKE ? OR u.name LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
    // Pick the page's IDs first (count sorts read the rank table), then load
    // full rows with live counts for just that page.
    const ranks = { like_count:'COALESCE(k.likes,0)', recent_like_count:'COALESCE(k.recent,0)', equipped_count:'COALESCE(k.wearers,0)' };
    const ranked = /\b(recent_like_count|like_count|equipped_count)\b/.test(selection.order);
    if (ranked) this.refreshRank();
    const order = selection.order.replace(/\b(recent_like_count|like_count|equipped_count)\b/g, name => ranks[name]);
    const ids = this.db.prepare(`SELECT c.id FROM cosmetics c JOIN users u ON u.id=c.owner_id${ranked ? ' LEFT JOIN temp.cosmetic_rank k ON k.cosmetic_id=c.id' : ''} WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset).map(row => row.id);
    if (!ids.length) return [];
    const rows = new Map(this.db.prepare(`${paintSelect} WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(row => [row.id, row]));
    return ids.map(id => this.cosmetic(rows.get(id))).filter(Boolean);
  }
  mine(id, { offset = 0, limit = this.user(id)?.role === 'owner' ? -1:100 } = {}) { return this.db.prepare(`${paintSelect} WHERE c.owner_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`).all(id,limit,offset).map(row => this.cosmetic(row)); }
  submit(id, name, description, recipe, listed = true) {
    this.changed();
    publishingFlag(listed);
    const user = this.user(id), automatic = ['owner','moderator'].includes(user?.role);
    assert(user && !user.banned_at,403,'This account is banned.');
    const cosmeticId = randomUUID();
    return this.transaction(() => {
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM cosmetics WHERE owner_id=?').get(id).n;
      const limit = user.role === 'artist' ? 20:3;
      assert(automatic || count < limit,429,`Flare submission limit reached (${limit} per account).`);
      this.db.prepare('INSERT INTO cosmetics (id,owner_id,name,description,recipe,created_at,listed,status,reviewed_at,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(cosmeticId,id,name,description,JSON.stringify(recipe),now(),Number(listed),automatic ? 'approved':'pending',automatic ? now():null,automatic ? id:null);
      if (automatic) this.audit(id,'cosmetic.auto_approved',cosmeticId,`${user.role} submission`);
      return this.getCosmetic(cosmeticId);
    });
  }
  setPublication(userId, id, listed) {
    this.changed();
    publishingFlag(listed);
    return this.transaction(() => {
      const cosmetic = this.getCosmetic(id);
      assert(cosmetic, 404, 'Flare not found.');
      assert(cosmetic.owner_id === userId || this.user(userId)?.role === 'owner', 403, 'Only the creator or owner can change publication.');
      this.db.prepare('UPDATE cosmetics SET listed=? WHERE id=?').run(Number(listed), id);
      this.audit(userId, 'flare.publication', id, listed ? 'public' : 'unlisted');
      return this.getCosmetic(id);
    });
  }
  audit(actor, action, target, detail = '') {
    this.db.prepare('INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (?,?,?,?,?)').run(actor, action, target, detail, now());
  }
  notify(userId, actorId, kind, target = '', detail = '') {
    if (!userId || userId === actorId) return false;
    const actor = this.user(actorId), recipient = this.user(userId);
    if (!actor || actor.banned_at || !recipient || recipient.banned_at) return false;
    this.db.prepare('INSERT INTO notifications (user_id,actor_id,kind,target,detail,created_at) VALUES (?,?,?,?,?,?)').run(userId, actorId, kind, target, detail, now());
    return true;
  }
  notifications(userId, { limit = 30, offset = 0 } = {}) {
    const rows = this.db.prepare(`SELECT n.id,n.kind,n.target,n.detail,n.read_at,n.created_at,u.name AS actor,u.avatar_url AS actor_avatar,u.profile_provider AS actor_provider FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=? AND (u.id IS NULL OR u.banned_at IS NULL) ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);
    return rows.map(row => ({ id: row.id, kind: row.kind, target: row.target, detail: row.detail, read: Boolean(row.read_at), created_at: row.created_at, actor: row.actor ? { name: row.actor, avatar_url: row.actor_avatar, profile_provider: row.actor_provider } : null }));
  }
  unreadNotifications(userId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? AND n.read_at IS NULL AND u.banned_at IS NULL').get(userId).n;
  }
  markNotificationsRead(userId, id = null) {
    if (id === null) this.db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), userId);
    else this.db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND id=?').run(now(), userId, id);
    return this.unreadNotifications(userId);
  }
  recordView(path) {
    const day = new Date().toISOString().slice(0,10);
    // Distinct paths per day are capped so scripted views cannot grow the table without bound.
    if (this.viewDay?.day !== day) this.viewDay = { day, paths:this.db.prepare('SELECT COUNT(*) AS n FROM page_views WHERE day=?').get(day).n };
    if (this.viewDay.paths >= 5000) { this.db.prepare('UPDATE page_views SET count=count+1 WHERE day=? AND path=?').run(day, path); return; }
    const before = this.db.prepare('INSERT INTO page_views (day,path,count) VALUES (?,?,1) ON CONFLICT(day,path) DO UPDATE SET count=count+1 RETURNING count').get(day, path);
    if (before?.count === 1) this.viewDay.paths++;
  }
  review(actor, id, status, reason) {
    this.changed();
    return this.transaction(() => {
      const cosmetic = this.getCosmetic(id);
      assert(cosmetic, 404, 'Cosmetic not found.');
      assert(!this.user(cosmetic.owner_id)?.banned_at,403,'Unban the creator before reviewing this Flare.');
      assert(actor.role === 'owner' || cosmetic.owner_id !== actor.id, 403, 'You cannot review your own submission.');
      assert(actor.role === 'owner' || cosmetic.status === 'pending' || (status === 'rejected' && cosmetic.status === 'approved'), 409, 'This submission has already been reviewed.');
      this.db.prepare('UPDATE cosmetics SET status=?, reason=?,reviewed_at=?,reviewer_id=? WHERE id=?').run(status, reason, now(), actor.id, id);
      if (status === 'rejected') this.db.prepare('UPDATE users SET equipped=NULL WHERE equipped=?').run(id);
      this.audit(actor.id, status === 'approved' ? 'cosmetic.approved' : 'cosmetic.rejected', id, reason);
      this.notify(cosmetic.owner_id, actor.id, status === 'approved' ? 'approved' : 'rejected', id, cosmetic.name);
      this.emit({ type:'cosmetic', id });
      return this.getCosmetic(id);
    });
  }
  // Deletes one Flare and the images no other Flare uses. Call inside a transaction.
  removeFlare(id) {
    const cosmetic = this.getCosmetic(id);
    if (!cosmetic) return [];
    const removed = [];
    for (const textureId of recipeTextureIds(cosmetic.recipe)) {
      const shared = this.db.prepare("SELECT id FROM cosmetics WHERE id!=? AND instr(recipe,?)>0 AND (json_extract(recipe,'$.textureId')=? OR EXISTS (SELECT 1 FROM json_each(recipe,'$.layers') layer WHERE json_extract(layer.value,'$.textureId')=?)) LIMIT 1").get(id,textureId,textureId,textureId);
      if (shared) continue;
      this.db.prepare('DELETE FROM textures WHERE id=?').run(textureId);
      removed.push(textureId);
    }
    this.db.prepare('UPDATE users SET equipped=NULL WHERE equipped=?').run(id);
    this.db.prepare('DELETE FROM cosmetics WHERE id=?').run(id);
    this.emit({ type:'cosmetic', id });
    return removed;
  }
  deleteRejected(actor, id, removeTexture = () => {}, { blockImages = false } = {}) {
    this.changed();
    const deleted = this.transaction(() => {
      // Read the current role, not a role cached when the caller signed in.
      const user = this.user(actor.id);
      assert(user && !user.banned_at && ['owner','moderator'].includes(user.role),403,'Moderator access required.');
      const cosmetic = this.getCosmetic(id);
      assert(cosmetic,404,'Flare not found.');
      assert(cosmetic.status === 'rejected',409,'Only disapproved Flares can be permanently deleted.');
      if (blockImages) this.blockMedia(actor.id, recipeTextureIds(cosmetic.recipe), cosmetic.reason || 'Blocked with a deleted Flare');
      const removed = this.removeFlare(id);
      // Files go inside the transaction: if one cannot be removed, nothing is deleted.
      for (const textureId of removed) removeTexture(textureId);
      // Keep the event, not a copy of the deleted recipe or artwork.
      this.audit(actor.id,'flare.deleted',id);
      return removed;
    });
    return { id, deleted_textures:deleted };
  }
  addTexture(id, ownerId, { scan = 'unscanned', sourceHash = '' } = {}) {
    this.db.prepare('INSERT INTO textures (id,owner_id,created_at,scan,source_hash) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id, ownerId, now(), scan, sourceHash);
  }
  mediaBlocked(...hashes) { return hashes.some(hash => hash && this.db.prepare('SELECT 1 FROM blocked_media WHERE hash=?').get(hash)); }
  // Blocks both the stored file's hash and the hash of the bytes originally uploaded.
  blockMedia(actorId, textureIds, reason) {
    for (const id of textureIds) {
      const source = this.db.prepare('SELECT source_hash FROM textures WHERE id=?').get(id)?.source_hash;
      for (const hash of [id.split('.')[0], source].filter(Boolean)) this.db.prepare('INSERT OR IGNORE INTO blocked_media (hash,reason,actor_id,created_at) VALUES (?,?,?,?)').run(hash, String(reason).slice(0,400), actorId, now());
    }
    if (textureIds.length) this.audit(actorId, 'media.blocked', textureIds.join(','), String(reason).slice(0,400));
  }
  // ---- Networks (for bans that cover IP addresses)
  networkHash(clientKey) { return createHmac('sha256', this.networkSecret).update(String(clientKey)).digest('hex'); }
  recordNetwork(userId, hash) { this.db.prepare('INSERT INTO account_networks (user_id,hash,last_seen) VALUES (?,?,?) ON CONFLICT(user_id,hash) DO UPDATE SET last_seen=excluded.last_seen').run(userId, hash, now()); }
  networkBanned(hash) { return Boolean(this.db.prepare('SELECT 1 FROM network_bans WHERE hash=? AND expires_at>?').get(hash, now())); }
  // ---- Abuse reports
  report(userId, { target_type, target_id, reason, details = '' } = {}) {
    assert(['cosmetic','user'].includes(target_type),400,'Report a Flare or a profile.');
    assert(REPORT_REASONS.includes(reason),400,'Choose a reason for the report.');
    assert(typeof target_id === 'string' && target_id.length >= 1 && target_id.length <= 100,400,'Invalid report target.');
    details = typeof details === 'string' ? details.trim() : '';
    assert(details.length <= 1000,400,'Details must be 1000 characters or fewer.');
    return this.transaction(() => {
      const user = this.user(userId);
      assert(user && !user.banned_at,403,'This account is banned.');
      if (target_type === 'cosmetic') {
        const cosmetic = this.getCosmetic(target_id);
        assert(cosmetic && cosmetic.status === 'approved' && !this.user(cosmetic.owner_id)?.banned_at,404,'Flare not found.');
        assert(cosmetic.owner_id !== userId,400,'You cannot report your own Flare.');
      } else {
        const target = this.user(target_id);
        assert(target && !target.banned_at,404,'Profile not found.');
        assert(target.id !== userId,400,'You cannot report your own profile.');
      }
      const existing = this.db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'").get(userId, target_type, target_id);
      if (existing) {
        this.db.prepare('UPDATE reports SET reason=?,details=? WHERE id=?').run(reason, details, existing.id);
        return { id:existing.id, updated:true };
      }
      const recent = this.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id=? AND created_at>=?').get(userId, new Date(Date.now() - 86400000).toISOString()).n;
      assert(recent < 20,429,'You have sent many reports today. Moderators will work through them; try again tomorrow.');
      const { lastInsertRowid } = this.db.prepare('INSERT INTO reports (reporter_id,target_type,target_id,reason,details,created_at) VALUES (?,?,?,?,?,?)').run(userId, target_type, target_id, reason, details, now());
      return { id:Number(lastInsertRowid), updated:false };
    });
  }
  reportTarget(type, id) {
    if (type === 'cosmetic') {
      const c = this.getCosmetic(id);
      return c ? { id:c.id, name:c.name, status:c.status, listed:Boolean(c.listed), creator:c.creator, owner_id:c.owner_id, creator_avatar:c.creator_avatar, creator_provider:c.creator_provider, recipe:c.recipe, description:c.description } : null;
    }
    const u = this.user(id);
    return u ? { id:u.id, name:u.name, role:u.role, bio:u.bio, avatar_url:u.avatar_url, profile_provider:u.profile_provider, banned:Boolean(u.banned_at), equipped:u.equipped } : null;
  }
  // Open reports grouped by what they are about, most-reported first.
  reportQueue({ status = 'open', offset = 0, limit = 20 } = {}) {
    assert(['open','closed'].includes(status),400,'Invalid report status.');
    const where = status === 'open' ? "status='open'" : "status!='open'";
    const groups = this.db.prepare(`SELECT target_type, target_id, COUNT(*) AS reports, MIN(created_at) AS first_at, MAX(created_at) AS last_at, MAX(resolved_at) AS resolved_at FROM reports WHERE ${where} GROUP BY target_type,target_id ORDER BY ${status === 'open' ? 'reports DESC, first_at' : 'resolved_at DESC'} LIMIT ? OFFSET ?`).all(limit, offset);
    return groups.map(group => ({ ...group, target:this.reportTarget(group.target_type, group.target_id), items:this.db.prepare(`SELECT r.id,r.reason,r.details,r.status,r.created_at,r.resolved_at,r.resolution,COALESCE(u.name,'Deleted account') AS reporter,v.name AS resolver FROM reports r LEFT JOIN users u ON u.id=r.reporter_id LEFT JOIN users v ON v.id=r.resolver_id WHERE r.target_type=? AND r.target_id=? AND r.${where} ORDER BY r.id DESC LIMIT 25`).all(group.target_type, group.target_id) }));
  }
  openReportCount() { return this.db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM reports WHERE status='open' GROUP BY target_type,target_id)").get().n; }
  // Acts on everything reported about one target at once.
  resolveReports(actor, { target_type, target_id, action, note = '', block_images = false } = {}) {
    actor = this.user(actor?.id);
    assert(actor && !actor.banned_at && ['owner','moderator'].includes(actor.role),403,'Moderator access required.');
    assert(['dismiss','remove','ban'].includes(action),400,'Choose dismiss, remove, or ban.');
    note = text(note || '', action === 'dismiss' ? 0 : 3, 400, 'Decision note');
    const open = this.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type=? AND target_id=? AND status='open'").get(target_type, target_id).n;
    assert(open > 0,404,'There are no open reports about this.');
    const cosmetic = target_type === 'cosmetic' ? this.getCosmetic(target_id) : null;
    // The action runs first; if it is refused (say, a moderator banning a
    // moderator), the reports stay open.
    if (action === 'remove') {
      assert(target_type === 'cosmetic',400,'Only a Flare can be removed. Ban the account instead.');
      if (cosmetic && cosmetic.status !== 'rejected') this.review(actor, target_id, 'rejected', `Removed after a report: ${note}`);
    }
    if (action === 'ban') {
      const userId = target_type === 'user' ? target_id : cosmetic?.owner_id;
      assert(userId && this.user(userId),404,'Account not found.');
      this.setBan(actor, userId, true, `After a report: ${note}`);
    }
    return this.transaction(() => {
      if (block_images && cosmetic && action !== 'dismiss') this.blockMedia(actor.id, recipeTextureIds(cosmetic.recipe), note);
      const status = action === 'dismiss' ? 'dismissed' : 'actioned';
      const resolution = action === 'dismiss' ? (note || 'No action needed') : `${action === 'remove' ? 'Flare removed' : 'Account banned'}: ${note}`;
      const changes = this.db.prepare("UPDATE reports SET status=?,resolved_at=?,resolver_id=?,resolution=? WHERE target_type=? AND target_id=? AND status='open'").run(status, now(), actor.id, resolution, target_type, target_id).changes;
      this.audit(actor.id, action === 'dismiss' ? 'report.dismissed' : 'report.actioned', `${target_type}:${target_id}`, resolution);
      return { resolved:Number(changes), status };
    });
  }
  // ---- Your data: export and deletion
  exportAccount(id) {
    const user = this.user(id);
    assert(user,404,'Account not found.');
    const all = (sql, ...params) => this.db.prepare(sql).all(...params);
    return {
      format:'nameflare-account-export', version:1, exported_at:now(),
      account:{ id:user.id, name:user.name, role:user.role, bio:user.bio, profile_color:user.profile_color, avatar_url:user.avatar_url, profile_provider:user.profile_provider, equipped:user.equipped, created_at:user.created_at },
      identities:this.identities(id),
      flares:all('SELECT id,name,description,recipe,status,reason,listed,created_at,reviewed_at FROM cosmetics WHERE owner_id=? ORDER BY created_at',id).map(row => ({ ...row, listed:Boolean(row.listed), recipe:JSON.parse(row.recipe) })),
      uploads:all('SELECT id,created_at,scan FROM textures WHERE owner_id=? ORDER BY created_at',id),
      likes:all('SELECT cosmetic_id,created_at FROM cosmetic_likes WHERE user_id=? ORDER BY created_at',id),
      following:all('SELECT creator_id,created_at FROM creator_follows WHERE follower_id=? ORDER BY created_at',id),
      notifications:all('SELECT kind,target,detail,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id',id),
      reports_filed:all('SELECT target_type,target_id,reason,details,status,created_at,resolved_at FROM reports WHERE reporter_id=? ORDER BY id',id),
      sessions:{ active:this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires>?').get(id, Date.now()).n },
      networks:{ recent:this.db.prepare('SELECT COUNT(*) AS n FROM account_networks WHERE user_id=?').get(id).n, note:'Networks you used in the last 90 days, stored as keyed hashes for enforcing bans. The addresses themselves are not stored.' }
    };
  }
  // Erases an account and everything attached to it. Returns the image files to
  // remove once the database change has committed.
  // Staff deletion: moderators may delete members and artists, the owner any
  // account but its own. A reason is required and kept in the activity log.
  deleteAccount(id, { actor = null, reason = '' } = {}) {
    const user = this.user(id);
    assert(user,404,'Account not found.');
    assert(user.role !== 'owner',403,'The owner account cannot be deleted.');
    const byStaff = actor && actor.id !== id;
    if (byStaff) {
      const by = this.user(actor.id);
      assert(by && !by.banned_at && ['owner','moderator'].includes(by.role),403,'Moderator access required.');
      assert(by.role === 'owner' || ['user','artist'].includes(user.role),403,'Only the owner can delete a moderator.');
      reason = text(reason,3,400,'Reason');
    }
    this.changed();
    // Tell integrations while the identities still resolve to this account.
    this.emit({ type:'user', id });
    return this.transaction(() => {
      if (user.banned_at) for (const identity of this.identities(id)) this.db.prepare('INSERT OR IGNORE INTO identity_bans (hash,created_at) VALUES (?,?)').run(identityHash(identity.provider, identity.provider_id), now());
      const flares = this.db.prepare('SELECT id FROM cosmetics WHERE owner_id=?').all(id).map(row => row.id);
      const files = [];
      for (const flare of flares) {
        this.db.prepare("UPDATE reports SET status='dismissed',resolved_at=?,resolution='Account deleted' WHERE target_type='cosmetic' AND target_id=? AND status='open'").run(now(), flare);
        files.push(...this.removeFlare(flare));
      }
      this.db.prepare("UPDATE reports SET status='dismissed',resolved_at=?,resolution='Account deleted' WHERE target_type='user' AND target_id=? AND status='open'").run(now(), id);
      for (const row of this.db.prepare('SELECT id FROM textures WHERE owner_id=?').all(id)) files.push(row.id);
      this.db.prepare('DELETE FROM textures WHERE owner_id=?').run(id);
      for (const table of ['sessions','oauth_states','identities']) this.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
      // Likes, follows and notifications cascade; reports filed become anonymous.
      this.db.prepare('DELETE FROM users WHERE id=?').run(id);
      this.audit(byStaff ? actor.id : id, 'account.deleted', id, byStaff ? `Deleted by staff: ${reason}` : 'Deleted by the account holder');
      return { id, flares:flares.length, files:[...new Set(files)] };
    });
  }
  // Applies RETENTION. Returns counts and the image files to remove.
  retention(at = Date.now()) {
    const ago = days => new Date(at - days * 86400000).toISOString();
    return this.transaction(() => {
      const run = (sql, ...params) => Number(this.db.prepare(sql).run(...params).changes);
      const result = {
        notifications:run('DELETE FROM notifications WHERE created_at<?', ago(RETENTION.notifications_days)),
        page_views:run('DELETE FROM page_views WHERE day<?', ago(RETENTION.page_view_days).slice(0,10)),
        audit:run('DELETE FROM audit WHERE created_at<?', ago(RETENTION.audit_days)),
        report_details:run("UPDATE reports SET details='' WHERE status!='open' AND details!='' AND resolved_at<?", ago(RETENTION.closed_report_detail_days)),
        reports:run("DELETE FROM reports WHERE status!='open' AND resolved_at<?", ago(RETENTION.closed_report_days)),
        networks:run('DELETE FROM account_networks WHERE last_seen<?', ago(RETENTION.network_days)),
        network_bans:run('DELETE FROM network_bans WHERE expires_at<?', new Date(at).toISOString()),
        rejected_flares:0, files:[]
      };
      for (const row of this.db.prepare("SELECT id FROM cosmetics WHERE status='rejected' AND COALESCE(reviewed_at,created_at)<?").all(ago(RETENTION.rejected_flare_days))) {
        result.files.push(...this.removeFlare(row.id)); result.rejected_flares++;
      }
      // Uploads no Flare uses: abandoned after the grace period.
      for (const row of this.db.prepare('SELECT t.id FROM textures t WHERE t.created_at<? AND NOT EXISTS (SELECT 1 FROM cosmetics c WHERE instr(c.recipe,t.id)>0)').all(ago(RETENTION.orphan_texture_days))) {
        this.db.prepare('DELETE FROM textures WHERE id=?').run(row.id); result.files.push(row.id);
      }
      if (result.rejected_flares) this.changed();
      return result;
    });
  }
  likedIds(userId) {
    return this.db.prepare("SELECT l.cosmetic_id FROM cosmetic_likes l JOIN cosmetics c ON c.id=l.cosmetic_id JOIN users u ON u.id=c.owner_id WHERE l.user_id=? AND c.status='approved' AND c.listed=1 AND u.banned_at IS NULL").all(userId).map(row => row.cosmetic_id);
  }
  setLike(userId, id, liked) {
    assert(typeof liked === 'boolean',400,'Liked must be true or false.');
    return this.transaction(() => {
      const user = this.user(userId), cosmetic = this.getCosmetic(id);
      assert(user && !user.banned_at,403,'This account is banned.');
      assert(cosmetic && cosmetic.status === 'approved' && cosmetic.listed && !this.user(cosmetic.owner_id)?.banned_at,404,'Public Flare not found.');
      if (liked) {
        const inserted=this.db.prepare('INSERT OR IGNORE INTO cosmetic_likes (cosmetic_id,user_id,created_at) VALUES (?,?,?)').run(id,userId,now());
        if(inserted.changes)this.notify(cosmetic.owner_id,userId,'like',id,cosmetic.name);
      } else {
        this.db.prepare('DELETE FROM cosmetic_likes WHERE cosmetic_id=? AND user_id=?').run(id,userId);
        this.db.prepare("DELETE FROM notifications WHERE user_id=? AND actor_id=? AND kind='like' AND target=?").run(cosmetic.owner_id,userId,id);
      }
      return { id, liked, like_count:this.getCosmetic(id).like_count };
    });
  }
  equip(userId, cosmeticId) {
    if (cosmeticId !== null) assert(this.getCosmetic(cosmeticId)?.status === 'approved', 400, 'Only approved cosmetics can be equipped.');
    if (this.db.prepare('UPDATE users SET equipped=? WHERE id=? AND equipped IS NOT ?').run(cosmeticId, userId, cosmeticId).changes) this.emit({ type:'user', id:userId });
  }
  publicCosmetic(c) {
    if (!c || c.status !== 'approved') return null;
    return { id: c.id, name: c.name, description: c.description, creator: c.creator, creator_id: c.owner_id, creator_avatar: c.creator_avatar, creator_provider: c.creator_provider, listed: Boolean(c.listed), equipped_count: c.equipped_count || 0, like_count: c.like_count || 0, recent_like_count: c.recent_like_count || 0, recipe: c.recipe, updated_at: c.reviewed_at || c.created_at };
  }
  resolve(provider, providerId, { withCosmetic = true } = {}) {
    const identity = this.db.prepare('SELECT i.provider, i.provider_id, i.login, i.display_name, u.equipped FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.provider_id=? AND u.banned_at IS NULL').get(provider, providerId);
    if (!identity) return null;
    const result = { provider: identity.provider, provider_id: identity.provider_id, login: identity.login, display_name: identity.display_name };
    // Callers that memoise Flares take the equipped ID and look it up themselves.
    return withCosmetic ? { ...result, cosmetic: this.publicCosmetic(this.getCosmetic(identity.equipped || '')) } : { ...result, equipped: identity.equipped };
  }
  moderators() { return this.db.prepare("SELECT u.id,u.name,u.role,u.avatar_url,u.profile_provider,u.created_at,i.provider_id AS twitch_id,i.login FROM users u JOIN identities i ON u.id=i.user_id AND i.provider='twitch' WHERE u.role IN ('moderator','owner')").all(); }
  setModerator(actor, twitchId, enabled) {
    this.changed();
    return this.transaction(() => {
      const row = this.db.prepare("SELECT u.* FROM identities i JOIN users u ON i.user_id=u.id WHERE i.provider='twitch' AND i.provider_id=?").get(twitchId);
      assert(row, 404, 'That Twitch account must sign in to Nameflare first. Use their numeric Twitch user ID.');
      assert(!enabled || !row.banned_at,403,'Unban this account before granting moderator access.');
      assert(row.role !== 'owner', 403, 'The owner role cannot be changed here.');
      this.db.prepare('UPDATE users SET role=? WHERE id=?').run(enabled ? 'moderator' : 'user', row.id);
      this.audit(actor.id, enabled ? 'moderator.added' : 'moderator.removed', row.id, twitchId);
    });
  }
  setArtist(actor, id, enabled) {
    this.changed();
    return this.transaction(() => {
      actor = this.user(actor.id);
      assert(actor && !actor.banned_at && actor.role === 'owner',403,'Owner access required.');
      assert(typeof enabled === 'boolean',400,'Provide an enabled flag.');
      const user = this.user(id);
      assert(user,404,'Account not found.');
      assert(['user','artist'].includes(user.role),403,'Owner and moderator roles cannot be changed here.');
      assert(!enabled || !user.banned_at,403,'Unban this account before granting the artist role.');
      if ((user.role === 'artist') === enabled) return this.account(id);
      this.db.prepare('UPDATE users SET role=? WHERE id=?').run(enabled ? 'artist':'user',id);
      this.audit(actor.id,enabled ? 'artist.added':'artist.removed',id);
      return this.account(id);
    });
  }
  // The whole retained activity log, oldest first, for export.
  auditExport() { return this.db.prepare("SELECT a.id,a.created_at,a.action,COALESCE(u.name,'Deleted account') AS actor,a.actor_id,a.target,a.detail FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id").all(); }
  auditLog() { return this.db.prepare("SELECT a.*,COALESCE(u.name,'Deleted account') AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100").all(); }
  stats() { return { public: this.db.prepare("SELECT COUNT(*) AS n FROM cosmetics WHERE status='approved' AND listed=1").get().n, approved: this.db.prepare("SELECT COUNT(*) AS n FROM cosmetics WHERE status='approved'").get().n, creators: this.db.prepare("SELECT COUNT(DISTINCT owner_id) AS n FROM cosmetics WHERE status='approved'").get().n, pending: this.db.prepare("SELECT COUNT(*) AS n FROM cosmetics WHERE status='pending'").get().n, rejected: this.db.prepare("SELECT COUNT(*) AS n FROM cosmetics WHERE status='rejected'").get().n }; }
  analytics(days = 14) {
    const windowDays = dateWindow(days), since = windowDays[0];
    const series = rows => fillSeries(windowDays, rows);
    const scalar = sql => this.db.prepare(sql).get().n;
    const totals = {
      accounts: scalar('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NULL'),
      creators: scalar("SELECT COUNT(DISTINCT owner_id) AS n FROM cosmetics WHERE status='approved'"),
      public_flares: scalar("SELECT COUNT(*) AS n FROM cosmetics WHERE status='approved' AND listed=1"),
      pending: scalar("SELECT COUNT(*) AS n FROM cosmetics WHERE status='pending'"),
      likes: scalar('SELECT COUNT(*) AS n FROM cosmetic_likes l JOIN users u ON u.id=l.user_id WHERE u.banned_at IS NULL'),
      wears: scalar('SELECT COUNT(*) AS n FROM users WHERE equipped IS NOT NULL AND banned_at IS NULL'),
      follows: scalar('SELECT COUNT(*) AS n FROM creator_follows f JOIN users a ON a.id=f.follower_id JOIN users b ON b.id=f.creator_id WHERE a.banned_at IS NULL AND b.banned_at IS NULL'),
      views: scalar('SELECT COALESCE(SUM(count),0) AS n FROM page_views')
    };
    const recentViews = this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM page_views WHERE day>=?').get(since).n;
    const topFlares = this.db.prepare(`SELECT c.id,c.name,c.owner_id,u.name AS creator,
      (SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL) AS likes,
      (SELECT COUNT(*) FROM users wearer WHERE wearer.equipped=c.id AND wearer.banned_at IS NULL) AS wears
      FROM cosmetics c JOIN users u ON u.id=c.owner_id
      WHERE c.status='approved' AND c.listed=1 AND u.banned_at IS NULL
      ORDER BY likes DESC,wears DESC,c.created_at DESC LIMIT 8`).all();
    const topCreators = this.db.prepare(`SELECT u.id,u.name,COUNT(c.id) AS flares,
      COALESCE(SUM((SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL)),0) AS likes,
      COALESCE(SUM((SELECT COUNT(*) FROM users wearer WHERE wearer.equipped=c.id AND wearer.banned_at IS NULL)),0) AS wears
      FROM users u JOIN cosmetics c ON c.owner_id=u.id AND c.status='approved' AND c.listed=1
      WHERE u.banned_at IS NULL GROUP BY u.id ORDER BY likes DESC,wears DESC,flares DESC LIMIT 6`).all();
    const topPages = this.db.prepare('SELECT path,SUM(count) AS views FROM page_views WHERE day>=? GROUP BY path ORDER BY views DESC LIMIT 8').all(since);
    return {
      window_days: windowDays.length,
      since,
      series: {
        signups: series(this.db.prepare('SELECT substr(created_at,1,10) AS day,COUNT(*) AS n FROM users WHERE substr(created_at,1,10)>=? GROUP BY day').all(since)),
        submissions: series(this.db.prepare('SELECT substr(created_at,1,10) AS day,COUNT(*) AS n FROM cosmetics WHERE substr(created_at,1,10)>=? GROUP BY day').all(since)),
        reviews: series(this.db.prepare("SELECT substr(reviewed_at,1,10) AS day,COUNT(*) AS n FROM cosmetics WHERE reviewed_at IS NOT NULL AND status IN ('approved','rejected') AND substr(reviewed_at,1,10)>=? GROUP BY day").all(since)),
        likes: series(this.db.prepare('SELECT substr(l.created_at,1,10) AS day,COUNT(*) AS n FROM cosmetic_likes l JOIN users u ON u.id=l.user_id WHERE substr(l.created_at,1,10)>=? AND u.banned_at IS NULL GROUP BY day').all(since)),
        views: series(this.db.prepare('SELECT day,SUM(count) AS n FROM page_views WHERE day>=? GROUP BY day').all(since))
      },
      totals: { ...totals, views_window: recentViews },
      top_flares: topFlares,
      top_creators: topCreators,
      top_pages: topPages
    };
  }
  creatorAnalytics(userId, days = 30) {
    const user = this.user(userId);
    if (!user || user.banned_at) return null;
    const windowDays = dateWindow(days), since = windowDays[0], series = rows => fillSeries(windowDays, rows);
    const counts = this.db.prepare(`SELECT COUNT(*) AS submissions,COALESCE(SUM(CASE WHEN status='approved' AND listed=1 THEN 1 ELSE 0 END),0) AS public FROM cosmetics WHERE owner_id=?`).get(userId);
    const likes = this.db.prepare('SELECT COUNT(*) AS n FROM cosmetic_likes l JOIN cosmetics c ON c.id=l.cosmetic_id JOIN users u ON u.id=l.user_id WHERE c.owner_id=? AND u.banned_at IS NULL').get(userId).n;
    const wears = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE equipped IN (SELECT id FROM cosmetics WHERE owner_id=?) AND banned_at IS NULL').get(userId).n;
    const followers = this.db.prepare('SELECT COUNT(*) AS n FROM creator_follows f JOIN users a ON a.id=f.follower_id JOIN users b ON b.id=f.creator_id WHERE f.creator_id=? AND a.banned_at IS NULL AND b.banned_at IS NULL').get(userId).n;
    const profile = `/profiles/${userId}`;
    const profileViews = this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM page_views WHERE path=? AND day>=?').get(profile, since).n;
    const flareViews = new Map(this.db.prepare("SELECT path,SUM(count) AS n FROM page_views WHERE path LIKE '/discover/%' GROUP BY path").all().map(row => [row.path.slice('/discover/'.length), Number(row.n)]));
    const flares = this.db.prepare(`${paintSelect} WHERE c.owner_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 200`).all(userId).map(row => this.cosmetic(row)).map(paint => ({
      id: paint.id, name: paint.name, status: paint.status, listed: Boolean(paint.listed), created_at: paint.created_at, reviewed_at: paint.reviewed_at,
      like_count: Number(paint.like_count || 0), equipped_count: Number(paint.equipped_count || 0), view_count: flareViews.get(paint.id) || 0
    }));
    return {
      window_days: windowDays.length,
      totals: { submissions: counts.submissions, public: counts.public, likes, wears, followers, profile_views: profileViews },
      series: {
        likes: series(this.db.prepare('SELECT substr(l.created_at,1,10) AS day,COUNT(*) AS n FROM cosmetic_likes l JOIN cosmetics c ON c.id=l.cosmetic_id JOIN users u ON u.id=l.user_id WHERE c.owner_id=? AND substr(l.created_at,1,10)>=? AND u.banned_at IS NULL GROUP BY day').all(userId, since)),
        profile_views: series(this.db.prepare('SELECT day,SUM(count) AS n FROM page_views WHERE path=? AND day>=? GROUP BY day').all(profile, since))
      },
      flares
    };
  }
  cleanup() { this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); this.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now()); }
  seedDemo() {
    if (this.user('demo-owner')) return;
    this.transaction(() => {
      for (const [id,name,role,twitch] of [['demo-owner','orbit','owner','1001'],['demo-creator','lumi','user','1002'],['demo-mod','nova','moderator','1003']]) {
        this.db.prepare('INSERT INTO users (id,name,role,created_at) VALUES (?,?,?,?)').run(id,name,role,now());
        this.db.prepare('INSERT INTO identities (provider,provider_id,user_id,login,display_name) VALUES (?,?,?,?,?)').run('twitch',twitch,id,name,name);
        this.db.prepare("UPDATE users SET profile_provider='twitch' WHERE id=?").run(id);
      }
      const presets = [
        ['Aurora drift',['#71f5bd','#82b8ff','#b798ff'],'flow',4,120,5],
        ['Solar flare',['#ffcc76','#ff735c','#f95d9b'],'flow',3,45,6],
        ['Ultraviolet',['#c39bff','#965dff','#f2a4f9'],'shimmer',5,90,8],
        ['Ocean glass',['#84f2f2','#4c9bff','#bbdcff'],'flow',6,160,3],
        ['Cherry blossom',['#ffd6e9','#ff83bd','#e5a9ff'],'pulse',4,65,6],
        ['Liquid gold',['#fff2b7','#e4ab4a','#fff9de'],'shimmer',7,100,4],
        ['Acid rain',['#dbff85','#60f59c','#a4e54c'],'flow',3,135,5],
        ['Midnight signal',['#829dff','#dd94ff','#738bfa'],'pulse',5,90,7]
      ];
      presets.forEach(([name,colors,animation,speed,angle,glow],i) => {
        this.db.prepare('INSERT INTO cosmetics (id,owner_id,name,description,recipe,status,created_at,reviewed_at,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?)').run(`demo-${i}`, i%2 ? 'demo-mod':'demo-creator', name, 'A sample cosmetic for the isolated demo.',JSON.stringify({colors,animation,speed,angle,glow}),'approved',now(),now(),'demo-owner');
      });
      this.equip('demo-creator','demo-0');
      const samplePaths = [['/discover',44],['/profiles',17],['/profiles/demo-creator',12],['/discover/demo-0',16],['/studio',9],['/discover/demo-2',7],['/profiles/demo-mod',5]];
      for (let i = 13; i >= 0; i--) {
        const day = new Date(); day.setUTCHours(0,0,0,0); day.setUTCDate(day.getUTCDate() - i);
        for (const [path, base] of samplePaths) this.db.prepare('INSERT OR IGNORE INTO page_views (day,path,count) VALUES (?,?,?)').run(day.toISOString().slice(0,10), path, base + ((i * 7 + base) % 9));
      }
    });
    this.db.prepare('INSERT INTO notifications (user_id,actor_id,kind,target,detail,created_at) VALUES (?,?,?,?,?,?)').run('demo-creator','demo-owner','approved','demo-0','Aurora drift',now());
    // Legacy demo data intentionally represents an account above the new cap.
    this.db.prepare('INSERT INTO cosmetics (id,owner_id,name,description,recipe,created_at,status) VALUES (?,?,?,?,?,?,?)').run('demo-pending','demo-creator','Starlight circuit','Soft violet with a slow blue shimmer.',JSON.stringify({colors:['#8de7ff','#b68bff','#ffe4fa'],animation:'shimmer',speed:5,angle:120,glow:7}),now(),'pending');
  }
  close() { this.db.close(); }
}
