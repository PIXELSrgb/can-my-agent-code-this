const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const scoring = fs.readFileSync('scoring.js', 'utf8');

test('page contains the scanner controls and v2 scoring script', () => {
  assert.match(html, /id="repoInput"/);
  assert.match(html, /id="scanForm"/);
  assert.match(html, /id="result"/);
  assert.match(html, /src="scoring\.js"/);
  assert.match(html, /id="confidenceLabel"/);
});

test('scanner never executes repository code', () => {
  assert.match(app, /api\.github\.com\/repos/);
  assert.match(app, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(app, /\beval\s*\(/);
  assert.doesNotMatch(app, /new Function\s*\(/);
});

test('six explainable scoring categories remain present', () => {
  const categories = ['instructions', 'docs', 'tests', 'automation', 'clarity', 'workflow'];
  for (const category of categories) assert.match(scoring, new RegExp(`key: '${category}'`));
});
