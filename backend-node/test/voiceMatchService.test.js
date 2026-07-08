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
