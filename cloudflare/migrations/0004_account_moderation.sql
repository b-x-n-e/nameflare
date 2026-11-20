ALTER TABLE users ADD COLUMN banned_at TEXT;
ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT '';

DROP TRIGGER pending_quota;
CREATE TRIGGER pending_quota BEFORE INSERT ON cosmetics
WHEN NEW.status='pending' AND (SELECT role FROM users WHERE id=NEW.owner_id)!='owner'
AND (SELECT COUNT(*) FROM cosmetics WHERE owner_id=NEW.owner_id AND status='pending')>=10
BEGIN SELECT RAISE(ABORT,'Pending submission limit reached'); END;

DROP TRIGGER texture_quota;
CREATE TRIGGER texture_quota BEFORE INSERT ON textures
WHEN (SELECT role FROM users WHERE id=NEW.owner_id)!='owner'
AND (SELECT COUNT(*) FROM textures WHERE owner_id=NEW.owner_id)>=50 AND NOT EXISTS(SELECT 1 FROM textures WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Texture limit reached'); END;

DROP TRIGGER no_self_review;
CREATE TRIGGER no_self_review BEFORE UPDATE OF status ON cosmetics
WHEN NEW.reviewer_id=NEW.owner_id AND (SELECT role FROM users WHERE id=NEW.reviewer_id)!='owner'
BEGIN SELECT RAISE(ABORT,'Cannot review own submission'); END;

CREATE TRIGGER automatic_approval_audit AFTER INSERT ON cosmetics
WHEN NEW.status='approved'
BEGIN INSERT INTO audit (actor_id,action,target,detail,created_at) VALUES (NEW.reviewer_id,'cosmetic.auto_approved',NEW.id,'Staff submission',NEW.reviewed_at); END;
