# Voice Casting（配音选角）设计文档

日期：2026-07-08

## 背景

LocalMiniDrama 已有 `ttsService.js`，支持 MiniMax、OpenAI 兼容接口两种 TTS provider。`characters` 表已有 `voice_style`（自由文本）字段但没有可执行的语音绑定。

目标：接入 [OmniVoice](https://github.com/k2-fsa/OmniVoice)（本地运行的零样本 TTS 模型，`~/OmniVoice-master/server/omnivoice_server.py` 已提供本地 HTTP 服务），做到：

1. 有一个语音库管理页面，可以试听、克隆、设计、管理语音。
2. 语音克隆的音色来源为 ElevenLabs（通过 voice_id 拉取一段示例音频，只调用一次云端 API，之后全部走本地 OmniVoice 克隆）。
3. 有一个"语音设计"标签页，允许用 attributes prompt（如 `"female, low pitch, gentle, british accent"`）直接设计新音色，设计结果同样落地为 ref_audio，纳入语音库统一管理。
4. 有一键 AI 推荐：对某剧集下所有角色，基于角色描述批量匹配语音库中最合适的语音；单个角色可以"重新推荐"（regenerate），避免重复推荐同一个语音。

## 核心设计决策

- **两种语音来源统一收敛为「语音克隆」**：无论音色来自 ElevenLabs 导入还是 Voice Design 生成，最终都会在语音库里落地成一个 `ref_audio` 文件 + `ref_text`。角色实际配音合成时，统一走 OmniVoice 的 voice cloning 模式，避免 Voice Design 模式每次生成音色不稳定的问题。
- **ElevenLabs 仅用于"取样"，不作为长期 TTS provider**：只在导入语音到库时调用一次 ElevenLabs API 生成示例音频；后续所有合成都在本地跑 OmniVoice，不产生持续云端费用，也符合项目本地优先的取向。
- **AI 推荐复用现有 LLM 配置**：不新增独立的 AI 配置类型，直接复用 `aiClient.generateText(db, log, 'text', ...)`，与项目现有的脚本生成等功能使用同一套 LLM 配置。
- **Voice Design 与角色配音自动分配是两个独立特性**：Voice Design 标签页产出的语音进入语音库后，与克隆导入的语音处于同一个池子里，AI 推荐时一视同仁地考虑。

## 架构总览

```
[ElevenLabs API]          [Voice Design prompt]
       │ (一次性导入)              │ (一次性设计)
       ▼                          ▼ (调用本地 OmniVoice 生成样音)
       └──────► voice_library/*.wav ◄──────┘
                        │
                        ▼
          voice_library 表（SQLite）
          {id, name, description, gender, age_range, tags,
           source, source_ref, ref_audio_path, ref_text, language}
                        │
        ┌───────────────┼────────────────────┐
        ▼               ▼                    ▼
  [语音测试台 UI]   [AI 一键推荐]      [characters.voice_id]
                        │                    │
                        ▼                    ▼
              (LLM 匹配角色描述→voice_id)  (TTS 合成时使用)
                                             │
                                             ▼
                                 [OmniVoice /synthesize]
                                 （统一走 cloning 模式）
```

## 数据库变更

新表 `voice_library`：

```sql
CREATE TABLE voice_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                 -- 展示名，如 "Rachel（英式温柔）"
  description TEXT,                   -- 自由描述，供 AI 匹配使用
  gender TEXT,                        -- 'male' | 'female' | 'neutral' | null
  age_range TEXT,                     -- 'child' | 'young' | 'adult' | 'elderly' | null
  tags TEXT,                          -- JSON array，如 ["gentle","mature","narrator"]
  source TEXT NOT NULL,               -- 'elevenlabs' | 'design' | 'upload'
  source_ref TEXT,                    -- elevenlabs voice_id / design 时的 instruct 原文 / null
  ref_audio_path TEXT NOT NULL,       -- 相对路径，如 'voice_library/xx.wav'
  ref_text TEXT NOT NULL,             -- ref_audio 对应的文本（克隆模式必需）
  sample_url TEXT,                    -- 试听地址（= ref_audio 的静态路径）
  language TEXT DEFAULT 'en',
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
```

`characters` 表新增列：

```sql
ALTER TABLE characters ADD COLUMN voice_id INTEGER;  -- 外键，指向 voice_library.id
```

保留旧的 `voice_style` 字段不动，避免破坏兼容性。

Migration 文件命名：`backend-node/migrations/23_voice_library.sql`（当前最新为 `22_library_source_id.sql`）。

存储目录：`backend-node/data/voice_library/{uid}.wav`。

`ai_service_configs` 新增（通过现有 AI 配置管理界面添加，不改表结构）：
- 一条 `service_type='tts', provider='omnivoice'`，`base_url` 默认 `http://127.0.0.1:8712`
- 一条 `service_type='tts', provider='elevenlabs'`，存放 ElevenLabs API key（复用现有 provider 模式，Voice Library 导入表单不单独收 API key 输入框）

## 后端服务

### `omnivoiceService.js`（新）

封装对本地 OmniVoice HTTP 服务的调用：

```js
async function checkHealth(baseUrl)
async function synthesizeCloning(text, refAudioPath, refText, baseUrl)
async function synthesizeDesign(text, instruct, baseUrl)
```

对应 `POST {baseUrl}/synthesize`，请求体分别带 `{text, ref_audio, ref_text}` 或 `{text, instruct}`。调用前先 `GET /health` 校验模型已加载，未就绪时返回明确错误信息（"OmniVoice 本地服务未启动，请先运行 server/omnivoice_server.py"）。

### `voiceLibraryService.js`（新）

```js
function listVoices(db, filters)
async function importFromElevenLabs(db, log, { voice_id, name, description, gender, age_range, tags })
async function createFromDesign(db, log, { instruct, name, description, gender, age_range, tags, sample_text })
function deleteVoice(db, id)
async function testSynthesize(db, log, { voice_id, text })
```

- `importFromElevenLabs`：从 `ai_service_configs` 读取 ElevenLabs API key，调用 `POST /v1/text-to-speech/{voice_id}`，示例文本使用固定的英文句子常量（约 5-8 秒），保存音频文件，写入 `voice_library` 行（`source='elevenlabs'`）。
- `createFromDesign`：调用 `omnivoiceService.synthesizeDesign` 生成一段试听音频，用户确认满意后再落库（`source='design'`, `source_ref=instruct`）。
- `testSynthesize`：语音测试台用，基于某个已入库语音的 `ref_audio_path` + `ref_text`，对任意输入文本做一次性克隆合成，返回临时试听地址，不写入库。

### `ttsService.js` 扩展

新增 `provider === 'omnivoice'` 分支：读取 `character.voice_id` 对应的 `voice_library` 行，取其 `ref_audio_path` / `ref_text`，调用 `omnivoiceService.synthesizeCloning`。

> 范围说明：本设计只保证"角色 → voice_id → 语音克隆合成"这条链路可用；storyboard 对白批量合成时如何按说话角色自动路由到对应 `voice_id`（目前 `ttsService.synthesize` 调用点未传角色信息）属于后续改进，不在本次实现范围内。

### `voiceMatchService.js`（新）

```js
async function recommendVoicesForDrama(db, log, dramaId)
async function regenerateForCharacter(db, log, characterId)
```

- 批量推荐：取该剧集下所有角色（name/description/personality/appearance）与语音库全部语音（name/description/gender/age_range/tags），构造一个 prompt 交给 `aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, { json: true })`，要求 LLM 返回 `{character_id: voice_id, ...}` 格式的 JSON，解析后批量更新 `characters.voice_id`。
- 单角色重新推荐：同样逻辑但只处理一个角色，prompt 中排除当前已绑定的语音，避免重复推荐相同结果。
- 语音库为空时提前拦截，返回"请先在配音管理中添加语音"提示；LLM 返回内容解析失败时报错，不静默写入错误的 voice_id。

## API 路由

```
GET    /api/voice-library                       列表（支持 gender/tag/source 过滤）
POST   /api/voice-library/import-elevenlabs      { voice_id, name, description, gender, age_range, tags }
POST   /api/voice-library/design                 { instruct, name, description, gender, age_range, tags, sample_text? }
POST   /api/voice-library/:id/test               { text } → 返回临时试听地址
DELETE /api/voice-library/:id                    软删除；若有角色正在使用需在响应中提示占用数量

POST   /api/dramas/:dramaId/characters/voice-recommend   批量推荐（该剧集下所有角色）
POST   /api/characters/:id/voice-recommend                单角色重新推荐
```

## 前端

### 新页面 `VoiceLibrary.vue`（路由 `/voice-library`，菜单"配音管理"）

四个标签页：

1. **语音库**：卡片网格展示已入库语音，含性别/年龄段标签、tags、试听按钮、删除按钮，支持按 gender/tag/source 过滤。
2. **克隆导入（ElevenLabs）**：表单输入 `voice_id`、`name`、`description`、`gender`、`age_range`、`tags`；点击"导入并克隆"后端调用 ElevenLabs 取样 + 保存，成功后可试听并已自动入库。
3. **语音设计**：表单输入 `instruct`（attributes prompt，带占位提示示例）、`name`、`description`、可选自定义 `sample_text`；先"生成试听"，确认满意后再"保存到语音库"，避免每次设计都占用存储。
4. **语音测试台**：下拉选择语音库中的语音 + 任意输入文本，点击"试听"调用 `testSynthesize`。

### `DramaDetail.vue`（角色管理区域）

- 增加"AI 一键推荐配音"按钮，触发批量推荐 API；完成后在角色列表中以表格/徽标形式展示每个角色已分配的语音名，附试听按钮。
- 每个角色旁增加"重新推荐"按钮，仅对该角色重新调用推荐逻辑。

## 错误处理

- OmniVoice 服务未启动：`/health` 检查前置，返回明确提示而非超时静默失败。
- ElevenLabs 导入失败（voice_id 错误、配额耗尽、未配置 API key）：原样透传 ElevenLabs 返回的错误信息。
- 语音设计生成失败（模型未加载等）：报错，不写入语音库。
- AI 推荐：语音库为空提前拦截；LLM 返回内容无法解析为合法 JSON 时报错，不静默写入错误绑定。
- 删除正在被角色使用的语音：软删除前查询占用角色数量，在 UI 中提示确认。

## 测试计划（人工验证，项目当前无该模块的自动化测试）

1. 启动本地 OmniVoice 服务，确认 `/health` 返回 `ready:true`。
2. 用一个 ElevenLabs voice_id 导入 → 试听 → 确认文件按预期路径落地、库中记录正确。
3. 语音设计：输入 attributes prompt → 生成试听 → 确认满意后保存 → 确认出现在语音库列表。
4. 语音测试台：选择任意语音，输入中/英/越文本，试听验证克隆效果。
5. 创建一个包含性别/年龄差异明显角色的剧集 → 执行"一键推荐配音" → 验证分配结果合理。
6. 对某一角色点击"重新推荐" → 验证得到与上次不同的语音（不重复推荐同一结果）。
7. 删除一个正被角色使用的语音 → 验证 UI 正确提示占用并给出确认步骤。
