import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { assert, catalogSelection, publishingFlag, profileFields, text } from '../lib/cosmetics.js';
import { safeAvatar } from '../lib/oauth.js';
const paintSelect = `SELECT c.*,u.name AS creator,u.avatar_url AS creator_avatar,u.profile_provider AS creator_provider,r.name AS reviewer,(SELECT COUNT(*) FROM users e WHERE e.equipped=c.id) AS equipped_count,(SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL) AS like_count,(SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL AND l.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS recent_like_count FROM cosmetics c JOIN users u ON u.id=c.owner_id LEFT JOIN users r ON r.id=c.reviewer_id`;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
const now = () => new Date().toISOString();
const parse = row => row ? {...row,recipe:JSON.parse(row.recipe)} : null;
export class D1Store {
  constructor(db) { this.db=db; }
  stmt(sql,...args) { return this.db.prepare(sql).bind(...args); }
  first(sql,...args) { return this.stmt(sql,...args).first(); }
  async all(sql,...args) { return (await this.stmt(sql,...args).all()).results; }
  run(sql,...args) { return this.stmt(sql,...args).run(); }
  user(id) { return this.first('SELECT * FROM users WHERE id=?',id); }
  async account(id) {
    const user=await this.user(id);
    return user ? {...user,identities:await this.all('SELECT provider,provider_id,login,display_name,avatar_url FROM identities WHERE user_id=?',id)} : null;
  }
  async identities(id) { return this.all('SELECT provider,provider_id,login,display_name,avatar_url FROM identities WHERE user_id=?',id); }
  async updateProfile(id,provider,input={}) {
    const identity=(await this.identities(id)).find(item=>item.provider===provider);
    assert(identity,400,'Choose a connected platform for your profile.');
    const fields=profileFields(input);
    await this.run('UPDATE users SET profile_provider=?,name=?,avatar_url=?,bio=COALESCE(?,bio),profile_color=COALESCE(?,profile_color) WHERE id=?',provider,identity.display_name,safeAvatar(provider,identity.avatar_url),fields.bio ?? null,fields.profile_color ?? null,id);
    return this.account(id);
  }
  async adminUsers({query='',offset=0,limit=50,status='all'}={}) {
    const filters={all:'1=1',active:'u.banned_at IS NULL',banned:'u.banned_at IS NOT NULL',staff:"u.role IN ('owner','moderator')"};
    assert(Object.hasOwn(filters,status),400,'Invalid account status.');
    const rows=await this.all(`SELECT u.*,i.provider_id AS twitch_id FROM users u LEFT JOIN identities i ON i.user_id=u.id AND i.provider='twitch' WHERE (${filters[status]}) AND (u.name LIKE ? OR u.id=? OR EXISTS (SELECT 1 FROM identities x WHERE x.user_id=u.id AND (x.login LIKE ? OR x.provider_id=?))) ORDER BY ${status==='banned'?'u.banned_at':'u.created_at'} DESC,u.id LIMIT ? OFFSET ?`,`%${query}%`,query,`%${query}%`,query,limit,offset);
    return Promise.all(rows.map(async row=>({...row,identities:await this.identities(row.id)})));
  }
  async publicProfile(id) {
    const user=await this.user(id);
    if(!user || user.banned_at)return null;
    const stats=await this.first(`SELECT COUNT(*) AS paints, COALESCE(SUM((SELECT COUNT(*) FROM cosmetic_likes l JOIN users liker ON liker.id=l.user_id WHERE l.cosmetic_id=c.id AND liker.banned_at IS NULL)),0) AS likes, COALESCE(SUM((SELECT COUNT(*) FROM users wearer WHERE wearer.equipped=c.id AND wearer.banned_at IS NULL)),0) AS wears FROM cosmetics c WHERE c.owner_id=? AND c.status='approved' AND c.listed=1`,id);
    return {id:user.id,name:user.name,is_moderator:user.role==='moderator',bio:user.bio,profile_color:user.profile_color,avatar_url:user.avatar_url,profile_provider:user.profile_provider,created_at:user.created_at,stats,identities:await this.identities(id),cosmetic:this.publicCosmetic(await this.getCosmetic(user.equipped || ''))};
  }
  async searchProfiles({query='',offset=0,limit=25}={}) {
    const rows=await this.all(`SELECT u.id FROM users u WHERE u.banned_at IS NULL AND (u.name LIKE ? OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id=u.id AND (i.login LIKE ? OR i.display_name LIKE ? OR i.provider_id=?))) ORDER BY u.name COLLATE NOCASE,u.id LIMIT ? OFFSET ?`,`%${query}%`,`%${query}%`,`%${query}%`,query,limit,offset);
    return Promise.all(rows.map(row=>this.publicProfile(row.id)));
  }
  async followingIds(id) {
    return (await this.all('SELECT f.creator_id FROM creator_follows f JOIN users creator ON creator.id=f.creator_id JOIN users follower ON follower.id=f.follower_id WHERE f.follower_id=? AND creator.banned_at IS NULL AND follower.banned_at IS NULL ORDER BY f.created_at DESC,f.creator_id',id)).map(row=>row.creator_id);
  }
  async followingProfiles(id,{offset=0,limit=25,query=''}={}) {
    const rows=await this.all('SELECT f.creator_id FROM creator_follows f JOIN users creator ON creator.id=f.creator_id JOIN users follower ON follower.id=f.follower_id WHERE f.follower_id=? AND creator.banned_at IS NULL AND follower.banned_at IS NULL AND creator.name LIKE ? ORDER BY f.created_at DESC,f.creator_id LIMIT ? OFFSET ?',id,`%${query}%`,limit,offset);
    return (await Promise.all(rows.map(row=>this.publicProfile(row.creator_id)))).filter(Boolean);
  }
  async setFollow(id,creatorId,following) {
    assert(typeof following==='boolean',400,'Following must be true or false.');assert(id!==creatorId,400,'You cannot follow yourself.');
    const follower=await this.user(id),creator=await this.user(creatorId);
    assert(follower && !follower.banned_at,403,'This account is banned.');assert(creator && !creator.banned_at,404,'Creator not found.');
    if(following)await this.run('INSERT OR IGNORE INTO creator_follows (follower_id,creator_id,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND banned_at IS NULL) AND EXISTS (SELECT 1 FROM users WHERE id=? AND banned_at IS NULL)',id,creatorId,now(),id,creatorId);
    else await this.run('DELETE FROM creator_follows WHERE follower_id=? AND creator_id=?',id,creatorId);
    return {id:creatorId,following};
  }
  async setBan(actor,id,banned,reason='') {
    actor=await this.user(actor.id);
    assert(actor && !actor.banned_at && ['owner','moderator'].includes(actor.role),403,'Moderator access required.');
    assert(typeof banned==='boolean',400,'Provide a banned flag.');reason=text(reason,banned?3:0,400,'Ban reason');
    const user=await this.user(id);assert(user,404,'Account not found.');
    assert(user.role!=='owner' && user.id!==actor.id,403,'The owner and your own account are protected.');
    assert(actor.role==='owner' || user.role==='user',403,'Only the owner can ban or unban moderators.');
    if(Boolean(user.banned_at)===banned)return this.account(id);
    const statements=[this.stmt('UPDATE users SET banned_at=?,ban_reason=? WHERE id=?',banned?now():null,banned?reason:'',id)];
    if(banned)statements.push(
      this.stmt('UPDATE users SET equipped=NULL WHERE id=?',id),
      this.stmt('DELETE FROM sessions WHERE user_id=?',id),
      this.stmt('DELETE FROM oauth_states WHERE user_id=?',id),
      this.stmt("UPDATE cosmetics SET status='rejected',reason=?,reviewed_at=?,reviewer_id=? WHERE owner_id=? AND status!='rejected'",`Account banned: ${reason}`,now(),actor.id,id)
    );
    statements.push(this.stmt('INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (?,?,?,?,?)',actor.id,banned?'account.banned':'account.unbanned',id,reason,now()));
    await this.db.batch(statements);return this.account(id);
  }
  async moderationCatalog(options) { return Promise.all((await this.catalog(options)).map(async paint=>({...paint,creator_identities:await this.identities(paint.owner_id)}))); }
  async session(raw) {
    return raw ? this.first('SELECT sessions.csrf,users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>? AND users.banned_at IS NULL',digest(raw),Date.now()) : null;
  }
  async newSession(id) {
    const user=await this.user(id);assert(user && !user.banned_at,403,'This account is banned.');
    const raw=token(),csrf=token();
    await this.run('INSERT INTO sessions VALUES (?,?,?,?)',digest(raw),id,csrf,Date.now()+7*86400000);
    return {raw,csrf};
  }
  async revokeSession(raw) { if(raw)await this.run('DELETE FROM sessions WHERE hash=?',digest(raw)); }
  async state(provider,userId,binding,verifier) {
    const raw=token();await this.run('INSERT INTO oauth_states VALUES (?,?,?,?,?,?)',digest(raw),provider,userId || null,digest(binding),verifier,Date.now()+600000);return raw;
  }
  async consumeState(raw,provider,binding) {
    const state=await this.first('DELETE FROM oauth_states WHERE hash=? AND provider=? AND binding=? AND expires>? RETURNING *',digest(raw || ''),provider,digest(binding || ''),Date.now());
    assert(state,400,'Login expired or invalid. Please start again.');return state;
  }
  async linkIdentity(profile,currentId,ownerTwitchId) {
    const existing=await this.first('SELECT * FROM identities WHERE provider=? AND provider_id=?',profile.provider,profile.id);
    if(currentId && existing)assert(existing.user_id===currentId,409,'This identity belongs to another account. Sign out to access that account.');
    const id=currentId || existing?.user_id || randomUUID();
    assert(!(await this.user(id))?.banned_at,403,'This account is banned.');
    const slot=await this.first('SELECT * FROM identities WHERE user_id=? AND provider=?',id,profile.provider);
    assert(!slot || slot.provider_id===profile.id,409,'This account already has a different identity for this platform.');
    const statements=[
      this.stmt('INSERT OR IGNORE INTO users (id,name,created_at) VALUES (?,?,?)',id,profile.name,now()),
      this.stmt('INSERT INTO identities (provider,provider_id,user_id,login,display_name,avatar_url) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,provider_id) DO UPDATE SET login=excluded.login,display_name=excluded.display_name,avatar_url=excluded.avatar_url',profile.provider,profile.id,id,profile.login,profile.name,safeAvatar(profile.provider,profile.avatar_url)),
      this.stmt("UPDATE users SET profile_provider=?,name=?,avatar_url=? WHERE id=? AND (profile_provider='' OR profile_provider=?)",profile.provider,profile.name,safeAvatar(profile.provider,profile.avatar_url),id,profile.provider)
    ];
    if(profile.provider==='twitch' && profile.id===ownerTwitchId)statements.push(this.stmt("UPDATE users SET role='owner' WHERE id=?",id));
    try { await this.db.batch(statements); }
    catch { assert(false,409,'This identity could not be linked. It may already belong to another account.'); }
    return id;
  }
  async getCosmetic(id) { return parse(await this.first(`${paintSelect} WHERE c.id=?`,id)); }
  async catalog({status='approved',owner,offset=0,limit=60,query='',listedOnly=false,likedBy,followedBy,effect='all',sort='newest',color='all',motion='all',fill='all'}={}) {
    const selection=catalogSelection({effect,sort,color,motion,fill});
    return (await this.all(`${paintSelect} WHERE c.status=? ${listedOnly?'AND c.listed=1':''} ${owner?'AND c.owner_id=?':''} ${likedBy?'AND EXISTS (SELECT 1 FROM cosmetic_likes l WHERE l.cosmetic_id=c.id AND l.user_id=?)':''} ${followedBy?"AND c.status='approved' AND c.listed=1 AND u.banned_at IS NULL AND EXISTS (SELECT 1 FROM creator_follows f JOIN users follower ON follower.id=f.follower_id WHERE f.creator_id=c.owner_id AND f.follower_id=? AND follower.banned_at IS NULL)":''} AND (${selection.filter}) AND (c.name LIKE ? OR u.name LIKE ?) ORDER BY ${selection.order} LIMIT ? OFFSET ?`,status,...(owner?[owner]:[]),...(likedBy?[likedBy]:[]),...(followedBy?[followedBy]:[]),`%${query}%`,`%${query}%`,limit,offset)).map(parse);
  }
  async mine(id, {offset=0,limit}={}) { return (await this.all(`${paintSelect} WHERE c.owner_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,id,limit ?? ((await this.user(id))?.role==='owner'?-1:100),offset)).map(parse); }
  async submit(id,name,description,recipe,listed=true) {
    publishingFlag(listed);
    const user=await this.user(id),automatic=['owner','moderator'].includes(user?.role);
    assert(user && !user.banned_at,403,'This account is banned.');
    const count=await this.first('SELECT COUNT(*) AS n FROM cosmetics WHERE owner_id=?',id);
    assert(automatic || count.n<3,429,'Flare submission limit reached (3 per account).');
    const cosmeticId=randomUUID();
    await this.run('INSERT INTO cosmetics (id,owner_id,name,description,recipe,created_at,listed,status,reviewed_at,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?,?)',cosmeticId,id,name,description,JSON.stringify(recipe),now(),Number(listed),automatic?'approved':'pending',automatic?now():null,automatic?id:null);
    return this.getCosmetic(cosmeticId);
  }
  async setPublication(userId,id,listed) {
    publishingFlag(listed);
    const c=await this.getCosmetic(id);assert(c,404,'Flare not found.');assert(c.owner_id===userId || (await this.user(userId))?.role==='owner',403,'Only the creator or owner can change publication.');
    await this.db.batch([
      this.stmt('UPDATE cosmetics SET listed=? WHERE id=?',Number(listed),id),
      this.stmt('INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (?,?,?,?,?)',userId,'flare.publication',id,listed?'public':'unlisted',now())
    ]);
    return this.getCosmetic(id);
  }
  publicCosmetic(c) { return c?.status==='approved' ? {id:c.id,name:c.name,description:c.description,creator:c.creator,creator_id:c.owner_id,creator_avatar:c.creator_avatar,creator_provider:c.creator_provider,listed:Boolean(c.listed),equipped_count:c.equipped_count || 0,like_count:c.like_count || 0,recent_like_count:c.recent_like_count || 0,recipe:c.recipe,updated_at:c.reviewed_at || c.created_at} : null; }
  async resolve(provider,id) {
    const identity=await this.first('SELECT i.provider,i.provider_id,i.login,i.display_name,u.equipped FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.provider_id=? AND u.banned_at IS NULL',provider,id);
    if(!identity)return null;
    const {equipped,...result}=identity;return {...result,cosmetic:this.publicCosmetic(await this.getCosmetic(equipped || ''))};
  }
  async resolveMany(provider,ids) {
    const rows=await this.all("SELECT i.provider,i.provider_id,i.login,i.display_name,c.id AS cosmetic_id,c.name AS cosmetic_name,u2.name AS creator,c.recipe,c.reviewed_at,c.created_at FROM json_each(?) requested JOIN identities i ON i.provider_id=requested.value AND i.provider=? JOIN users u ON u.id=i.user_id AND u.banned_at IS NULL LEFT JOIN cosmetics c ON c.id=u.equipped AND c.status='approved' LEFT JOIN users u2 ON u2.id=c.owner_id ORDER BY CAST(requested.key AS INTEGER)",JSON.stringify(ids),provider);
    return rows.map(row=>({provider:row.provider,provider_id:row.provider_id,login:row.login,display_name:row.display_name,cosmetic:row.cosmetic_id?{id:row.cosmetic_id,name:row.cosmetic_name,creator:row.creator,recipe:JSON.parse(row.recipe),updated_at:row.reviewed_at || row.created_at}:null}));
  }
  async review(actor,id,status,reason) {
    const c=await this.getCosmetic(id);assert(c,404,'Cosmetic not found.');assert(!(await this.user(c.owner_id))?.banned_at,403,'Unban the creator before reviewing this Flare.');assert(actor.role==='owner' || c.owner_id!==actor.id,403,'You cannot review your own submission.');
    const row=await this.first("UPDATE cosmetics SET status=?,reason=?,reviewed_at=?,reviewer_id=? WHERE id=? AND (?='owner' OR status='pending' OR (status='approved' AND ?='rejected')) RETURNING *",status,reason,now(),actor.id,id,actor.role,status);
    assert(row,409,'This submission has already been reviewed.');return this.getCosmetic(id);
  }
  async likedIds(userId) {
    return (await this.all("SELECT l.cosmetic_id FROM cosmetic_likes l JOIN cosmetics c ON c.id=l.cosmetic_id JOIN users u ON u.id=c.owner_id WHERE l.user_id=? AND c.status='approved' AND c.listed=1 AND u.banned_at IS NULL",userId)).map(row=>row.cosmetic_id);
  }
  async setLike(userId,id,liked) {
    assert(typeof liked==='boolean',400,'Liked must be true or false.');
    const user=await this.user(userId),c=await this.getCosmetic(id);
    assert(user && !user.banned_at,403,'This account is banned.');
    assert(c?.status==='approved' && c.listed && !(await this.user(c.owner_id))?.banned_at,404,'Public Flare not found.');
    if(liked)await this.run("INSERT OR IGNORE INTO cosmetic_likes (cosmetic_id,user_id,created_at) SELECT c.id,u.id,? FROM cosmetics c JOIN users u ON u.id=? JOIN users creator ON creator.id=c.owner_id WHERE c.id=? AND c.status='approved' AND c.listed=1 AND u.banned_at IS NULL AND creator.banned_at IS NULL",now(),userId,id);
    else await this.run('DELETE FROM cosmetic_likes WHERE cosmetic_id=? AND user_id=?',id,userId);
    return {id,liked,like_count:(await this.getCosmetic(id)).like_count};
  }
  async equip(id,cosmeticId) {
    if(cosmeticId!==null)assert((await this.getCosmetic(cosmeticId))?.status==='approved',400,'Only approved cosmetics can be equipped.');
    await this.run('UPDATE users SET equipped=? WHERE id=?',cosmeticId,id);
  }
  moderators() { return this.all("SELECT u.id,u.name,u.role,u.avatar_url,u.profile_provider,u.created_at,i.provider_id AS twitch_id,i.login FROM users u JOIN identities i ON u.id=i.user_id AND i.provider='twitch' WHERE u.role IN ('moderator','owner')"); }
  async setModerator(actor,twitchId,enabled) {
    const row=await this.first("SELECT u.* FROM users u JOIN identities i ON u.id=i.user_id WHERE i.provider='twitch' AND i.provider_id=?",twitchId);
    assert(row,404,'That Twitch account must sign in first. Use its numeric Twitch ID.');assert(!enabled || !row.banned_at,403,'Unban this account before granting moderator access.');assert(row.role!=='owner',403,'The owner role cannot be changed here.');
    await this.db.batch([
      this.stmt("UPDATE users SET role=? WHERE id=? AND role!='owner'",enabled?'moderator':'user',row.id),
      this.stmt('INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (?,?,?,?,?)',actor.id,enabled?'moderator.added':'moderator.removed',row.id,twitchId,now())
    ]);
  }
  auditLog() { return this.all('SELECT a.*,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100'); }
  async stats() {
    const row=await this.first("SELECT SUM(status='approved' AND listed=1) AS public,SUM(status='approved') AS approved,SUM(status='pending') AS pending,SUM(status='rejected') AS rejected,COUNT(DISTINCT CASE WHEN status='approved' THEN owner_id END) AS creators FROM cosmetics");
    return {public:row.public || 0,approved:row.approved || 0,pending:row.pending || 0,rejected:row.rejected || 0,creators:row.creators || 0};
  }
  ownsTexture(id,owner) { return this.first('SELECT id FROM textures WHERE id=? AND owner_id=?',id,owner); }
  async publicTexture(id) {
    return this.first("SELECT c.id FROM cosmetics c WHERE c.status='approved' AND (json_extract(c.recipe,'$.textureId')=? OR EXISTS (SELECT 1 FROM json_each(c.recipe,'$.layers') layer WHERE json_extract(layer.value,'$.textureId')=?)) LIMIT 1",id,id);
  }
  async cleanup() { await this.db.batch([this.stmt('DELETE FROM sessions WHERE expires<?',Date.now()),this.stmt('DELETE FROM oauth_states WHERE expires<?',Date.now())]); }
}
