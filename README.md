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
