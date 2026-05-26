CREATE TABLE IF NOT EXISTS __migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  power_type TEXT
);

CREATE TABLE IF NOT EXISTS specs (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  role TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS talents (
  id INTEGER PRIMARY KEY,
  spec_id INTEGER REFERENCES specs(id),
  class_id INTEGER REFERENCES classes(id),
  name TEXT NOT NULL,
  description TEXT,
  tier INTEGER,
  col INTEGER,
  node_type TEXT,
  tree_type TEXT
);

CREATE TABLE IF NOT EXISTS spells (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cooldown TEXT,
  range TEXT,
  cast_time TEXT,
  power_cost TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  quality TEXT,
  ilvl INTEGER,
  slot TEXT,
  item_class TEXT,
  item_subclass TEXT,
  required_level INTEGER
);

CREATE TABLE IF NOT EXISTS dungeons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  instance_type TEXT,
  min_level INTEGER,
  description TEXT,
  expansion TEXT
);

CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY,
  dungeon_id INTEGER REFERENCES dungeons(id),
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS m_plus_dungeons (
  id INTEGER PRIMARY KEY,
  dungeon_id INTEGER,
  name TEXT NOT NULL,
  season_id INTEGER
);

CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  level INTEGER,
  required_level INTEGER,
  category TEXT,
  rewards_json TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  points INTEGER,
  category TEXT
);

CREATE TABLE IF NOT EXISTS guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  spec TEXT,
  class TEXT,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  scraped_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS meta_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  data_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

-- FTS5 virtual tables for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_classes USING fts5(
  name, content='classes', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_specs USING fts5(
  name, description, content='specs', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_talents USING fts5(
  name, description, content='talents', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_spells USING fts5(
  name, description, content='spells', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_dungeons USING fts5(
  name, description, content='dungeons', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_guides USING fts5(
  title, content_md, content='guides', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_achievements USING fts5(
  name, description, content='achievements', content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS classes_ai AFTER INSERT ON classes BEGIN
  INSERT INTO fts_classes(rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER IF NOT EXISTS classes_ad AFTER DELETE ON classes BEGIN
  INSERT INTO fts_classes(fts_classes, rowid, name) VALUES('delete', old.id, old.name);
END;
CREATE TRIGGER IF NOT EXISTS classes_au AFTER UPDATE ON classes BEGIN
  INSERT INTO fts_classes(fts_classes, rowid, name) VALUES('delete', old.id, old.name);
  INSERT INTO fts_classes(rowid, name) VALUES (new.id, new.name);
END;

CREATE TRIGGER IF NOT EXISTS specs_ai AFTER INSERT ON specs BEGIN
  INSERT INTO fts_specs(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS specs_ad AFTER DELETE ON specs BEGIN
  INSERT INTO fts_specs(fts_specs, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS specs_au AFTER UPDATE ON specs BEGIN
  INSERT INTO fts_specs(fts_specs, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
  INSERT INTO fts_specs(rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS talents_ai AFTER INSERT ON talents BEGIN
  INSERT INTO fts_talents(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS talents_ad AFTER DELETE ON talents BEGIN
  INSERT INTO fts_talents(fts_talents, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS talents_au AFTER UPDATE ON talents BEGIN
  INSERT INTO fts_talents(fts_talents, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
  INSERT INTO fts_talents(rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS spells_ai AFTER INSERT ON spells BEGIN
  INSERT INTO fts_spells(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS spells_ad AFTER DELETE ON spells BEGIN
  INSERT INTO fts_spells(fts_spells, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS spells_au AFTER UPDATE ON spells BEGIN
  INSERT INTO fts_spells(fts_spells, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
  INSERT INTO fts_spells(rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS dungeons_ai AFTER INSERT ON dungeons BEGIN
  INSERT INTO fts_dungeons(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS dungeons_ad AFTER DELETE ON dungeons BEGIN
  INSERT INTO fts_dungeons(fts_dungeons, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS dungeons_au AFTER UPDATE ON dungeons BEGIN
  INSERT INTO fts_dungeons(fts_dungeons, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
  INSERT INTO fts_dungeons(rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS guides_ai AFTER INSERT ON guides BEGIN
  INSERT INTO fts_guides(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;
CREATE TRIGGER IF NOT EXISTS guides_ad AFTER DELETE ON guides BEGIN
  INSERT INTO fts_guides(fts_guides, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
END;
CREATE TRIGGER IF NOT EXISTS guides_au AFTER UPDATE ON guides BEGIN
  INSERT INTO fts_guides(fts_guides, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
  INSERT INTO fts_guides(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;

CREATE TRIGGER IF NOT EXISTS achievements_ai AFTER INSERT ON achievements BEGIN
  INSERT INTO fts_achievements(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS achievements_ad AFTER DELETE ON achievements BEGIN
  INSERT INTO fts_achievements(fts_achievements, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS achievements_au AFTER UPDATE ON achievements BEGIN
  INSERT INTO fts_achievements(fts_achievements, rowid, name, description) VALUES('delete', old.id, old.name, old.description);
  INSERT INTO fts_achievements(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
