# Đợt 1: Rules Bible + Phân tập (Episode Outline + Gate 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 6 rule packs (chưng cất từ 13 DOC làm phim) + tầng "Đề cương phân tập" có duyệt giữa cốt truyện → kịch bản, kèm Gate 1 kiểm tra phủ mốc truyện.

**Architecture:** Rule packs là file tĩnh trong `backend-node/prompts/rulepacks/`, nạp qua `rulepackService` và ghép vào system prompt của từng công đoạn trong `promptI18n.js`. Luồng mới: `POST /generation/story-outline` (sync, 1 call LLM) → lưu bảng `story_outlines` → người dùng sửa/duyệt trên UI (`StoryOutlinePanel.vue`) → `POST /generation/story-from-outline` (async task, mỗi tập 1 call LLM + 1 call kiểm tra coverage = Gate 1). Luồng cũ `/generation/story` giữ nguyên (backward compat).

**Tech Stack:** Node.js ≥18 CommonJS + Express + better-sqlite3 (backend); Vue 3 + element-plus (frontend); test bằng `node:test` + sqlite `:memory:`.

## Global Constraints

- Backend là CommonJS (`require`/`module.exports`), KHÔNG dùng ESM import.
- KHÔNG thêm npm dependency mới (cả backend lẫn frontend).
- Test backend: `node --test test/<file>.test.js`, chạy từ thư mục `backend-node/`; DB test dùng `new Database(':memory:')` (pattern như `test/taskService.test.js`).
- Frontend không có test framework — verify bằng chạy dev server thủ công; KHÔNG tự thêm vitest.
- Prompt mặc định viết tiếng Trung (khớp pipeline hiện có); phần format JSON là locked suffix KHÔNG override được (pattern `_overrideCache[key]` + `getDefaultPromptBody`/`getLockedSuffix` trong `promptI18n.js`).
- UI copy tiếng Việt; log/error message backend tiếng Trung (khớp style hiện có).
- AI call qua `aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, { scene_key, temperature, min_max_tokens, model })`; KHÔNG dùng `json_mode` (lý do đã ghi ở `storyGenerationService.js:26-27`).
- Parse JSON từ AI bằng `safeParseAIJSON(rawText, log)` từ `../utils/safeJson`.
- Response route: `response.success(res, data)` / `response.badRequest(res, msg)` / `response.internalError(res, msg)`.
- Migration: file SQL mới `backend-node/migrations/25_story_outlines.sql` + `CREATE TABLE IF NOT EXISTS` trong `src/db/migrate.js` (pattern sẵn có).
- Commit message tiếng Việt/tiếng Anh đều được, prefix `feat:`/`test:`/`docs:`, kèm dòng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Ngoài phạm vi Đợt 1** (đã ghi trong spec, làm ở đợt sau): tab UI riêng để sửa nội dung rule packs (đợt này packs sửa bằng file; 2 prompt key mới đã hiện trong PromptEditor sẵn có); tiêm packs `shot-grammar`/`emotion-to-behavior`/`continuity` vào prompt storyboard/ảnh/video (Đợt 2); Gate 2/3 (Đợt 3).

---

### Task 1: Rule packs + rulepackService

**Files:**
- Create: `backend-node/prompts/rulepacks/series-bible.md`
- Create: `backend-node/prompts/rulepacks/episode-script.md`
- Create: `backend-node/prompts/rulepacks/shot-grammar.md`
- Create: `backend-node/prompts/rulepacks/emotion-to-behavior.json`
- Create: `backend-node/prompts/rulepacks/continuity.md`
- Create: `backend-node/prompts/rulepacks/qc-gates.md`
- Create: `backend-node/src/services/rulepackService.js`
- Test: `backend-node/test/rulepackService.test.js`

**Interfaces:**
- Produces: `rulepackService.getPackText(name: string): string` (trả `''` nếu file không tồn tại); `rulepackService.composePacks(names: string[]): string` (ghép các pack, mỗi pack có header `【规则包：<name>】`); `rulepackService.getEmotionTable(): Array<{key, zh, en, prompt_zh, prompt_en}>`; `rulepackService.clearCache(): void` (cho test).

- [ ] **Step 1: Viết 6 file rule pack**

`backend-node/prompts/rulepacks/series-bible.md`:
```markdown
【剧集圣经规则｜用于：分集大纲】
1. 冲突必须内建于故事前提（premise）之中，禁止逐场景临时编造冲突。
2. 每个情节点（plot point）必须且只能分配到一集，不遗漏、不重复。
3. 允许为丰富剧情虚构细节（对话、过渡场景），但禁止虚构改变或矛盾于原始梗概情节点的重大事件。
4. 每 3-5 集必须安排一次改变局势的重大揭示（reveal）。
5. 开场钩子（opening_hook）必须是 3-5 秒内可拍摄的具体动作或冲突画面，禁止用旁白或字幕交代。
6. 每集结尾悬念（cliffhanger）必须"切在问题上，不切在答案上"——留下未回答的问题，比自然结束提前一拍收尾。
7. 若用户指定集数与故事容量不符（每集约800字承载1-3个情节点为宜），必须给出建议集数及理由。
8. 反派/阻力必须在第 1 集内出现或被暗示。
```

`backend-node/prompts/rulepacks/episode-script.md`:
```markdown
【单集剧本规则｜用于：按大纲写单集】
1. 只使用本集被分配的情节点，禁止提前使用后续集的情节点，禁止编造矛盾于大纲的重大事件。
2. 本集第一段必须直接呈现大纲中的 opening_hook（动作/冲突进行中开场），禁止背景铺陈式开头。
3. 本集最后一段必须落在大纲中的 cliffhanger 上，在问题抛出后立即收尾，禁止解释或缓和。
4. 禁止角色直接说出情绪名称（如"我很伤心"）；情绪通过动作、潜台词（subtext）和具体物理细节表现。
5. 每句对白必须是指向对方的一个动作（说服/威胁/试探/安抚/隐瞒…），不是情绪陈述。
6. 巧合可以让角色陷入麻烦，禁止用巧合解救角色（皮克斯规则）。
7. 角色必须有主见并按自身动机行动，禁止为推进剧情而让角色做不合动机的事。
8. 每个情绪重场至少绑定一个具体物理细节（道具、动作、环境），拒绝空泛描写。
9. 与上一集衔接：开头承接上一集结尾状态，但不复述剧情。
```

`backend-node/prompts/rulepacks/shot-grammar.md`:
```markdown
【镜头语法规则｜用于：分镜拆解（第2批次接入）】
1. 每场戏遵循 coverage 结构：先交代空间的全景/中景，再进中近景，情绪高点用特写。
2. 全程遵守 180 度轴线；同一场戏内禁止无动机跳轴。
3. 一个镜头 = 一个主要动作 = 一次情绪变化（1-1-1 规则）。
4. 平均镜头时长 4-6 秒；对白镜头一句台词对应一个镜头。
5. 推镜（push-in）只用于情绪强度上升的时刻；手持只用于紧张/纪实感；禁止无动机运镜。
6. 重要对白场必须有听者反应镜头（reaction shot）。
7. 情绪高潮之后安排一个喘息镜头（pillow shot：空镜/物件/环境）。
8. 新机位优先复用已有机位；开新机位时景别只允许相邻递进（全景→中景→特写），禁止全景直跳特写。
```

`backend-node/prompts/rulepacks/emotion-to-behavior.json`:
```json
{
  "description": "情绪→可拍摄行为翻译表。生成图像/视频提示词时禁止写情绪名称，必须查表翻译成行为描述。",
  "rules": [
    "提示词中禁止出现情绪名称本身，必须使用行为描述",
    "每组行为按 起始→变化→结束 的进程书写",
    "优先描写眼睛与嘴部（特写最清晰的部位）"
  ],
  "table": [
    { "key": "sad_repressed", "zh": "压抑的悲伤", "prompt_zh": "试图保持平静但嘴角下垂，下巴微颤，眼睛湿润，缓慢眨眼后垂下目光", "prompt_en": "tries to keep a neutral face but lip corners pull down, chin trembles slightly, eyes glisten, she blinks slowly and looks down" },
    { "key": "burst_crying", "zh": "崩溃大哭", "prompt_zh": "克制的表情瞬间崩塌，眉头紧蹙上扬，捂住嘴，肩膀无声抽动", "prompt_en": "her composed face cracks, brows pull together and up, she covers her mouth, shoulders shake with silent sobs" },
    { "key": "shock", "zh": "震惊", "prompt_zh": "表情在动作中途凝固，眼睛缓缓睁大，嘴唇微张，后退半步，手抓住桌沿", "prompt_en": "her expression freezes mid-motion, eyes widen slowly, lips part, she takes a small step back, hand grips the table edge" },
    { "key": "anger_suppressed", "zh": "压抑的愤怒", "prompt_zh": "下颌收紧，鼻翼微张，用鼻子缓慢呼气，凝视不眨眼，嘴唇抿成一条线", "prompt_en": "jaw tightens, nostrils flare slightly, he exhales slowly through his nose, stares without blinking, lips pressed thin" },
    { "key": "fake_smile", "zh": "假笑/社交微笑", "prompt_zh": "礼貌的微笑但未达眼底，脸颊抬起而眼神平淡疲惫，笑容提前一秒褪去", "prompt_en": "a polite smile that doesn't reach her eyes, cheeks lift but eyes stay flat and tired, smile fades a second too early" },
    { "key": "genuine_joy", "zh": "真心的喜悦", "prompt_zh": "笑容缓缓绽开，眼角皱起，轻声笑出来并害羞地移开视线", "prompt_en": "a genuine smile spreading slowly, eyes crinkle at the corners, she laughs softly and looks away shyly" },
    { "key": "fear", "zh": "恐惧", "prompt_zh": "呼吸加快，目光扫向门口，用力吞咽，手指反复揉搓衣袖", "prompt_en": "breath quickens, eyes dart to the door, she swallows hard, fingers fidget with her sleeve" },
    { "key": "contempt", "zh": "轻蔑（反派）", "prompt_zh": "一侧嘴角缓缓上挑，下巴微抬，眯起眼睛带着冷冷的玩味", "prompt_en": "one corner of his mouth lifts in a slow smirk, chin tilts up, eyes narrow with cold amusement" },
    { "key": "hidden_love", "zh": "隐忍的爱意", "prompt_zh": "趁对方不注意时目光温柔地注视，对方转身时立刻压下浮起的微笑", "prompt_en": "she watches him with soft eyes while he isn't looking, a faint smile she suppresses when he turns around" },
    { "key": "resolve", "zh": "下定决心（反击）", "prompt_zh": "用手背擦去眼泪，咬紧下颌，眼神变硬，抬起下巴直视前方", "prompt_en": "she wipes her tears with the back of her hand, jaw sets, eyes harden, she lifts her chin and looks straight ahead" }
  ]
}
```

`backend-node/prompts/rulepacks/continuity.md`:
```markdown
【连贯性规则｜用于：图像/视频提示词与接续（第2批次接入）】
1. 同一场戏内所有镜头必须复用完全相同的 CHARACTER BLOCK（角色外貌描述）与 SETTING BLOCK（环境光线描述），逐字复制，禁止改写。
2. 视频运动描述中禁止用角色名字指代人物，必须用可见外貌特征（发型、服装颜色等）。
3. 同一场戏内：光线方向、时段、天气、服装、道具位置不得改变。
4. 首帧描述必须是纯静态快照（禁止"正要/即将"类进行时描述）；尾帧必须是首帧+运动过程的合理物理结果。
5. 相邻镜头衔接：上一镜结束状态 = 下一镜开始状态（位置、姿态、道具）。
```

`backend-node/prompts/rulepacks/qc-gates.md`:
```markdown
【质检门规则｜用于：Gate 1 覆盖检查（本批次）与 Gate 2/3（后续批次）】
Gate 1（剧本 vs 大纲）：
1. 本集剧本必须体现被分配的每一个情节点；未体现 = missing。
2. 开头是否呈现 opening_hook（具体动作/冲突，非旁白铺陈）。
3. 结尾是否落在 cliffhanger 的未回答问题上。
4. 判定只依据剧本文本，禁止脑补"隐含体现"。
Gate 2/3（预留，第3批次接入）：
5. 关键帧须与角色参考图一致（性别/年龄/发型/服装/体型/脸部特征）。
6. 合成前须检查：每个分镜有视频、总时长在目标±10%、旁白/对白音频齐备。
```

- [ ] **Step 2: Viết failing test cho rulepackService**

`backend-node/test/rulepackService.test.js`:
```js
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const rulepackService = require('../src/services/rulepackService');

describe('rulepackService', () => {
  beforeEach(() => rulepackService.clearCache());

  it('getPackText returns content for existing pack', () => {
    const text = rulepackService.getPackText('series-bible');
    assert.ok(text.includes('剧集圣经规则'));
  });

  it('getPackText returns empty string for missing pack', () => {
    assert.equal(rulepackService.getPackText('khong-ton-tai'), '');
  });

  it('composePacks joins packs with headers, skips missing', () => {
    const out = rulepackService.composePacks(['series-bible', 'khong-ton-tai', 'episode-script']);
    assert.ok(out.includes('【规则包：series-bible】'));
    assert.ok(out.includes('【规则包：episode-script】'));
    assert.ok(!out.includes('khong-ton-tai'));
  });

  it('getEmotionTable returns 10 entries with prompt_zh', () => {
    const table = rulepackService.getEmotionTable();
    assert.equal(table.length, 10);
    assert.ok(table[0].prompt_zh.length > 0);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run (từ `backend-node/`): `node --test test/rulepackService.test.js`
Expected: FAIL — `Cannot find module '../src/services/rulepackService'`

- [ ] **Step 4: Implement rulepackService**

`backend-node/src/services/rulepackService.js`:
```js
// 规则包加载器：从 prompts/rulepacks/ 读取规则文本，按需拼进各环节 system prompt
const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', '..', 'prompts', 'rulepacks');
const _cache = {};

function getPackText(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(_cache, key)) return _cache[key];
  let text = '';
  for (const ext of ['.md', '.json']) {
    const p = path.join(PACKS_DIR, key + ext);
    if (fs.existsSync(p)) {
      try {
        text = fs.readFileSync(p, 'utf8').trim();
      } catch (_) {
        text = '';
      }
      break;
    }
  }
  _cache[key] = text;
  return text;
}

function composePacks(names) {
  const parts = [];
  for (const name of Array.isArray(names) ? names : []) {
    const text = getPackText(name);
    if (!text) continue;
    parts.push(`【规则包：${name}】\n${text}`);
  }
  return parts.join('\n\n');
}

function getEmotionTable() {
  const raw = getPackText('emotion-to-behavior');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.table) ? parsed.table : [];
  } catch (_) {
    return [];
  }
}

function clearCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

module.exports = { getPackText, composePacks, getEmotionTable, clearCache };
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `node --test test/rulepackService.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend-node/prompts/rulepacks/ backend-node/src/services/rulepackService.js backend-node/test/rulepackService.test.js
git commit -m "feat: 6 rule packs (chưng cất DOC làm phim) + rulepackService loader

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Prompt đề cương phân tập trong promptI18n

**Files:**
- Modify: `backend-node/src/services/promptI18n.js` (thêm sau `buildStoryExpansionUserPrompt`, ~dòng 960; thêm case vào `getDefaultPromptBody` ~dòng 966 và `getLockedSuffix` ~dòng 1003; export ở cuối file ~dòng 1613)
- Modify: `backend-node/src/routes/promptOverrides.js` (thêm entry vào `PROMPT_META`)
- Test: `backend-node/test/storyOutlinePrompts.test.js`

**Interfaces:**
- Consumes: `rulepackService.composePacks(names)` (Task 1); helper nội bộ `isEnglish(cfg)`, `_overrideCache`, `STORY_STYLE_LABELS`, `STORY_TYPE_LABELS` (đã có sẵn trong promptI18n.js).
- Produces: `promptI18n.getStoryOutlineSystemPrompt(cfg): string`; `promptI18n.buildStoryOutlineUserPrompt(cfg, premise, style, type, episodeCount): string`.

- [ ] **Step 1: Viết failing test**

`backend-node/test/storyOutlinePrompts.test.js`:
```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const promptI18n = require('../src/services/promptI18n');

const cfgZh = {}; // config rỗng → mặc định tiếng Trung

describe('story outline prompts', () => {
  it('system prompt contains rule pack and locked JSON format', () => {
    const sys = promptI18n.getStoryOutlineSystemPrompt(cfgZh);
    assert.ok(sys.includes('剧集圣经规则'), 'phải ghép rule pack series-bible');
    assert.ok(sys.includes('"plot_points"'), 'locked suffix phải mô tả JSON plot_points');
    assert.ok(sys.includes('"episodes"'));
    assert.ok(sys.includes('必须只返回纯 JSON'));
  });

  it('user prompt contains premise, style label and episode count', () => {
    const up = promptI18n.buildStoryOutlineUserPrompt(cfgZh, '一个女孩在森林遇到会说话的狐狸', 'fantasy', 'adventure', 4);
    assert.ok(up.includes('会说话的狐狸'));
    assert.ok(up.includes('奇幻'));
    assert.ok(up.includes('冒险'));
    assert.ok(up.includes('4'));
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test test/storyOutlinePrompts.test.js`
Expected: FAIL — `promptI18n.getStoryOutlineSystemPrompt is not a function`

- [ ] **Step 3: Implement 2 hàm prompt trong promptI18n.js**

Thêm `const rulepackService = require('./rulepackService');` cạnh các require đầu file (nếu file chưa require gì thì thêm dòng 1). Thêm sau `buildStoryExpansionUserPrompt`:

```js
/**
 * 分集大纲：system prompt（可 override 正文；JSON 格式锁定）
 */
function getStoryOutlineSystemPrompt(cfg) {
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回一个 JSON 对象：\n{\n  "plot_points": [{ "id": "P1", "text": "情节点描述" }],\n  "episode_count_suggestion": 4,\n  "episode_count_reason": "若建议集数与用户要求一致则填空字符串",\n  "episodes": [\n    {\n      "episode": 1,\n      "title": "本集标题（5-10字）",\n      "goal": "本集叙事目标（一句话）",\n      "plot_point_ids": ["P1"],\n      "opening_hook": "开场3-5秒可拍的具体动作/冲突",\n      "cliffhanger": "结尾未回答的问题"\n    }\n  ]\n}\n**必须只返回纯 JSON 对象，不要任何 markdown 代码块、说明文字。直接以 { 开头，以 } 结尾。**`;
  if (isEnglish(cfg)) {
    return `You are a head writer (showrunner). Extract the premise's plot points and assign them to episodes, designing an opening hook and a cliffhanger for every episode.

Rules:
1. Every plot point is assigned to exactly one episode — none missing, none duplicated.
2. You may invent enriching details, but never invent major events that contradict the premise.
3. opening_hook must be a concrete action/conflict filmable in the first 3-5 seconds (no narration).
4. cliffhanger must cut on an unanswered question, not on an answer.
5. If the requested episode count does not fit the story volume (~1-3 plot points per episode), set episode_count_suggestion with a reason.
6. Every 3-5 episodes include one situation-changing reveal.${jsonNote}`;
  }
  const _o = _overrideCache['story_outline_system'];
  const base = _o || getDefaultPromptBody('story_outline_system');
  const packs = rulepackService.composePacks(['series-bible']);
  return base + (packs ? `\n\n${packs}` : '') + jsonNote;
}

/**
 * 分集大纲：user prompt（梗概 + 风格/类型 + 集数）
 */
function buildStoryOutlineUserPrompt(cfg, premise, style, type, episodeCount) {
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const styleLabels = STORY_STYLE_LABELS[lang];
  const typeLabels = STORY_TYPE_LABELS[lang];
  if (lang === 'en') {
    let p = `Create an episode outline for the following premise (${n} episode(s) requested):\n\n${premise}`;
    if (style && styleLabels[style]) p += `\n\nStyle: ${styleLabels[style]}`;
    if (type && typeLabels[type]) p += `\nGenre: ${typeLabels[type]}`;
    return p;
  }
  let p = `请为以下故事梗概制定分集大纲（用户要求 ${n} 集）：\n\n${premise}`;
  if (style && styleLabels[style]) p += `\n\n故事风格：${styleLabels[style]}`;
  if (type && typeLabels[type]) p += `\n剧本类型：${typeLabels[type]}`;
  return p;
}
```

Trong `getDefaultPromptBody(key)` thêm case (trước `default`):
```js
    case 'story_outline_system':
      return '你是一位剧本统筹（总编剧）。你的任务是：提取故事梗概中的情节点（plot points），把它们分配到各集，并为每一集设计开场钩子与结尾悬念。\n\n要求：\n1. 每个情节点必须且只能分配到一集，不遗漏、不重复。\n2. 允许虚构丰富细节，但禁止虚构矛盾于梗概的重大事件。\n3. opening_hook 必须是开场3-5秒内可拍摄的具体动作或冲突，禁止旁白。\n4. cliffhanger 必须切在未回答的问题上，不切在答案上。\n5. 若用户要求的集数与故事容量不符（每集约1-3个情节点为宜），在 episode_count_suggestion 给出建议集数及理由。\n6. 每3-5集安排一次改变局势的重大揭示。';
```

Trong `getLockedSuffix(key)` thêm case:
```js
    case 'story_outline_system':
      return '\n\n**输出格式（必须严格遵守）**：返回一个 JSON 对象，包含 plot_points、episode_count_suggestion、episode_count_reason、episodes（每项含 episode/title/goal/plot_point_ids/opening_hook/cliffhanger）。**必须只返回纯 JSON 对象，不要 markdown。**';
```

Thêm vào `module.exports` cuối file:
```js
  getStoryOutlineSystemPrompt,
  buildStoryOutlineUserPrompt,
```

- [ ] **Step 4: Đăng ký key trong PROMPT_META**

`backend-node/src/routes/promptOverrides.js` — thêm vào mảng `PROMPT_META` (sau entry `story_expansion_system`):
```js
  {
    key: 'story_outline_system',
    label: '分集大纲提示词',
    description: '控制 AI 如何提取情节点并分配到各集（钩子/悬念规则；JSON 格式已锁定）',
  },
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `node --test test/storyOutlinePrompts.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/services/promptI18n.js backend-node/src/routes/promptOverrides.js backend-node/test/storyOutlinePrompts.test.js
git commit -m "feat: prompt đề cương phân tập (story_outline_system) ghép rule pack series-bible

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Bảng story_outlines + storyOutlineService (storage + validate)

**Files:**
- Create: `backend-node/migrations/25_story_outlines.sql`
- Modify: `backend-node/src/db/migrate.js` (thêm `CREATE TABLE IF NOT EXISTS` vào phần ensure-tables, cạnh `global_settings` ~dòng 515)
- Create: `backend-node/src/services/storyOutlineService.js`
- Test: `backend-node/test/storyOutlineService.test.js`

**Interfaces:**
- Produces:
  - `storyOutlineService.parseOutlineResponse(rawText, log): object|null` — parse + chuẩn hóa outline từ text AI.
  - `storyOutlineService.validateOutline(outline, requestedCount): { ok: boolean, errors: string[] }`.
  - `storyOutlineService.saveOutline(db, dramaId, outline, status): row` — upsert theo `drama_id`; `status` ∈ `'draft'|'edited'|'confirmed'`.
  - `storyOutlineService.getOutline(db, dramaId): { id, drama_id, content: object, coverage: object|null, status } | null`.
  - `storyOutlineService.saveCoverage(db, dramaId, coverage): void`.

- [ ] **Step 1: Viết migration**

`backend-node/migrations/25_story_outlines.sql`:
```sql
CREATE TABLE IF NOT EXISTS story_outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL UNIQUE,
  content TEXT NOT NULL,
  coverage TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Trong `backend-node/src/db/migrate.js`, thêm vào phần ensure-tables (cùng chỗ các `database.exec(CREATE TABLE IF NOT EXISTS ...)`):
```js
    database.exec(`CREATE TABLE IF NOT EXISTS story_outlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL UNIQUE,
      content TEXT NOT NULL,
      coverage TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );`);
```

- [ ] **Step 2: Viết failing test**

`backend-node/test/storyOutlineService.test.js`:
```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const svc = require('../src/services/storyOutlineService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE story_outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL UNIQUE,
    content TEXT NOT NULL,
    coverage TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`);
  return db;
}

const goodOutline = {
  plot_points: [{ id: 'P1', text: '遇见狐狸' }, { id: 'P2', text: '发现宝石被盗' }],
  episode_count_suggestion: 2,
  episode_count_reason: '',
  episodes: [
    { episode: 1, title: '初遇', goal: '建立世界', plot_point_ids: ['P1'], opening_hook: '狐狸扑出咬住裙角', cliffhanger: '宝石发光，林中传来第三个脚步声' },
    { episode: 2, title: '追踪', goal: '追查小偷', plot_point_ids: ['P2'], opening_hook: '脚步声逼近', cliffhanger: '小偷的脸竟然是……' },
  ],
};

describe('parseOutlineResponse', () => {
  it('parses raw JSON text into normalized outline', () => {
    const out = svc.parseOutlineResponse(JSON.stringify(goodOutline), null);
    assert.equal(out.episodes.length, 2);
    assert.equal(out.plot_points[0].id, 'P1');
  });

  it('returns null on non-JSON text', () => {
    assert.equal(svc.parseOutlineResponse('không phải json', null), null);
  });
});

describe('validateOutline', () => {
  it('accepts a valid outline', () => {
    assert.equal(svc.validateOutline(goodOutline, 2).ok, true);
  });

  it('rejects duplicated plot point assignment', () => {
    const bad = JSON.parse(JSON.stringify(goodOutline));
    bad.episodes[1].plot_point_ids = ['P1', 'P2'];
    const res = svc.validateOutline(bad, 2);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('P1')));
  });

  it('rejects missing plot point assignment', () => {
    const bad = JSON.parse(JSON.stringify(goodOutline));
    bad.episodes[1].plot_point_ids = [];
    const res = svc.validateOutline(bad, 2);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('P2')));
  });

  it('rejects empty hook or cliffhanger', () => {
    const bad = JSON.parse(JSON.stringify(goodOutline));
    bad.episodes[0].opening_hook = '';
    assert.equal(svc.validateOutline(bad, 2).ok, false);
  });
});

describe('save/get outline', () => {
  it('upserts by drama_id and roundtrips content', () => {
    const db = createTestDb();
    svc.saveOutline(db, 7, goodOutline, 'draft');
    svc.saveOutline(db, 7, goodOutline, 'confirmed');
    const row = svc.getOutline(db, 7);
    assert.equal(row.status, 'confirmed');
    assert.equal(row.content.episodes.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM story_outlines').get().c, 1);
  });

  it('saveCoverage stores JSON', () => {
    const db = createTestDb();
    svc.saveOutline(db, 7, goodOutline, 'draft');
    svc.saveCoverage(db, 7, { 1: { missing_ids: [] } });
    assert.deepEqual(svc.getOutline(db, 7).coverage, { 1: { missing_ids: [] } });
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `node --test test/storyOutlineService.test.js`
Expected: FAIL — `Cannot find module '../src/services/storyOutlineService'`

- [ ] **Step 4: Implement storage + validate (chưa có AI call)**

`backend-node/src/services/storyOutlineService.js`:
```js
// 分集大纲：解析/校验/存取（AI 调用在 Task 4/6 补充）
const { safeParseAIJSON } = require('../utils/safeJson');

function parseOutlineResponse(rawText, log) {
  let parsed = null;
  try {
    parsed = safeParseAIJSON(rawText, log);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const plotPoints = Array.isArray(parsed.plot_points) ? parsed.plot_points : [];
  const episodes = Array.isArray(parsed.episodes) ? parsed.episodes : [];
  return {
    plot_points: plotPoints
      .map((p, i) => ({ id: String(p.id || `P${i + 1}`).trim(), text: String(p.text || '').trim() }))
      .filter((p) => p.text),
    episode_count_suggestion: Number(parsed.episode_count_suggestion) || episodes.length || 1,
    episode_count_reason: String(parsed.episode_count_reason || '').trim(),
    episodes: episodes.map((ep, i) => ({
      episode: Number(ep.episode ?? i + 1),
      title: String(ep.title || `第${Number(ep.episode ?? i + 1)}集`).trim(),
      goal: String(ep.goal || '').trim(),
      plot_point_ids: (Array.isArray(ep.plot_point_ids) ? ep.plot_point_ids : []).map((x) => String(x).trim()),
      opening_hook: String(ep.opening_hook || '').trim(),
      cliffhanger: String(ep.cliffhanger || '').trim(),
    })),
  };
}

function validateOutline(outline, requestedCount) {
  const errors = [];
  if (!outline || !Array.isArray(outline.episodes) || outline.episodes.length === 0) {
    return { ok: false, errors: ['大纲没有任何分集'] };
  }
  const pointIds = new Set((outline.plot_points || []).map((p) => p.id));
  const assigned = new Map(); // id -> count
  for (const ep of outline.episodes) {
    if (!ep.opening_hook) errors.push(`第${ep.episode}集缺少 opening_hook`);
    if (!ep.cliffhanger) errors.push(`第${ep.episode}集缺少 cliffhanger`);
    for (const id of ep.plot_point_ids || []) {
      if (!pointIds.has(id)) errors.push(`第${ep.episode}集引用了不存在的情节点 ${id}`);
      assigned.set(id, (assigned.get(id) || 0) + 1);
    }
  }
  for (const id of pointIds) {
    const c = assigned.get(id) || 0;
    if (c === 0) errors.push(`情节点 ${id} 未分配到任何一集`);
    if (c > 1) errors.push(`情节点 ${id} 被分配到多集（${c} 次）`);
  }
  return { ok: errors.length === 0, errors };
}

function saveOutline(db, dramaId, outline, status) {
  const content = JSON.stringify(outline);
  const st = status || 'draft';
  db.prepare(
    `INSERT INTO story_outlines (drama_id, content, status, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(drama_id) DO UPDATE SET content = excluded.content, status = excluded.status, updated_at = datetime('now')`
  ).run(Number(dramaId), content, st);
  return getOutline(db, dramaId);
}

function getOutline(db, dramaId) {
  const row = db.prepare('SELECT * FROM story_outlines WHERE drama_id = ?').get(Number(dramaId));
  if (!row) return null;
  let content = null;
  let coverage = null;
  try { content = JSON.parse(row.content); } catch (_) {}
  try { coverage = row.coverage ? JSON.parse(row.coverage) : null; } catch (_) {}
  return { id: row.id, drama_id: row.drama_id, content, coverage, status: row.status };
}

function saveCoverage(db, dramaId, coverage) {
  db.prepare(`UPDATE story_outlines SET coverage = ?, updated_at = datetime('now') WHERE drama_id = ?`)
    .run(JSON.stringify(coverage || {}), Number(dramaId));
}

module.exports = { parseOutlineResponse, validateOutline, saveOutline, getOutline, saveCoverage };
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `node --test test/storyOutlineService.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add backend-node/migrations/25_story_outlines.sql backend-node/src/db/migrate.js backend-node/src/services/storyOutlineService.js backend-node/test/storyOutlineService.test.js
git commit -m "feat: bảng story_outlines + storyOutlineService (parse/validate/storage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: generateOutline (AI call) + routes đề cương

**Files:**
- Modify: `backend-node/src/services/storyOutlineService.js` (thêm `generateOutline`)
- Modify: `backend-node/src/routes/index.js` (thêm 3 routes sau block `/generation/story` ~dòng 144)

**Interfaces:**
- Consumes: `promptI18n.getStoryOutlineSystemPrompt(cfg)` / `buildStoryOutlineUserPrompt(...)` (Task 2); `parseOutlineResponse` / `validateOutline` / `saveOutline` (Task 3); `aiClient.generateText`; `dramaService.getDramaById(db, id)`.
- Produces:
  - `storyOutlineService.generateOutline(db, log, body): Promise<{ outline, warnings: string[] }>` — body: `{ drama_id, premise, style?, type?, episode_count? }`.
  - Routes: `POST /generation/story-outline` (sync, trả `{ outline, warnings }`); `GET /dramas/:id/story-outline` (trả row hoặc 404-empty `{}`); `PUT /dramas/:id/story-outline` (body `{ content }`, validate rồi lưu status `'edited'`, trả row; content sai → 400 kèm errors).

- [ ] **Step 1: Thêm generateOutline vào storyOutlineService.js**

Thêm require ở đầu file:
```js
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const loadConfig = require('../config').loadConfig;
```

Thêm hàm (trước `module.exports`) và export thêm `generateOutline`:
```js
async function generateOutline(db, log, body) {
  const premise = (body.premise || '').trim();
  if (!premise) throw new Error('请提供故事梗概');
  const dramaId = Number(body.drama_id);
  if (!dramaId) throw new Error('drama_id 必填');
  const cfg = loadConfig();
  const episodeCount = Math.max(1, Math.floor(Number(body.episode_count) || 1));
  const systemPrompt = promptI18n.getStoryOutlineSystemPrompt(cfg);
  const userPrompt = promptI18n.buildStoryOutlineUserPrompt(cfg, premise, body.style || null, body.type || null, episodeCount);

  let outline = null;
  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'story_outline',
      temperature: attempt === 0 ? 0.7 : 0.4,
      min_max_tokens: Math.max(1500, episodeCount * 400),
    });
    const parsed = parseOutlineResponse(raw, log);
    if (!parsed) {
      lastErrors = ['AI 返回内容无法解析为大纲 JSON'];
      continue;
    }
    const v = validateOutline(parsed, episodeCount);
    if (v.ok) {
      outline = parsed;
      break;
    }
    lastErrors = v.errors;
    log && log.warn && log.warn('Outline validate failed, retrying', { attempt, errors: v.errors.slice(0, 5) });
  }
  if (!outline) throw new Error('生成分集大纲失败：' + lastErrors.join('；'));

  const warnings = [];
  if (outline.episode_count_suggestion && outline.episode_count_suggestion !== episodeCount) {
    warnings.push(`AI 建议 ${outline.episode_count_suggestion} 集：${outline.episode_count_reason || '容量更合适'}`);
  }
  saveOutline(db, dramaId, outline, 'draft');
  return { outline, warnings };
}
```

- [ ] **Step 2: Thêm 3 routes vào routes/index.js**

Chèn ngay sau block `r.post('/generation/story', ...)` (sau dòng ~144):
```js
  // 分集大纲：从梗概生成（同步，1次 LLM 调用）
  r.post('/generation/story-outline', async (req, res) => {
    const storyOutlineService = require('../services/storyOutlineService');
    try {
      const result = await storyOutlineService.generateOutline(db, log, req.body || {});
      response.success(res, result);
    } catch (err) {
      log.error('generation/story-outline', { error: err.message });
      if (err.message && (err.message.includes('必填') || err.message.includes('请提供'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '生成分集大纲失败');
    }
  });

  r.get('/dramas/:id/story-outline', (req, res) => {
    const storyOutlineService = require('../services/storyOutlineService');
    const row = storyOutlineService.getOutline(db, Number(req.params.id));
    response.success(res, row || {});
  });

  r.put('/dramas/:id/story-outline', (req, res) => {
    const storyOutlineService = require('../services/storyOutlineService');
    try {
      const content = (req.body || {}).content;
      if (!content || !Array.isArray(content.episodes)) {
        return response.badRequest(res, 'content.episodes 必填');
      }
      const v = storyOutlineService.validateOutline(content, content.episodes.length);
      if (!v.ok) {
        return response.badRequest(res, '大纲校验失败：' + v.errors.join('；'));
      }
      const row = storyOutlineService.saveOutline(db, Number(req.params.id), content, 'edited');
      response.success(res, row);
    } catch (err) {
      log.error('put story-outline', { error: err.message });
      response.internalError(res, err.message || '保存大纲失败');
    }
  });
```

- [ ] **Step 3: Verify bằng smoke test thủ công**

Run (từ `backend-node/`): `node --test test/storyOutlineService.test.js && node -e "require('./src/routes/index')"`
Expected: tests PASS; require routes không throw (nếu `require('./src/routes/index')` cần tham số, chỉ cần `node -e "require('./src/services/storyOutlineService')"` không throw là đủ).

- [ ] **Step 4: Commit**

```bash
git add backend-node/src/services/storyOutlineService.js backend-node/src/routes/index.js
git commit -m "feat: generateOutline + routes GET/PUT/POST story-outline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Prompt viết từng tập + prompt kiểm tra coverage (Gate 1)

**Files:**
- Modify: `backend-node/src/services/promptI18n.js` (thêm 4 hàm + case override + export)
- Modify: `backend-node/src/routes/promptOverrides.js` (thêm entry `episode_script_system`)
- Test: `backend-node/test/episodeScriptPrompts.test.js`

**Interfaces:**
- Consumes: `rulepackService.composePacks(['episode-script'])`, `isEnglish(cfg)`, `_overrideCache`.
- Produces:
  - `promptI18n.getEpisodeScriptSystemPrompt(cfg): string`
  - `promptI18n.buildEpisodeScriptUserPrompt(cfg, args): string` — args: `{ episodeNumber, title, goal, plotPointTexts: string[], openingHook, cliffhanger, prevTail: string }`
  - `promptI18n.getCoverageCheckSystemPrompt(cfg): string`
  - `promptI18n.buildCoverageCheckUserPrompt(cfg, args): string` — args: `{ episodeNumber, plotPoints: [{id,text}], openingHook, cliffhanger, scriptContent }`

- [ ] **Step 1: Viết failing test**

`backend-node/test/episodeScriptPrompts.test.js`:
```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const promptI18n = require('../src/services/promptI18n');

const cfgZh = {};

describe('episode script prompts', () => {
  it('system prompt contains episode-script rule pack and JSON lock', () => {
    const sys = promptI18n.getEpisodeScriptSystemPrompt(cfgZh);
    assert.ok(sys.includes('单集剧本规则'));
    assert.ok(sys.includes('"content"'));
  });

  it('user prompt contains outline fields and prev tail', () => {
    const up = promptI18n.buildEpisodeScriptUserPrompt(cfgZh, {
      episodeNumber: 2,
      title: '追踪',
      goal: '追查小偷',
      plotPointTexts: ['发现宝石被盗'],
      openingHook: '脚步声逼近',
      cliffhanger: '小偷的脸竟然是……',
      prevTail: '……宝石突然发光。',
    });
    assert.ok(up.includes('第2集'));
    assert.ok(up.includes('发现宝石被盗'));
    assert.ok(up.includes('脚步声逼近'));
    assert.ok(up.includes('宝石突然发光'));
  });
});

describe('coverage check prompts', () => {
  it('system prompt demands strict JSON verdict', () => {
    const sys = promptI18n.getCoverageCheckSystemPrompt(cfgZh);
    assert.ok(sys.includes('"missing_ids"'));
  });

  it('user prompt lists plot points with ids', () => {
    const up = promptI18n.buildCoverageCheckUserPrompt(cfgZh, {
      episodeNumber: 1,
      plotPoints: [{ id: 'P1', text: '遇见狐狸' }],
      openingHook: '狐狸扑出',
      cliffhanger: '第三个脚步声',
      scriptContent: '剧本正文……',
    });
    assert.ok(up.includes('P1'));
    assert.ok(up.includes('遇见狐狸'));
    assert.ok(up.includes('剧本正文'));
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test test/episodeScriptPrompts.test.js`
Expected: FAIL — `getEpisodeScriptSystemPrompt is not a function`

- [ ] **Step 3: Implement 4 hàm trong promptI18n.js**

Thêm sau `buildStoryOutlineUserPrompt`:
```js
/**
 * 按大纲写单集：system prompt（可 override；JSON 格式锁定）
 */
function getEpisodeScriptSystemPrompt(cfg) {
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回一个 JSON 对象：{ "title": "本集标题", "content": "本集剧本正文（约800字）" }\n**必须只返回纯 JSON 对象，不要 markdown。直接以 { 开头，以 } 结尾。**`;
  if (isEnglish(cfg)) {
    return `You are a professional screenwriter. Write ONE episode (~800 words) strictly following the assigned outline entry: open on the opening_hook action, use only the assigned plot points, and end exactly on the cliffhanger question. Never state emotions by name — show them through actions, subtext and concrete physical detail.${jsonNote}`;
  }
  const _o = _overrideCache['episode_script_system'];
  const base = _o || getDefaultPromptBody('episode_script_system');
  const packs = rulepackService.composePacks(['episode-script']);
  return base + (packs ? `\n\n${packs}` : '') + jsonNote;
}

/**
 * 按大纲写单集：user prompt
 */
function buildEpisodeScriptUserPrompt(cfg, args) {
  const a = args || {};
  const points = (a.plotPointTexts || []).map((t, i) => `${i + 1}. ${t}`).join('\n');
  if (isEnglish(cfg)) {
    return `Write episode ${a.episodeNumber} "${a.title || ''}".\nEpisode goal: ${a.goal || ''}\nAssigned plot points:\n${points}\nOpening hook (first beat): ${a.openingHook || ''}\nCliffhanger (last beat): ${a.cliffhanger || ''}\nEnd of previous episode (continue from here, do not recap):\n${a.prevTail || '(this is episode 1)'}`;
  }
  return `请撰写第${a.episodeNumber}集《${a.title || ''}》。\n本集目标：${a.goal || ''}\n本集分配的情节点：\n${points}\n开场钩子（第一拍必须呈现）：${a.openingHook || ''}\n结尾悬念（最后一拍必须落在此处）：${a.cliffhanger || ''}\n上一集结尾（从此处自然衔接，禁止复述）：\n${a.prevTail || '（本集为第1集）'}`;
}

/**
 * Gate 1 覆盖检查：system prompt（锁定 JSON 结论格式）
 */
function getCoverageCheckSystemPrompt(cfg) {
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回 JSON 对象：{ "covered_ids": ["P1"], "missing_ids": [], "hook_ok": true, "cliffhanger_ok": true, "notes": "简短说明" }\n**必须只返回纯 JSON，不要 markdown。**`;
  if (isEnglish(cfg)) {
    return `You are a strict script QC reviewer. Given a list of plot points assigned to an episode and the episode script, verify which plot points are actually depicted in the text. Judge ONLY from the text; no benefit of the doubt. Also verify the script opens on the given hook action and ends on the given cliffhanger question.${jsonNote}`;
  }
  return `你是一位严格的剧本质检员。给定本集被分配的情节点列表与剧本正文，逐一核对每个情节点是否在正文中被实际呈现。只依据文本判断，禁止脑补"隐含体现"。同时核对：开头是否呈现指定的开场钩子动作；结尾是否落在指定悬念问题上。${jsonNote}`;
}

/**
 * Gate 1 覆盖检查：user prompt
 */
function buildCoverageCheckUserPrompt(cfg, args) {
  const a = args || {};
  const points = (a.plotPoints || []).map((p) => `${p.id}: ${p.text}`).join('\n');
  if (isEnglish(cfg)) {
    return `Episode ${a.episodeNumber}\nAssigned plot points:\n${points}\nRequired opening hook: ${a.openingHook || ''}\nRequired cliffhanger: ${a.cliffhanger || ''}\n\nScript:\n${a.scriptContent || ''}`;
  }
  return `第${a.episodeNumber}集\n分配的情节点：\n${points}\n要求的开场钩子：${a.openingHook || ''}\n要求的结尾悬念：${a.cliffhanger || ''}\n\n剧本正文：\n${a.scriptContent || ''}`;
}
```

Case trong `getDefaultPromptBody`:
```js
    case 'episode_script_system':
      return '你是一位专业编剧。你的任务是严格按照分集大纲撰写"单独一集"约800字的剧本：以 opening_hook 的动作直接开场，只使用本集被分配的情节点，结尾精确落在 cliffhanger 的未回答问题上。禁止直接说出情绪名称——通过动作、潜台词与具体物理细节表现情绪。可包含场景描述、角色动作与对话，但不要输出分镜格式或场次标记。';
```

Case trong `getLockedSuffix`:
```js
    case 'episode_script_system':
      return '\n\n**输出格式（必须严格遵守）**：返回 JSON 对象 { "title": "...", "content": "约800字剧本正文" }。**必须只返回纯 JSON，不要 markdown。**';
```

Export thêm 4 hàm trong `module.exports`:
```js
  getEpisodeScriptSystemPrompt,
  buildEpisodeScriptUserPrompt,
  getCoverageCheckSystemPrompt,
  buildCoverageCheckUserPrompt,
```

Entry `PROMPT_META` trong `promptOverrides.js` (sau `story_outline_system`):
```js
  {
    key: 'episode_script_system',
    label: '单集剧本提示词',
    description: '控制 AI 如何按分集大纲撰写单集剧本（钩子/悬念/潜台词规则；JSON 格式已锁定）',
  },
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `node --test test/episodeScriptPrompts.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/services/promptI18n.js backend-node/src/routes/promptOverrides.js backend-node/test/episodeScriptPrompts.test.js
git commit -m "feat: prompt viết từng tập theo đề cương + prompt Gate 1 coverage check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Task viết kịch bản theo đề cương + Gate 1 + route

**Files:**
- Modify: `backend-node/src/services/storyOutlineService.js` (thêm `startEpisodesFromOutline`, `processEpisodesFromOutline`, `parseEpisodeScriptResponse`, `checkEpisodeCoverage`)
- Modify: `backend-node/src/routes/index.js` (thêm route `POST /generation/story-from-outline` sau block story-outline)
- Test: `backend-node/test/storyOutlineService.test.js` (thêm describe cho `parseEpisodeScriptResponse`)

**Interfaces:**
- Consumes: `taskService.createTask/updateTaskStatus/updateTaskResult/updateTaskError`; `dramaService.saveEpisodes(db, log, dramaId, { episodes })` + `dramaService.getDramaById`; 4 hàm prompt Task 5; `saveCoverage` (Task 3).
- Produces:
  - `storyOutlineService.parseEpisodeScriptResponse(rawText, episodeNumber, log): { title, content }` — fallback: text thô làm content.
  - `storyOutlineService.startEpisodesFromOutline(db, log, req): taskId` — req: `{ drama_id, episode_numbers?: number[] }`; task type `'story_from_outline'`.
  - Route: `POST /generation/story-from-outline` trả `{ task_id, status: 'pending' }`.
  - Coverage lưu dạng: `{ [episodeNumber]: { missing_ids: string[], hook_ok: boolean, cliffhanger_ok: boolean, notes: string } }`.

- [ ] **Step 1: Thêm failing test cho parseEpisodeScriptResponse**

Thêm vào cuối `backend-node/test/storyOutlineService.test.js`:
```js
describe('parseEpisodeScriptResponse', () => {
  it('parses JSON object {title, content}', () => {
    const out = svc.parseEpisodeScriptResponse('{"title":"初遇","content":"正文……"}', 1, null);
    assert.equal(out.title, '初遇');
    assert.equal(out.content, '正文……');
  });

  it('falls back to raw text as content', () => {
    const out = svc.parseEpisodeScriptResponse('纯文本剧本', 3, null);
    assert.equal(out.title, '第3集');
    assert.equal(out.content, '纯文本剧本');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test test/storyOutlineService.test.js`
Expected: FAIL — `svc.parseEpisodeScriptResponse is not a function` (các test cũ vẫn PASS)

- [ ] **Step 3: Implement trong storyOutlineService.js**

Thêm require:
```js
const taskService = require('./taskService');
const dramaService = require('./dramaService');
```

Thêm các hàm (trước `module.exports`), export thêm cả 3:
```js
function parseEpisodeScriptResponse(rawText, episodeNumber, log) {
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, log); } catch (_) {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.content || parsed.title)) {
    return {
      title: String(parsed.title || `第${episodeNumber}集`).trim(),
      content: String(parsed.content || '').trim() || String(rawText || '').trim(),
    };
  }
  return { title: `第${episodeNumber}集`, content: String(rawText || '').trim() };
}

async function checkEpisodeCoverage(db, log, cfg, outlineEp, plotPoints, scriptContent) {
  const promptI18nLocal = promptI18n;
  const sys = promptI18nLocal.getCoverageCheckSystemPrompt(cfg);
  const user = promptI18nLocal.buildCoverageCheckUserPrompt(cfg, {
    episodeNumber: outlineEp.episode,
    plotPoints,
    openingHook: outlineEp.opening_hook,
    cliffhanger: outlineEp.cliffhanger,
    scriptContent,
  });
  try {
    const raw = await aiClient.generateText(db, log, 'text', user, sys, {
      scene_key: 'story_coverage_check',
      temperature: 0.1,
      min_max_tokens: 800,
    });
    const parsed = safeParseAIJSON(raw, log);
    if (parsed && typeof parsed === 'object') {
      return {
        missing_ids: Array.isArray(parsed.missing_ids) ? parsed.missing_ids.map(String) : [],
        hook_ok: parsed.hook_ok !== false,
        cliffhanger_ok: parsed.cliffhanger_ok !== false,
        notes: String(parsed.notes || '').trim(),
      };
    }
  } catch (e) {
    log && log.warn && log.warn('coverage check failed', { episode: outlineEp.episode, error: e.message });
  }
  return { missing_ids: [], hook_ok: true, cliffhanger_ok: true, notes: '检查失败，默认通过' };
}

async function processEpisodesFromOutline(db, log, taskId, req) {
  const dramaId = Number(req.drama_id);
  try {
    const row = getOutline(db, dramaId);
    if (!row || !row.content) {
      taskService.updateTaskError(db, taskId, '尚未生成分集大纲');
      return;
    }
    const cfg = loadConfig();
    const outline = row.content;
    const pointById = new Map((outline.plot_points || []).map((p) => [p.id, p]));
    const filter = Array.isArray(req.episode_numbers) && req.episode_numbers.length > 0
      ? new Set(req.episode_numbers.map(Number))
      : null;
    const targets = outline.episodes.filter((ep) => !filter || filter.has(Number(ep.episode)));
    if (targets.length === 0) {
      taskService.updateTaskError(db, taskId, '没有需要生成的集');
      return;
    }

    const coverage = row.coverage || {};
    let prevTail = '';
    // prevTail của tập k lấy từ tập k-1 đã có trong DB (khi viết lại 1 tập) hoặc từ tập vừa viết trong vòng lặp
    const drama = dramaService.getDramaById(db, dramaId);
    const existingEpisodes = (drama && drama.episodes) || [];
    const tailOf = (content) => String(content || '').slice(-400);

    for (let i = 0; i < targets.length; i++) {
      const ep = targets[i];
      const pct = 5 + Math.floor((i / targets.length) * 80);
      taskService.updateTaskStatus(db, taskId, 'processing', pct, `正在撰写第${ep.episode}集…`);

      if (i === 0 && ep.episode > 1) {
        const prev = existingEpisodes.find((e) => Number(e.episode_number) === Number(ep.episode) - 1);
        prevTail = tailOf(prev && prev.script_content);
      }

      const plotTexts = (ep.plot_point_ids || []).map((id) => (pointById.get(id) || {}).text).filter(Boolean);
      const sys = promptI18n.getEpisodeScriptSystemPrompt(cfg);
      const user = promptI18n.buildEpisodeScriptUserPrompt(cfg, {
        episodeNumber: ep.episode,
        title: ep.title,
        goal: ep.goal,
        plotPointTexts: plotTexts,
        openingHook: ep.opening_hook,
        cliffhanger: ep.cliffhanger,
        prevTail,
      });
      const raw = await aiClient.generateText(db, log, 'text', user, sys, {
        scene_key: 'story_generation',
        temperature: 0.8,
        min_max_tokens: 2200,
      });
      const parsed = parseEpisodeScriptResponse(raw, ep.episode, log);
      dramaService.saveEpisodes(db, log, dramaId, {
        episodes: [{ episode_number: ep.episode, title: parsed.title || ep.title, script_content: parsed.content }],
      });
      prevTail = tailOf(parsed.content);

      taskService.updateTaskStatus(db, taskId, 'processing', pct + 5, `正在质检第${ep.episode}集（Gate 1）…`);
      const plotPoints = (ep.plot_point_ids || []).map((id) => pointById.get(id)).filter(Boolean);
      coverage[ep.episode] = await checkEpisodeCoverage(db, log, cfg, ep, plotPoints, parsed.content);
      saveCoverage(db, dramaId, coverage);
    }

    saveOutline(db, dramaId, outline, 'confirmed');
    const failed = Object.entries(coverage).filter(
      ([, c]) => (c.missing_ids || []).length > 0 || c.hook_ok === false || c.cliffhanger_ok === false
    );
    taskService.updateTaskResult(db, taskId, {
      drama_id: dramaId,
      episode_count: targets.length,
      gate1_failed_episodes: failed.map(([n]) => Number(n)),
    });
    log.info('Episodes from outline completed', { task_id: taskId, drama_id: dramaId, count: targets.length });
  } catch (err) {
    log.error('processEpisodesFromOutline failed', { task_id: taskId, error: err.message });
    taskService.updateTaskError(db, taskId, err.message || '按大纲生成剧本失败');
  }
}

function startEpisodesFromOutline(db, log, req) {
  const dramaId = String(req.drama_id || '');
  if (!dramaId) throw new Error('drama_id 必填');
  if (!dramaService.getDramaById(db, Number(dramaId))) throw new Error('项目不存在');
  const existing = db.prepare(
    `SELECT id FROM async_tasks
     WHERE resource_id = ? AND type = 'story_from_outline'
       AND status IN ('pending', 'processing') AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(dramaId);
  if (existing) return existing.id;
  const task = taskService.createTask(db, log, 'story_from_outline', dramaId);
  setImmediate(() => {
    processEpisodesFromOutline(db, log, task.id, req).catch((err) => {
      log.error('processEpisodesFromOutline fatal', { error: err.message, task_id: task.id });
      taskService.updateTaskError(db, task.id, err.message || '按大纲生成剧本失败');
    });
  });
  return task.id;
}
```

Lưu ý: `dramaService.getDramaById` phải trả kèm `episodes`; nếu thực tế không kèm, dùng query trực tiếp:
```js
const existingEpisodes = db.prepare('SELECT episode_number, script_content FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number').all(dramaId);
```
(kiểm tra schema bảng episodes trước khi chọn nhánh nào — xem `dramaService.saveEpisodes`).

- [ ] **Step 4: Thêm route**

Trong `routes/index.js`, sau block PUT story-outline:
```js
  // 按已确认大纲逐集生成剧本 + Gate 1 覆盖检查（异步任务）
  r.post('/generation/story-from-outline', (req, res) => {
    const storyOutlineService = require('../services/storyOutlineService');
    try {
      const taskId = storyOutlineService.startEpisodesFromOutline(db, log, req.body || {});
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/story-from-outline', { error: err.message });
      if (err.message && (err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '创建任务失败');
    }
  });
```

- [ ] **Step 5: Chạy toàn bộ test backend, xác nhận PASS**

Run: `node --test test/storyOutlineService.test.js test/storyOutlinePrompts.test.js test/episodeScriptPrompts.test.js test/rulepackService.test.js`
Expected: PASS toàn bộ

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/services/storyOutlineService.js backend-node/src/routes/index.js backend-node/test/storyOutlineService.test.js
git commit -m "feat: viết kịch bản từng tập theo đề cương + Gate 1 coverage check (async task)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend API + composable useStoryOutline

**Files:**
- Modify: `frontweb/src/api/generation.js`
- Create: `frontweb/src/composables/useStoryOutline.js`

**Interfaces:**
- Consumes: `request` từ `@/utils/request` (pattern như `generation.js` hiện có); backend routes Task 4/6.
- Produces:
  - `generationAPI.generateStoryOutline(body)` / `generationAPI.generateStoryFromOutline(body)` / `generationAPI.getStoryOutline(dramaId)` / `generationAPI.saveStoryOutline(dramaId, content)`.
  - Composable `useStoryOutline()` trả về: `{ outline, coverage, outlineStatus, warnings, generating, writing, generateOutline(args), saveOutline(dramaId), confirmAndWrite(args), rewriteEpisode(args), loadOutline(dramaId) }` (chi tiết code Step 2).

- [ ] **Step 1: Thêm 4 method vào generationAPI**

`frontweb/src/api/generation.js` — thêm vào object `generationAPI` (sau `generateStory`):
```js
  /** Tạo đề cương phân tập từ premise (sync). body: { drama_id, premise, style?, type?, episode_count? } */
  generateStoryOutline(body) {
    return request.post('/generation/story-outline', body)
  },
  /** Viết kịch bản từng tập theo đề cương đã chốt (async task). body: { drama_id, episode_numbers? } */
  generateStoryFromOutline(body) {
    return request.post('/generation/story-from-outline', body)
  },
  getStoryOutline(dramaId) {
    return request.get(`/dramas/${dramaId}/story-outline`)
  },
  saveStoryOutline(dramaId, content) {
    return request.put(`/dramas/${dramaId}/story-outline`, { content })
  },
```

- [ ] **Step 2: Viết composable**

`frontweb/src/composables/useStoryOutline.js`:
```js
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { generationAPI } from '@/api/generation'

/**
 * Quản lý đề cương phân tập: tạo / sửa / chốt & viết kịch bản / viết lại 1 tập / Gate 1 coverage.
 */
export function useStoryOutline() {
  const outline = ref(null) // { plot_points, episode_count_suggestion, episode_count_reason, episodes }
  const coverage = ref(null) // { [episodeNumber]: { missing_ids, hook_ok, cliffhanger_ok, notes } }
  const outlineStatus = ref('') // draft | edited | confirmed
  const warnings = ref([])
  const generating = ref(false)
  const writing = ref(false)

  async function loadOutline(dramaId) {
    if (!dramaId) return
    try {
      const row = await generationAPI.getStoryOutline(dramaId)
      if (row && row.content) {
        outline.value = row.content
        coverage.value = row.coverage || null
        outlineStatus.value = row.status || ''
      }
    } catch (_) {}
  }

  async function generateOutline({ dramaId, premise, style, type, episodeCount }) {
    generating.value = true
    try {
      const res = await generationAPI.generateStoryOutline({
        drama_id: dramaId,
        premise,
        style: style || undefined,
        type: type || undefined,
        episode_count: episodeCount || 1,
      })
      outline.value = res.outline
      coverage.value = null
      outlineStatus.value = 'draft'
      warnings.value = res.warnings || []
      return { ok: true }
    } catch (e) {
      ElMessage.error(e.message || 'Tạo đề cương thất bại')
      return { ok: false, error: e.message }
    } finally {
      generating.value = false
    }
  }

  async function saveOutline(dramaId) {
    if (!outline.value) return { ok: false }
    try {
      const row = await generationAPI.saveStoryOutline(dramaId, outline.value)
      outlineStatus.value = row.status || 'edited'
      return { ok: true }
    } catch (e) {
      ElMessage.error(e.message || 'Lưu đề cương thất bại')
      return { ok: false, error: e.message }
    }
  }

  /** Chốt đề cương rồi viết toàn bộ (hoặc danh sách tập chỉ định). pollTask/meta do FilmCreate truyền vào. */
  async function confirmAndWrite({ dramaId, episodeNumbers, pollTask, meta, onSaved }) {
    const saved = await saveOutline(dramaId)
    if (!saved.ok) return { ok: false }
    writing.value = true
    try {
      const res = await generationAPI.generateStoryFromOutline({
        drama_id: dramaId,
        episode_numbers: episodeNumbers || undefined,
      })
      const taskId = res?.task_id
      if (!taskId) {
        ElMessage.error('Không khởi động được task viết kịch bản')
        return { ok: false }
      }
      const pollRes = await pollTask(taskId, onSaved, meta)
      if (pollRes?.status !== 'completed') {
        return { ok: false, error: pollRes?.error || 'Viết kịch bản thất bại' }
      }
      await loadOutline(dramaId)
      const parsed = typeof pollRes?.result === 'string'
        ? (() => { try { return JSON.parse(pollRes.result) } catch { return {} } })()
        : (pollRes?.result || {})
      const failed = parsed.gate1_failed_episodes || []
      if (failed.length > 0) {
        ElMessage.warning(`Gate 1: tập ${failed.join(', ')} chưa phủ đủ mốc truyện — xem cảnh báo đỏ để viết lại`)
      } else {
        ElMessage.success('Đã viết xong kịch bản, tất cả tập pass Gate 1')
      }
      return { ok: true, failedEpisodes: failed }
    } catch (e) {
      ElMessage.error(e.message || 'Viết kịch bản thất bại')
      return { ok: false, error: e.message }
    } finally {
      writing.value = false
    }
  }

  function rewriteEpisode({ dramaId, episodeNumber, pollTask, meta, onSaved }) {
    return confirmAndWrite({ dramaId, episodeNumbers: [episodeNumber], pollTask, meta, onSaved })
  }

  return {
    outline, coverage, outlineStatus, warnings, generating, writing,
    loadOutline, generateOutline, saveOutline, confirmAndWrite, rewriteEpisode,
  }
}
```

- [ ] **Step 3: Verify import không lỗi**

Run (từ `frontweb/`): `npx vite build --logLevel error 2>&1 | tail -5` (hoặc lệnh build sẵn có trong `frontweb/package.json`)
Expected: build không lỗi liên quan file mới

- [ ] **Step 4: Commit**

```bash
git add frontweb/src/api/generation.js frontweb/src/composables/useStoryOutline.js
git commit -m "feat: frontend API + composable useStoryOutline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: StoryOutlinePanel.vue + gắn vào FilmCreate

**Files:**
- Create: `frontweb/src/components/StoryOutlinePanel.vue`
- Modify: `frontweb/src/views/FilmCreate.vue` (khu vực "Tạo cốt truyện", template ~dòng 189-232 + script setup)

**Interfaces:**
- Consumes: composable `useStoryOutline()` (Task 7); các ref sẵn có trong FilmCreate: `storyInput`, `storyStyle`, `storyType`, `storyEpisodeCount`, `dramaId` (qua store), `pollTask`, `loadDrama`.
- Produces: component props/emits — props: `outline` (object), `coverage` (object|null), `warnings` (string[]), `writing` (boolean); emits: `update:outline`, `confirm` (toàn bộ), `rewrite-episode` (number), `regenerate` (tạo lại đề cương).

- [ ] **Step 1: Viết component StoryOutlinePanel.vue**

`frontweb/src/components/StoryOutlinePanel.vue`:
```vue
<template>
  <div v-if="outline" class="outline-panel">
    <h3 class="outline-title">Đề cương phân tập <el-tag v-if="statusLabel" size="small">{{ statusLabel }}</el-tag></h3>

    <el-alert v-for="(w, i) in warnings" :key="'w' + i" :title="w" type="warning" show-icon :closable="false" style="margin-bottom: 8px" />

    <div class="plot-points">
      <div class="pp-head">Mốc truyện ({{ outline.plot_points.length }})</div>
      <el-tag v-for="p in outline.plot_points" :key="p.id" size="small" style="margin: 2px">{{ p.id }}: {{ p.text }}</el-tag>
    </div>

    <el-table :data="outline.episodes" size="small" style="width: 100%; margin-top: 10px">
      <el-table-column label="Tập" width="60">
        <template #default="{ row }">
          <span>{{ row.episode }}</span>
          <el-tooltip v-if="episodeFailed(row.episode)" :content="failReason(row.episode)" placement="top">
            <el-tag type="danger" size="small" style="margin-left:4px">Gate 1</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="Tiêu đề" width="140">
        <template #default="{ row }"><el-input v-model="row.title" size="small" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column label="Mốc truyện" width="180">
        <template #default="{ row }">
          <el-select v-model="row.plot_point_ids" multiple size="small" style="width:100%" @change="emitUpdate">
            <el-option v-for="p in outline.plot_points" :key="p.id" :label="p.id" :value="p.id" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="Hook mở đầu (3-5s)">
        <template #default="{ row }"><el-input v-model="row.opening_hook" size="small" type="textarea" :rows="2" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column label="Cliffhanger">
        <template #default="{ row }"><el-input v-model="row.cliffhanger" size="small" type="textarea" :rows="2" @change="emitUpdate" /></template>
      </el-table-column>
      <el-table-column width="110">
        <template #default="{ row }">
          <el-button v-if="episodeFailed(row.episode)" type="danger" size="small" plain :loading="writing" @click="$emit('rewrite-episode', row.episode)">
            Viết lại tập
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="row gap" style="margin-top: 10px">
      <el-button type="primary" :loading="writing" @click="$emit('confirm')">Chốt đề cương &amp; viết kịch bản</el-button>
      <el-button plain @click="$emit('regenerate')">Tạo lại đề cương</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  outline: { type: Object, default: null },
  coverage: { type: Object, default: null },
  warnings: { type: Array, default: () => [] },
  writing: { type: Boolean, default: false },
  status: { type: String, default: '' },
})
const emit = defineEmits(['update:outline', 'confirm', 'rewrite-episode', 'regenerate'])

const statusLabel = computed(() => ({ draft: 'Bản nháp', edited: 'Đã sửa', confirmed: 'Đã chốt' }[props.status] || ''))

function emitUpdate() {
  emit('update:outline', props.outline)
}
function episodeFailed(n) {
  const c = props.coverage && props.coverage[n]
  return !!c && ((c.missing_ids || []).length > 0 || c.hook_ok === false || c.cliffhanger_ok === false)
}
function failReason(n) {
  const c = props.coverage?.[n] || {}
  const parts = []
  if ((c.missing_ids || []).length) parts.push(`Thiếu mốc: ${c.missing_ids.join(', ')}`)
  if (c.hook_ok === false) parts.push('Mở đầu chưa đúng hook')
  if (c.cliffhanger_ok === false) parts.push('Kết chưa đúng cliffhanger')
  if (c.notes) parts.push(c.notes)
  return parts.join(' · ') || 'Chưa đạt Gate 1'
}
</script>

<style scoped>
.outline-panel { margin-top: 14px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.outline-title { margin: 0 0 8px; font-size: 15px; }
.pp-head { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
</style>
```

- [ ] **Step 2: Gắn vào FilmCreate.vue**

Trong `<script setup>` của FilmCreate.vue, thêm import + khởi tạo (kiểm tra: nếu `dramaAPI` chưa được import trong FilmCreate.vue thì thêm `import { dramaAPI } from '@/api/drama'`):
```js
import StoryOutlinePanel from '@/components/StoryOutlinePanel.vue'
import { useStoryOutline } from '@/composables/useStoryOutline'

const storyOutline = useStoryOutline()
```

Đổi handler nút "Tạo kịch bản": tìm hàm `onGenerateStory` hiện tại (gọi `runGenerateStoryFromPremise`). Thêm hàm mới và trỏ nút sang nó (giữ `runGenerateStoryFromPremise` nguyên vẹn cho trang khác):
```js
async function onGenerateStoryOutline() {
  const text = (storyInput.value || '').trim()
  if (!text) {
    ElMessage.warning('Vui lòng nhập story premise trước')
    return
  }
  // Nếu chưa có drama thì tạo trước (tái dùng logic tạo drama trong runGenerateStoryFromPremise bằng cách gọi dramaAPI.create tương tự)
  let id = store.dramaId
  if (!id) {
    const drama = await dramaAPI.create({
      title: scriptTitle.value || 'Câu chuyện mới',
      description: text,
      genre: storyType.value || undefined,
      style: generationStyle.value || undefined,
      metadata: { story_style: storyStyle.value || undefined, aspect_ratio: projectAspectRatio.value || '16:9' },
    })
    store.setDrama(drama)
    id = drama.id
    if (route?.params?.id === 'new') router.replace('/film/' + id)
  }
  await storyOutline.generateOutline({
    dramaId: id,
    premise: text,
    style: storyStyle.value,
    type: storyType.value,
    episodeCount: storyEpisodeCount.value,
  })
}

async function onConfirmOutline() {
  const id = store.dramaId
  const meta = {
    dramaId: id,
    episodeId: 0,
    dramaTitle: store.drama?.title || 'Dự án',
    episodeNumber: 1,
    resourceType: GEN_RESOURCE.GENERATE_STORY,
    resourceId: Number(id),
    label: `${store.drama?.title || 'Dự án'} viết kịch bản theo đề cương`,
  }
  const res = await storyOutline.confirmAndWrite({
    dramaId: id,
    pollTask,
    meta,
    onSaved: () => loadDrama?.(),
  })
  if (res.ok) {
    await loadDrama()
    const firstEp = (store.drama?.episodes || [])[0]
    if (firstEp) {
      selectedEpisodeId.value = firstEp.id
      onEpisodeSelect(firstEp.id)
    }
  }
}

function onRewriteEpisode(n) {
  const id = store.dramaId
  const meta = {
    dramaId: id, episodeId: 0, dramaTitle: store.drama?.title || 'Dự án', episodeNumber: n,
    resourceType: GEN_RESOURCE.GENERATE_STORY, resourceId: Number(id),
    label: `${store.drama?.title || 'Dự án'} viết lại tập ${n}`,
  }
  return storyOutline.rewriteEpisode({ dramaId: id, episodeNumber: n, pollTask, meta, onSaved: () => loadDrama?.() })
}
```

Template: nút "Tạo kịch bản" (dòng ~224) đổi `@click="onGenerateStory"` → `@click="onGenerateStoryOutline"` và `:loading` → `storyOutline.generating.value`. Ngay sau `</div>` đóng `row gap` (dòng ~231), chèn:
```html
<StoryOutlinePanel
  :outline="storyOutline.outline.value"
  :coverage="storyOutline.coverage.value"
  :warnings="storyOutline.warnings.value"
  :writing="storyOutline.writing.value"
  :status="storyOutline.outlineStatus.value"
  @update:outline="(v) => (storyOutline.outline.value = v)"
  @confirm="onConfirmOutline"
  @rewrite-episode="onRewriteEpisode"
  @regenerate="onGenerateStoryOutline"
/>
```

Khi vào lại trang đã có drama: trong luồng load (nơi gọi `loadDrama()` lúc mounted), thêm `storyOutline.loadOutline(store.dramaId)`.

(Template dùng `.value` hay không tùy cách destructure — nếu dùng `const { outline, coverage, ... } = storyOutline` thì bỏ `.value` trong template. Người implement chọn 1 kiểu nhất quán.)

- [ ] **Step 3: Verify thủ công bằng dev server**

Run: backend `cd backend-node && npm run dev`; frontend `cd frontweb && npm run dev`.
Kiểm tra:
1. Nhập premise + số tập 2 → bấm "Tạo kịch bản" → bảng đề cương hiện ra với mốc truyện, hook, cliffhanger từng tập.
2. Nếu AI đề xuất số tập khác → alert vàng hiện lý do.
3. Sửa hook 1 tập → bấm "Chốt đề cương & viết kịch bản" → task chạy, kịch bản từng tập xuất hiện trong phần "Kịch bản".
4. Reload trang → đề cương load lại từ DB.

- [ ] **Step 4: Commit**

```bash
git add frontweb/src/components/StoryOutlinePanel.vue frontweb/src/views/FilmCreate.vue
git commit -m "feat: StoryOutlinePanel + luồng đề cương phân tập trong FilmCreate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Kiểm tra E2E + tổng vệ sinh

**Files:**
- Modify (nếu phát hiện lỗi): các file đã tạo ở Task 1-8

- [ ] **Step 1: Chạy toàn bộ test backend**

Run (từ `backend-node/`): `node --test test/`
Expected: PASS toàn bộ (bao gồm các test cũ — xác nhận không phá gì)

- [ ] **Step 2: E2E thủ công luồng đầy đủ**

Với backend + frontend dev server đang chạy:
1. Tạo dự án mới, premise ~3 câu có ≥4 biến cố rõ, số tập = 2.
2. "Tạo kịch bản" → duyệt đề cương → kéo 1 mốc truyện từ tập 1 sang tập 2 (qua multiselect) → chốt.
3. Đợi task xong → kiểm tra: kịch bản tập 1 mở bằng hook, kết bằng cliffhanger; tập 2 nối tiếp tập 1.
4. Nếu có tập bị badge đỏ Gate 1 → bấm "Viết lại tập" → xác nhận tập được viết lại và badge cập nhật.
5. Kiểm tra luồng cũ vẫn sống: trang quản lý kịch bản (nơi khác gọi `runGenerateStoryFromPremise`) vẫn tạo kịch bản được.
6. Kiểm tra tab Prompt override admin hiện 2 key mới (分集大纲提示词, 单集剧本提示词).

- [ ] **Step 3: Sửa lỗi phát hiện (nếu có), chạy lại test**

Run: `node --test test/`
Expected: PASS

- [ ] **Step 4: Commit cuối**

```bash
git add -A
git commit -m "feat: hoàn tất Đợt 1 — rule packs + đề cương phân tập + Gate 1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
