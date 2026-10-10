const $ = (id) => document.getElementById(id);
const { CATEGORIES, normalizeRepo, analyze } = AgentReadiness;

const form = $('scanForm');
const input = $('repoInput');
const button = $('scanBtn');
const statusEl = $('status');
const resultEl = $('result');

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 && remaining === '0') throw new Error('GitHub rate limit hit. Try again later or from another network.');
    if (res.status === 404) throw new Error('Repo not found. It must be public.');
    throw new Error(`GitHub returned ${res.status}. Try again.`);
  }
  return res.json();
}

async function getText(url) {
  try {
    const res = await fetch(url);
    return res.ok ? res.text() : '';
  } catch (_) {
    return '';
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function collectTexts(repo, branch, tree, primaryLanguage = '') {
  const pathMap = new Map(tree.map(n => [String(n.path || '').toLowerCase(), n.path]).filter(([, p]) => p));
  const wanted = new Set([
    'package.json', 'pyproject.toml', 'cargo.toml', 'readme.md', 'contributing.md',
    'agents.md', 'claude.md', 'gemini.md', '.github/copilot-instructions.md',
    'justfile', 'makefile', 'gnumakefile', 'taskfile.yml', 'taskfile.yaml',
  ]);

  const firstByBasename = basename => [...pathMap.keys()].find(p => p === basename || p.endsWith(`/${basename}`));
  const primary = String(primaryLanguage || '').toLowerCase();
  const ecosystemFiles = primary === 'rust' ? ['cargo.toml']
    : primary === 'go' ? ['go.mod']
    : primary === 'python' ? ['pyproject.toml']
    : ['cargo.toml', 'go.mod', 'pyproject.toml'];
  for (const basename of ecosystemFiles) {
    const found = firstByBasename(basename);
    if (found) wanted.add(found);
  }

  const nestedAgent = [...pathMap.keys()].find(p => /(^|\/)agents\.md$/.test(p));
  if (nestedAgent) wanted.add(nestedAgent);

  const texts = {};
  const rawBase = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}`;
  await Promise.all([...wanted].map(async lower => {
    const actual = pathMap.get(lower);
    if (!actual) return;
    texts[lower] = await getText(`${rawBase}/${encodePath(actual)}`);
  }));
  return texts;
}

function render(repo, meta, analysis) {
  $('repoLabel').textContent = repo;
  $('verdict').textContent = analysis.verdict;
  $('summary').textContent = `${meta.description || 'No repository description.'} ${Number(meta.stargazers_count || 0).toLocaleString()}★ · ${meta.language || 'mixed'} · updated ${new Date(meta.updated_at).toLocaleDateString()}.`;
  $('score').textContent = analysis.score;
  $('scoreRing').style.setProperty('--score', analysis.score);
  $('grade').textContent = analysis.grade;
  $('stackLabel').textContent = analysis.stack;
  $('stackLabel').title = analysis.stack;
  $('verifyLabel').textContent = compactCommand(analysis.verifyCommand);
  $('verifyLabel').title = analysis.verifyCommand;
  $('confidenceLabel').textContent = analysis.confidence;
  $('confidenceLabel').title = analysis.confidenceNote;

  const strong = CATEGORIES.filter(c => analysis.scores[c.key] / c.max >= 0.8).length;
  $('signalCount').textContent = `${strong}/6 strong`;

  $('checks').innerHTML = CATEGORIES.map(c => {
    const points = analysis.scores[c.key];
    const ratio = points / c.max;
    const state = ratio >= 0.8 ? 'good' : ratio >= 0.45 ? 'mid' : 'bad';
    const icon = state === 'good' ? '✓' : state === 'mid' ? '~' : '×';
    return `<div class="check"><span class="check-icon ${state}">${icon}</span><div><strong>${c.name}</strong><small>${escapeHtml(analysis.details[c.key])}</small></div><span class="points">${points}/${c.max}</span></div>`;
  }).join('');

  $('fixes').innerHTML = analysis.fixes.length
    ? analysis.fixes.map(f => `<div class="fix"><div class="fix-top"><strong>${escapeHtml(f.title)}</strong><span class="impact">${f.impact}</span></div><p>${escapeHtml(f.body)}</p></div>`).join('')
    : `<div class="all-good"><strong>No structural gaps detected.</strong><br>This repo hits every v2 readiness signal. The remaining question is whether its instructions and tests are actually accurate.</div>`;

  $('confidenceNote').textContent = analysis.confidenceNote;
  resultEl.classList.remove('hidden');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function compactCommand(command) {
  if (!command || command === 'Not detected') return 'Not detected';
  return command.length > 18 ? `${command.slice(0, 16)}…` : command;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

async function scan(repo) {
  button.disabled = true;
  button.textContent = 'SCANNING…';
  statusEl.textContent = 'Reading public repo structure…';
  resultEl.classList.add('hidden');

  try {
    const meta = await getJson(`https://api.github.com/repos/${repo}`);
    statusEl.textContent = `Found ${meta.full_name}. Mapping ${meta.default_branch}…`;
    const branch = encodeURIComponent(meta.default_branch);
    const treeData = await getJson(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`);
    const tree = treeData.tree || [];
    statusEl.textContent = 'Detecting stack, verification, CI and guardrails…';
    const texts = await collectTexts(repo, meta.default_branch, tree, meta.language);
    const analysis = analyze(meta, tree, texts, { truncated: Boolean(treeData.truncated) });

    render(repo, meta, analysis);
    statusEl.textContent = treeData.truncated ? 'Done — medium confidence because GitHub truncated this very large repo tree.' : '';
    history.replaceState(null, '', `${location.pathname}?repo=${encodeURIComponent(repo)}`);
    window.__lastAudit = { repo, meta, analysis };
  } catch (err) {
    statusEl.textContent = err.message || 'Something went wrong.';
  } finally {
    button.disabled = false;
    button.textContent = 'SCAN REPO';
  }
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const repo = normalizeRepo(input.value);
  if (!repo) {
    statusEl.textContent = 'Use owner/repo or a github.com/owner/repo URL.';
    return;
  }
  scan(repo);
});

document.querySelectorAll('[data-repo]').forEach(btn => btn.addEventListener('click', () => {
  input.value = btn.dataset.repo;
  form.requestSubmit();
}));

$('copyAudit').addEventListener('click', async () => {
  const a = window.__lastAudit;
  if (!a) return;
  const lines = [
    `Can My Agent Code This? — ${a.repo}`,
    `${a.analysis.score}/100 · Grade ${a.analysis.grade} · ${a.analysis.verdict}`,
    `Stack: ${a.analysis.stack} · Verify: ${a.analysis.verifyCommand} · Confidence: ${a.analysis.confidence}`,
    '',
  ];
  CATEGORIES.forEach(c => lines.push(`${c.name}: ${a.analysis.scores[c.key]}/${c.max} — ${a.analysis.details[c.key]}`));
  if (a.analysis.fixes.length) {
    lines.push('', 'Top fixes:');
    a.analysis.fixes.forEach(f => lines.push(`- ${f.title} (${f.impact})`));
  }
  lines.push('', 'Heuristic readiness audit — not a benchmark of code quality or agent success rate.');
  await copy(lines.join('\n'), $('copyAudit'), 'COPIED');
});

$('copyBadge').addEventListener('click', async () => {
  const a = window.__lastAudit;
  if (!a) return;
  const color = a.analysis.score >= 85 ? 'b7ff3c' : a.analysis.score >= 60 ? 'ffcc66' : 'ff6f7f';
  const badge = `![Agent readiness](https://img.shields.io/badge/agent--ready-${a.analysis.score}%2F100-${color}?style=flat-square)`;
  await copy(badge, $('copyBadge'), 'BADGE COPIED');
});

$('shareResult').addEventListener('click', async () => {
  const a = window.__lastAudit;
  if (!a) return;
  const url = new URL(location.href);
  url.searchParams.set('repo', a.repo);
  await copy(url.toString(), $('shareResult'), 'LINK COPIED');
});

async function copy(text, btn, label) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

const initial = new URLSearchParams(location.search).get('repo');
if (initial) {
  input.value = initial;
  const repo = normalizeRepo(initial);
  if (repo) scan(repo);
}
