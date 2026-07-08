# Voice Casting（配音选角）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the local OmniVoice TTS server into LocalMiniDrama so users can build a voice library (via ElevenLabs sample import or OmniVoice voice design), test voices, and let an LLM batch-assign the best-matching voice to each character in a drama.

**Architecture:** New `voice_library` SQLite table holds reusable `ref_audio` clips. Two new backend services wrap external calls (`omnivoiceService.js` for the local OmniVoice HTTP server, `elevenlabsService.js` for one-shot ElevenLabs sampling); `voiceLibraryService.js` owns CRUD + import/design/test logic; `voiceMatchService.js` reuses the existing `aiClient.generateText` LLM plumbing to batch-match characters to voices. `ttsService.js` gains an `omnivoice` provider branch. A new Vue page (`VoiceLibrary.vue`) exposes library management + testing; `DramaDetail.vue` gets a one-click "AI 推荐配音" button plus per-character "重新推荐".

**Tech Stack:** Node.js/Express backend (better-sqlite3, native `https`/`http`), Vue 3 + Element Plus frontend, Python OmniVoice HTTP server (external, already exists at `~/OmniVoice-master/server/omnivoice_server.py`, run separately by the user).

**Reference spec:** `docs/superpowers/specs/2026-07-08-voice-casting-design.md`

---

## Before you start

- This plan assumes `~/OmniVoice-master` is already set up (confirmed present on this machine with `server/omnivoice_server.py`). It is a *separate* process the user starts manually — this plan does not touch that repo.
- Run backend unit tests with: `cd backend-node && node --test test/<file>.test.js` (Node's built-in test runner; no `npm test` script exists in this repo, confirmed by checking `package.json`).
- Storage root is `backend-node/data/storage` (from `configs/config.yaml` → `storage.local_path`), served publicly at `/static/...`. All voice files go under `data/storage/voice_library/`.
- `ai_service_configs` is the existing generic config table (service_type/provider/base_url/api_key/model/settings). OmniVoice and ElevenLabs are wired in as `service_type='tts'` providers, same as the existing `minimax` provider — no schema change needed for that table.

---

### Task 1: DB migration — `voice_library` table + `characters.voice_id`

**Files:**
- Create: `backend-node/migrations/23_voice_library.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Verify migrations run cleanly**

Run: `cd backend-node && node -e "require('./src/db/migrate.js').runMigrationsAndEnsure(require('./src/db/index.js').getDb(require('./src/config').loadConfig().database))"`

Expected output includes `Ran migration: 23_voice_library.sql #1` and `#2` (two statements), no errors. Running it a second time should print `Skip (already exists)` lines instead of erroring (idempotency, matches existing migration convention in `backend-node/src/db/migrate.js:24-33`).

- [ ] **Step 3: Commit**

```bash
git add backend-node/migrations/23_voice_library.sql
git commit -m "Add voice_library table and characters.voice_id column"
```

---

### Task 2: `voiceLibraryService.js` — core CRUD (TDD)

This task builds only the pure DB-logic parts of the service (listing, fetching, deleting with usage-guard). Network-dependent parts (ElevenLabs import, OmniVoice design/test) come in Task 3, appended to the same file.

**Files:**
- Create: `backend-node/src/services/voiceLibraryService.js`
- Test: `backend-node/test/voiceLibraryService.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const voiceLibraryService = require('../src/services/voiceLibraryService');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE voice_library (
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
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT,
      voice_id INTEGER,
      deleted_at TEXT
    );
  `);
  return db;
}

function insertVoiceRow(db, overrides = {}) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO voice_library (name, gender, source, ref_audio_path, ref_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.name || 'Test Voice',
    overrides.gender || 'female',
    overrides.source || 'elevenlabs',
    overrides.ref_audio_path || 'voice_library/x.mp3',
    overrides.ref_text || 'sample',
    now, now
  );
  return info.lastInsertRowid;
}

test('listVoices filters by gender', () => {
  const db = createDb();
  insertVoiceRow(db, { name: 'A', gender: 'female' });
  insertVoiceRow(db, { name: 'B', gender: 'male' });
  const females = voiceLibraryService.listVoices(db, { gender: 'female' });
  assert.equal(females.length, 1);
  assert.equal(females[0].name, 'A');
});

test('deleteVoice blocks when in use unless forced, and clears the dangling reference when forced', () => {
  const db = createDb();
  const voiceId = insertVoiceRow(db, { name: 'Used' });
  db.prepare('INSERT INTO characters (drama_id, name, voice_id) VALUES (1, ?, ?)').run('Hero', voiceId);

  const blocked = voiceLibraryService.deleteVoice(db, log, voiceId, false);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'in_use');
  assert.equal(blocked.usageCount, 1);
  assert.notEqual(voiceLibraryService.getVoice(db, voiceId), null);

  const forced = voiceLibraryService.deleteVoice(db, log, voiceId, true);
  assert.equal(forced.ok, true);
  assert.equal(voiceLibraryService.getVoice(db, voiceId), null);
  const char = db.prepare('SELECT voice_id FROM characters WHERE name = ?').get('Hero');
  assert.equal(char.voice_id, null);
});

test('deleteVoice succeeds directly when unused', () => {
  const db = createDb();
  const voiceId = insertVoiceRow(db, { name: 'Unused' });
  const result = voiceLibraryService.deleteVoice(db, log, voiceId, false);
  assert.equal(result.ok, true);
  assert.equal(voiceLibraryService.getVoice(db, voiceId), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/voiceLibraryService.test.js`
Expected: FAIL — `Cannot find module '../src/services/voiceLibraryService'`

- [ ] **Step 3: Write the implementation**

```js
// backend-node/src/services/voiceLibraryService.js
const fs = require('fs');
const path = require('path');

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
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
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
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/voiceLibraryService.test.js`
Expected: PASS — `tests 3`, `pass 3`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/voiceLibraryService.js backend-node/test/voiceLibraryService.test.js
git commit -m "Add voiceLibraryService core CRUD with usage-guarded delete"
```

---

### Task 3: OmniVoice + ElevenLabs HTTP clients, and library import/design/test

**Files:**
- Create: `backend-node/src/services/omnivoiceService.js`
- Create: `backend-node/src/services/elevenlabsService.js`
- Modify: `backend-node/src/services/voiceLibraryService.js` (append import/design/test functions)

- [ ] **Step 1: Create the OmniVoice HTTP client**

```js
// backend-node/src/services/omnivoiceService.js
// 封装对本地 OmniVoice 推理服务（server/omnivoice_server.py）的调用。
// 该服务只监听 127.0.0.1，且 ref_audio 以本机文件路径传递（模型进程与 Node 后端运行在同一台机器上）。
const https = require('https');
const http = require('http');
const aiConfigService = require('./aiConfigService');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8712';

function getOmnivoiceConfig(db) {
  const configs = aiConfigService.listConfigs(db, 'tts');
  const cfg = configs.find((c) => c.is_active && (c.provider || '').toLowerCase() === 'omnivoice');
  return { baseUrl: ((cfg && cfg.base_url) || DEFAULT_BASE_URL).replace(/\/+$/, '') };
}

function checkHealth(baseUrl) {
  return new Promise((resolve) => {
    const parsed = new URL('/health', baseUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(parsed, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve({ ready: !!json.ready, statusCode: res.statusCode });
        } catch (_) {
          resolve({ ready: false, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', () => resolve({ ready: false, statusCode: 0 }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ ready: false, statusCode: 0 }); });
  });
}

async function ensureHealthy(baseUrl) {
  const health = await checkHealth(baseUrl);
  if (!health.ready) {
    throw new Error('OmniVoice 本地服务未启动或模型未加载完成，请先运行 server/omnivoice_server.py（参考 OmniVoice-master/server/omnivoice_server.py）');
  }
}

function postSynthesize(baseUrl, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL('/synthesize', baseUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);
    const req = mod.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          let errMsg = buf.toString('utf-8').slice(0, 500);
          try { errMsg = JSON.parse(errMsg).error || errMsg; } catch (_) {}
          reject(new Error(`OmniVoice HTTP ${res.statusCode}: ${errMsg}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OmniVoice 合成请求超时')); }, timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(bodyStr);
    req.end();
  });
}

/** 克隆模式：refAudioAbsPath 必须是 OmniVoice 服务进程能直接读取的本机绝对路径。 */
async function synthesizeCloning(text, refAudioAbsPath, refText, baseUrl) {
  await ensureHealthy(baseUrl);
  return postSynthesize(baseUrl, { text, ref_audio: refAudioAbsPath, ref_text: refText });
}

/** 语音设计模式：仅凭 attributes 描述（instruct）生成音色，不需要参考音频。 */
async function synthesizeDesign(text, instruct, baseUrl) {
  await ensureHealthy(baseUrl);
  return postSynthesize(baseUrl, { text, instruct });
}

module.exports = { DEFAULT_BASE_URL, getOmnivoiceConfig, checkHealth, synthesizeCloning, synthesizeDesign };
```

- [ ] **Step 2: Create the ElevenLabs sampling client**

```js
// backend-node/src/services/elevenlabsService.js
// 仅用于「取样」：调用一次 ElevenLabs TTS API 生成一小段示例音频，
// 之后该音频会作为 ref_audio 交给本地 OmniVoice 做克隆合成，不再持续调用 ElevenLabs。
const https = require('https');
const aiConfigService = require('./aiConfigService');

const ELEVENLABS_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog while the morning sun rises slowly behind the distant hills.';

function getElevenLabsConfig(db) {
  const configs = aiConfigService.listConfigs(db, 'tts');
  const cfg = configs.find((c) => c.is_active && (c.provider || '').toLowerCase() === 'elevenlabs');
  if (!cfg || !cfg.api_key) {
    throw new Error('未配置 ElevenLabs，请在「AI 配置」中添加 service_type=tts, provider=elevenlabs 的配置并填写 API Key');
  }
  return { apiKey: cfg.api_key, baseUrl: (cfg.base_url || 'https://api.elevenlabs.io/v1').replace(/\/+$/, '') };
}

function fetchSampleAudio(apiKey, baseUrl, voiceId, text) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${baseUrl}/text-to-speech/${voiceId}`);
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
          reject(new Error(`ElevenLabs HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('ElevenLabs 请求超时')); }, 60000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

module.exports = { ELEVENLABS_SAMPLE_TEXT, getElevenLabsConfig, fetchSampleAudio };
```

- [ ] **Step 3: Append import/design/test functions to `voiceLibraryService.js`**

Add near the top of `backend-node/src/services/voiceLibraryService.js` (after the existing `const fs = require('fs'); const path = require('path');` lines):

```js
const { randomUUID } = require('crypto');
const omnivoiceService = require('./omnivoiceService');
const elevenlabsService = require('./elevenlabsService');

const DEFAULT_DESIGN_SAMPLE_TEXT = 'Hello, this is a test of a newly designed voice for a character in the story.';
```

Add these functions before the final `module.exports` block:

```js
async function importFromElevenLabs(db, log, storageBase, req) {
  const voiceId = (req.voice_id || '').trim();
  if (!voiceId) throw new Error('voice_id 不能为空');
  if (!req.name || !req.name.trim()) throw new Error('name 不能为空');
  const { apiKey, baseUrl } = elevenlabsService.getElevenLabsConfig(db);
  const sampleText = elevenlabsService.ELEVENLABS_SAMPLE_TEXT;
  const audioBuffer = await elevenlabsService.fetchSampleAudio(apiKey, baseUrl, voiceId, sampleText);
  const dir = voiceLibraryDir(storageBase);
  const filename = `el_${voiceId}_${randomUUID().slice(0, 8)}.mp3`;
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
  if (!tempPath.startsWith('voice_library/tmp/')) throw new Error('无效的 temp_path');
  const absTemp = path.join(storageBase, tempPath);
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
```

Update the `module.exports` block at the bottom to add the four new functions and the constant:

```js
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
  DEFAULT_DESIGN_SAMPLE_TEXT,
};
```

- [ ] **Step 4: Manual verification (requires the OmniVoice server running)**

This step depends on external processes and cannot be automated in this plan. Once Task 4 (routes) is also done:

1. In a separate terminal: `cd ~/OmniVoice-master && uv run python server/omnivoice_server.py --host 127.0.0.1 --port 8712` and wait for `OMNIVOICE_SERVER_READY`.
2. In "AI 配置", add a `service_type=tts, provider=omnivoice` config with `base_url=http://127.0.0.1:8712` (Task 6 adds a UI preset for this; until then, use "自定义").
3. `curl -X POST http://localhost:5679/api/v1/voice-library/design/preview -H "Content-Type: application/json" -d '{"instruct":"female, low pitch, gentle","sample_text":"This is a test."}'` — expect a JSON response with `sample_url`.
4. Open the returned `sample_url` (e.g. `http://localhost:5679/static/voice_library/tmp/design_preview_xxx.wav`) in a browser and confirm audio plays.

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/omnivoiceService.js backend-node/src/services/elevenlabsService.js backend-node/src/services/voiceLibraryService.js
git commit -m "Add OmniVoice/ElevenLabs HTTP clients and voice import/design/test flows"
```

---

### Task 4: `voice-library` API routes

**Files:**
- Create: `backend-node/src/routes/voiceLibrary.js`
- Modify: `backend-node/src/routes/index.js`

- [ ] **Step 1: Write the route handlers**

```js
// backend-node/src/routes/voiceLibrary.js
const response = require('../response');
const path = require('path');
const voiceLibraryService = require('../services/voiceLibraryService');

function routes(db, cfg, log) {
  function getStoragePath() {
    const loadConfig = require('../config').loadConfig;
    const c = (cfg && cfg.storage) ? cfg : loadConfig();
    return path.isAbsolute(c.storage?.local_path)
      ? c.storage.local_path
      : path.join(process.cwd(), c.storage?.local_path || './data/storage');
  }

  return {
    list: (req, res) => {
      try {
        const items = voiceLibraryService.listVoices(db, {
          gender: req.query.gender,
          source: req.query.source,
          tag: req.query.tag,
        });
        response.success(res, { items });
      } catch (err) {
        log.error('voice-library list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    importElevenLabs: async (req, res) => {
      try {
        const item = await voiceLibraryService.importFromElevenLabs(db, log, getStoragePath(), req.body || {});
        response.created(res, item);
      } catch (err) {
        log.error('voice-library import-elevenlabs', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    designPreview: async (req, res) => {
      try {
        const preview = await voiceLibraryService.previewDesign(db, log, getStoragePath(), req.body || {});
        response.success(res, preview);
      } catch (err) {
        log.error('voice-library design-preview', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    designSave: (req, res) => {
      try {
        const item = voiceLibraryService.saveDesign(db, log, getStoragePath(), req.body || {});
        response.created(res, item);
      } catch (err) {
        log.error('voice-library design-save', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    test: async (req, res) => {
      try {
        const result = await voiceLibraryService.testSynthesize(db, log, getStoragePath(), {
          voice_id: req.params.id,
          text: req.body?.text,
        });
        response.success(res, result);
      } catch (err) {
        log.error('voice-library test', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const force = req.query.force === '1' || req.query.force === 'true';
        const out = voiceLibraryService.deleteVoice(db, log, req.params.id, force);
        if (!out.ok) {
          if (out.error === 'not_found') return response.notFound(res, '语音不存在');
          if (out.error === 'in_use') {
            return response.error(res, 409, 'IN_USE', `该语音正被 ${out.usageCount} 个角色使用，确认要删除吗？`, { usage_count: out.usageCount });
          }
        }
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('voice-library delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
```

- [ ] **Step 2: Wire into the router**

In `backend-node/src/routes/index.js`, add the require near the other route requires (after line 22 `const sceneModelMapRoutes = require('./sceneModelMap');`):

```js
const voiceLibraryRoutes = require('./voiceLibrary');
```

Add the instantiation near the other route instantiations (after line 33 `const sceneModelMap = sceneModelMapRoutes(db, log);`):

```js
  const voiceLibrary = voiceLibraryRoutes(db, cfg, log);
```

Add the route registrations after the `---------- audio ----------` block (after line 299 `r.post('/audio/extract/batch', audio.extractBatch);`):

```js
  // ---------- voice-library ----------
  r.get('/voice-library', voiceLibrary.list);
  r.post('/voice-library/import-elevenlabs', voiceLibrary.importElevenLabs);
  r.post('/voice-library/design/preview', voiceLibrary.designPreview);
  r.post('/voice-library/design/save', voiceLibrary.designSave);
  r.post('/voice-library/:id/test', voiceLibrary.test);
  r.delete('/voice-library/:id', voiceLibrary.delete);
```

- [ ] **Step 3: Manual verification**

Run: `cd backend-node && npm run dev` (or however the dev server is normally started — check `package.json` `scripts` if unsure)
Run: `curl http://localhost:5679/api/v1/voice-library`
Expected: `{"success":true,"data":{"items":[]},...}` (empty array, no server error)

- [ ] **Step 4: Commit**

```bash
git add backend-node/src/routes/voiceLibrary.js backend-node/src/routes/index.js
git commit -m "Add voice-library API routes"
```

---

### Task 5: `ttsService.js` — add `omnivoice` provider

**Files:**
- Modify: `backend-node/src/services/ttsService.js:119-171`

- [ ] **Step 1: Add the `voice_library_id` parameter and the new provider branch**

In `backend-node/src/services/ttsService.js`, change the `synthesize` function signature at line 119:

```js
async function synthesize(db, log, { text, storyboard_id, config, storage_base, voice_id, speed, voice_library_id }) {
```

Insert a new `else if` branch **before** the existing `openai` branch (not after). This ordering matters: the `openai` branch's condition is `provider === 'openai' || ttsConfig.base_url`, which matches whenever *any* `base_url` is set — and an omnivoice config always has `base_url` set (that's how it finds the local server). If `omnivoice` were checked after `openai`, it would never be reached. Replace the whole `if/else if/else` chain (originally lines 139-159) with:

```js
  if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'omnivoice') {
    const omnivoiceService = require('./omnivoiceService');
    const voiceLibraryService = require('./voiceLibraryService');
    const voice = voice_library_id ? voiceLibraryService.getVoice(db, voice_library_id) : null;
    if (!voice) throw new Error('未指定 voice_library_id 或对应语音不存在，请先在配音管理中选择语音');
    const path = require('path');
    const absRefAudio = path.join(storage_base, voice.ref_audio_path);
    const { baseUrl } = omnivoiceService.getOmnivoiceConfig(db);
    audioBuffer = await omnivoiceService.synthesizeCloning(text, absRefAudio, voice.ref_text, baseUrl);
  } else if (provider === 'openai' || ttsConfig.base_url) {
    console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ttsConfig.base_url, ttsModel, finalSpeed);
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax、omnivoice`);
  }
```

- [ ] **Step 2: Manual verification**

No automated test — this mirrors the existing convention in this file (the `minimax`/`openai` branches also have zero test coverage, confirmed by the absence of a `ttsService.test.js` file). Verify manually once a voice exists in the library (after Task 3's manual verification) and an `ai_service_configs` row with `provider=omnivoice` exists:

```bash
node -e "
const { getDb } = require('./src/db/index.js');
const { loadConfig } = require('./src/config');
const cfg = loadConfig();
const db = getDb(cfg.database);
const ttsService = require('./src/services/ttsService');
const voice = db.prepare('SELECT id FROM voice_library WHERE deleted_at IS NULL LIMIT 1').get();
ttsService.synthesize(db, console, {
  text: 'Testing OmniVoice cloning through ttsService.',
  storage_base: require('path').join(process.cwd(), 'data', 'storage'),
  voice_library_id: voice.id,
  config: { provider: 'omnivoice', base_url: 'http://127.0.0.1:8712' },
}).then(r => console.log('OK', r)).catch(e => console.error('FAIL', e.message));
"
```

Expected: prints `OK { local_path: 'audio/tts_sbx_xxxxxxxx.mp3' }`. Note the filename gets a `.mp3` extension from `synthesize()`'s generic save step (`ttsService.js:164`) even though OmniVoice returns WAV bytes — the extension is cosmetic only, the bytes on disk are WAV. This is a pre-existing convention in this file (not introduced by this task); leave it as-is rather than fixing it here.

- [ ] **Step 3: Commit**

```bash
git add backend-node/src/services/ttsService.js
git commit -m "Add omnivoice provider branch to ttsService"
```

---

### Task 6: `voiceMatchService.js` — pure prompt/parse functions (TDD)

**Files:**
- Create: `backend-node/src/services/voiceMatchService.js`
- Test: `backend-node/test/voiceMatchService.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend-node/test/voiceMatchService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecommendPrompt, parseRecommendResponse } = require('../src/services/voiceMatchService');

const characters = [
  { id: 1, name: '阿强', role: 'main', description: '沉稳的中年男人', personality: '冷静', appearance: '络腮胡' },
  { id: 2, name: '小美', role: 'supporting', description: '活泼的少女', personality: '开朗', appearance: '马尾辫' },
];

const voices = [
  { id: 10, name: 'Deep Male', gender: 'male', age_range: 'adult', description: '低沉成熟', tags: ['calm'] },
  { id: 11, name: 'Bright Female', gender: 'female', age_range: 'young', description: '明亮活泼', tags: ['cheerful'] },
];

test('buildRecommendPrompt includes all character and voice ids', () => {
  const prompt = buildRecommendPrompt(characters, voices);
  assert.match(prompt, /id=1/);
  assert.match(prompt, /id=2/);
  assert.match(prompt, /id=10/);
  assert.match(prompt, /id=11/);
  assert.match(prompt, /阿强/);
  assert.match(prompt, /Bright Female/);
});

test('parseRecommendResponse keeps only valid character/voice id pairs', () => {
  const rawText = JSON.stringify({
    '1': { voice_id: 10, reason: '低沉稳重贴合角色' },
    '2': { voice_id: 11, reason: '明亮活泼贴合角色' },
    '999': { voice_id: 10, reason: '无效角色id应被丢弃' },
    '1_dup': { voice_id: 999, reason: '无效语音id应被丢弃' },
  });
  const result = parseRecommendResponse(rawText, characters, voices);
  assert.equal(result.length, 2);
  const byChar = Object.fromEntries(result.map((r) => [r.character_id, r.voice_id]));
  assert.equal(byChar[1], 10);
  assert.equal(byChar[2], 11);
});

test('parseRecommendResponse handles markdown-fenced JSON', () => {
  const rawText = '```json\n' + JSON.stringify({ '1': { voice_id: 10, reason: 'ok' } }) + '\n```';
  const result = parseRecommendResponse(rawText, characters, voices);
  assert.equal(result.length, 1);
  assert.equal(result[0].voice_id, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-node && node --test test/voiceMatchService.test.js`
Expected: FAIL — `Cannot find module '../src/services/voiceMatchService'`

- [ ] **Step 3: Write the implementation (pure functions only)**

```js
// backend-node/src/services/voiceMatchService.js
const { safeParseAIJSON } = require('../utils/safeJson');

function buildRecommendPrompt(characters, voices) {
  const charLines = characters.map((c) =>
    `- id=${c.id} 名称="${c.name || ''}" 角色定位="${c.role || ''}" 描述="${(c.description || '').slice(0, 200)}" 性格="${(c.personality || '').slice(0, 200)}" 外貌="${(c.appearance || '').slice(0, 200)}"`
  ).join('\n');
  const voiceLines = voices.map((v) =>
    `- id=${v.id} 名称="${v.name}" 性别=${v.gender || '未知'} 年龄段=${v.age_range || '未知'} 描述="${v.description || ''}" 标签=${(v.tags || []).join(',')}`
  ).join('\n');
  return `下面是一批短剧角色和一个可选语音库，请为每个角色匹配一个最合适的语音。

【角色列表】
${charLines}

【语音库】
${voiceLines}

请只返回 JSON 对象，key 为角色 id（字符串），value 为一个对象 {"voice_id": 数字, "reason": "一句话理由"}。不要返回任何角色 id 或语音 id 不在上面列表中的内容。`;
}

const RECOMMEND_SYSTEM_PROMPT = '你是短剧配音选角专家，根据角色的性别、年龄、性格、外貌描述，从提供的语音库中挑选最贴合的语音。只输出合法 JSON，不要输出任何解释文字或 markdown 代码块标记。';

function parseRecommendResponse(rawText, characters, voices) {
  const parsed = safeParseAIJSON(rawText, {}, null);
  const charIds = new Set(characters.map((c) => String(c.id)));
  const voiceIds = new Set(voices.map((v) => v.id));
  const result = [];
  for (const key of Object.keys(parsed)) {
    if (!charIds.has(String(key))) continue;
    const entry = parsed[key];
    const voiceId = Number(entry && entry.voice_id);
    if (!voiceId || !voiceIds.has(voiceId)) continue;
    result.push({ character_id: Number(key), voice_id: voiceId, reason: (entry && entry.reason) || '' });
  }
  return result;
}

module.exports = { buildRecommendPrompt, parseRecommendResponse, RECOMMEND_SYSTEM_PROMPT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-node && node --test test/voiceMatchService.test.js`
Expected: PASS — `tests 3`, `pass 3`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/voiceMatchService.js backend-node/test/voiceMatchService.test.js
git commit -m "Add voiceMatchService prompt-building and response-parsing logic"
```

---

### Task 7: `voiceMatchService.js` — batch recommend + regenerate (DB + LLM glue)

**Files:**
- Modify: `backend-node/src/services/voiceMatchService.js` (append)

- [ ] **Step 1: Append the DB/LLM wrapper functions**

Add near the top of `backend-node/src/services/voiceMatchService.js` (after the `safeParseAIJSON` require):

```js
const aiClient = require('./aiClient');
const voiceLibraryService = require('./voiceLibraryService');
```

Add these functions before `module.exports`:

```js
async function recommendVoicesForDrama(db, log, dramaId, opts = {}) {
  const characters = db.prepare(
    'SELECT id, name, role, description, personality, appearance, voice_id FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(Number(dramaId));
  if (characters.length === 0) throw new Error('该剧集暂无角色');
  const targets = opts.onlyUnassigned ? characters.filter((c) => !c.voice_id) : characters;
  if (targets.length === 0) return [];
  const voices = voiceLibraryService.listVoices(db, {});
  if (voices.length === 0) throw new Error('请先在配音管理中添加语音');
  const userPrompt = buildRecommendPrompt(targets, voices);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, RECOMMEND_SYSTEM_PROMPT, { json_mode: true, temperature: 0.4 });
  const matches = parseRecommendResponse(rawText, targets, voices);
  if (matches.length === 0) throw new Error('AI 未返回有效的配音推荐结果，请重试');
  const now = new Date().toISOString();
  const results = [];
  for (const m of matches) {
    db.prepare('UPDATE characters SET voice_id = ?, updated_at = ? WHERE id = ?').run(m.voice_id, now, m.character_id);
    const character = characters.find((c) => c.id === m.character_id);
    const voice = voices.find((v) => v.id === m.voice_id);
    results.push({ character_id: m.character_id, character_name: character?.name, voice_id: m.voice_id, voice_name: voice?.name, reason: m.reason });
  }
  log.info('Voice recommend batch done', { drama_id: dramaId, count: results.length });
  return results;
}

async function regenerateForCharacter(db, log, characterId) {
  const character = db.prepare(
    'SELECT id, drama_id, name, role, description, personality, appearance, voice_id FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!character) throw new Error('角色不存在');
  const allVoices = voiceLibraryService.listVoices(db, {});
  if (allVoices.length === 0) throw new Error('请先在配音管理中添加语音');
  const candidateVoices = character.voice_id ? allVoices.filter((v) => v.id !== character.voice_id) : allVoices;
  const voices = candidateVoices.length > 0 ? candidateVoices : allVoices;
  const userPrompt = buildRecommendPrompt([character], voices);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, RECOMMEND_SYSTEM_PROMPT, { json_mode: true, temperature: 0.6 });
  const matches = parseRecommendResponse(rawText, [character], voices);
  if (matches.length === 0) throw new Error('AI 未返回有效的配音推荐结果，请重试');
  const m = matches[0];
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET voice_id = ?, updated_at = ? WHERE id = ?').run(m.voice_id, now, character.id);
  const voice = voices.find((v) => v.id === m.voice_id);
  log.info('Voice regenerate done', { character_id: characterId, voice_id: m.voice_id });
  return { character_id: character.id, character_name: character.name, voice_id: m.voice_id, voice_name: voice?.name, reason: m.reason };
}
```

Update `module.exports` to:

```js
module.exports = {
  buildRecommendPrompt,
  parseRecommendResponse,
  RECOMMEND_SYSTEM_PROMPT,
  recommendVoicesForDrama,
  regenerateForCharacter,
};
```

- [ ] **Step 2: Manual verification**

This requires a running server, a drama with characters, an LLM `ai_service_configs` entry (`service_type=text`), and at least 2 voices in the library (from Task 3's manual step). Full end-to-end verification happens in Task 15 — skip standalone verification here to avoid duplicating setup.

- [ ] **Step 3: Commit**

```bash
git add backend-node/src/services/voiceMatchService.js
git commit -m "Add batch voice recommendation and per-character regeneration"
```

---

### Task 8: `voice-recommend` API routes

**Files:**
- Create: `backend-node/src/routes/voiceMatch.js`
- Modify: `backend-node/src/routes/index.js`

- [ ] **Step 1: Write the route handlers**

```js
// backend-node/src/routes/voiceMatch.js
const response = require('../response');
const voiceMatchService = require('../services/voiceMatchService');

function routes(db, log) {
  return {
    recommendForDrama: async (req, res) => {
      try {
        const onlyUnassigned = req.query.only_unassigned === '1' || req.body?.only_unassigned === true;
        const results = await voiceMatchService.recommendVoicesForDrama(db, log, req.params.dramaId, { onlyUnassigned });
        response.success(res, { items: results });
      } catch (err) {
        log.error('voice-recommend drama', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    regenerateForCharacter: async (req, res) => {
      try {
        const result = await voiceMatchService.regenerateForCharacter(db, log, req.params.id);
        response.success(res, result);
      } catch (err) {
        log.error('voice-recommend character', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = routes;
```

- [ ] **Step 2: Wire into the router**

In `backend-node/src/routes/index.js`, add the require after the `voiceLibraryRoutes` require added in Task 4:

```js
const voiceMatchRoutes = require('./voiceMatch');
```

Add the instantiation after `const voiceLibrary = voiceLibraryRoutes(db, cfg, log);` (also added in Task 4):

```js
  const voiceMatch = voiceMatchRoutes(db, log);
```

Add the route registrations right after the `voice-library` block added in Task 4:

```js
  // ---------- voice-recommend ----------
  r.post('/dramas/:dramaId/characters/voice-recommend', voiceMatch.recommendForDrama);
  r.post('/characters/:id/voice-recommend', voiceMatch.regenerateForCharacter);
```

- [ ] **Step 3: Manual verification**

Run: `curl -X POST http://localhost:5679/api/v1/dramas/1/characters/voice-recommend`
Expected (with no characters in drama 1): `{"success":false,"error":{"code":"BAD_REQUEST","message":"该剧集暂无角色"},...}` — confirms routing + error propagation works even before real data exists.

- [ ] **Step 4: Commit**

```bash
git add backend-node/src/routes/voiceMatch.js backend-node/src/routes/index.js
git commit -m "Add voice-recommend API routes"
```

---

### Task 9: Expose `voice_id` on character read paths

**Files:**
- Modify: `backend-node/src/services/dramaService.js:399-419` (`rowToCharacter`)
- Modify: `backend-node/src/routes/characters.js:12-14` (`getOne` SELECT)

- [ ] **Step 1: Add `voice_id` to `rowToCharacter`**

In `backend-node/src/services/dramaService.js`, in the `rowToCharacter` function, add a line right after `voice_style: r.voice_style,` (line 408):

```js
    voice_style: r.voice_style,
    voice_id: r.voice_id ?? null,
```

This makes `drama.characters[].voice_id` available wherever `dramaService.getCharacters`/`getDrama` populate the characters array — `SELECT *` already includes the new column (added in Task 1), only the explicit field-mapping needed the update.

- [ ] **Step 2: Add `voice_id` to the single-character SELECT**

In `backend-node/src/routes/characters.js`, update the `getOne` handler's SELECT (lines 12-14):

```js
        const row = db.prepare(
          'SELECT id, drama_id, name, role, appearance, description, personality, voice_style, voice_id, image_url, local_path, polished_prompt, four_view_image_url, identity_anchors, seedance2_asset, seedance2_voice_asset, negative_prompt, updated_at FROM characters WHERE id = ? AND deleted_at IS NULL'
        ).get(Number(req.params.id));
```

- [ ] **Step 3: Manual verification**

Run: `curl http://localhost:5679/api/v1/dramas/1` (any drama with at least one character)
Expected: each item in `data.characters` includes a `"voice_id"` key (null until Task 15's end-to-end test assigns one).

- [ ] **Step 4: Commit**

```bash
git add backend-node/src/services/dramaService.js backend-node/src/routes/characters.js
git commit -m "Expose character voice_id on drama and character read endpoints"
```

---

### Task 10: Frontend API layer

**Files:**
- Create: `frontweb/src/api/voiceLibrary.js`
- Modify: `frontweb/src/api/characters.js`
- Modify: `frontweb/src/api/drama.js`

- [ ] **Step 1: Create the voice library API module**

```js
// frontweb/src/api/voiceLibrary.js
import request from '@/utils/request'

export const voiceLibraryAPI = {
  list(params) {
    return request.get('/voice-library', { params })
  },
  importElevenLabs(data) {
    return request.post('/voice-library/import-elevenlabs', data)
  },
  designPreview(data) {
    return request.post('/voice-library/design/preview', data)
  },
  designSave(data) {
    return request.post('/voice-library/design/save', data)
  },
  test(id, text) {
    return request.post(`/voice-library/${id}/test`, { text })
  },
  delete(id, force) {
    return request.delete(`/voice-library/${id}`, { params: force ? { force: 1 } : {} })
  }
}
```

- [ ] **Step 2: Add the regenerate method to `characters.js`**

In `frontweb/src/api/characters.js`, add inside the `characterAPI` object (after the `sd2VoiceRefresh` method, before the closing `}`):

```js
  ,
  recommendVoice(characterId) {
    return request.post(`/characters/${characterId}/voice-recommend`, {})
  }
```

- [ ] **Step 3: Add the batch-recommend method to `drama.js`**

In `frontweb/src/api/drama.js`, add inside the `dramaAPI` object (after `saveCharacters`):

```js
  /** AI 一键推荐配音：为该剧集下所有角色（或仅未分配的）批量匹配语音库中的语音 */
  recommendVoices(id, onlyUnassigned) {
    return request.post(`/dramas/${id}/characters/voice-recommend`, { only_unassigned: !!onlyUnassigned })
  },
```

- [ ] **Step 4: Manual verification**

Run: `cd frontweb && npm run build` (or `npm run dev` and check the browser console for import errors)
Expected: no build errors related to the three files touched.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/api/voiceLibrary.js frontweb/src/api/characters.js frontweb/src/api/drama.js
git commit -m "Add frontend API bindings for voice library and voice recommendation"
```

---

### Task 11: Router entry + nav button

**Files:**
- Modify: `frontweb/src/router/index.js:42-47`
- Modify: `frontweb/src/views/FilmList.vue` (header actions area, around line 33-39)

- [ ] **Step 1: Add the route**

In `frontweb/src/router/index.js`, add a new route object after the `media-library` route (after line 47, before the closing `]`):

```js
    {
      path: '/voice-library',
      name: 'voice-library',
      component: () => import('@/views/VoiceLibrary.vue'),
      meta: { title: '配音管理' }
    }
```

- [ ] **Step 2: Add a nav button**

In `frontweb/src/views/FilmList.vue`, add a new `el-button` in the `header-actions` div, right before the existing theme toggle button (before line 33 `<el-button class="btn-theme" ...>`):

```html
          <el-button class="btn-library" title="配音管理" @click="$router.push('/voice-library')">
            <el-icon><Microphone /></el-icon>配音管理
          </el-button>
```

Add `Microphone` to the icon import in the `<script setup>` section — find the existing `@element-plus/icons-vue` import line and add `Microphone` to the destructured list.

- [ ] **Step 3: Manual verification**

Run: `cd frontweb && npm run dev`, open the app in a browser, confirm the "配音管理" button appears in the header and navigating to it renders an empty page (component doesn't exist yet — expect a Vite import error until Task 12 is done; that's expected at this point).

- [ ] **Step 4: Commit**

```bash
git add frontweb/src/router/index.js frontweb/src/views/FilmList.vue
git commit -m "Add voice-library route and nav entry point"
```

---

### Task 12: `VoiceLibrary.vue` page

**Files:**
- Create: `frontweb/src/views/VoiceLibrary.vue`

- [ ] **Step 1: Write the page component**

```vue
<template>
  <div class="voice-library-page">
    <header class="page-header">
      <div class="header-left">
        <el-button text @click="$router.back()">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">配音管理</h2>
      </div>
    </header>

    <el-tabs v-model="activeTab" class="voice-tabs">
      <el-tab-pane label="语音库" name="library">
        <div class="filter-bar">
          <el-select v-model="filterGender" placeholder="性别" clearable style="width: 120px" @change="loadVoices">
            <el-option label="男" value="male" />
            <el-option label="女" value="female" />
            <el-option label="中性" value="neutral" />
          </el-select>
          <el-select v-model="filterSource" placeholder="来源" clearable style="width: 140px" @change="loadVoices">
            <el-option label="ElevenLabs 克隆" value="elevenlabs" />
            <el-option label="语音设计" value="design" />
            <el-option label="上传" value="upload" />
          </el-select>
        </div>
        <div v-loading="voicesLoading" class="voice-grid">
          <div v-for="v in voices" :key="v.id" class="voice-card">
            <div class="voice-card-name">{{ v.name }}</div>
            <div class="voice-card-meta">
              <el-tag v-if="v.gender" size="small">{{ v.gender }}</el-tag>
              <el-tag v-if="v.age_range" size="small" type="info">{{ v.age_range }}</el-tag>
              <el-tag size="small" type="success">{{ sourceLabel(v.source) }}</el-tag>
            </div>
            <div class="voice-card-desc">{{ v.description }}</div>
            <div class="voice-card-actions">
              <el-button size="small" @click="playAudio(v.sample_url)">
                <el-icon><VideoPlay /></el-icon>试听
              </el-button>
              <el-button size="small" type="danger" plain @click="confirmDeleteVoice(v)">删除</el-button>
            </div>
          </div>
          <div v-if="!voicesLoading && voices.length === 0" class="voice-empty">暂无语音，请前往「克隆导入」或「语音设计」添加</div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="克隆导入（ElevenLabs）" name="import">
        <el-form :model="importForm" label-width="90px" class="voice-form">
          <el-form-item label="Voice ID"><el-input v-model="importForm.voice_id" placeholder="ElevenLabs voice_id" /></el-form-item>
          <el-form-item label="名称"><el-input v-model="importForm.name" placeholder="展示名，如 Rachel（英式温柔）" /></el-form-item>
          <el-form-item label="描述"><el-input v-model="importForm.description" type="textarea" :rows="2" placeholder="自由描述，供 AI 匹配角色时参考" /></el-form-item>
          <el-form-item label="性别">
            <el-select v-model="importForm.gender" placeholder="选择性别" style="width: 160px">
              <el-option label="男" value="male" />
              <el-option label="女" value="female" />
              <el-option label="中性" value="neutral" />
            </el-select>
          </el-form-item>
          <el-form-item label="年龄段">
            <el-select v-model="importForm.age_range" placeholder="选择年龄段" style="width: 160px">
              <el-option label="儿童" value="child" />
              <el-option label="青年" value="young" />
              <el-option label="成年" value="adult" />
              <el-option label="老年" value="elderly" />
            </el-select>
          </el-form-item>
          <el-form-item label="标签"><el-input v-model="importForm.tagsInput" placeholder="逗号分隔，如 gentle,mature" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="importing" @click="doImport">导入并克隆</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="语音设计" name="design">
        <el-form :model="designForm" label-width="90px" class="voice-form">
          <el-form-item label="Attributes">
            <el-input v-model="designForm.instruct" type="textarea" :rows="2" placeholder='例如："female, low pitch, gentle, british accent"' />
          </el-form-item>
          <el-form-item label="试听文本"><el-input v-model="designForm.sample_text" placeholder="留空使用默认试听文本" /></el-form-item>
          <el-form-item>
            <el-button :loading="designPreviewing" @click="doDesignPreview">生成试听</el-button>
          </el-form-item>
          <template v-if="designPreview">
            <el-form-item label="试听结果">
              <el-button @click="playAudio(designPreview.sample_url)"><el-icon><VideoPlay /></el-icon>播放</el-button>
            </el-form-item>
            <el-form-item label="名称"><el-input v-model="designForm.name" placeholder="展示名" /></el-form-item>
            <el-form-item label="描述"><el-input v-model="designForm.description" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="性别">
              <el-select v-model="designForm.gender" placeholder="选择性别" style="width: 160px">
                <el-option label="男" value="male" />
                <el-option label="女" value="female" />
                <el-option label="中性" value="neutral" />
              </el-select>
            </el-form-item>
            <el-form-item label="年龄段">
              <el-select v-model="designForm.age_range" placeholder="选择年龄段" style="width: 160px">
                <el-option label="儿童" value="child" />
                <el-option label="青年" value="young" />
                <el-option label="成年" value="adult" />
                <el-option label="老年" value="elderly" />
              </el-select>
            </el-form-item>
            <el-form-item label="标签"><el-input v-model="designForm.tagsInput" placeholder="逗号分隔" /></el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="designSaving" @click="doDesignSave">保存到语音库</el-button>
            </el-form-item>
          </template>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="语音测试台" name="test">
        <el-form label-width="90px" class="voice-form">
          <el-form-item label="选择语音">
            <el-select v-model="testVoiceId" placeholder="选择要试听的语音" style="width: 280px">
              <el-option v-for="v in voices" :key="v.id" :label="v.name" :value="v.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="测试文本"><el-input v-model="testText" type="textarea" :rows="3" placeholder="输入任意文本" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="testing" @click="doTest">试听</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, VideoPlay } from '@element-plus/icons-vue'
import { voiceLibraryAPI } from '@/api/voiceLibrary'

const activeTab = ref('library')

const voices = ref([])
const voicesLoading = ref(false)
const filterGender = ref('')
const filterSource = ref('')

function sourceLabel(source) {
  if (source === 'elevenlabs') return 'ElevenLabs 克隆'
  if (source === 'design') return '语音设计'
  return '上传'
}

async function loadVoices() {
  voicesLoading.value = true
  try {
    const data = await voiceLibraryAPI.list({ gender: filterGender.value || undefined, source: filterSource.value || undefined })
    voices.value = data?.items || []
  } catch (e) {
    ElMessage.error(e.message || '加载语音库失败')
  } finally {
    voicesLoading.value = false
  }
}

function playAudio(url) {
  if (!url) return
  new Audio(url).play().catch(() => ElMessage.error('播放失败'))
}

async function confirmDeleteVoice(voice) {
  try {
    await ElMessageBox.confirm(`确定删除语音「${voice.name}」吗？`, '删除确认', { type: 'warning' })
  } catch (_) { return }
  try {
    await voiceLibraryAPI.delete(voice.id)
    ElMessage.success('已删除')
    loadVoices()
  } catch (e) {
    const detail = e.response?.data?.error
    if (detail?.code === 'IN_USE') {
      try {
        await ElMessageBox.confirm(detail.message, '语音正在使用中', { type: 'warning', confirmButtonText: '仍然删除' })
      } catch (_) { return }
      try {
        await voiceLibraryAPI.delete(voice.id, true)
        ElMessage.success('已删除，相关角色的配音绑定已清除')
        loadVoices()
      } catch (e2) {
        ElMessage.error(e2.message || '删除失败')
      }
      return
    }
    ElMessage.error(e.message || '删除失败')
  }
}

const importForm = ref({ voice_id: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' })
const importing = ref(false)

async function doImport() {
  if (!importForm.value.voice_id?.trim()) { ElMessage.warning('请输入 ElevenLabs voice_id'); return }
  if (!importForm.value.name?.trim()) { ElMessage.warning('请输入名称'); return }
  importing.value = true
  try {
    await voiceLibraryAPI.importElevenLabs({
      voice_id: importForm.value.voice_id.trim(),
      name: importForm.value.name.trim(),
      description: importForm.value.description || null,
      gender: importForm.value.gender || null,
      age_range: importForm.value.age_range || null,
      tags: importForm.value.tagsInput ? importForm.value.tagsInput.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    ElMessage.success('导入成功')
    importForm.value = { voice_id: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' }
    activeTab.value = 'library'
    loadVoices()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const designForm = ref({ instruct: '', sample_text: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' })
const designPreviewing = ref(false)
const designSaving = ref(false)
const designPreview = ref(null)

async function doDesignPreview() {
  if (!designForm.value.instruct?.trim()) { ElMessage.warning('请输入 attributes 描述'); return }
  designPreviewing.value = true
  designPreview.value = null
  try {
    const data = await voiceLibraryAPI.designPreview({
      instruct: designForm.value.instruct.trim(),
      sample_text: designForm.value.sample_text || undefined,
    })
    designPreview.value = data
    playAudio(data.sample_url)
  } catch (e) {
    ElMessage.error(e.message || '生成试听失败')
  } finally {
    designPreviewing.value = false
  }
}

async function doDesignSave() {
  if (!designPreview.value) { ElMessage.warning('请先生成试听'); return }
  if (!designForm.value.name?.trim()) { ElMessage.warning('请输入名称'); return }
  designSaving.value = true
  try {
    await voiceLibraryAPI.designSave({
      temp_path: designPreview.value.temp_path,
      instruct: designPreview.value.instruct,
      sample_text: designPreview.value.sample_text,
      name: designForm.value.name.trim(),
      description: designForm.value.description || null,
      gender: designForm.value.gender || null,
      age_range: designForm.value.age_range || null,
      tags: designForm.value.tagsInput ? designForm.value.tagsInput.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    ElMessage.success('已保存到语音库')
    designForm.value = { instruct: '', sample_text: '', name: '', description: '', gender: '', age_range: '', tagsInput: '' }
    designPreview.value = null
    activeTab.value = 'library'
    loadVoices()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    designSaving.value = false
  }
}

const testVoiceId = ref(null)
const testText = ref('')
const testing = ref(false)

async function doTest() {
  if (!testVoiceId.value) { ElMessage.warning('请选择语音'); return }
  if (!testText.value?.trim()) { ElMessage.warning('请输入测试文本'); return }
  testing.value = true
  try {
    const data = await voiceLibraryAPI.test(testVoiceId.value, testText.value.trim())
    playAudio(data.sample_url)
  } catch (e) {
    ElMessage.error(e.message || '试听失败')
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  loadVoices()
})
</script>

<style scoped>
.voice-library-page { min-height: 100vh; padding: 20px 32px; }
.page-header { display: flex; align-items: center; margin-bottom: 16px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.page-title { margin: 0; font-size: 20px; }
.filter-bar { display: flex; gap: 12px; margin-bottom: 16px; }
.voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.voice-card { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 14px; }
.voice-card-name { font-weight: 600; margin-bottom: 6px; }
.voice-card-meta { display: flex; gap: 6px; margin-bottom: 8px; }
.voice-card-desc { color: var(--el-text-color-secondary); font-size: 13px; min-height: 36px; margin-bottom: 10px; }
.voice-card-actions { display: flex; gap: 8px; }
.voice-empty { grid-column: 1 / -1; text-align: center; color: var(--el-text-color-secondary); padding: 40px 0; }
.voice-form { max-width: 480px; }
</style>
```

- [ ] **Step 2: Manual verification in the browser**

Run: `cd frontweb && npm run dev`, navigate to `/voice-library` (via the nav button added in Task 11).

Walk through each tab:
1. "语音库" — loads without error, shows empty state.
2. "克隆导入" — requires an `ai_service_configs` row with `service_type=tts, provider=elevenlabs` and a real ElevenLabs API key + a real `voice_id` to fully succeed; verify at minimum that submitting with an empty `voice_id` shows the "请输入 ElevenLabs voice_id" warning without hitting the network.
3. "语音设计" — requires the OmniVoice server running (Task 3's setup); enter `"female, low pitch, gentle"`, click "生成试听", confirm audio plays and the save form appears; fill name, save, confirm it lands in "语音库".
4. "语音测试台" — select the voice just saved, enter text, click "试听", confirm audio plays.

- [ ] **Step 3: Commit**

```bash
git add frontweb/src/views/VoiceLibrary.vue
git commit -m "Add VoiceLibrary page with import, design, library, and test tabs"
```

---

### Task 13: `DramaDetail.vue` — batch recommend + per-character regenerate

**Files:**
- Modify: `frontweb/src/views/DramaDetail.vue`

- [ ] **Step 1: Add a toolbar with the batch-recommend button above the character list**

In the `<!-- 本剧制作角色 -->` template block, insert a toolbar div right after the opening `<template v-if="activeResTab === 'drama-char'">` tag and before `<div class="drama-res-list">` (i.e., right before line 262):

```html
        <template v-if="activeResTab === 'drama-char'">
          <div class="drama-char-toolbar">
            <el-button type="primary" plain :loading="voiceRecommending" @click="doRecommendVoices">
              <el-icon><Microphone /></el-icon>AI 一键推荐配音
            </el-button>
          </div>
          <div class="drama-res-list">
```

- [ ] **Step 2: Show the assigned voice + a regenerate button per character**

In the same block, inside the `drama-res-actions` div for each character (currently only has the "编辑" button, around line 275-277), add the voice badge and regenerate button:

```html
                  <div class="drama-res-meta" v-if="item.role">
                    <el-tag size="small" type="info">{{ item.role === 'main' ? '主角' : item.role === 'supporting' ? '配角' : item.role }}</el-tag>
                  </div>
                  <div class="drama-res-meta" v-if="voiceNameById[item.voice_id]">
                    <el-tag size="small" type="success">🎤 {{ voiceNameById[item.voice_id] }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaChar(item)">编辑</el-button>
                    <el-button size="small" :loading="regeneratingVoiceId === item.id" @click="doRegenerateVoice(item)">🔄 重新推荐</el-button>
                  </div>
```

This replaces the existing block from `<div class="drama-res-meta" v-if="item.role">` through the closing `</div>` of `drama-res-actions` (originally lines 271-277).

- [ ] **Step 3: Add script state, the voice-name lookup map, and the two handler functions**

Add a new import after the existing `import { characterAPI } from '@/api/characters'` line (line 576):

```js
import { voiceLibraryAPI } from '@/api/voiceLibrary'
```

Add `Microphone` to the existing `@element-plus/icons-vue` import (line 566):

```js
import { ArrowLeft, VideoPlay, Plus, Delete, Sunny, Moon, PictureFilled, Grid, Microphone } from '@element-plus/icons-vue'
```

Add new refs near the other `edit*` refs (after line 607 `const episodeBatchImportDialogRef = ref(null)`):

```js
const voiceRecommending = ref(false)
const regeneratingVoiceId = ref(null)
const voiceNameById = ref({})
```

Add these functions near `openEditDramaChar` (after line 671, before `async function saveDramaChar()`):

```js
async function loadVoiceNames() {
  try {
    const data = await voiceLibraryAPI.list({})
    const map = {}
    for (const v of (data?.items || [])) map[v.id] = v.name
    voiceNameById.value = map
  } catch (_) {
    // 语音库加载失败不阻塞角色页面，静默忽略
  }
}

async function doRecommendVoices() {
  voiceRecommending.value = true
  try {
    const data = await dramaAPI.recommendVoices(dramaId, false)
    const items = data?.items || []
    ElMessage.success(`已为 ${items.length} 个角色推荐配音`)
    await loadVoiceNames()
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '推荐配音失败')
  } finally {
    voiceRecommending.value = false
  }
}

async function doRegenerateVoice(item) {
  regeneratingVoiceId.value = item.id
  try {
    await characterAPI.recommendVoice(item.id)
    ElMessage.success('已重新推荐配音')
    await loadVoiceNames()
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '重新推荐失败')
  } finally {
    regeneratingVoiceId.value = null
  }
}
```

- [ ] **Step 4: Load voice names on mount**

Find the `onMounted` hook that calls `loadDrama()` and add `loadVoiceNames()` alongside it:

```js
onMounted(() => {
  loadDrama()
  loadVoiceNames()
  // ...(keep any other existing calls in this hook as-is)
})
```

> If `onMounted` already contains other calls, add `loadVoiceNames()` as an additional line rather than replacing the block — locate the exact hook by searching for `loadDrama()` inside an `onMounted(` call in the file.

- [ ] **Step 5: Add a small style rule for the new toolbar**

Add to the `<style scoped>` section (anywhere among the other `.drama-res-*` rules):

```css
.drama-char-toolbar {
  margin-bottom: 12px;
}
```

- [ ] **Step 6: Manual verification in the browser**

1. Open a drama with 2+ characters that have distinct descriptions (e.g., one elderly male, one young female).
2. Ensure the voice library has at least 2 voices (from Task 12's manual verification).
3. Click "AI 一键推荐配音" — confirm a success message shows the count, and each character card now shows a `🎤` voice badge.
4. Click "🔄 重新推荐" on one character — confirm its badge updates (ideally to a different voice, if more than one voice exists).

- [ ] **Step 7: Commit**

```bash
git add frontweb/src/views/DramaDetail.vue
git commit -m "Add AI voice recommendation UI to DramaDetail character panel"
```

---

### Task 14: AI 配置 — add OmniVoice/ElevenLabs provider presets

**Files:**
- Modify: `frontweb/src/components/AIConfigContent.vue:1353-1355` (`providerConfigs.tts`)
- Modify: `frontweb/src/components/AIConfigContent.vue:1390-1410` (`getBaseUrlForProvider`)

- [ ] **Step 1: Add the two presets to the `tts` provider list**

Change:

```js
  tts: [
    { id: 'minimax', name: 'MiniMax T2A', models: ['speech-02-hd', 'speech-02-turbo'] },
  ],
```

to:

```js
  tts: [
    { id: 'minimax', name: 'MiniMax T2A', models: ['speech-02-hd', 'speech-02-turbo'] },
    { id: 'omnivoice', name: 'OmniVoice（本地）', models: ['omnivoice'] },
    { id: 'elevenlabs', name: 'ElevenLabs（仅用于取样克隆）', models: ['eleven_multilingual_v2'] },
  ],
```

- [ ] **Step 2: Add default base URLs for the two new providers**

In `getBaseUrlForProvider`, add two conditions before the final `return` (after the `if (p === 'agnes') return 'https://apihub.agnes-ai.com/v1'` line):

```js
  if (p === 'omnivoice') return 'http://127.0.0.1:8712'
  if (p === 'elevenlabs') return 'https://api.elevenlabs.io/v1'
```

- [ ] **Step 3: Manual verification in the browser**

Open "AI 配置" (via the settings button in `FilmList.vue` header, or navigate to `/ai-config`), click "新增配置", select `service_type=tts`, confirm "OmniVoice（本地）" and "ElevenLabs（仅用于取样克隆）" both appear in the provider dropdown, and selecting either auto-fills the expected `base_url`.

- [ ] **Step 4: Commit**

```bash
git add frontweb/src/components/AIConfigContent.vue
git commit -m "Add OmniVoice and ElevenLabs presets to the tts provider picker"
```

---

### Task 15: End-to-end manual verification

No new files — this is a checklist to run through once every prior task is complete, matching the spec's testing plan.

- [ ] **Step 1: Start both servers**

Terminal 1: `cd ~/OmniVoice-master && uv run python server/omnivoice_server.py --host 127.0.0.1 --port 8712` — wait for `OMNIVOICE_SERVER_READY 127.0.0.1:8712`.
Terminal 2: start the LocalMiniDrama backend + frontend as normal for this repo (check `backend-node/README.md` / root-level scripts if the exact commands aren't already known from this session).

- [ ] **Step 2: Configure providers**

In "AI 配置": add a `tts` config with provider `omnivoice` (base URL auto-fills to `http://127.0.0.1:8712`, no API key needed since it's loopback-only). Add a `tts` config with provider `elevenlabs` and a real API key. Confirm a `text`-type LLM config already exists (required for voice matching) — if not, add one.

- [ ] **Step 3: Import + design voices**

In "配音管理": import at least one real ElevenLabs voice via "克隆导入", and design at least one voice via "语音设计" with attributes like `"male, elderly, gravelly"`. Confirm both appear in "语音库" and both play back correctly via "试听".

- [ ] **Step 4: Test bench**

In "语音测试台", pick each imported/designed voice, enter a sentence, confirm the cloned output sounds like a reasonable approximation of the source (not a strict pass/fail — judgment call).

- [ ] **Step 5: Batch recommend**

Open a drama with characters spanning different genders/ages (create one if needed — e.g., one elderly male description, one young female description). Click "AI 一键推荐配音". Confirm the elderly-male character gets matched to a male/older voice and the young-female character to a female/younger voice (not necessarily perfect, but directionally sane).

- [ ] **Step 6: Regenerate**

Click "🔄 重新推荐" on one character. Confirm the badge updates to a different voice than before (assuming 2+ voices exist in the library).

- [ ] **Step 7: Deletion guard**

In "配音管理" → "语音库", try deleting a voice that's currently assigned to a character. Confirm the warning dialog shows the correct usage count, and confirming the second dialog deletes it and clears the character's `voice_id` (re-open the drama's character panel and confirm the `🎤` badge disappeared for that character).

- [ ] **Step 8: Record results**

No commit needed for this task — if any step fails, file it as a follow-up rather than silently patching scope creep into this plan.

---

## Summary of new/modified files

**Backend — new:**
- `backend-node/migrations/23_voice_library.sql`
- `backend-node/src/services/voiceLibraryService.js`
- `backend-node/src/services/omnivoiceService.js`
- `backend-node/src/services/elevenlabsService.js`
- `backend-node/src/services/voiceMatchService.js`
- `backend-node/src/routes/voiceLibrary.js`
- `backend-node/src/routes/voiceMatch.js`
- `backend-node/test/voiceLibraryService.test.js`
- `backend-node/test/voiceMatchService.test.js`

**Backend — modified:**
- `backend-node/src/routes/index.js`
- `backend-node/src/services/ttsService.js`
- `backend-node/src/services/dramaService.js`
- `backend-node/src/routes/characters.js`

**Frontend — new:**
- `frontweb/src/api/voiceLibrary.js`
- `frontweb/src/views/VoiceLibrary.vue`

**Frontend — modified:**
- `frontweb/src/api/characters.js`
- `frontweb/src/api/drama.js`
- `frontweb/src/router/index.js`
- `frontweb/src/views/FilmList.vue`
- `frontweb/src/views/DramaDetail.vue`
- `frontweb/src/components/AIConfigContent.vue`
