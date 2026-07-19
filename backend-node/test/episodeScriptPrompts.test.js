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
  it('system prompt demands strict JSON verdict and composes qc-gates pack', () => {
    const sys = promptI18n.getCoverageCheckSystemPrompt(cfgZh);
    assert.ok(sys.includes('"missing_ids"'));
    assert.ok(sys.includes('质检门规则'), 'tiêu chí Gate 1 phải đến từ pack qc-gates, không duplicate trong body');
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
