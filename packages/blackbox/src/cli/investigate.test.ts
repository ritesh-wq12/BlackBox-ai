import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetStorage, getStorage } from "../storage/index.js";
import { Server } from "./server.js";

const AI_ENV_KEYS = [
  "BLACKBOX_AI_PROVIDER",
  "BLACKBOX_AI_API_KEY",
  "BLACKBOX_AI_MODEL",
  "BLACKBOX_AI_TIMEOUT_MS",
] as const;

test("/api/investigate returns a string explanation and explanationSource", async () => {
  // This test process must exercise the no-provider path regardless of the
  // shell environment the tests were launched from.
  const saved: Record<string, string | undefined> = {};
  for (const key of AI_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  const dir = mkdtempSync(join(tmpdir(), "bb-investigate-"));
  const dbPath = join(dir, "blackbox.db");
  resetStorage({ filepath: dbPath });
  const storage = getStorage({ filepath: dbPath });

  const port = 18900 + (process.pid % 500);
  const server = new Server({ port, projectDir: dir, sessionId: "test-session", storage });
  server.start();

  try {
    // Give the listener a moment to bind.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const events = [
      {
        id: "e1",
        type: "COMMAND",
        timestamp: "2026-10-09T10:00:00.000Z",
        summary: "COMMAND npm run build",
        path: "",
        project: dir,
        sessionId: "test-session",
        details: { command: "npm run build", exitCode: 0, stdout: "ok" },
      },
      {
        id: "e2",
        type: "FILE",
        timestamp: "2026-10-09T10:00:05.000Z",
        summary: "MODIFIED Login.jsx",
        path: "src/Login.jsx",
        project: dir,
        sessionId: "test-session",
        details: { changeType: "modified" },
      },
      {
        id: "e3",
        type: "COMMAND",
        timestamp: "2026-10-09T10:00:10.000Z",
        summary: "COMMAND npm run build",
        path: "",
        project: dir,
        sessionId: "test-session",
        details: { command: "npm run build", exitCode: 1, stderr: "Error in src/Login.jsx" },
      },
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/investigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    assert.equal(res.status, 200, "investigate responds 200");

    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(typeof body.aiExplanation, "string", "aiExplanation is a string (awaited)");
    assert.ok((body.aiExplanation as string).length > 0, "aiExplanation is non-empty");
    assert.equal(body.explanationSource, "deterministic", "no provider configured in tests");
    assert.equal(typeof body.score, "number", "deterministic score present");
    assert.ok(Array.isArray(body.chain), "chain present");
    assert.ok(Array.isArray(body.breakdown), "breakdown present");
  } finally {
    server.stop();
    for (const key of AI_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
