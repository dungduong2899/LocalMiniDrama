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
