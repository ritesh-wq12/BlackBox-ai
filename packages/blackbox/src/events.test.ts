import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFileEvent,
  createGitEvent,
  createCommandEvent,
  createBuildTestEvent,
  createErrorEvent,
  isBuildPassed,
  isBuildFailed,
} from "./events.js";

const PROJECT = "/tmp/project";
const SESSION = "session-test-123";

test("createFileEvent produces correct FileEvent shape", () => {
  const event = createFileEvent(PROJECT, SESSION, "/src/Login.jsx", "modified", 1024);

  assert.strictEqual(event.type, "FILE");
  assert.strictEqual(event.summary, "MODIFIED Login.jsx");
  assert.strictEqual(event.path, "/src/Login.jsx");
  assert.strictEqual(event.project, PROJECT);
  assert.strictEqual(event.sessionId, SESSION);
  assert.deepStrictEqual(event.details, { changeType: "modified", size: 1024 });
  assert.ok(event.id);
  assert.ok(event.timestamp);
});

test("createFileEvent default size undefined", () => {
  const event = createFileEvent(PROJECT, SESSION, "/src/App.tsx", "created");

  assert.strictEqual(event.details.changeType, "created");
  assert.strictEqual(event.details.size, undefined);
});

test("createGitEvent with commits produces correct shape", () => {
  const event = createGitEvent(PROJECT, SESSION, {
    branch: "main",
    commits: ["abc123 Fix login"],
    changedPaths: ["src/Login.jsx"],
  });

  assert.strictEqual(event.type, "GIT");
  assert.strictEqual(event.summary, "GIT commit abc123 Fix login");
  assert.strictEqual(event.details.branch, "main");
  assert.deepStrictEqual(event.details.commits, ["abc123 Fix login"]);
  assert.deepStrictEqual(event.details.changedPaths, ["src/Login.jsx"]);
});

test("createGitEvent without commits produces generic summary", () => {
  const event = createGitEvent(PROJECT, SESSION, { branch: "feature" });

  assert.strictEqual(event.type, "GIT");
  assert.strictEqual(event.summary, "GIT activity");
  assert.strictEqual(event.details.branch, "feature");
  assert.deepStrictEqual(event.details.commits, undefined);
});

test("createCommandEvent produces correct shape with all fields", () => {
  const event = createCommandEvent(
    PROJECT,
    SESSION,
    "npm run build",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:05.000Z",
    0,
    "Build succeeded",
    ""
  );

  assert.strictEqual(event.type, "COMMAND");
  assert.strictEqual(event.summary, "COMMAND npm run build");
  assert.strictEqual(event.path, "npm run build");
  assert.strictEqual(event.details.command, "npm run build");
  assert.strictEqual(event.details.exitCode, 0);
  assert.strictEqual(event.details.stdout, "Build succeeded");
  assert.strictEqual(event.details.stderr, "");
  assert.strictEqual(event.details.start, "2024-01-01T00:00:00.000Z");
  assert.strictEqual(event.details.end, "2024-01-01T00:00:05.000Z");
});

test("createBuildTestEvent PASSED summary for exit 0", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "npm test", 0);

  assert.strictEqual(event.type, "BUILD_TEST");
  assert.strictEqual(event.summary, "BUILD PASSED");
  assert.strictEqual(event.details.exitCode, 0);
  assert.strictEqual(event.details.command, "npm test");
});

test("createBuildTestEvent FAILED summary for non-zero exit", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "npm run build", 2);

  assert.strictEqual(event.type, "BUILD_TEST");
  assert.strictEqual(event.summary, "BUILD FAILED");
  assert.strictEqual(event.details.exitCode, 2);
});

test("createErrorEvent produces correct shape", () => {
  const event = createErrorEvent(
    PROJECT,
    SESSION,
    "Cannot read properties of undefined",
    "TypeError: Cannot read properties of undefined",
    "npm run build"
  );

  assert.strictEqual(event.type, "ERROR");
  assert.ok(event.summary.startsWith("ERROR"));
  assert.strictEqual(event.details.message, "Cannot read properties of undefined");
  assert.strictEqual(event.details.output, "TypeError: Cannot read properties of undefined");
  assert.strictEqual(event.details.command, "npm run build");
});

test("isBuildPassed returns true for BUILD_TEST with exit 0", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "build", 0);
  assert.strictEqual(isBuildPassed(event), true);
});

test("isBuildPassed returns false for BUILD_TEST with non-zero exit", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "build", 1);
  assert.strictEqual(isBuildPassed(event), false);
});

test("isBuildPassed returns true for COMMAND with exit 0 (successful build/test command)", () => {
  const cmdEvent = createCommandEvent(PROJECT, SESSION, "cmd", "s", "e", 0);
  assert.strictEqual(isBuildPassed(cmdEvent), true);
});

test("isBuildPassed returns false for non-build events (FILE, GIT)", () => {
  const fileEvent = createFileEvent(PROJECT, SESSION, "/f", "modified");
  const gitEvent = createGitEvent(PROJECT, SESSION, { branch: "main" });

  assert.strictEqual(isBuildPassed(fileEvent), false);
  assert.strictEqual(isBuildPassed(gitEvent), false);
});

test("isBuildFailed returns true for BUILD_TEST with non-zero exit", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "build", 1);
  assert.strictEqual(isBuildFailed(event), true);
});

test("isBuildFailed returns true for COMMAND with non-zero exit", () => {
  const event = createCommandEvent(PROJECT, SESSION, "cmd", "s", "e", 2);
  assert.strictEqual(isBuildFailed(event), true);
});

test("isBuildFailed returns false for BUILD_TEST with exit 0", () => {
  const event = createBuildTestEvent(PROJECT, SESSION, "build", 0);
  assert.strictEqual(isBuildFailed(event), false);
});

test("isBuildFailed returns false for FILE and GIT events", () => {
  const fileEvent = createFileEvent(PROJECT, SESSION, "/f", "modified");
  const gitEvent = createGitEvent(PROJECT, SESSION, { branch: "main" });

  assert.strictEqual(isBuildFailed(fileEvent), false);
  assert.strictEqual(isBuildFailed(gitEvent), false);
});
