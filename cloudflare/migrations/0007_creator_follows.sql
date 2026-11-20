CREATE TABLE creator_follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(follower_id,creator_id),
  CHECK(follower_id!=creator_id)
);
CREATE INDEX creator_follows_creator ON creator_follows(creator_id);
