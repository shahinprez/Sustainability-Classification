'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CODER_A_TOKEN = 'test-only-coder-a-strong-token-123456';
process.env.CODER_B_TOKEN = 'test-only-coder-b-strong-token-789012';
process.env.ADMIN_TOKEN = 'test-only-admin-strong-token-654321';

const { app, resolveCoder, validDimensions } = require('../server.js');

test('rejects missing, short, and unknown coder credentials', () => {
  assert.equal(resolveCoder(undefined), null);
  assert.equal(resolveCoder(''), null);
  assert.equal(resolveCoder('short'), null);
  assert.equal(resolveCoder('not-a-valid-key-with-enough-length'), null);
  assert.equal(resolveCoder(process.env.CODER_A_TOKEN).id, 'A');
});

test('validates labels and forbids mixing none with substantive labels', () => {
  assert.equal(validDimensions(['climate_action', 'biodiversity_protection']), true);
  assert.equal(validDimensions(['none']), true);
  assert.equal(validDimensions([]), false);
  assert.equal(validDimensions(['unknown']), false);
  assert.equal(validDimensions(['none', 'climate_action']), false);
  assert.equal(validDimensions(['climate_action', 'climate_action']), false);
});

test('protected endpoints reject unauthenticated requests and URL-based tokens', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const endpoint of ['/api/posts', '/api/disagreements']) {
      const missing = await fetch(base + endpoint);
      assert.equal(missing.status, 401);
      assert.equal(missing.headers.get('cache-control'), 'no-store');
      const urlToken = await fetch(base + endpoint + '?token=' + process.env.CODER_A_TOKEN);
      assert.equal(urlToken.status, 401);
    }

    const unauthorizedSave = await fetch(base + '/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: 'rec1234567890', imgDim: ['none'], capDim: ['none'], ovDim: ['none'] }),
    });
    assert.equal(unauthorizedSave.status, 401);

    const invalidSave = await fetch(base + '/api/save', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.CODER_A_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordId: 'rec1234567890', imgDim: ['none', 'climate_action'], capDim: ['none'], ovDim: ['none'] }),
    });
    assert.equal(invalidSave.status, 400);

    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('id="loginForm"'));
    assert.ok(!html.includes(process.env.CODER_A_TOKEN));

    const legacy = await fetch(base + '/?token=some-token', { redirect: 'manual' });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/');
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
