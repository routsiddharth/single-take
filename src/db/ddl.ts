/** Schema DDL shared by the runtime connection (src/db/index.ts) and the
 *  standalone seed script (src/db/seed.ts). No `server-only` guard so it can be
 *  imported from a plain Node/tsx context. Mirrors src/db/schema.ts. */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified_at INTEGER,
    google_id TEXT,
    avatar_url TEXT,
    bio TEXT,
    post_karma INTEGER NOT NULL DEFAULT 0,
    comment_karma INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unq ON users (lower(handle));
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unq ON users (lower(email));

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id),
    prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 300),
    status TEXT NOT NULL DEFAULT 'building',
    error_kind TEXT,
    error_detail TEXT,
    artifact_key TEXT,
    og_image_key TEXT,
    model_id TEXT,
    prompt_version TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    generation_ms INTEGER,
    result_url TEXT,
    result_image TEXT,
    tool TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    hot_rank REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS posts_hot_idx ON posts (hot_rank);
  CREATE INDEX IF NOT EXISTS posts_new_idx ON posts (created_at);
  CREATE INDEX IF NOT EXISTS posts_top_idx ON posts (score, created_at);
  CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at);

  CREATE TABLE IF NOT EXISTS votes (
    user_id TEXT NOT NULL REFERENCES users(id),
    post_id TEXT NOT NULL REFERENCES posts(id),
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK (length(body) <= 1000),
    score INTEGER NOT NULL DEFAULT 0,
    is_removed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);

  CREATE TABLE IF NOT EXISTS comment_votes (
    user_id TEXT NOT NULL REFERENCES users(id),
    comment_id TEXT NOT NULL REFERENCES comments(id),
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (user_id, comment_id)
  );

  CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL UNIQUE REFERENCES posts(id),
    status TEXT NOT NULL DEFAULT 'queued',
    attempt INTEGER NOT NULL DEFAULT 0,
    claimed_at INTEGER,
    finished_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT REFERENCES users(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
`;
