const $ = (id) => document.getElementById(id);
const { CATEGORIES, normalizeRepo, analyze } = AgentReadiness;

const form = $('scanForm');
const input = $('repoInput');
const button = $('scanBtn');
const statusEl = $('status');
const resultEl = $('result');

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function getJson(url) {
  const res = await fetch(url, { headers: githubHeaders });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 && remaining === '0') throw new Error('GitHub rate limit hit. Try again later or from another network.');
    if (res.status === 404) throw new Error('Repo not found. It must be public.');
    throw new Error(`GitHub returned ${res.status}. Try again.`);
  }
  return res.json();
}

async function getOptionalJson(url) {
  try {
    const res = await fetch(url, { headers: githubHeaders });
    return res.ok ? res.json() : {};
  } catch (_) {
    return {};
  }
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

function formatLanguages(languages, fallback = 'Unknown') {
  const entries = Object.entries(languages || {})
    .filter(([, bytes]) => Number(bytes) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return { short: fallback || 'Unknown', full: fallback || 'Unknown' };

  const total = entries.reduce((sum, [, bytes]) => sum + Number(bytes), 0) || 1;
  const formatted = entries.map(([name, bytes]) => ({ name, pct: (Number(bytes) / total) * 100 }));
  const visible = formatted.filter((item, index) => index === 0 || item.pct >= 5).slice(0, 3);
  const full = formatted.slice(0, 6).map(item => `${item.name} ${item.pct.toFixed(item.pct >= 10 ? 0 : 1)}%`).join(' · ');
  const short = visible.map(item => `${item.name} ${item.pct.toFixed(item.pct >= 10 ? 0 : 1)}%`).join(' · ');
  return { short, full };
}

function formatTooling(stack = '') {
  const s = String(stack || '');
  const lower = s.toLowerCase();
  const bazel = lower.includes('bazel');
  if (lower.includes('rust') || lower.includes('cargo')) return bazel ? 'Cargo + Bazel' : 'Cargo';
  if (lower.includes('node')) return 'Node / npm';
  if (lower.includes('gradle')) return 'Gradle';
  if (lower.includes('maven')) return 'Maven';
  if (lower.includes('python')) return 'Python tooling';
  if (lower.includes('go')) return 'Go toolchain';
  if (lower.includes('ruby')) return 'Bundler / Rake';
  if (lower.includes('composer')) return 'Composer';
  if (lower.includes('elixir')) return 'Mix';
  if (lower.includes('cmake')) return 'CMake';
  if (bazel) return 'Bazel';
  return s.replace(/\s*\(multi-stack\)/gi, '').replace(/\s*\+\s*Bazel/gi, ' + Bazel') || 'Not detected';
}

function displayDetail(key, analysis, tooling) {
  if (key !== 'clarity') return analysis.details[key];
  return String(analysis.details[key] || '').replace(analysis.stack, tooling);
}

function render(repo, meta, analysis, languages) {
  const languageInfo = formatLanguages(languages, meta.language || 'Unknown');
  const tooling = formatTooling(analysis.stack);

  $('repoLabel').textContent = meta.full_name || repo;
  $('verdict').textContent = analysis.verdict;
  $('summary').textContent = `${meta.description || 'No repository description.'} ${Number(meta.stargazers_count || 0).toLocaleString()}★ · updated ${new Date(meta.updated_at).toLocaleDateString()}.`;
  $('score').textContent = analysis.score;
  $('scoreRing').style.setProperty('--score', analysis.score);
  $('grade').textContent = analysis.grade;
  $('languageLabel').textContent = languageInfo.short;
  $('languageLabel').title = `GitHub language breakdown: ${languageInfo.full}`;
  $('toolingLabel').textContent = `Tooling: ${tooling}`;
  $('toolingLabel').title = `Detected build/test ecosystem: ${tooling}`;
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
    const detail = displayDetail(c.key, analysis, tooling);
    return `<div class="check"><span class="check-icon ${state}">${icon}</span><div><strong>${c.name}</strong><small>${escapeHtml(detail)}</small></div><span class="points">${points}/${c.max}</span></div>`;
  }).join('');

  $('fixes').innerHTML = analysis.fixes.length
    ? analysis.fixes.map(f => `<div class="fix"><div class="fix-top"><strong>${escapeHtml(f.title)}</strong><span class="impact">${f.impact}</span></div><p>${escapeHtml(f.body)}</p></div>`).join('')
    : `<div class="all-good"><strong>No structural gaps detected.</strong><br>This repo hits every v2 readiness signal. The remaining question is whether its instructions and tests are actually accurate.</div>`;

  $('confidenceNote').textContent = `${analysis.confidenceNote} Language percentages come from GitHub Linguist's public language breakdown.`;
  resultEl.classList.remove('hidden');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return { languageInfo, tooling };
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
    const canonicalRepo = meta.full_name || repo;
    statusEl.textContent = `Found ${canonicalRepo}. Mapping ${meta.default_branch}…`;
    const branch = encodeURIComponent(meta.default_branch);
    const [treeData, languages] = await Promise.all([
      getJson(`https://api.github.com/repos/${canonicalRepo}/git/trees/${branch}?recursive=1`),
      getOptionalJson(`https://api.github.com/repos/${canonicalRepo}/languages`),
    ]);
    const tree = treeData.tree || [];
    statusEl.textContent = 'Detecting languages, tooling, verification, CI and guardrails…';
    const texts = await collectTexts(canonicalRepo, meta.default_branch, tree, meta.language);
    const analysis = analyze(meta, tree, texts, { truncated: Boolean(treeData.truncated) });

    const display = render(repo, meta, analysis, languages);
    statusEl.textContent = treeData.truncated ? 'Done — medium confidence because GitHub truncated this very large repo tree.' : '';
    history.replaceState(null, '', `${location.pathname}?repo=${encodeURIComponent(canonicalRepo)}`);
    window.__lastAudit = {
      repo: canonicalRepo,
      meta,
      analysis,
      languages,
      languageSummary: display.languageInfo.short,
      tooling: display.tooling,
    };
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
    `Languages: ${a.languageSummary} · Tooling: ${a.tooling} · Verify: ${a.analysis.verifyCommand} · Confidence: ${a.analysis.confidence}`,
    '',
  ];
  CATEGORIES.forEach(c => lines.push(`${c.name}: ${a.analysis.scores[c.key]}/${c.max} — ${displayDetail(c.key, a.analysis, a.tooling)}`));
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
