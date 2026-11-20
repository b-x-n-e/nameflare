ALTER TABLE cosmetics ADD COLUMN listed INTEGER NOT NULL DEFAULT 1 CHECK(listed IN (0,1));
CREATE INDEX cosmetic_publication ON cosmetics(status,listed,reviewed_at);
