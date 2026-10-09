# Trunk
# =========

Git URLs, if you'll be cloning this project.

## Install / build

Node **>=22** is required. The core needs no accounts.

```bash
npm install
npm run blackbox -- start
```

## Run

```bash
npm run blackbox -- start   # starts CLI + dashboard
npm run dashboard:dev       # Vite dev server (optional, used by learner during build)
npm run dashboard:build     # production build
npm run dashboard:preview   # preview built dashboard
npm run test                # evidence engine tests
npm run typecheck           # CLI + dashboard
```

## Try the demo

```bash
npm run blackbox -- start   # CLI + dashboard open
npm run blackbox -- run npm run build
# break a file, then:
npm run blackbox -- run npm run build
# click INVESTIGATE FAILURE in the dashboard
```

## Test coverage and future slices

The dashboard is visual-verified by the learner during build; engine tests are the
mechanic check. Future slices (polish, docs, AI adapter, app-map) follow.

See `devpost/checklist.md` for the build plan.

## AI explanations (optional)

BlackBox works fully offline: without an AI provider it explains failures with a
deterministic local summary. To have a real model narrate the evidence, set these
environment variables **before** starting the server (BlackBox reads the plain
environment; no `.env` loader is bundled — see `.env.example`):

| Variable | Required | Description |
| --- | --- | --- |
| `BLACKBOX_AI_PROVIDER` | yes | `anthropic` or `openai` |
| `BLACKBOX_AI_API_KEY` | yes | Provider API key (never logged, never returned) |
| `BLACKBOX_AI_MODEL` | no | Model override. Defaults: `claude-haiku-4-5`, `gpt-4o-mini` |
| `BLACKBOX_AI_TIMEOUT_MS` | no | Request timeout, default `10000` |

```bash
# PowerShell
$env:BLACKBOX_AI_PROVIDER="anthropic"; $env:BLACKBOX_AI_API_KEY="sk-ant-..."
npm run blackbox -- start
```

Behavior:

- Only the deterministic `EvidenceSet` is sent to the model as JSON — never the
  raw project, events, or database.
- Provider output is validated strictly: any file path, timestamp or command it
  names that is not present in the evidence rejects the text (fallback used).
- Timeouts, HTTP errors, empty output or a missing key also fall back silently.
- The dashboard labels each explanation `AI-written` or `Deterministic summary`
  based on the `explanationSource` field returned by `/api/investigate`.
- The engine's score, status, breakdown and chain are computed before any AI
  call and are never affected by it.
