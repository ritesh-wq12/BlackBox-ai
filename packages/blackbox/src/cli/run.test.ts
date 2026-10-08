import { test } from "node:test";
import assert from "node:assert/strict";
import { getStorage, resetStorage } from "../storage/index.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createCommandEvent, createErrorEvent, createBuildTestEvent, createFileEvent, createGitEvent, isBuildFailed, isBuildPassed } from "../events.js";

function tmpDir(name: string): string {
  const base = mkdtempSync(join(tmpdir(), "blackbox-test-" + name + "-"));
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  return base;
}

test("createCommandEvent produces correct event shape", () => {
  const project = "/tmp/project";
  const sessionId = "session-123";
  const command = "npm run build";
  const start = "2024-01-01T00:00:00.000Z";
  const end = "2024-01-01T00:00:05.000Z";
  const exitCode = 0;
  const stdout = "Build successful";
  const stderr = "";

  const event = createCommandEvent(project, sessionId, command, start, end, exitCode, stdout, stderr);

  assert.strictEqual(event.type, "COMMAND");
  assert.strictEqual(event.summary, "COMMAND npm run build");
  assert.strictEqual(event.path, "npm run build");
  assert.strictEqual(event.project, project);
  assert.strictEqual(event.sessionId, sessionId);
  assert.strictEqual(event.details.command, command);
  assert.strictEqual(event.details.exitCode, exitCode);
  assert.strictEqual(event.details.stdout, stdout);
  assert.strictEqual(event.details.stderr, stderr);
});

test("createErrorEvent produces correct event shape", () => {
  const project = "/tmp/project";
  const sessionId = "session-123";
  const message = "Error: something went wrong";
  const output = "stack trace here";
  const command = "npm run build";

  const event = createErrorEvent(project, sessionId, message, output, command);

  assert.strictEqual(event.type, "ERROR");
  assert.ok(event.summary.startsWith("ERROR"));
  assert.strictEqual(event.details.message, message);
  assert.strictEqual(event.details.output, output);
  assert.strictEqual(event.details.command, command);
});

test("createFileEvent produces correct FileEvent shape", () => {
  const event = createFileEvent("/tmp/project", "session-123", "/src/Login.jsx", "modified", 1024);

  assert.strictEqual(event.type, "FILE");
  assert.strictEqual(event.summary, "MODIFIED Login.jsx");
  assert.strictEqual(event.path, "/src/Login.jsx");
  assert.strictEqual(event.details.changeType, "modified");
  assert.strictEqual(event.details.size, 1024);
});

test("createGitEvent with commits produces correct shape", () => {
  const event = createGitEvent("/tmp/project", "session-123", {
    branch: "main",
    commits: ["abc123 Fix login"],
    changedPaths: ["src/Login.jsx"],
  });

  assert.strictEqual(event.type, "GIT");
  assert.strictEqual(event.summary, "GIT commit abc123 Fix login");
  assert.strictEqual(event.details.branch, "main");
  assert.deepStrictEqual(event.details.commits, ["abc123 Fix login"]);
});

test("createBuildTestEvent PASSED/FAILED summaries", () => {
  const pass = createBuildTestEvent("/p", "s", "build", 0);
  const fail = createBuildTestEvent("/p", "s", "build", 2);

  assert.strictEqual(pass.type, "BUILD_TEST");
  assert.strictEqual(pass.summary, "BUILD PASSED");
  assert.strictEqual(pass.details.exitCode, 0);

  assert.strictEqual(fail.summary, "BUILD FAILED");
  assert.strictEqual(fail.details.exitCode, 2);
});

test("isBuildFailed classification", () => {
  const passCmd = createCommandEvent("/p", "s", "cmd", "s", "e", 0);
  const failCmd = createCommandEvent("/p", "s", "cmd", "s", "e", 1);
  const passBuild = createBuildTestEvent("/p", "s", "build", 0);
  const failBuild = createBuildTestEvent("/p", "s", "build", 1);
  const fileEvent = createFileEvent("/p", "s", "/f", "modified");

  assert.strictEqual(isBuildFailed(passCmd), false);
  assert.strictEqual(isBuildFailed(failCmd), true);
  assert.strictEqual(isBuildFailed(passBuild), false);
  assert.strictEqual(isBuildFailed(failBuild), true);
  assert.strictEqual(isBuildFailed(fileEvent), false);
});

test("isBuildPassed classification", () => {
  const passBuild = createBuildTestEvent("/p", "s", "build", 0);
  const failBuild = createBuildTestEvent("/p", "s", "build", 1);
  const passCmd = createCommandEvent("/p", "s", "cmd", "s", "e", 0);
  const failCmd = createCommandEvent("/p", "s", "cmd", "s", "e", 1);

  assert.strictEqual(isBuildPassed(passBuild), true);
  assert.strictEqual(isBuildPassed(failBuild), false);
  assert.strictEqual(isBuildPassed(passCmd), true, "COMMAND with exit 0 is a passing build");
  assert.strictEqual(isBuildPassed(failCmd), false, "COMMAND with non-zero exit is not a passing build");
});

test("command event persisted to SQLite", () => {
  const projectDir = tmpDir("run-storage");
  const dbPath = join(projectDir, ".blackbox", "blackbox.db");
  resetStorage({ filepath: dbPath });
  const storage = getStorage({ filepath: dbPath });

  const event = createCommandEvent(
    projectDir,
    "session-test",
    "node -e process.exit(0)",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:01.000Z",
    0,
    "output",
    ""
  );
  storage.insertEvent({ ...event });

  const events = storage.listEvents(projectDir);
  assert.ok(events.length >= 1, "expected at least one event");
  const stored = events.find((e) => e.type === "COMMAND");
  assert.ok(stored, "expected a COMMAND event in storage");
  assert.strictEqual(stored!.details.exitCode, 0);
  assert.strictEqual(stored!.details.command, "node -e process.exit(0)");

  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});

test("failing command event persists COMMAND + ERROR to SQLite", () => {
  const projectDir = tmpDir("run-fail-storage");
  const dbPath = join(projectDir, ".blackbox", "blackbox.db");
  resetStorage({ filepath: dbPath });
  const storage = getStorage({ filepath: dbPath });

  const cmdEvent = createCommandEvent(
    projectDir,
    "session-test",
    "node -e process.exit(1)",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:01.000Z",
    1,
    "",
    "error output"
  );
  storage.insertEvent({ ...cmdEvent });

  const errEvent = createErrorEvent(
    projectDir,
    "session-test",
    "Command failed with exit code 1",
    "error output",
    "node -e process.exit(1)"
  );
  storage.insertEvent({ ...errEvent });

  const events = storage.listEvents(projectDir);
  assert.ok(events.length >= 2, "expected COMMAND and ERROR events");
  assert.ok(events.some((e) => e.type === "COMMAND" && e.details.exitCode === 1));
  assert.ok(events.some((e) => e.type === "ERROR" && String(e.details.message).includes("exit code 1")));

  try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
});
