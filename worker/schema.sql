-- form-atlas 的 D1（SQLite）结构
--
-- 设计取舍：原来是一个 styles.json 数组，读的时候整体返回。
-- 这里把「要排序 / 要筛选」的字段拆成真正的列，把纯展示用的嵌套结构
-- （aka / features / identify / tags / works / confusions / conflicts）
-- 留在 detail 这一列里存 JSON —— 它们从不参与查询，拆表只会增加复杂度。
--
-- 字段名与 JSON 尽量一致（order 是 SQL 保留字，所以列名用 sort_order）。
-- 只有几十条数据，因此刻意不建业务索引：全表扫描比维护索引更简单。

DROP TABLE IF EXISTS styles;
CREATE TABLE styles (
  id          TEXT PRIMARY KEY,
  grp         TEXT,                 -- JSON 的 group
  sort_order  INTEGER,              -- JSON 的 order
  name_zh     TEXT NOT NULL,
  name_en     TEXT,
  era         TEXT,
  region      TEXT,
  summary     TEXT,
  origin      TEXT,
  critique    TEXT,
  detail      TEXT,                 -- JSON：aka/features/identify/tags/works/confusions/conflicts
  source      TEXT,
  created_at  TEXT,
  updated_at  TEXT
);

DROP TABLE IF EXISTS taxonomy;
CREATE TABLE taxonomy (
  key        TEXT PRIMARY KEY,
  name_zh    TEXT NOT NULL,
  name_en    TEXT,
  descr      TEXT,                  -- JSON 的 desc
  cover      TEXT,                  -- 可选封面地址
  sort_order INTEGER
);

DROP TABLE IF EXISTS tag_vocab;
CREATE TABLE tag_vocab (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind  TEXT NOT NULL,              -- 'custom' | 'hidden'
  name  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tag_vocab_kind_name ON tag_vocab (kind, name);

DROP TABLE IF EXISTS app_meta;
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT                        -- JSON
);
