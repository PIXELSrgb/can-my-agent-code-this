# AGENTS.md

## Project
Can My Agent Code This? is a dependency-free GitHub Pages app that audits public GitHub repositories for AI coding-agent readiness.

## Architecture
- `index.html` is the static UI shell.
- `styles.css` contains all styling.
- `scoring.js` contains pure, explainable scoring and stack-detection logic. Keep it browser-compatible and CommonJS-compatible so Node tests can import it.
- `app.js` handles GitHub API/raw-file reads, rendering, share/copy actions, and URL state.
- `tests/` contains Node built-in test-runner coverage.
- `docs/scoring.md` documents the public rubric. If scoring changes, update the docs and tests in the same change.

## Setup and run
No install is required for the app itself. Node is only used for verification.

```bash
npm ci
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Verify
Run the canonical check before submitting changes:

```bash
npm run check
```

For scoring changes, also manually scan at least:
- `PIXELSrgb/can-my-agent-code-this`
- `facebook/react`
- `openai/codex`

## Rules and guardrails
- Never execute, clone, install, or evaluate code from scanned repositories.
- Keep the default flow token-free and backend-free.
- Only inspect public GitHub metadata, repository paths, and small text config/docs files.
- Do not penalize a repository for irrelevant ecosystem conventions (for example, do not require `.env.example` when no environment setup is implied).
- Prefer quality/explainability over raw file counts.
- Keep every point in the score traceable to an explicit signal in `docs/scoring.md`.
- Preserve mobile usability and accessible labels.
- Avoid adding runtime dependencies unless there is a compelling reason.
