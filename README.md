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
| `BLACKBOX_AI_BASE_URL` | **only for `openai-compatible`** | Base URL for an OpenAI-format API. Used when `BLACKBOX_AI_PROVIDER=openai-compatible`. Do not set for `anthropic`/`openai`. The key is sent as `Authorization: Bearer <key>` if `BLACKBOX_AI_API_KEY` is set; leave it empty only when the endpoint is truly keyless. |

**openai-compatible providers** (set `BLACKBOX_AI_PROVIDER=openai-compatible` and `BLACKBOX_AI_BASE_URL=<your base URL>`):

- Supports any service whose `/chat/completions` endpoint accepts the OpenAI request shape (examples only; I do not maintain these — if a URL I list here is no longer accurate, please update the README):
  - **Google Gemini** with developer API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` is **not** OpenAI-format — do not pass it as `openai-compatible`. Use the Gemini developer API only if you wrap it; I do not implement that wrapper in this codebase.
  - **Groq** OpenAI-compatible endpoint: `https://api.groq.com/openai/v1/chat/completions` (key: `BLACKBOX_AI_API_KEY`)
  - **OpenRouter** OpenAI-compatible endpoint: `https://api.openrouter.ai/v1/chat/completions` (key: `BLACKBOX_AI_API_KEY`)
  - **Ollama** local OpenAI-compatible endpoint: `http://localhost:11434/v1/chat/completions` (no key needed; leave `BLACKBOX_AI_API_KEY` empty)

If you use a provider I have not listed, set `BLACKBOX_AI_BASE_URL` to its `/v1/chat/completions` (or equivalent) path and keep `BLACKBOX_AI_PROVIDER=openai-compatible`. If in doubt, say so instead of guessing.

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
