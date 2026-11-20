-- Existing submissions are preserved; the cap applies only to new inserts.
DROP TRIGGER pending_quota;
CREATE TRIGGER flare_submission_quota BEFORE INSERT ON cosmetics
WHEN (SELECT role FROM users WHERE id=NEW.owner_id) NOT IN ('owner','moderator')
AND (SELECT COUNT(*) FROM cosmetics WHERE owner_id=NEW.owner_id)>=3
BEGIN SELECT RAISE(ABORT,'Flare submission limit reached (3 per account)'); END;
