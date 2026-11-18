import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spokenSummary } from '../server/src/lib/spoken-summary.js';

test('spoken summaries preserve the opening sentences and omit code, URLs and speech tags', () => {
  const reply = '# Build results\n\n```js\nconst token = "fixture";\n```\n\nThe build passed. [Open the preview](https://example.com). The full log follows. [sigh]';
  assert.equal(spokenSummary(reply), 'Build results The build passed. Open the preview.');
  assert.equal(spokenSummary('~~~js\nconst onlyCode = true;\n~~~'), '');
  assert.equal(spokenSummary('Done.'), 'Done.');
  assert.ok(spokenSummary('long '.repeat(200)).length <= 320);
});
