CREATE TABLE IF NOT EXISTS story_outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL UNIQUE,
  content TEXT NOT NULL,
  coverage TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
