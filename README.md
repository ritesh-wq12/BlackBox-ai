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
| `BLACKBOX_AI_PROVIDER` | yes | `anthropic`, `openai`, or `openai-compatible` |
| `BLACKBOX_AI_API_KEY` | yes* | Provider API key (never logged, never returned). Not required for keyless endpoints. |
| `BLACKBOX_AI_MODEL` | yes* | Model name. Required when `BLACKBOX_AI_PROVIDER=openai-compatible`; missing model or base URL falls back to deterministic. |
| `BLACKBOX_AI_TIMEOUT_MS` | no | Request timeout, default `10000` |
| `BLACKBOX_AI_BASE_URL` | **only for `openai-compatible`** | Base URL for an OpenAI-format API. Used when `BLACKBOX_AI_PROVIDER=openai-compatible`. Do not set for `anthropic`/`openai`. The key is sent as `Authorization: Bearer <key>` if `BLACKBOX_AI_API_KEY` is set; leave it empty only when the endpoint is truly keyless. |

**openai-compatible presets** (set `BLACKBOX_AI_PROVIDER=openai-compatible` and `BLACKBOX_AI_BASE_URL=<preset URL>`).
The model name must come from the provider's console — it is not guessed.

| Provider | `BLACKBOX_AI_BASE_URL` | `BLACKBOX_AI_API_KEY` | Notes |
| --- | --- | --- | --- |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | from Google AI Studio | verify |
| Groq | `https://api.groq.com/openai/v1` | from Groq console | |
| OpenRouter | `https://openrouter.ai/api/v1` | from OpenRouter console | model ending in `:free` for free tier |
| Ollama | `http://localhost:11434/v1` | _none_ | run Ollama locally first |

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
- For `openai-compatible`, if `BLACKBOX_AI_MODEL` or `BLACKBOX_AI_BASE_URL` is missing the explanation falls back to the deterministic summary.
