const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');

test('page contains the scanner controls', () => {
  assert.match(html, /id="repoInput"/);
  assert.match(html, /id="scanForm"/);
  assert.match(html, /id="result"/);
});

test('scanner never executes repository code', () => {
  assert.match(js, /api\.github\.com\/repos/);
  assert.match(js, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(js, /\beval\s*\(/);
  assert.doesNotMatch(js, /new Function\s*\(/);
});

test('six explainable scoring categories remain present', () => {
  const categories = ['instructions', 'docs', 'tests', 'automation', 'clarity', 'workflow'];
  for (const category of categories) assert.match(js, new RegExp(`key: '${category}'`));
});
