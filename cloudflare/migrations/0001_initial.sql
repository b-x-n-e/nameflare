PRAGMA foreign_keys=ON;
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','moderator','owner')), equipped TEXT, created_at TEXT NOT NULL);
CREATE TABLE identities (provider TEXT NOT NULL CHECK(provider IN ('twitch','kick','youtube')), provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), login TEXT NOT NULL, display_name TEXT NOT NULL, PRIMARY KEY(provider,provider_id), UNIQUE(user_id,provider));
CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE oauth_states (hash TEXT PRIMARY KEY, provider TEXT NOT NULL, user_id TEXT, binding TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE cosmetics (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL, recipe TEXT NOT NULL CHECK(json_valid(recipe)), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, reviewed_at TEXT, reviewer_id TEXT);
CREATE TABLE textures (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id));
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER identity_ownership BEFORE INSERT ON identities
WHEN EXISTS(SELECT 1 FROM identities WHERE provider=NEW.provider AND provider_id=NEW.provider_id AND user_id!=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Identity already linked'); END;
CREATE TRIGGER review_audit AFTER UPDATE OF status ON cosmetics
WHEN NEW.status!=OLD.status
BEGIN INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (NEW.reviewer_id,'cosmetic.'||NEW.status,NEW.id,NEW.reason,NEW.reviewed_at); END;
CREATE INDEX cosmetic_status ON cosmetics(status,created_at);
CREATE INDEX identity_user ON identities(user_id);
CREATE TRIGGER pending_quota BEFORE INSERT ON cosmetics
WHEN (SELECT COUNT(*) FROM cosmetics WHERE owner_id=NEW.owner_id AND status='pending')>=10
BEGIN SELECT RAISE(ABORT,'Pending submission limit reached'); END;
CREATE TRIGGER texture_quota BEFORE INSERT ON textures
WHEN (SELECT COUNT(*) FROM textures WHERE owner_id=NEW.owner_id)>=50 AND NOT EXISTS(SELECT 1 FROM textures WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Texture limit reached'); END;
CREATE TRIGGER valid_equip BEFORE UPDATE OF equipped ON users
WHEN NEW.equipped IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cosmetics WHERE id=NEW.equipped AND status='approved')
BEGIN SELECT RAISE(ABORT,'Only approved cosmetics can be equipped'); END;
CREATE TRIGGER no_self_review BEFORE UPDATE OF status ON cosmetics
WHEN NEW.reviewer_id=NEW.owner_id
BEGIN SELECT RAISE(ABORT,'Cannot review own submission'); END;
CREATE TRIGGER clear_revoked AFTER UPDATE OF status ON cosmetics WHEN NEW.status='rejected'
BEGIN UPDATE users SET equipped=NULL WHERE equipped=NEW.id; END;
