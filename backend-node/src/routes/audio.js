const response = require('../response');
const path = require('path');

// storyboards.characters lưu JSON array [id, id, ...]; character đầu tiên là speaker chính của dialogue.
// Nếu character đó có voice_id trỏ tới voice_library đang active, trả về id đó cho omnivoice ref_audio cloning.
function resolveVoiceLibraryIdFromStoryboard(db, storyboardId) {
  if (!storyboardId) return null;
  const sb = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboardId));
  if (!sb || !sb.characters) return null;
  let charIds;
  try { charIds = JSON.parse(sb.characters); } catch (_) { return null; }
  if (!Array.isArray(charIds) || charIds.length === 0) return null;
  const primary = Number(charIds[0]);
  if (!primary) return null;
  const row = db.prepare('SELECT voice_id FROM characters WHERE id = ? AND deleted_at IS NULL').get(primary);
  if (!row || !row.voice_id) return null;
  const voice = db.prepare('SELECT id FROM voice_library WHERE id = ? AND deleted_at IS NULL AND is_active = 1').get(Number(row.voice_id));
  return voice ? voice.id : null;
}

// Narration voice: no character context, so use the voice marked is_default_narration in voice_library.
function resolveDefaultNarrationVoiceId(db) {
  const row = db.prepare('SELECT id FROM voice_library WHERE is_default_narration = 1 AND deleted_at IS NULL AND is_active = 1 LIMIT 1').get();
  return row ? row.id : null;
}

function routes(db, log, cfg) {
  function getStoragePath() {
    const loadConfig = require('../config').loadConfig;
    const c = (cfg && cfg.storage) ? cfg : loadConfig();
    return path.isAbsolute(c.storage?.local_path)
      ? c.storage.local_path
      : path.join(process.cwd(), c.storage?.local_path || './data/storage');
  }

  return {
    /** 为单条分镜生成 TTS：对白 → audio_local_path；旁白 → narration_audio_local_path（body.tts_kind === 'narration'） */
    extract: async (req, res) => {
      const { storyboard_id, text, tts_kind, voice_library_id: bodyVoiceLibraryId } = req.body || {};
      if (!text && !storyboard_id) return response.badRequest(res, '请提供 storyboard_id 或 text');
      const kind = String(tts_kind || 'dialogue').toLowerCase() === 'narration' ? 'narration' : 'dialogue';
      let ttsText = text;
      if (kind === 'narration') {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT narration FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.narration;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜解说旁白为空，无法合成语音');
        }
      } else {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.dialogue;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜对白为空，无法合成语音');
        }
      }
      // Dialogue: character's assigned voice. Narration: default narration voice (no character context).
      const voiceLibraryId = bodyVoiceLibraryId
        || (kind === 'dialogue'
              ? resolveVoiceLibraryIdFromStoryboard(db, storyboard_id)
              : resolveDefaultNarrationVoiceId(db));
      try {
        const ttsService = require('../services/ttsService');
        const result = await ttsService.synthesize(db, log, {
          text: ttsText,
          storyboard_id: storyboard_id || null,
          storage_base: getStoragePath(),
          voice_library_id: voiceLibraryId,
        });
        if (storyboard_id && result.local_path) {
          const now = new Date().toISOString();
          try {
            if (kind === 'narration') {
              db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            } else {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            }
          } catch (_) {}
        }
        response.success(res, { local_path: result.local_path, url: result.local_path ? '/static/' + result.local_path : '', tts_kind: kind });
      } catch (err) {
        log.error('audio extract', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 批量为多条分镜生成 TTS */
    extractBatch: async (req, res) => {
      const { storyboard_ids } = req.body || {};
      if (!Array.isArray(storyboard_ids) || storyboard_ids.length === 0) {
        return response.badRequest(res, 'storyboard_ids 不能为空');
      }
      const results = [];
      const storagePath = getStoragePath();
      for (const sbId of storyboard_ids) {
        const row = db.prepare('SELECT id, dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(sbId));
        if (!row || !row.dialogue?.trim()) {
          results.push({ storyboard_id: sbId, error: '对白为空' });
          continue;
        }
        const voiceLibraryId = resolveVoiceLibraryIdFromStoryboard(db, row.id);
        try {
          const ttsService = require('../services/ttsService');
          const result = await ttsService.synthesize(db, log, {
            text: row.dialogue,
            storyboard_id: row.id,
            storage_base: storagePath,
            voice_library_id: voiceLibraryId,
          });
          if (result.local_path) {
            const now = new Date().toISOString();
            try {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, row.id
              );
            } catch (_) {}
          }
          results.push({ storyboard_id: sbId, local_path: result.local_path });
        } catch (err) {
          results.push({ storyboard_id: sbId, error: err.message });
        }
      }
      response.success(res, results);
    },
  };
}

module.exports = routes;
