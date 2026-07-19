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
  );
  CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_number INTEGER,
    title TEXT,
    script_content TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
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
