# AGENTS.md

## Project
Static, dependency-free GitHub Pages app. It scores public GitHub repositories for coding-agent readiness.

## Rules
- Keep the app dependency-free unless there is a compelling reason not to.
- Never execute code from scanned repositories.
- Never require a GitHub token for the default flow.
- Preserve a usable mobile layout.
- Keep all scoring logic explainable in `app.js`.

## Run
`python -m http.server 8080`

## Verify
- Open the app locally.
- Scan `facebook/react` and one small public repository.
- Confirm invalid/private repositories show a readable error.
- Confirm Copy Audit, Copy Badge, and Copy Share Link work.
