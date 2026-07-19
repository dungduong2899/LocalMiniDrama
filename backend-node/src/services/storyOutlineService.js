// 分集大纲：解析/校验/存取（AI 调用在 Task 4/6 补充）
const { safeParseAIJSON } = require('../utils/safeJson');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const loadConfig = require('../config').loadConfig;

function parseOutlineResponse(rawText, log) {
  let parsed = null;
  try {
    parsed = safeParseAIJSON(rawText, {}, log);
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

module.exports = { parseOutlineResponse, validateOutline, saveOutline, getOutline, saveCoverage, generateOutline };
