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
