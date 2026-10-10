import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandEvent } from "../events.js";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import { getStorage, resetStorage } from "../storage/index.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as net from "node:net";

function tmpDir(name: string): string {
  const base = mkdtempSync(join(tmpdir(), "blackbox-http-test-" + name + "-"));
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  return base;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => {
        if (addr && typeof addr !== "string") resolve(addr.port);
        else reject(new Error("could not get port"));
      });
    });
  });
}

function createTestServer(
  port: number,
  options: {
    status?: number;
    delayMs?: number;
    body?: string;
  }
): { server: http.Server; close: () => void } {
  const server = http.createServer((req: IncomingMessage, res) => {
    if (req.url === "/api/events" && req.method === "POST") {
      const handler = () => {
        res.writeHead(options.status ?? 200, { "Content-Type": "application/json" });
        res.end(options.body ?? JSON.stringify({ ok: true, count: 1 }));
      };
      if (options.delayMs) {
        setTimeout(handler, options.delayMs);
      } else {
        handler();
      }
      return;
    }
    res.writeHead(404).end("not found");
  });
  server.listen(port, "127.0.0.1", () => {});
  return {
    server,
    close: () => {
      server.close(() => {});
    },
  };
}

async function waitForServer(port: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(200) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  throw new Error(`server on port ${port} did not become ready within ${timeoutMs}ms`);
}

async function postEvents(
  port: number,
  events: Record<string, unknown>[]
): Promise<boolean> {
  const body = JSON.stringify(events);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/events",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res: IncomingMessage) => {
        res.resume();
        const status = res.statusCode;
        settle(status != null && status >= 200 && status < 300);
      }
    );
    req.on("error", () => settle(false));
    req.on("timeout", () => {
      try { req.destroy(); } catch { /* ignore */ }
      settle(false);
    });
    req.setTimeout(5000);
    req.write(body);
    req.end();
  });
}

test("HTTP delivery: successful 2xx returns true", async () => {
  const dir = tmpDir("http-2xx");
  mkdirSync(join(dir, ".blackbox"), { recursive: true });
  const port = await findFreePort();
  const { server, close } = createTestServer(port, { status: 200 });
  await waitForServer(port);
  try {
    const events = [
      createCommandEvent(
        dir, "sess-1", "echo hi",
        "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:01.000Z",
        0, "hi", ""
      )
    ];
    const delivered = await postEvents(port, events.map((e) => ({ ...e })) as Record<string, unknown>[]);
    assert.equal(delivered, true, "2xx response should be reported as delivered");
  } finally {
    close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("HTTP delivery: non-2xx returns false", async () => {
  const dir = tmpDir("http-non2xx");
  mkdirSync(join(dir, ".blackbox"), { recursive: true });
  const port = await findFreePort();
  const { server, close } = createTestServer(port, { status: 500, body: JSON.stringify({ ok: false }) });
  await waitForServer(port);
  try {
    const events = [
      createCommandEvent(
        dir, "sess-1", "echo hi",
        "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:01.000Z",
        1, "", "err"
      )
    ];
    const delivered = await postEvents(port, events.map((e) => ({ ...e })) as Record<string, unknown>[]);
    assert.equal(delivered, false, "500 response should be reported as not delivered");
  } finally {
    close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("HTTP delivery: connection refusal returns false", async () => {
  const port = await findFreePort();
  // Don't start a server - the port should be free
  const events = [
    createCommandEvent("/p", "sess-1", "cmd", "s", "e", 1, "", "err")
  ];
  const delivered = await postEvents(port, events.map((e) => ({ ...e })) as Record<string, unknown>[]);
  assert.equal(delivered, false, "connection refusal should be reported as not delivered");
});

test("HTTP delivery: timeout returns false", async () => {
  const dir = tmpDir("http-timeout");
  mkdirSync(join(dir, ".blackbox"), { recursive: true });
  const port = await findFreePort();
  const { server, close } = createTestServer(port, { delayMs: 8000 });
  await waitForServer(port);
  try {
    const events = [
      createCommandEvent(
        dir, "sess-1", "echo hi",
        "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:01.000Z",
        0, "hi", ""
      )
    ];
    const delivered = await postEvents(port, events.map((e) => ({ ...e })) as Record<string, unknown>[]);
    assert.equal(delivered, false, "timeout should be reported as not delivered");
  } finally {
    close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("HTTP delivery: no duplicate local writes when server succeeds", async () => {
  const dir = tmpDir("http-noduplicate");
  const dbPath = join(dir, ".blackbox", "blackbox.db");
  mkdirSync(join(dir, ".blackbox"), { recursive: true });

  const port = await findFreePort();
  const { server, close } = createTestServer(port, { status: 200 });
  await waitForServer(port);

  resetStorage({ filepath: dbPath });
  const storage = getStorage({ filepath: dbPath });

  try {
    const events = [
      createCommandEvent(
        dir, "sess-1", "echo hi",
        "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:01.000Z",
        0, "hi", ""
      )
    ];
    const delivered = await postEvents(port, events.map((e) => ({ ...e })) as Record<string, unknown>[]);

    assert.equal(delivered, true, "server should accept events");
    // The CLI's contract: when posted successfully, do NOT write locally.
    const localEvents = storage.listEvents(dir);
    assert.equal(localEvents.length, 0, "no local fallback write when server accepted events");
  } finally {
    close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
