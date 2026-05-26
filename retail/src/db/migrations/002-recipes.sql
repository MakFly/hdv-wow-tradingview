CREATE TABLE IF NOT EXISTS professions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  profession_id INTEGER REFERENCES professions(id),
  name TEXT NOT NULL,
  description TEXT,
  crafted_item_id INTEGER,
  crafted_item_name TEXT,
  crafted_quantity INTEGER DEFAULT 1,
  skill_tier TEXT
);

CREATE TABLE IF NOT EXISTS recipe_reagents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  UNIQUE(recipe_id, item_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_recipes USING fts5(
  name, description, crafted_item_name, content='recipes', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS recipes_ai AFTER INSERT ON recipes BEGIN
  INSERT INTO fts_recipes(rowid, name, description, crafted_item_name) VALUES (new.id, new.name, new.description, new.crafted_item_name);
END;
CREATE TRIGGER IF NOT EXISTS recipes_ad AFTER DELETE ON recipes BEGIN
  INSERT INTO fts_recipes(fts_recipes, rowid, name, description, crafted_item_name) VALUES('delete', old.id, old.name, old.description, old.crafted_item_name);
END;
CREATE TRIGGER IF NOT EXISTS recipes_au AFTER UPDATE ON recipes BEGIN
  INSERT INTO fts_recipes(fts_recipes, rowid, name, description, crafted_item_name) VALUES('delete', old.id, old.name, old.description, old.crafted_item_name);
  INSERT INTO fts_recipes(rowid, name, description, crafted_item_name) VALUES (new.id, new.name, new.description, new.crafted_item_name);
END;
