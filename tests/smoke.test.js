const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const scoring = fs.readFileSync('scoring.js', 'utf8');

test('page contains the scanner controls and versioned v2 scoring script', () => {
  assert.match(html, /id="repoInput"/);
  assert.match(html, /id="scanForm"/);
  assert.match(html, /id="result"/);
  assert.match(html, /src="scoring\.js\?v=/);
  assert.match(html, /id="confidenceLabel"/);
  assert.match(html, /id="languageLabel"/);
  assert.match(html, /id="toolingLabel"/);
});

test('scanner never executes repository code', () => {
  assert.match(app, /api\.github\.com\/repos/);
  assert.match(app, /raw\.githubusercontent\.com/);
  assert.match(app, /\/languages/);
  assert.doesNotMatch(app, /\beval\s*\(/);
  assert.doesNotMatch(app, /new Function\s*\(/);
});

test('six explainable scoring categories remain present', () => {
  const categories = ['instructions', 'docs', 'tests', 'automation', 'clarity', 'workflow'];
  for (const category of categories) assert.match(scoring, new RegExp(`key: '${category}'`));
});
