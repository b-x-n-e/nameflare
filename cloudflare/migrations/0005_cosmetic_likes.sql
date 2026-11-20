CREATE TABLE cosmetic_likes (
  cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(cosmetic_id,user_id)
);
CREATE INDEX cosmetic_likes_user ON cosmetic_likes(user_id,created_at);
