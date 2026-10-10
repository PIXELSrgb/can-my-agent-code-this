const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, normalizeRepo } = require('../scoring.js');

const meta = { license: { key: 'mit' } };
const nodes = paths => paths.map(path => ({ path, type: 'blob' }));

test('normalizes GitHub repo input', () => {
  assert.equal(normalizeRepo('https://github.com/facebook/react.git'), 'facebook/react');
  assert.equal(normalizeRepo('openai/codex'), 'openai/codex');
  assert.equal(normalizeRepo('https://gitlab.com/a/b'), null);
});

test('a genuinely complete Node repo can earn 100', () => {
  const tree = nodes([
    'README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'docs/scoring.md',
    'package.json', 'package-lock.json', 'LICENSE',
    'tests/scoring.test.js', '.github/workflows/ci.yml', '.github/workflows/pages.yml',
    '.github/pull_request_template.md', '.github/CODEOWNERS', 'SECURITY.md',
    '.github/ISSUE_TEMPLATE/bug.yml', '.github/dependabot.yml'
  ]);
  const texts = {
    'package.json': JSON.stringify({
      scripts: { test: 'node --test', lint: 'node --check app.js', check: 'npm run lint && npm test' },
      engines: { node: '>=22' },
    }),
    'agents.md': '# Rules\nNever execute scanned code.\n## Run\nnpm test\n## Verify\nnpm run check',
  };
  const result = analyze(meta, tree, texts);
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'S');
  assert.equal(result.fixes.length, 0);
});

test('mature repos without agent-specific docs get fallback credit, not a zero', () => {
  const tree = nodes([
    'README.md', 'CONTRIBUTING.md', 'docs/architecture.md', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml',
    'tests/integration/test.rs', 'rustfmt.toml', '.github/workflows/ci.yml', '.github/workflows/test.yml',
    '.github/CODEOWNERS', 'SECURITY.md', '.github/ISSUE_TEMPLATE/bug.yml'
  ]);
  const result = analyze(meta, tree, { 'cargo.toml': '[package]\nname="x"' });
  assert.equal(result.scores.instructions, 6);
  assert.equal(result.verifyCommand, 'cargo test');
  assert.equal(result.scores.tests, 20);
});

test('large test suites are described cleanly instead of dumping raw path counts', () => {
  const paths = ['README.md','package.json','package-lock.json','LICENSE'];
  for (let i = 0; i < 100; i++) paths.push(`tests/case-${i}.test.js`);
  const result = analyze(meta, nodes(paths), { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) });
  assert.match(result.details.tests, /Extensive automated test suite/);
  assert.doesNotMatch(result.details.tests, /100 test-path/);
});

test('truncated repository trees lower confidence without lowering the score', () => {
  const tree = nodes(['README.md','package.json','package-lock.json','LICENSE']);
  const normal = analyze(meta, tree, { 'package.json': '{}' });
  const truncated = analyze(meta, tree, { 'package.json': '{}' }, { truncated: true });
  assert.equal(normal.score, truncated.score);
  assert.equal(truncated.confidence, 'Medium');
});
