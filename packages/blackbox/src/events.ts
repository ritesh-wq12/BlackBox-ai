import { randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import type { EventDetails, EventType } from "./db.js";

export interface FileEvent {
  id: string;
  type: "FILE";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: { changeType: "created" | "modified" | "deleted"; size?: number };
  order: number;
}

export interface GitEvent {
  id: string;
  type: "GIT";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: { branch?: string; commits?: string[]; changedPaths?: string[] };
  order: number;
}

export interface CommandEvent {
  id: string;
  type: "COMMAND";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: {
    command: string;
    start: string;
    end: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  order: number;
}

export interface BuildTestEvent {
  id: string;
  type: "BUILD_TEST";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: { exitCode: number; command?: string };
  order: number;
}

export interface ErrorEvent {
  id: string;
  type: "ERROR";
  timestamp: string;
  summary: string;
  path: string;
  project: string;
  sessionId: string;
  details: { message: string; output?: string; command?: string };
  order: number;
}

export type BlackBoxEvent =
  | FileEvent
  | GitEvent
  | CommandEvent
  | BuildTestEvent
  | ErrorEvent;

export function isBuildPassed(event: BlackBoxEvent): boolean {
  return event.type === "BUILD_TEST" && (event as BuildTestEvent).details.exitCode === 0;
}

export function isBuildFailed(event: BlackBoxEvent): boolean {
  if (event.type === "BUILD_TEST") {
    return (event as BuildTestEvent).details.exitCode !== 0;
  }
  if (event.type === "COMMAND") {
    return (event as CommandEvent).details.exitCode !== 0;
  }
  return false;
}

export function createFileEvent(
  project: string,
  sessionId: string,
  filePath: string,
  changeType: "created" | "modified" | "deleted",
  size?: number,
  timestamp: string = new Date().toISOString(),
): FileEvent {
  return {
    id: randomUUID(),
    type: "FILE",
    timestamp,
    summary: `${changeType.toUpperCase()} ${basename(filePath)}`,
    path: filePath,
    project,
    sessionId,
    details: { changeType, size },
    order: 0,
  };
}

export function createGitEvent(
  project: string,
  sessionId: string,
  options: { branch?: string; commits?: string[]; changedPaths?: string[] } = {},
  timestamp: string = new Date().toISOString(),
): GitEvent {
  return {
    id: randomUUID(),
    type: "GIT",
    timestamp,
    summary: options.commits && options.commits.length ? `GIT commit ${options.commits[0]}` : "GIT activity",
    path: options.changedPaths?.[0] ?? "",
    project,
    sessionId,
    details: {
      branch: options.branch,
      commits: options.commits,
      changedPaths: options.changedPaths,
    },
    order: 0,
  };
}

export function createCommandEvent(
  project: string,
  sessionId: string,
  command: string,
  start: string,
  end: string,
  exitCode: number,
  stdout = "",
  stderr = "",
  timestamp: string = new Date().toISOString(),
): CommandEvent {
  return {
    id: randomUUID(),
    type: "COMMAND",
    timestamp,
    summary: `COMMAND ${command}`,
    path: command,
    project,
    sessionId,
    details: { command, start, end, exitCode, stdout, stderr },
    order: 0,
  };
}

export function createBuildTestEvent(
  project: string,
  sessionId: string,
  command: string,
  exitCode: number,
  timestamp: string = new Date().toISOString(),
): BuildTestEvent {
  return {
    id: randomUUID(),
    type: "BUILD_TEST",
    timestamp,
    summary: exitCode === 0 ? "BUILD PASSED" : "BUILD FAILED",
    path: command,
    project,
    sessionId,
    details: { exitCode, command },
    order: 0,
  };
}

export function createErrorEvent(
  project: string,
  sessionId: string,
  message: string,
  output = "",
  command = "",
  timestamp: string = new Date().toISOString(),
): ErrorEvent {
  return {
    id: randomUUID(),
    type: "ERROR",
    timestamp,
    summary: `ERROR ${message.slice(0, 80)}`,
    path: command,
    project,
    sessionId,
    details: { message, output, command },
    order: 0,
  };
}
