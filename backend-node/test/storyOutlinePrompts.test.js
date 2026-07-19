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
