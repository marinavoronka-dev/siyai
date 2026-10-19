CREATE TABLE form_messages (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('feedback','order','sponsor')),
 message TEXT NOT NULL,
 reply_email TEXT,
 content_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 read_at INTEGER
);
CREATE INDEX form_messages_created ON form_messages(created_at DESC,id DESC);
CREATE TABLE form_rate_events (id TEXT PRIMARY KEY NOT NULL, client_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX form_rate_client ON form_rate_events(client_hash,created_at);
CREATE INDEX form_rate_created ON form_rate_events(created_at);
CREATE TABLE form_author_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), user_id TEXT NOT NULL UNIQUE);
