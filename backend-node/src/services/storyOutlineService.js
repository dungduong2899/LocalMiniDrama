// 分集大纲：解析/校验/存取（AI 调用在 Task 4/6 补充）
const { safeParseAIJSON } = require('../utils/safeJson');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const loadConfig = require('../config').loadConfig;
const dramaService = require('./dramaService');
const taskService = require('./taskService');

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
  if (!dramaService.getDramaById(db, dramaId)) {
    throw new Error('项目不存在');
  }
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

function parseEpisodeScriptResponse(rawText, episodeNumber, log) {
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, {}, log); } catch (_) {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.content || parsed.title)) {
    return {
      title: String(parsed.title || `第${episodeNumber}集`).trim(),
      content: String(parsed.content || '').trim() || String(rawText || '').trim(),
    };
  }
  return { title: `第${episodeNumber}集`, content: String(rawText || '').trim() };
}

/**
 * Upsert 1 tập theo episode_number.
 * KHÔNG dùng dramaService.saveEpisodes ở đây — hàm đó xóa mềm mọi tập không nằm trong
 * danh sách gửi lên (dramaService.js:682-689), gọi từng tập sẽ xóa các tập còn lại.
 */
function upsertEpisode(db, dramaId, ep) {
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? ORDER BY deleted_at IS NOT NULL ASC, id ASC LIMIT 1'
  ).get(Number(dramaId), Number(ep.episode_number));
  if (existing) {
    db.prepare('UPDATE episodes SET title = ?, script_content = ?, deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(ep.title || '', ep.script_content ?? null, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, duration, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'draft', ?, ?)`
    ).run(Number(dramaId), Number(ep.episode_number), ep.title || '', ep.script_content ?? null, now, now);
  }
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
    const parsed = safeParseAIJSON(raw, {}, log);
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
    // prevTail của tập k lấy từ tập k-1 đã có trong DB (khi viết lại 1 tập) hoặc từ tập vừa viết trong vòng lặp.
    // Query bảng episodes trực tiếp — dramaService.getDramaById() KHÔNG kèm episodes (chỉ getDrama() mới có).
    const tailOf = (content) => String(content || '').slice(-400);
    function getScriptOf(episodeNumber) {
      const r = db.prepare(
        'SELECT script_content FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL'
      ).get(dramaId, episodeNumber);
      return r ? r.script_content : '';
    }

    for (let i = 0; i < targets.length; i++) {
      const ep = targets[i];
      const pct = 5 + Math.floor((i / targets.length) * 80);
      taskService.updateTaskStatus(db, taskId, 'processing', pct, `正在撰写第${ep.episode}集…`);

      if (i === 0 && ep.episode > 1) {
        prevTail = tailOf(getScriptOf(Number(ep.episode) - 1));
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
      upsertEpisode(db, dramaId, { episode_number: ep.episode, title: parsed.title || ep.title, script_content: parsed.content });
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

module.exports = {
  parseOutlineResponse,
  validateOutline,
  saveOutline,
  getOutline,
  saveCoverage,
  generateOutline,
  parseEpisodeScriptResponse,
  upsertEpisode,
  checkEpisodeCoverage,
  processEpisodesFromOutline,
  startEpisodesFromOutline,
};
