// backend-node/src/services/elevenlabsService.js
// ElevenLabs helpers for the voice-library clone flow:
//   1) getVoiceMetadata — GET /v1/voices/{id} to verify the voice exists in the
//      user's My Voices library and pull all metadata (name, description,
//      labels{gender,age,accent,descriptive,use_case}, category, preview_url).
//      Throws a clear error when the ID is missing so the UI can guide the user
//      to add it on elevenlabs.io first — no TTS credit is spent.
//   2) fetchSampleAudio — POST /v1/text-to-speech/{id} to synthesize a ~10s
//      pangram sample once at import time. That MP3 becomes the ref_audio for
//      OmniVoice few-shot cloning at synthesis time.
const https = require('https');
const aiConfigService = require('./aiConfigService');

const ELEVENLABS_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog while the morning sun rises slowly behind the distant hills.';

function getElevenLabsConfig(db) {
  const configs = aiConfigService.listConfigs(db, 'tts');
  const cfg = configs.find((c) => c.is_active && (c.provider || '').toLowerCase() === 'elevenlabs');
  if (!cfg || !cfg.api_key) {
    throw new Error('Chưa cấu hình ElevenLabs — vui lòng thêm cấu hình service_type=tts, provider=elevenlabs và điền API Key.');
  }
  return { apiKey: cfg.api_key, baseUrl: (cfg.base_url || 'https://api.elevenlabs.io/v1').replace(/\/+$/, '') };
}

function requestJson({ method, url, headers, body, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(parsed, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf-8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('ElevenLabs request timeout')); }, timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}

// GET /v1/voices/{voice_id} — returns full metadata for a voice in the user's
// account (My Voices). Throws a specific error on 404 so the UI can tell the
// user "voice này không có trong My Voices trên ElevenLabs".
async function getVoiceMetadata(apiKey, baseUrl, voiceId) {
  const id = String(voiceId || '').trim();
  if (!id) throw new Error('voice_id không được để trống.');
  const res = await requestJson({
    method: 'GET',
    url: `${baseUrl}/voices/${encodeURIComponent(id)}`,
    headers: { 'xi-api-key': apiKey, 'Accept': 'application/json' },
    timeoutMs: 30_000,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`ElevenLabs từ chối truy cập (HTTP ${res.status}). Vui lòng kiểm tra lại API Key.`);
  }
  // ElevenLabs returns 400 with body { detail: { status: "voice_not_found" } } (or 404)
  // when the voice isn't in the user's account. Treat both as "not in My Voices".
  const detail = res.json?.detail;
  const notFoundStatus = detail && (detail.status === 'voice_not_found' || detail.code === 'voice_not_found' || detail.type === 'not_found');
  if (res.status === 404 || notFoundStatus) {
    throw new Error(`Không tìm thấy voice_id "${id}" trong My Voices trên ElevenLabs. Vui lòng vào elevenlabs.io → Voices → thêm voice này vào thư viện cá nhân của bạn trước, rồi quay lại nhập ID.`);
  }
  if (res.status !== 200 || !res.json) {
    const snippet = (res.text || '').slice(0, 300);
    throw new Error(`ElevenLabs trả về HTTP ${res.status}: ${snippet}`);
  }
  const data = res.json;
  const labels = data.labels && typeof data.labels === 'object' ? data.labels : {};
  return {
    voice_id: data.voice_id || id,
    name: data.name || '',
    description: data.description || '',
    category: data.category || '',
    preview_url: data.preview_url || '',
    labels: {
      gender: labels.gender || '',
      age: labels.age || '',
      accent: labels.accent || '',
      descriptive: labels.descriptive || labels.description || '',
      use_case: labels.use_case || labels.useCase || '',
    },
    samples_count: Array.isArray(data.samples) ? data.samples.length : 0,
  };
}

// Wrap raw PCM_S16LE bytes into a minimal WAV container so downstream tools
// (OmniVoice, ffmpeg, browsers) can read the file directly.
function wrapPcmToWav(pcmBuf, sampleRate, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuf.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);             // PCM chunk size
  header.writeUInt16LE(1, 20);              // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuf]);
}

// Fetch a training-quality sample of the voice speaking `text`.
// Prefers PCM (lossless) at 24kHz — the samplerate OmniVoice already uses —
// and returns a self-contained WAV buffer. Falls back to MP3 128k automatically
// if the account tier can't request PCM (older Free tier / disabled endpoints).
function fetchSampleAudio(apiKey, baseUrl, voiceId, text) {
  // Ordered by preference. First format the API returns 200 for wins.
  const attempts = [
    { fmt: 'pcm_24000', ext: 'wav', mime: 'audio/wav', wrap: (b) => wrapPcmToWav(b, 24000) },
    { fmt: 'pcm_22050', ext: 'wav', mime: 'audio/wav', wrap: (b) => wrapPcmToWav(b, 22050) },
    { fmt: 'pcm_16000', ext: 'wav', mime: 'audio/wav', wrap: (b) => wrapPcmToWav(b, 16000) },
    { fmt: 'mp3_44100_128', ext: 'mp3', mime: 'audio/mpeg', wrap: (b) => b },
  ];

  const doRequest = (fmt) => new Promise((resolve, reject) => {
    const parsed = new URL(`${baseUrl}/text-to-speech/${voiceId}?output_format=${fmt}`);
    const body = JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
    const req = https.request(parsed, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          const snippet = buf.toString('utf-8').slice(0, 500);
          if (res.statusCode === 404) {
            const err = new Error('ElevenLabs không tìm thấy voice_id — có thể đã bị xoá giữa lúc kiểm tra và tổng hợp.');
            err.fatal = true;
            reject(err);
            return;
          }
          const err = new Error(`ElevenLabs HTTP ${res.statusCode} @ ${fmt}: ${snippet}`);
          // 403 subscription_required → skip this format and try the next one.
          err.fatal = res.statusCode !== 403;
          reject(err);
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('ElevenLabs TTS timeout')); }, 60_000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });

  return (async () => {
    let lastErr = null;
    for (const opt of attempts) {
      try {
        const raw = await doRequest(opt.fmt);
        return { buffer: opt.wrap(raw), format: opt.fmt, ext: opt.ext, mime: opt.mime };
      } catch (err) {
        lastErr = err;
        if (err && err.fatal) throw err;
        // 403 subscription_required → try next format
      }
    }
    throw lastErr || new Error('Không lấy được audio từ ElevenLabs.');
  })();
}

module.exports = {
  ELEVENLABS_SAMPLE_TEXT,
  getElevenLabsConfig,
  getVoiceMetadata,
  fetchSampleAudio,
};
