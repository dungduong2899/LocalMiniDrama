const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const { getFfmpegPath } = require('../utils/ffmpegPath');
const omnivoiceService = require('./omnivoiceService');
const elevenlabsService = require('./elevenlabsService');

const DEFAULT_DESIGN_SAMPLE_TEXT = 'Hello, this is a test of a newly designed voice for a character in the story.';

function rowToVoice(r) {
  let tags = [];
  try { tags = r.tags ? JSON.parse(r.tags) : []; } catch (_) { tags = []; }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    gender: r.gender,
    age_range: r.age_range,
    tags,
    source: r.source,
    source_ref: r.source_ref,
    ref_audio_path: r.ref_audio_path,
    ref_text: r.ref_text,
    sample_url: r.sample_url || (r.ref_audio_path ? '/static/' + r.ref_audio_path : ''),
    language: r.language,
    is_active: !!r.is_active,
    is_default_narration: !!r.is_default_narration,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function getDefaultNarrationVoice(db) {
  const row = db.prepare('SELECT * FROM voice_library WHERE is_default_narration = 1 AND deleted_at IS NULL AND is_active = 1 LIMIT 1').get();
  return row ? rowToVoice(row) : null;
}

function setDefaultNarrationVoice(db, log, voiceId) {
  const id = Number(voiceId);
  if (!id) throw new Error('voice_id 不能为空');
  const target = db.prepare('SELECT id FROM voice_library WHERE id = ? AND deleted_at IS NULL AND is_active = 1').get(id);
  if (!target) throw new Error('语音不存在或未激活');
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE voice_library SET is_default_narration = 0, updated_at = ? WHERE is_default_narration = 1').run(now);
    db.prepare('UPDATE voice_library SET is_default_narration = 1, updated_at = ? WHERE id = ?').run(now, id);
  });
  tx();
  log.info('Voice library default narration updated', { voice_id: id });
  return getVoice(db, id);
}

function clearDefaultNarrationVoice(db, log) {
  const now = new Date().toISOString();
  db.prepare('UPDATE voice_library SET is_default_narration = 0, updated_at = ? WHERE is_default_narration = 1').run(now);
  log.info('Voice library default narration cleared');
}

function listVoices(db, filters = {}) {
  let sql = 'SELECT * FROM voice_library WHERE deleted_at IS NULL';
  const params = [];
  if (filters.gender) { sql += ' AND gender = ?'; params.push(filters.gender); }
  if (filters.source) { sql += ' AND source = ?'; params.push(filters.source); }
  if (filters.tag) { sql += ' AND tags LIKE ?'; params.push('%"' + filters.tag + '"%'); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToVoice);
}

function getVoice(db, id) {
  const row = db.prepare('SELECT * FROM voice_library WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return row ? rowToVoice(row) : null;
}

function countCharacterUsage(db, voiceId) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM characters WHERE voice_id = ? AND deleted_at IS NULL').get(Number(voiceId));
  return row ? row.cnt : 0;
}

function deleteVoice(db, log, id, force) {
  const row = db.prepare('SELECT id FROM voice_library WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!row) return { ok: false, error: 'not_found' };
  const usageCount = countCharacterUsage(db, id);
  if (usageCount > 0 && !force) {
    return { ok: false, error: 'in_use', usageCount };
  }
  const now = new Date().toISOString();
  if (force && usageCount > 0) {
    db.prepare('UPDATE characters SET voice_id = NULL WHERE voice_id = ? AND deleted_at IS NULL').run(Number(id));
  }
  db.prepare('UPDATE voice_library SET deleted_at = ? WHERE id = ?').run(now, Number(id));
  log.info('Voice library item deleted', { id, usageCount, force: !!force });
  return { ok: true };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function voiceLibraryDir(storageBase) {
  const dir = path.join(storageBase, 'voice_library');
  ensureDir(dir);
  return dir;
}

function voiceLibraryTmpDir(storageBase) {
  const dir = path.join(storageBase, 'voice_library', 'tmp');
  ensureDir(dir);
  return dir;
}

function voiceLibraryMp3CacheDir(storageBase) {
  const dir = path.join(storageBase, 'voice_library', 'mp3-cache');
  ensureDir(dir);
  return dir;
}

// Returns absolute path to an MP3 version of the voice's ref_audio.
// If ref_audio is already .mp3 → just returns the original.
// Otherwise runs ffmpeg to encode a 128kbps MP3, caches on disk keyed by mtime.
function ensureMp3(db, log, storageBase, voiceId) {
  const voice = getVoice(db, voiceId);
  if (!voice) throw new Error('语音不存在');
  const srcAbs = path.join(storageBase, voice.ref_audio_path);
  if (!fs.existsSync(srcAbs)) throw new Error('参考音频文件不存在');
  if (/\.mp3$/i.test(srcAbs)) {
    return { path: srcAbs, filename: `${sanitizeName(voice.name)}.mp3`, contentType: 'audio/mpeg' };
  }
  const st = fs.statSync(srcAbs);
  const cacheKey = `${voice.id}_${st.mtimeMs.toString(36)}`;
  const cacheAbs = path.join(voiceLibraryMp3CacheDir(storageBase), `${cacheKey}.mp3`);
  if (!fs.existsSync(cacheAbs)) {
    const bin = getFfmpegPath();
    const r = spawnSync(
      bin,
      ['-y', '-loglevel', 'error', '-i', srcAbs, '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', cacheAbs],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    if (r.status !== 0) {
      const err = (r.stderr || '').trim().split('\n').slice(-3).join(' | ') || `ffmpeg exit ${r.status}`;
      throw new Error(`MP3 转码失败：${err}`);
    }
    log.info('voice-library MP3 encoded', { voice_id: voice.id, src: voice.ref_audio_path, cache: path.basename(cacheAbs) });
  }
  return { path: cacheAbs, filename: `${sanitizeName(voice.name)}.mp3`, contentType: 'audio/mpeg' };
}

// Same idea but for an ad-hoc file inside data/storage (e.g. tmp preview from test bench).
// Path must be relative to storageBase and inside voice_library/ to avoid arbitrary reads.
function ensureMp3FromRelativePath(log, storageBase, relPath, baseName) {
  if (!relPath) throw new Error('relative path 不能为空');
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const scopeRoot = path.resolve(storageBase, 'voice_library');
  const srcAbs = path.resolve(storageBase, normalized);
  if (!srcAbs.startsWith(scopeRoot + path.sep)) throw new Error('路径越界');
  if (!fs.existsSync(srcAbs)) throw new Error('音频文件不存在');
  if (/\.mp3$/i.test(srcAbs)) {
    return { path: srcAbs, filename: `${sanitizeName(baseName || 'voice')}.mp3`, contentType: 'audio/mpeg' };
  }
  const st = fs.statSync(srcAbs);
  const hashLike = path.basename(srcAbs, path.extname(srcAbs));
  const cacheKey = `adhoc_${hashLike}_${st.mtimeMs.toString(36)}`;
  const cacheAbs = path.join(voiceLibraryMp3CacheDir(storageBase), `${cacheKey}.mp3`);
  if (!fs.existsSync(cacheAbs)) {
    const bin = getFfmpegPath();
    const r = spawnSync(
      bin,
      ['-y', '-loglevel', 'error', '-i', srcAbs, '-vn', '-codec:a', 'libmp3lame', '-b:a', '128k', cacheAbs],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    if (r.status !== 0) {
      const err = (r.stderr || '').trim().split('\n').slice(-3).join(' | ') || `ffmpeg exit ${r.status}`;
      throw new Error(`MP3 转码失败：${err}`);
    }
    log.info('voice-library MP3 encoded (adhoc)', { src: normalized, cache: path.basename(cacheAbs) });
  }
  return { path: cacheAbs, filename: `${sanitizeName(baseName || 'voice')}.mp3`, contentType: 'audio/mpeg' };
}

function sanitizeName(s) {
  return String(s || 'voice').replace(/[^\w一-龥.-]+/g, '_').slice(0, 80) || 'voice';
}

function insertVoice(db, log, fields) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO voice_library (name, description, gender, age_range, tags, source, source_ref, ref_audio_path, ref_text, sample_url, language, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    fields.name || '',
    fields.description || null,
    fields.gender || null,
    fields.age_range || null,
    fields.tags ? JSON.stringify(fields.tags) : null,
    fields.source,
    fields.source_ref || null,
    fields.ref_audio_path,
    fields.ref_text,
    '/static/' + fields.ref_audio_path,
    fields.language || 'en',
    now,
    now
  );
  log.info('Voice library item created', { id: info.lastInsertRowid, source: fields.source });
  return getVoice(db, info.lastInsertRowid);
}

async function importFromElevenLabs(db, log, storageBase, req) {
  const voiceId = (req.voice_id || '').trim();
  if (!voiceId) throw new Error('voice_id 不能为空');
  if (!req.name || !req.name.trim()) throw new Error('name 不能为空');
  const { apiKey, baseUrl } = elevenlabsService.getElevenLabsConfig(db);
  const sampleText = elevenlabsService.ELEVENLABS_SAMPLE_TEXT;
  const audioBuffer = await elevenlabsService.fetchSampleAudio(apiKey, baseUrl, voiceId, sampleText);
  const dir = voiceLibraryDir(storageBase);
  const safeVoiceId = voiceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `el_${safeVoiceId}_${randomUUID().slice(0, 8)}.mp3`;
  fs.writeFileSync(path.join(dir, filename), audioBuffer);
  return insertVoice(db, log, {
    name: req.name,
    description: req.description,
    gender: req.gender,
    age_range: req.age_range,
    tags: req.tags,
    source: 'elevenlabs',
    source_ref: voiceId,
    ref_audio_path: `voice_library/${filename}`,
    ref_text: sampleText,
    language: req.language || 'en',
  });
}

async function previewDesign(db, log, storageBase, req) {
  const instruct = (req.instruct || '').trim();
  if (!instruct) throw new Error('instruct 不能为空');
  const sampleText = (req.sample_text || '').trim() || DEFAULT_DESIGN_SAMPLE_TEXT;
  const { baseUrl } = omnivoiceService.getOmnivoiceConfig(db);
  const audioBuffer = await omnivoiceService.synthesizeDesign(sampleText, instruct, baseUrl);
  const tmpDir = voiceLibraryTmpDir(storageBase);
  const filename = `design_preview_${randomUUID().slice(0, 12)}.wav`;
  fs.writeFileSync(path.join(tmpDir, filename), audioBuffer);
  return {
    temp_path: `voice_library/tmp/${filename}`,
    sample_url: `/static/voice_library/tmp/${filename}`,
    sample_text: sampleText,
    instruct,
  };
}

function saveDesign(db, log, storageBase, req) {
  const tempPath = req.temp_path || '';
  const tmpDir = path.resolve(voiceLibraryTmpDir(storageBase));
  const absTemp = path.resolve(storageBase, tempPath);
  if (!absTemp.startsWith(tmpDir + path.sep)) throw new Error('无效的 temp_path');
  if (!fs.existsSync(absTemp)) throw new Error('试听音频已过期，请重新生成');
  if (!req.name || !req.name.trim()) throw new Error('name 不能为空');
  if (!req.instruct || !req.instruct.trim()) throw new Error('instruct 不能为空');
  if (!req.sample_text || !req.sample_text.trim()) throw new Error('sample_text 不能为空');
  const dir = voiceLibraryDir(storageBase);
  const filename = `design_${randomUUID().slice(0, 8)}.wav`;
  fs.copyFileSync(absTemp, path.join(dir, filename));
  fs.unlinkSync(absTemp);
  return insertVoice(db, log, {
    name: req.name,
    description: req.description,
    gender: req.gender,
    age_range: req.age_range,
    tags: req.tags,
    source: 'design',
    source_ref: req.instruct,
    ref_audio_path: `voice_library/${filename}`,
    ref_text: req.sample_text,
    language: req.language || 'en',
  });
}

async function testSynthesize(db, log, storageBase, req) {
  const voice = getVoice(db, req.voice_id);
  if (!voice) throw new Error('语音不存在');
  const text = (req.text || '').trim();
  if (!text) throw new Error('text 不能为空');
  const { baseUrl } = omnivoiceService.getOmnivoiceConfig(db);
  const absRefAudio = path.join(storageBase, voice.ref_audio_path);
  const audioBuffer = await omnivoiceService.synthesizeCloning(text, absRefAudio, voice.ref_text, baseUrl);
  const tmpDir = voiceLibraryTmpDir(storageBase);
  const filename = `preview_${randomUUID().slice(0, 12)}.wav`;
  fs.writeFileSync(path.join(tmpDir, filename), audioBuffer);
  return { sample_url: `/static/voice_library/tmp/${filename}` };
}

module.exports = {
  rowToVoice,
  listVoices,
  getVoice,
  countCharacterUsage,
  deleteVoice,
  ensureDir,
  voiceLibraryDir,
  voiceLibraryTmpDir,
  insertVoice,
  importFromElevenLabs,
  previewDesign,
  saveDesign,
  testSynthesize,
  getDefaultNarrationVoice,
  setDefaultNarrationVoice,
  clearDefaultNarrationVoice,
  ensureMp3,
  ensureMp3FromRelativePath,
  DEFAULT_DESIGN_SAMPLE_TEXT,
};
