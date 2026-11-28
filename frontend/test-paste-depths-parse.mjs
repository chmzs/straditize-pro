import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePasteDepthsText } from './src/utils/pasteDepths.ts';

// 1. Valid, invalid, and duplicate depths are counted explicitly
const mixed = parsePasteDepthsText('10\nabc\n10\n20.5\n12xyz\n5.0\n\n');
assert.deepEqual(mixed.depths, [5, 10, 20.5]);
assert.equal(mixed.invalidCount, 2, 'abc and 12xyz should both be counted as invalid');
assert.equal(mixed.duplicateCount, 1, 'duplicate 10 should be counted');

// 2. Comma / semicolon delimiters work cleanly
const delimited = parsePasteDepthsText('30, 10; 20, 10');
assert.deepEqual(delimited.depths, [10, 20, 30]);
assert.equal(delimited.invalidCount, 0);
assert.equal(delimited.duplicateCount, 1);

// 3. Modal guard prevents stacking duplicate #txt-paste-depths modals
const panelSource = readFileSync(new URL('./src/components/steps/SamplesPanel.ts', import.meta.url), 'utf8');
assert.match(
  panelSource,
  /function openPasteDepthsModal[\s\S]*?if \(document\.querySelector\('#txt-paste-depths'\)\)/,
  'openPasteDepthsModal must guard against duplicate modals',
);

console.log('test-paste-depths-parse: all assertions passed');
