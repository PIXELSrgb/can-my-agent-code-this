const $ = (id) => document.getElementById(id);

const form = $('scanForm');
const input = $('repoInput');
const button = $('scanBtn');
const statusEl = $('status');
const resultEl = $('result');

const CATEGORIES = [
  { key: 'instructions', name: 'Agent instructions', max: 20, detail: 'Repo-specific guidance for coding agents' },
  { key: 'docs', name: 'Documentation', max: 15, detail: 'README, contributing guide and deeper docs' },
  { key: 'tests', name: 'Tests & verification', max: 20, detail: 'Signals that changes can be checked automatically' },
  { key: 'automation', name: 'CI automation', max: 15, detail: 'GitHub Actions or equivalent workflow automation' },
  { key: 'clarity', name: 'Project clarity', max: 15, detail: 'Manifest, lockfile, license and environment examples' },
  { key: 'workflow', name: 'Safe change workflow', max: 15, detail: 'PR templates, ownership, security and issue guidance' },
];

function normalizeRepo(value) {
  value = value.trim().replace(/\.git$/, '').replace(/\/$/, '');
  try {
    if (/^https?:\/\//i.test(value)) {
      const u = new URL(value);
      if (!/github\.com$/i.test(u.hostname)) return null;
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
  } catch (_) {}
  const match = value.match(/^(?:github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

const hasAny = (paths, predicates) => paths.some(path => predicates.some(p => typeof p === 'string' ? path === p : p.test(path)));
const countAny = (paths, regex) => paths.filter(p => regex.test(p)).length;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 && remaining === '0') throw new Error('GitHub rate limit hit. Try again later or from another network.');
    if (res.status === 404) throw new Error('Repo not found. It must be public.');
    throw new Error(`GitHub returned ${res.status}. Try again.`);
  }
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  return res.ok ? res.text() : '';
}

function analyze(meta, tree, packageJsonText = '', pyprojectText = '') {
  const paths = tree.map(n => n.path.toLowerCase());
  const files = new Set(paths);
  const has = p => files.has(p.toLowerCase());
  const starts = p => paths.some(x => x.startsWith(p.toLowerCase()));

  const agentFiles = ['agents.md','claude.md','gemini.md','.github/copilot-instructions.md','.cursorrules','.windsurfrules'].filter(has);
  const cursorRules = paths.filter(p => p.startsWith('.cursor/rules/') || p === '.cursor/rules').length;
  const agentCount = agentFiles.length + (cursorRules ? 1 : 0);
  const hasReadme = paths.some(p => /^readme(?:\.[a-z0-9]+)?$/i.test(p));
  const hasContrib = hasAny(paths, ['contributing.md', /^docs\/contributing/i, /^\.github\/contributing/i]);
  const hasDocs = starts('docs/') || starts('documentation/');
  const testFiles = countAny(paths, /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i);
  const hasTestDir = testFiles > 0;
  let hasTestScript = false, scriptCount = 0;
  try {
    if (packageJsonText) {
      const pkg = JSON.parse(packageJsonText);
      const scripts = pkg.scripts || {};
      scriptCount = Object.keys(scripts).length;
      hasTestScript = Boolean(scripts.test || scripts['test:unit'] || scripts['test:ci'] || scripts.check || scripts.verify);
    }
  } catch (_) {}
  const pyTestSignal = /pytest|unittest|tox|nox/i.test(pyprojectText);
  const hasTests = hasTestDir || hasTestScript || pyTestSignal;
  const workflowCount = paths.filter(p => /^\.github\/workflows\/[^/]+\.(ya?ml)$/i.test(p)).length;
  const hasCI = workflowCount > 0 || has('.gitlab-ci.yml') || has('circle.yml') || has('.circleci/config.yml') || has('azure-pipelines.yml');
  const manifest = hasAny(paths, ['package.json','pyproject.toml','cargo.toml','go.mod','pom.xml','build.gradle','build.gradle.kts','composer.json','gemfile','mix.exs','deno.json','deno.jsonc']);
  const lockfile = hasAny(paths, ['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb','cargo.lock','poetry.lock','uv.lock','composer.lock','gemfile.lock']);
  const license = Boolean(meta.license) || hasAny(paths, [/^license(?:\.[a-z0-9]+)?$/i, /^copying(?:\.[a-z0-9]+)?$/i]);
  const envExample = hasAny(paths, ['.env.example','.env.sample','.env.template','example.env']);
  const prTemplate = hasAny(paths, [/^\.github\/pull_request_template\.md$/i, /^\.github\/pull_request_template\//i, /^docs\/pull_request_template\.md$/i]);
  const codeowners = hasAny(paths, ['.github/codeowners','codeowners','docs/codeowners']);
  const security = hasAny(paths, ['security.md','.github/security.md']);
  const issueTemplates = starts('.github/issue_template/');

  const scores = {};
  scores.instructions = Math.min(20, agentCount ? 12 + Math.min(8, (agentCount - 1) * 4) : 0);
  scores.docs = (hasReadme ? 7 : 0) + (hasContrib ? 4 : 0) + (hasDocs ? 4 : 0);
  scores.tests = (hasTests ? 14 : 0) + (hasTestScript ? 3 : 0) + (testFiles >= 5 ? 3 : testFiles ? 1 : 0);
  scores.automation = hasCI ? Math.min(15, 10 + Math.min(5, workflowCount)) : 0;
  scores.clarity = (manifest ? 4 : 0) + (lockfile ? 4 : 0) + (license ? 4 : 0) + (envExample ? 3 : 0);
  scores.workflow = (prTemplate ? 4 : 0) + (codeowners ? 4 : 0) + (security ? 4 : 0) + (issueTemplates ? 3 : 0);

  const score = Math.max(0, Math.min(100, Object.values(scores).reduce((a,b)=>a+b,0)));
  const grade = score >= 92 ? 'S' : score >= 82 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  const verdict = score >= 90 ? 'Your agent will feel at home.' : score >= 78 ? 'Looks agent-friendly.' : score >= 62 ? 'Usable, but expect hand-holding.' : score >= 45 ? 'Your agent will be guessing.' : 'Good luck, little agent.';

  const details = {
    instructions: agentCount ? `${agentCount} agent-instruction signal${agentCount === 1 ? '' : 's'} found` : 'No AGENTS.md or tool-specific instructions found',
    docs: [hasReadme && 'README', hasContrib && 'CONTRIBUTING', hasDocs && 'docs/'].filter(Boolean).join(' · ') || 'Thin documentation signals',
    tests: hasTests ? `${testFiles} test-path signal${testFiles === 1 ? '' : 's'}${hasTestScript ? ' + runnable test/check script' : ''}` : 'No obvious automated test signal',
    automation: hasCI ? `${workflowCount || 1} CI workflow signal${workflowCount === 1 ? '' : 's'}` : 'No CI workflow detected',
    clarity: [manifest && 'manifest', lockfile && 'lockfile', license && 'license', envExample && 'env example'].filter(Boolean).join(' · ') || 'Few project setup signals',
    workflow: [prTemplate && 'PR template', codeowners && 'CODEOWNERS', security && 'SECURITY', issueTemplates && 'issue templates'].filter(Boolean).join(' · ') || 'Few guardrails for safe changes',
  };

  const fixes = [];
  if (!agentCount) fixes.push({impact: '+12 pts', title: 'Add an AGENTS.md', body: 'Tell coding agents how to install, test, lint, build, and what they must not change.'});
  if (!hasTests) fixes.push({impact: '+14 pts', title: 'Make verification obvious', body: 'Add automated tests or one canonical check command an agent can run after edits.'});
  if (!hasCI) fixes.push({impact: '+10 pts', title: 'Add CI', body: 'Run your tests/lint on pull requests so agent changes get an automatic reality check.'});
  if (!hasContrib) fixes.push({impact: '+4 pts', title: 'Add CONTRIBUTING.md', body: 'Document the expected local workflow, coding conventions, and PR requirements.'});
  if (!lockfile && manifest) fixes.push({impact: '+4 pts', title: 'Commit a lockfile', body: 'Give agents deterministic dependencies instead of letting installs drift.'});
  if (!prTemplate) fixes.push({impact: '+4 pts', title: 'Add a PR template', body: 'Force every change to state what changed and which checks were run.'});
  if (!codeowners) fixes.push({impact: '+4 pts', title: 'Add CODEOWNERS', body: 'Make ownership and review boundaries machine-readable.'});
  if (!security) fixes.push({impact: '+4 pts', title: 'Add SECURITY.md', body: 'Give both humans and agents a safe path for security-sensitive findings.'});

  return { score, grade, verdict, scores, details, fixes: fixes.slice(0,5), agentCount, workflowCount, testCount: testFiles + (hasTestScript ? 1 : 0), scriptCount };
}

function render(repo, meta, analysis) {
  $('repoLabel').textContent = repo;
  $('verdict').textContent = analysis.verdict;
  $('summary').textContent = `${meta.description || 'No repository description.'} ${meta.stargazers_count.toLocaleString()}★ · ${meta.language || 'mixed'} · updated ${new Date(meta.updated_at).toLocaleDateString()}.`;
  $('score').textContent = analysis.score;
  $('scoreRing').style.setProperty('--score', analysis.score);
  $('grade').textContent = analysis.grade;
  $('agentDocsCount').textContent = analysis.agentCount;
  $('workflowCount').textContent = analysis.workflowCount;
  $('testCount').textContent = analysis.testCount;
  const strong = CATEGORIES.filter(c => analysis.scores[c.key] / c.max >= .75).length;
  $('signalCount').textContent = `${strong}/6 strong`;
  $('checks').innerHTML = CATEGORIES.map(c => {
    const points = analysis.scores[c.key]; const ratio = points / c.max;
    const state = ratio >= .75 ? 'good' : ratio >= .4 ? 'mid' : 'bad';
    const icon = state === 'good' ? '✓' : state === 'mid' ? '~' : '×';
    return `<div class="check"><span class="check-icon ${state}">${icon}</span><div><strong>${c.name}</strong><small>${escapeHtml(analysis.details[c.key])}</small></div><span class="points">${points}/${c.max}</span></div>`;
  }).join('');
  $('fixes').innerHTML = analysis.fixes.length ? analysis.fixes.map(f => `<div class="fix"><div class="fix-top"><strong>${escapeHtml(f.title)}</strong><span class="impact">${f.impact}</span></div><p>${escapeHtml(f.body)}</p></div>`).join('') : `<div class="all-good"><strong>Nothing obvious is missing.</strong><br>At this point, quality depends more on whether the instructions are accurate than whether the files exist.</div>`;
  resultEl.classList.remove('hidden');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(s='') { return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

async function scan(repo) {
  button.disabled = true; button.textContent = 'SCANNING…'; statusEl.textContent = 'Reading public repo structure…';
  resultEl.classList.add('hidden');
  try {
    const meta = await getJson(`https://api.github.com/repos/${repo}`);
    statusEl.textContent = `Found ${meta.full_name}. Mapping the default branch…`;
    const branch = encodeURIComponent(meta.default_branch);
    const treeData = await getJson(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`);
    if (treeData.truncated) statusEl.textContent = 'Large repo: GitHub truncated the tree, so this score is approximate.';
    const tree = treeData.tree || [];
    const lower = new Set(tree.map(x => x.path.toLowerCase()));
    const rawBase = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(meta.default_branch)}`;
    const packagePromise = lower.has('package.json') ? getText(`${rawBase}/package.json`) : Promise.resolve('');
    const pyprojectPromise = lower.has('pyproject.toml') ? getText(`${rawBase}/pyproject.toml`) : Promise.resolve('');
    const [packageText, pyprojectText] = await Promise.all([packagePromise, pyprojectPromise]);
    const analysis = analyze(meta, tree, packageText, pyprojectText);
    render(repo, meta, analysis);
    statusEl.textContent = treeData.truncated ? 'Done — approximate because GitHub truncated this very large repo.' : '';
    history.replaceState(null, '', `${location.pathname}?repo=${encodeURIComponent(repo)}`);
    window.__lastAudit = { repo, meta, analysis };
  } catch (err) { statusEl.textContent = err.message || 'Something went wrong.'; }
  finally { button.disabled = false; button.textContent = 'SCAN REPO'; }
}

form.addEventListener('submit', e => { e.preventDefault(); const repo = normalizeRepo(input.value); if (!repo) { statusEl.textContent = 'Use owner/repo or a github.com/owner/repo URL.'; return; } scan(repo); });
document.querySelectorAll('[data-repo]').forEach(btn => btn.addEventListener('click', () => { input.value = btn.dataset.repo; form.requestSubmit(); }));

$('copyAudit').addEventListener('click', async () => {
  const a = window.__lastAudit; if (!a) return;
  const lines = [`Can My Agent Code This? — ${a.repo}`, `${a.analysis.score}/100 · Grade ${a.analysis.grade} · ${a.analysis.verdict}`, ''];
  CATEGORIES.forEach(c => lines.push(`${c.name}: ${a.analysis.scores[c.key]}/${c.max} — ${a.analysis.details[c.key]}`));
  if (a.analysis.fixes.length) { lines.push('', 'Top fixes:'); a.analysis.fixes.forEach(f => lines.push(`- ${f.title} (${f.impact})`)); }
  await copy(lines.join('\n'), $('copyAudit'), 'COPIED');
});
$('copyBadge').addEventListener('click', async () => { const a = window.__lastAudit; if (!a) return; const color = a.analysis.score >= 82 ? 'b7ff3c' : a.analysis.score >= 60 ? 'ffcc66' : 'ff6f7f'; const badge = `![Agent readiness](https://img.shields.io/badge/agent--ready-${a.analysis.score}%2F100-${color}?style=flat-square)`; await copy(badge, $('copyBadge'), 'BADGE COPIED'); });
$('shareResult').addEventListener('click', async () => { const a = window.__lastAudit; if (!a) return; const url = new URL(location.href); url.searchParams.set('repo', a.repo); await copy(url.toString(), $('shareResult'), 'LINK COPIED'); });
async function copy(text, btn, label) { try { await navigator.clipboard.writeText(text); } catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } const old = btn.textContent; btn.textContent = label; setTimeout(() => btn.textContent = old, 1200); }
const initial = new URLSearchParams(location.search).get('repo');
if (initial) { const repo = normalizeRepo(initial); if (repo) { input.value = repo; setTimeout(() => scan(repo), 250); } }
