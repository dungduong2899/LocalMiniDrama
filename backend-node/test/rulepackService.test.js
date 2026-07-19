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
