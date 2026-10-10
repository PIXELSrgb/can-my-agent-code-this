# Can My Agent Code This?

![Can My Agent Code This preview](assets/preview.svg)

**Paste a public GitHub repo → get an instant coding-agent readiness score.**

[**→ Try the live scanner**](https://pixelsrgb.github.io/can-my-agent-code-this/)

[![No backend](https://img.shields.io/badge/backend-none-b7ff3c?style=flat-square)](#)
[![No API key](https://img.shields.io/badge/API%20key-none-b7ff3c?style=flat-square)](#)
[![MIT](https://img.shields.io/badge/license-MIT-white?style=flat-square)](LICENSE)

Coding agents are getting better fast. Repositories are not always keeping up.

**Can My Agent Code This?** checks a public GitHub repository for the signals that make agent-driven changes less painful: instructions, docs, tests, CI, deterministic setup and contribution guardrails.

## What it checks

- `AGENTS.md`, `CLAUDE.md`, Cursor/Copilot/Gemini instructions
- README, `CONTRIBUTING.md`, and `docs/`
- test folders/files and runnable test/check scripts
- GitHub Actions / CI workflows
- manifests, lockfiles, license, `.env.example`
- PR templates, `CODEOWNERS`, `SECURITY.md`, issue templates

The result is a **0–100 score**, grade, signal breakdown, and a ranked fix list.

## Why this exists

Agent tooling is everywhere, but "works with agents" is often treated like magic. It isn't. Agents do much better when repositories expose clear instructions and a reliable feedback loop.

This tool makes those repo-level signals visible in about two seconds.

## Run locally

There is no build step.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The included workflow deploys the site automatically.

## Privacy

- No analytics
- No cookies
- No account
- No backend
- Repository code is **never executed**
- The browser talks directly to the public GitHub API and `raw.githubusercontent.com`

GitHub's unauthenticated API rate limits still apply.

## Scoring

The score is intentionally heuristic. It measures whether useful repository *signals exist*, not whether the codebase is "good" or whether an AI agent will produce correct code.

That means a repository can score highly and still contain bad or outdated instructions. Treat the output as a fast pre-flight check, not a benchmark.

## Contributing

Issues and PRs are welcome. If you think a signal should count (or should count differently), open an issue with a concrete example repo.

## License

MIT
