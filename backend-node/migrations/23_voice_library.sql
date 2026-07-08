-- 配音库表：存储可复用的语音克隆参考音频（ElevenLabs 导入 / OmniVoice 语音设计），characters.voice_id 指向此表
CREATE TABLE IF NOT EXISTS voice_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  gender TEXT,
  age_range TEXT,
  tags TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  source_ref TEXT,
  ref_audio_path TEXT NOT NULL DEFAULT '',
  ref_text TEXT NOT NULL DEFAULT '',
  sample_url TEXT,
  language TEXT DEFAULT 'en',
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

ALTER TABLE characters ADD COLUMN voice_id INTEGER;
