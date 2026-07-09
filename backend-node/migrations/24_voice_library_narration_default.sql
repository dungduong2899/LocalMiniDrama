-- 增加 voice_library.is_default_narration 列：用于标记默认解说旁白（narration）使用的语音。
-- 每次只有 0 或 1 行 is_default_narration=1；由应用层通过路由 API 保证互斥。
ALTER TABLE voice_library ADD COLUMN is_default_narration INTEGER DEFAULT 0;
