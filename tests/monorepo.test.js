const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, detectStack } = require('../scoring.js');

const nodes = paths => paths.map(path => ({ path, type: 'blob' }));
const meta = { license: { key: 'apache-2.0' }, language: 'Rust' };

test('primary GitHub language wins over sidecar package manifests', () => {
  const paths = ['package.json', 'pnpm-lock.yaml', 'codex-rs/Cargo.toml', 'codex-rs/Cargo.lock', 'BUILD.bazel', 'MODULE.bazel'];
  const stack = detectStack(paths.map(p => p.toLowerCase()), {}, {}, 'Rust');
  assert.equal(stack.id, 'rust');
  assert.match(stack.label, /^Rust \/ Cargo/);
});

test('Codex-like Rust monorepos detect just test as canonical verification', () => {
  const tree = nodes([
    'README.md', 'CONTRIBUTING.md', 'docs/architecture.md', 'package.json', 'pnpm-lock.yaml',
    'codex-rs/Cargo.toml', 'codex-rs/Cargo.lock', 'codex-rs/core/tests/suite/example.rs',
    'justfile', 'BUILD.bazel', 'MODULE.bazel', '.bazelversion',
    '.github/workflows/rust-ci.yml', '.github/workflows/repo-checks.yml',
    '.github/CODEOWNERS', 'SECURITY.md', '.github/ISSUE_TEMPLATE/bug.yml',
    'codex-rs/core/AGENTS.md'
  ]);
  const texts = {
    'package.json': JSON.stringify({ packageManager: 'pnpm@10' }),
    'codex-rs/cargo.toml': '[workspace]\n',
    'justfile': 'test *args:\n    cargo nextest run --no-fail-fast\n\nfmt-check:\n    cargo fmt --check\n',
    'codex-rs/core/agents.md': '# Verify\nRun just test.\n# Rules\nDo not weaken security checks.\n',
  };
  const result = analyze(meta, tree, texts);
  assert.match(result.stack, /^Rust \/ Cargo/);
  assert.equal(result.verifyCommand, 'just test');
  assert.equal(result.scores.tests, 20);
  assert.doesNotMatch(result.fixes.map(f => f.title).join(' '), /canonical verification/i);
});
