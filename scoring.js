(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AgentReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CATEGORIES = [
    { key: 'instructions', name: 'Agent instructions', max: 20 },
    { key: 'docs', name: 'Documentation', max: 15 },
    { key: 'tests', name: 'Tests & verification', max: 20 },
    { key: 'automation', name: 'CI automation', max: 15 },
    { key: 'clarity', name: 'Project clarity', max: 15 },
    { key: 'workflow', name: 'Safe change workflow', max: 15 },
  ];

  function normalizeRepo(value) {
    value = String(value || '').trim().replace(/\.git$/, '').replace(/\/$/, '');
    try {
      if (/^https?:\/\//i.test(value)) {
        const u = new URL(value);
        if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
        const parts = u.pathname.split('/').filter(Boolean);
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
      }
    } catch (_) {}
    const match = value.match(/^(?:github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
    return match ? `${match[1]}/${match[2]}` : null;
  }

  function parsePackage(text) {
    try { return text ? JSON.parse(text) : {}; } catch (_) { return {}; }
  }

  function analyze(meta, tree, texts = {}, options = {}) {
    const entries = (tree || []).filter(Boolean);
    const originalPaths = entries.map(n => n.path || '').filter(Boolean);
    const paths = originalPaths.map(p => p.toLowerCase());
    const starts = p => paths.some(x => x.startsWith(p.toLowerCase()));
    const hasAny = predicates => paths.some(path => predicates.some(p => typeof p === 'string' ? path === p : p.test(path)));
    const countAny = regex => paths.filter(p => regex.test(p)).length;
    const text = p => texts[String(p).toLowerCase()] || '';
    const hasBasename = names => {
      const wanted = new Set(names.map(n => n.toLowerCase()));
      return paths.some(p => wanted.has(p.split('/').pop()));
    };

    const pkg = parsePackage(text('package.json'));
    const scripts = pkg.scripts || {};
    const scriptNames = Object.keys(scripts).map(s => s.toLowerCase());
    const packageManager = String(pkg.packageManager || '');
    const engines = pkg.engines || {};

    const stack = detectStack(paths, pkg, texts, meta && meta.language);
    const manifest = hasBasename([
      'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
      'composer.json', 'gemfile', 'mix.exs', 'deno.json', 'deno.jsonc', 'cmakelists.txt', 'module.bazel',
      'workspace', 'workspace.bazel'
    ]);
    const lockfile = hasBasename([
      'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'cargo.lock', 'poetry.lock',
      'uv.lock', 'composer.lock', 'gemfile.lock', 'go.sum', 'mix.lock', 'module.bazel.lock'
    ]);
    const license = Boolean(meta && meta.license) || hasAny([/^license(?:\.[a-z0-9]+)?$/i, /^copying(?:\.[a-z0-9]+)?$/i]);

    const agentPaths = originalPaths.filter(p => {
      const l = p.toLowerCase();
      return /(^|\/)agents\.md$/.test(l) || l === 'claude.md' || l === 'gemini.md' || l === '.github/copilot-instructions.md' || l === '.cursorrules' || l === '.windsurfrules' || l.startsWith('.cursor/rules/');
    });
    const rootAgents = agentPaths.find(p => p.toLowerCase() === 'agents.md');
    const primaryAgent = rootAgents || agentPaths.find(p => ['claude.md','gemini.md','.github/copilot-instructions.md','.cursorrules','.windsurfrules'].includes(p.toLowerCase())) || agentPaths[0];
    const agentText = primaryAgent ? text(primaryAgent) : '';
    const hasAgentWorkflowGuidance = /(test|verify|check|lint|build|install|run|npm|pnpm|yarn|cargo|pytest|go test|gradle|mvn|bazel|make|just)/i.test(agentText);
    const hasAgentGuardrails = /(must not|never|avoid|do not|constraint|scope|preserve|rule|security|dependency)/i.test(agentText);

    const hasReadme = paths.some(p => /^readme(?:\.[a-z0-9]+)?$/i.test(p));
    const hasContrib = hasAny(['contributing.md', /^docs\/contributing(?:\.|\/|$)/i, /^\.github\/contributing(?:\.|\/|$)/i]);
    const hasDocs = starts('docs/') || starts('documentation/') || paths.some(p => /(^|\/)docs\//.test(p));

    const testFiles = countAny(/(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[a-z0-9]+$|_test\.go$/i);
    const testConfig = hasBasename(['pytest.ini','tox.ini','noxfile.py','jest.config.js','jest.config.cjs','jest.config.mjs','vitest.config.js','vitest.config.ts','karma.conf.js','phpunit.xml','phpunit.xml.dist']);
    const packageTest = scriptNames.some(s => s === 'test' || s.startsWith('test:') || ['check','verify'].includes(s));
    const packageSecondary = scriptNames.some(s => /^(lint|typecheck|type-check|format:check|check:types|build)$/.test(s));
    const pyprojectText = Object.entries(texts).find(([k]) => k.toLowerCase().endsWith('pyproject.toml'))?.[1] || '';
    const pythonTest = /pytest|unittest|tox|nox/i.test(pyprojectText) || testConfig;
    const repoVerify = detectRepoVerification(texts, paths, stack);
    const hasTests = testFiles > 0 || packageTest || pythonTest || stack.inlineTests || repoVerify.hasTestTarget;
    const canonicalVerify = packageTest && stack.id === 'node'
      ? preferredPackageCommand(scripts)
      : (repoVerify.command || (hasTests ? stack.verifyCommand : ''));
    const secondaryCheck = packageSecondary || repoVerify.secondaryCheck || stack.secondaryCheck || hasBasename([
      '.golangci.yml','.golangci.yaml','clippy.toml','rustfmt.toml','.rustfmt.toml','ruff.toml','.ruff.toml','mypy.ini',
      '.eslintrc','.eslintrc.js','eslint.config.js','eslint.config.mjs'
    ]);

    const workflowPaths = paths.filter(p => /^\.github\/workflows\/[^/]+\.(ya?ml)$/i.test(p));
    const workflowCount = workflowPaths.length;
    const externalCI = hasAny(['.gitlab-ci.yml','circle.yml','.circleci/config.yml','azure-pipelines.yml','jenkinsfile']);
    const hasCI = workflowCount > 0 || externalCI;
    const verificationWorkflow = workflowPaths.some(p => /(ci|test|check|lint|build|verify|rust|go|python)/i.test(p)) || workflowCount >= 3;

    const reproducibleSetup = Boolean(packageManager || Object.keys(engines).length) || hasBasename([
      '.nvmrc','.node-version','.python-version','.tool-versions','rust-toolchain','rust-toolchain.toml','gradle-wrapper.properties',
      'devcontainer.json','dockerfile','docker-compose.yml','docker-compose.yaml','mise.toml','.bazelversion'
    ]) || stack.reproducibleByConvention;

    const prTemplate = hasAny([/^\.github\/pull_request_template\.md$/i, /^\.github\/pull_request_template\//i, /^docs\/pull_request_template\.md$/i]);
    const codeowners = hasAny(['.github/codeowners','codeowners','docs/codeowners']);
    const security = hasAny(['security.md','.github/security.md']);
    const issueTemplates = starts('.github/issue_template/');
    const dependencyAutomation = hasAny(['.github/dependabot.yml','.github/dependabot.yaml','renovate.json','renovate.json5','.renovaterc','.renovaterc.json']) || workflowPaths.some(p => /(codeql|dependency-review|security|dependabot)/i.test(p));

    const scores = {};
    if (agentPaths.length) {
      scores.instructions = rootAgents ? 16 : 14;
      if (hasAgentWorkflowGuidance && hasAgentGuardrails) scores.instructions += 4;
      else if (hasAgentWorkflowGuidance || hasAgentGuardrails) scores.instructions += 2;
      scores.instructions = Math.min(20, scores.instructions);
    } else {
      scores.instructions = hasReadme && hasContrib ? 6 : hasReadme ? 3 : 0;
    }
    scores.docs = (hasReadme ? 7 : 0) + (hasContrib ? 4 : 0) + (hasDocs ? 4 : 0);
    scores.tests = (hasTests ? 10 : 0) + (canonicalVerify ? 6 : 0) + (secondaryCheck ? 4 : 0);
    scores.automation = (hasCI ? 10 : 0) + (hasCI && (workflowCount >= 2 || externalCI) ? 3 : 0) + (hasCI && verificationWorkflow ? 2 : 0);
    scores.clarity = (manifest ? 5 : 0) + (lockfile ? 4 : 0) + (license ? 3 : 0) + (reproducibleSetup ? 3 : 0);
    scores.workflow = (prTemplate ? 4 : 0) + (codeowners ? 4 : 0) + (security ? 3 : 0) + (issueTemplates ? 2 : 0) + (dependencyAutomation ? 2 : 0);

    const score = Math.max(0, Math.min(100, Object.values(scores).reduce((a, b) => a + b, 0)));
    const grade = score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
    const verdict = score >= 95 ? 'Exceptional agent readiness.' : score >= 85 ? 'Very agent-friendly.' : score >= 70 ? 'Agent-ready with a few gaps.' : score >= 55 ? 'Usable, but expect hand-holding.' : 'Agents will need significant guidance.';

    const details = {
      instructions: agentPaths.length
        ? `${rootAgents ? 'AGENTS.md' : friendlyAgentName(primaryAgent)}${hasAgentWorkflowGuidance && hasAgentGuardrails ? ' · verification + guardrails documented' : ' · guidance detected'}`
        : (hasReadme && hasContrib ? 'No agent-specific file · contributor docs provide fallback context' : 'No agent-specific instructions found'),
      docs: [hasReadme && 'README', hasContrib && 'CONTRIBUTING', hasDocs && 'docs/'].filter(Boolean).join(' · ') || 'Thin documentation signals',
      tests: hasTests
        ? `${testFiles >= 25 ? 'Extensive automated test suite' : testFiles > 0 ? 'Automated tests detected' : 'Automated verification detected'}${canonicalVerify ? ` · canonical: ${canonicalVerify}` : ''}${secondaryCheck ? ' · lint/static checks detected' : ''}`
        : 'No obvious automated verification signal',
      automation: hasCI
        ? `${workflowCount >= 5 ? 'Extensive CI automation' : 'CI detected'}${verificationWorkflow ? ' · verification workflow present' : ''}`
        : 'No CI workflow detected',
      clarity: [manifest && stack.label, lockfile && 'deterministic dependencies', license && 'license', reproducibleSetup && 'reproducible setup'].filter(Boolean).join(' · ') || 'Few setup/reproducibility signals',
      workflow: [prTemplate && 'PR template', codeowners && 'CODEOWNERS', security && 'SECURITY', issueTemplates && 'issue templates', dependencyAutomation && 'dependency automation'].filter(Boolean).join(' · ') || 'Few review/safety guardrails',
    };

    const fixes = [];
    const addFix = (points, title, body) => points > 0 && fixes.push({ impact: `+${points} pts`, points, title, body });

    if (!agentPaths.length) addFix(20 - scores.instructions, 'Add an AGENTS.md', 'Give coding agents repo-specific setup, verification, architecture, and safety rules.');
    else if (scores.instructions < 20) addFix(20 - scores.instructions, 'Strengthen agent instructions', 'Document the canonical verification command and explicit guardrails/scope.');
    if (!hasContrib) addFix(4, 'Add CONTRIBUTING.md', 'Document the local workflow, conventions, and expected checks before a PR.');
    if (!hasDocs) addFix(4, 'Add deeper docs', 'Document architecture, scoring/design decisions, or subsystem-specific guidance beyond the README.');
    if (!hasTests) addFix(10, 'Add automated tests', 'Give agents a repeatable way to prove a change did not break behavior.');
    else if (!canonicalVerify) addFix(6, 'Expose one canonical verification command', `Make the expected check obvious${stack.verifyCommand ? ` (for example, ${stack.verifyCommand})` : ''}.`);
    if (hasTests && !secondaryCheck) addFix(4, 'Add lint/type/static checks', 'Catch mistakes that tests alone may miss and make those checks runnable locally.');
    if (!hasCI) addFix(10, 'Add CI', 'Run verification automatically on pull requests.');
    if (manifest && !lockfile) addFix(4, 'Commit deterministic dependency state', 'Add the ecosystem lock/sum file so installs do not drift.');
    if (!reproducibleSetup) addFix(3, 'Pin the toolchain/setup', 'Declare a runtime/toolchain version or provide a reproducible dev environment.');
    if (!prTemplate) addFix(4, 'Add a PR template', 'Ask every change to explain what changed and which checks were run.');
    if (!codeowners) addFix(4, 'Add CODEOWNERS', 'Make review ownership machine-readable.');
    if (!security) addFix(3, 'Add SECURITY.md', 'Provide a safe path for security-sensitive findings.');
    if (!issueTemplates) addFix(2, 'Add issue templates', 'Collect reproducible bug reports and focused feature requests.');
    if (!dependencyAutomation && manifest) addFix(2, 'Add dependency automation', 'Use Dependabot/Renovate or equivalent security/dependency automation.');

    fixes.sort((a, b) => b.points - a.points || a.title.localeCompare(b.title));

    const confidence = options.truncated ? 'Medium' : (stack.id === 'unknown' && !manifest ? 'Medium' : 'High');
    const confidenceNote = options.truncated ? 'GitHub truncated this very large repository tree, so some files may be missing from the audit.' : 'Full repository tree available to the scanner.';

    return {
      score, grade, verdict, scores, details, fixes: fixes.slice(0, 5),
      stack: stack.label, verifyCommand: canonicalVerify || stack.verifyCommand || 'Not detected', confidence, confidenceNote,
      agentCount: agentPaths.length, workflowCount, testCount: testFiles, categories: CATEGORIES,
      meta: { manifest, lockfile, license, hasTests, hasCI, prTemplate, codeowners, security, issueTemplates, dependencyAutomation }
    };
  }

  function friendlyAgentName(path) {
    if (!path) return 'Agent guidance';
    const l = path.toLowerCase();
    if (l === '.github/copilot-instructions.md') return 'Copilot instructions';
    if (l.includes('claude')) return 'CLAUDE.md';
    if (l.includes('gemini')) return 'GEMINI.md';
    if (l.includes('cursor')) return 'Cursor rules';
    if (l.includes('windsurf')) return 'Windsurf rules';
    return path;
  }

  function preferredPackageCommand(scripts) {
    const keys = Object.keys(scripts || {});
    const pick = ['check','verify','test:ci','test','test:unit'].find(k => keys.includes(k));
    return pick ? `npm run ${pick}`.replace('npm run test', 'npm test') : '';
  }

  function detectRepoVerification(texts, paths, stack) {
    const just = texts['justfile'] || '';
    const make = texts['makefile'] || texts['gnumakefile'] || '';
    const task = texts['taskfile.yml'] || texts['taskfile.yaml'] || '';
    const hasRecipe = (body, name) => new RegExp(`^${name}(?:\\s+[^:]*)?:`, 'mi').test(body);
    const justTest = ['check','verify','test','ci','bazel-test'].find(name => hasRecipe(just, name));
    const makeTest = ['check','verify','test','ci'].find(name => new RegExp(`^${name}\\s*:`, 'mi').test(make));
    const taskTest = ['check','verify','test','ci'].find(name => new RegExp(`^\\s{0,4}${name}\\s*:`, 'mi').test(task));
    const command = justTest ? `just ${justTest}` : makeTest ? `make ${makeTest}` : taskTest ? `task ${taskTest}` : '';
    const secondaryCheck = /(fmt-check|format-check|clippy|lint|typecheck|type-check|static|ruff|mypy)/i.test(`${just}\n${make}\n${task}`);
    return {
      command,
      secondaryCheck,
      hasTestTarget: Boolean(command) || (stack.id === 'bazel' && paths.some(p => /(^|\/)build\.bazel$/.test(p))),
    };
  }

  function detectStack(paths, pkg, texts, primaryLanguage = '') {
    const set = new Set(paths);
    const hasBase = name => paths.some(p => p === name || p.endsWith(`/${name}`));
    const anyBase = (...names) => names.some(hasBase);
    const lang = String(primaryLanguage || '').toLowerCase();
    const present = {
      node: hasBase('package.json'),
      rust: hasBase('cargo.toml'),
      go: hasBase('go.mod'),
      python: hasBase('pyproject.toml') || hasBase('setup.py') || hasBase('requirements.txt'),
      gradle: hasBase('gradlew') || hasBase('build.gradle') || hasBase('build.gradle.kts'),
      maven: hasBase('pom.xml'),
      bazel: hasBase('module.bazel') || hasBase('workspace') || hasBase('workspace.bazel') || hasBase('build.bazel'),
      ruby: hasBase('gemfile'),
      php: hasBase('composer.json'),
      elixir: hasBase('mix.exs'),
      cmake: hasBase('cmakelists.txt'),
    };
    const languageStackIds = Object.keys(present).filter(k => k !== 'bazel' && present[k]);
    const multi = languageStackIds.length > 1 || (present.bazel && languageStackIds.length > 0);
    const suffix = present.bazel && lang !== 'bazel' ? ' + Bazel' : (multi ? ' (multi-stack)' : '');

    const rust = () => ({ id: 'rust', label: `Rust / Cargo${suffix}`, verifyCommand: hasBase('justfile') ? 'just test' : (paths.some(p => p === 'cargo.toml') ? 'cargo test' : 'cargo test --workspace'), secondaryCheck: anyBase('rustfmt.toml','.rustfmt.toml','clippy.toml') || paths.some(p => p.endsWith('/clippy.toml')), inlineTests: paths.some(p => /(^|\/)tests?\//.test(p) && p.endsWith('.rs')) || /\[dev-dependencies\]/i.test(Object.entries(texts).find(([k]) => k.endsWith('cargo.toml'))?.[1] || ''), reproducibleByConvention: anyBase('rust-toolchain','rust-toolchain.toml') });
    const go = () => ({ id: 'go', label: `Go${suffix}`, verifyCommand: 'go test ./...', secondaryCheck: anyBase('.golangci.yml','.golangci.yaml'), inlineTests: paths.some(p => p.endsWith('_test.go')), reproducibleByConvention: hasBase('go.sum') });
    const python = () => ({ id: 'python', label: `Python${suffix}`, verifyCommand: 'pytest', secondaryCheck: /ruff|mypy|black|flake8/i.test(Object.entries(texts).find(([k]) => k.endsWith('pyproject.toml'))?.[1] || '') || anyBase('ruff.toml','.ruff.toml','mypy.ini'), inlineTests: false, reproducibleByConvention: anyBase('.python-version','uv.lock','poetry.lock') });
    const gradle = () => ({ id: 'gradle', label: `JVM / Gradle${suffix}`, verifyCommand: './gradlew test', secondaryCheck: true, inlineTests: false, reproducibleByConvention: hasBase('gradle-wrapper.properties') });
    const maven = () => ({ id: 'maven', label: `JVM / Maven${suffix}`, verifyCommand: 'mvn test', secondaryCheck: true, inlineTests: false, reproducibleByConvention: false });
    const node = () => { const scripts = pkg.scripts || {}; return { id: 'node', label: `Node.js / JavaScript${suffix}`, verifyCommand: scripts.check ? 'npm run check' : scripts.test ? 'npm test' : '', secondaryCheck: Boolean(scripts.lint || scripts.typecheck || scripts['type-check'] || scripts.build), inlineTests: false, reproducibleByConvention: Boolean(pkg.packageManager || (pkg.engines && Object.keys(pkg.engines).length)) }; };

    if (lang === 'rust' && present.rust) return rust();
    if (lang === 'go' && present.go) return go();
    if (lang === 'python' && present.python) return python();
    if (['java','kotlin'].includes(lang) && present.gradle) return gradle();
    if (['java','kotlin'].includes(lang) && present.maven) return maven();
    if (['javascript','typescript'].includes(lang) && present.node) return node();

    if (set.has('cargo.toml')) return rust();
    if (set.has('go.mod')) return go();
    if (set.has('pyproject.toml') || set.has('setup.py')) return python();
    if (set.has('build.gradle') || set.has('build.gradle.kts') || set.has('gradlew')) return gradle();
    if (set.has('pom.xml')) return maven();
    if (set.has('package.json')) return node();

    if (present.rust) return rust();
    if (present.go) return go();
    if (present.python) return python();
    if (present.gradle) return gradle();
    if (present.maven) return maven();
    if (present.node) return node();
    if (present.bazel) return { id: 'bazel', label: 'Bazel', verifyCommand: 'bazel test //...', secondaryCheck: true, inlineTests: false, reproducibleByConvention: hasBase('module.bazel.lock') || hasBase('.bazelversion') };
    if (present.ruby) return { id: 'ruby', label: `Ruby${multi ? ' (multi-stack)' : ''}`, verifyCommand: 'bundle exec rake test', secondaryCheck: false, inlineTests: false, reproducibleByConvention: hasBase('gemfile.lock') };
    if (present.php) return { id: 'php', label: `PHP / Composer${multi ? ' (multi-stack)' : ''}`, verifyCommand: 'composer test', secondaryCheck: false, inlineTests: false, reproducibleByConvention: hasBase('composer.lock') };
    if (present.elixir) return { id: 'elixir', label: `Elixir / Mix${multi ? ' (multi-stack)' : ''}`, verifyCommand: 'mix test', secondaryCheck: true, inlineTests: false, reproducibleByConvention: hasBase('mix.lock') };
    if (present.cmake) return { id: 'cmake', label: `C/C++ / CMake${multi ? ' (multi-stack)' : ''}`, verifyCommand: 'ctest', secondaryCheck: true, inlineTests: false, reproducibleByConvention: false };
    return { id: 'unknown', label: 'Mixed / unknown', verifyCommand: '', secondaryCheck: false, inlineTests: false, reproducibleByConvention: false };
  }

  return { CATEGORIES, normalizeRepo, analyze, detectStack, detectRepoVerification };
});
