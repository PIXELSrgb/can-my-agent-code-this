# Scoring model v2

The score is a **heuristic readiness audit**, not a benchmark of code quality and not a probability that an AI agent will succeed.

The scanner awards 100 points across six categories. It adapts verification expectations to the repository's detected ecosystem instead of assuming every project is Node.js.

## 1. Agent instructions — 20 points

Strongest signal: a root `AGENTS.md` with both:
- setup/verification guidance; and
- explicit constraints, scope, or safety guardrails.

Tool-specific guidance such as `CLAUDE.md`, Copilot instructions, Cursor rules, Gemini or Windsurf instructions also counts. Mature repositories without an agent-specific file receive limited fallback credit when both README and CONTRIBUTING guidance are present.

## 2. Documentation — 15 points

- README: 7
- CONTRIBUTING guidance: 4
- deeper `docs/` or `documentation/`: 4

## 3. Tests & verification — 20 points

- automated test/verification evidence: 10
- one canonical runnable verification command: 6
- lint/type/static/build checks: 4

The canonical command is inferred from the actual stack when appropriate, including npm, Cargo, Go, pytest, Gradle, Maven, Bazel, Ruby, PHP, Elixir and CMake.

Large repositories are described as having an "extensive automated test suite" instead of exposing meaningless raw path counts.

## 4. CI automation — 15 points

- CI present: 10
- multiple CI workflows/providers: 3
- verification-oriented CI: 2

## 5. Project clarity — 15 points

- manifest/build-system signal: 5
- deterministic dependency state (lock/sum file): 4
- license: 3
- pinned/reproducible toolchain or setup: 3

This category intentionally does **not** require an environment example unless the project actually needs one.

## 6. Safe change workflow — 15 points

- pull-request template: 4
- CODEOWNERS: 4
- SECURITY policy: 3
- issue templates: 2
- dependency/security automation: 2

## Confidence

The score is accompanied by a confidence label. GitHub can truncate very large recursive repository trees; when that happens, confidence is reduced without silently lowering the score.

## Design principles

1. Reward signals that materially help an agent make and verify changes.
2. Do not reward duplicate files just to inflate a score.
3. Do not punish a repository for conventions that do not apply to its ecosystem.
4. Keep the rubric explainable enough that a maintainer can disagree with it constructively.
