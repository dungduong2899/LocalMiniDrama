const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAgnesVideoImagePayload, formatVideoPostBodyForLog } = require('../src/services/videoClient');

describe('formatVideoPostBodyForLog', () => {
  it('keeps full http URLs and labels extra_body images with index', () => {
    const formatted = formatVideoPostBodyForLog({
      model: 'agnes-video-v2.0',
      prompt: 'test prompt',
      extra_body: {
        image: ['https://cdn/a.jpg', 'https://cdn/b.png'],
      },
    });
    assert.deepEqual(formatted.extra_body.image, [
      '[0] https://cdn/a.jpg',
      '[1] https://cdn/b.png',
    ]);
    assert.equal(formatted.prompt, 'test prompt');
  });

  it('summarizes base64 image fields', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    const formatted = formatVideoPostBodyForLog({ image: dataUrl });
    assert.match(formatted.image, /^\(base64, \d+ chars\)$/);
  });
});

describe('buildAgnesVideoImagePayload', () => {
  it('maps omni multi-reference (>=2 imgs) to keyframes mode with 2 images', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.png', 'https://cdn/c.png'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/a.jpg',
      lastResolved: 'https://cdn/z.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_as_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/a.jpg', 'https://cdn/c.png'],
    });
    assert.equal(out.image, undefined);
    assert.deepEqual(out.dropped_refs, ['https://cdn/b.png']);
  });

  it('keeps first + last only for exactly 2 omni refs (no dropped)', () => {
    const refs = ['https://cdn/scene.jpg', 'https://cdn/char.jpg'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'omni_reference_as_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/scene.jpg', 'https://cdn/char.jpg'],
    });
    assert.deepEqual(out.dropped_refs, []);
  });

  it('uses single top-level image string for one omni reference', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: ['https://cdn/scene.jpg'],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'omni_reference_single');
    assert.equal(out.image, 'https://cdn/scene.jpg');
  });

  it('uses extra_body keyframes for classic first/last (not omni)', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: 'https://cdn/first.jpg',
      lastResolved: 'https://cdn/last.jpg',
    });
    assert.equal(out.strategy, 'classic_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/first.jpg', 'https://cdn/last.jpg'],
    });
    assert.equal(out.image, undefined);
  });

  it('omni refs always take keyframes mode with exactly 2 images', () => {
    const refs = ['https://cdn/s.jpg', 'https://cdn/c.jpg'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/s.jpg',
      lastResolved: 'https://cdn/l.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_as_keyframes');
    assert.equal(out.extra_body.mode, 'keyframes');
    assert.equal(out.extra_body.image.length, 2);
  });

  it('falls back to text_only when no refs and no frames', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'text_only');
    assert.equal(out.image, undefined);
    assert.equal(out.extra_body, undefined);
  });
});
