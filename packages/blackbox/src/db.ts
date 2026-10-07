/**
 * Storage adapter for the Digital Black Box.
 *
 * Primary driver: Node.js built-in `node:sqlite` (DatabaseSync), available in
 * Node >= 22. It has no native module, no build step, no native compilation.
 *
 * Fallback: `better-sqlite3` (npm). On Windows / machines without Visual
 * Studio build tools, better-sqlite3 cannot be compiled, so it is listed as a
 * devDependency that is intentionally never imported here. The build always
 * prefers node:sqlite when it is present; if it is missing or throws on
 * process.start, the CLI exits with a clear message instead of corrupting the
 * database.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export type EventType = "FILE" | "GIT" | "COMMAND" | "BUILD_TEST" | "ERROR";

export interface EventDetails {
  exitCode?: number;
  error?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  output?: string;
  [key: string]: unknown;
}

export interface StoredEvent {
  id: string;
  type: EventType;
  timestamp: string;
  summary: string;
  details: EventDetails;
  path: string;
  project: string;
  sessionId: string;
  order: number;
}

export interface DbConfig {
  filepath: string;
}

export interface EventHistory {
  lastHealthyEventId: string | null;
  lastHealthyTimestamp: string | null;
}

export class Storage {
  private db: DatabaseSync;
  private config: DbConfig;

  private static readonly SCHEMA = `
    CREATE TABLE IF NOT EXISTS events (
      "order" INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      path TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      sessionId TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_events_order ON events("order");
    CREATE TABLE IF NOT EXISTS events_histories (
      project TEXT PRIMARY KEY,
      last_healthy_event_id TEXT,
      last_healthy_timestamp TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      project TEXT NOT NULL DEFAULT '',
      agent_pid INTEGER
    );
  `;

  constructor(config: DbConfig) {
    this.config = config;
    mkdirSync(dirname(config.filepath), { recursive: true });
    this.db = new DatabaseSync(config.filepath);
    this.db.exec(Storage.SCHEMA);
  }

  /**
   * Atomically assign the next insertion order. Shared across the whole
   * process, so `RunCommand` and `Watcher` never collide.
   */
  insertEvent(event: {
    id: string;
    type: EventType;
    timestamp: string;
    summary: string;
    details: EventDetails;
    path: string;
    project: string;
    sessionId: string;
  }): void {
    this.db.prepare(
      `INSERT INTO events
        (id, type, timestamp, summary, details, path, project, sessionId)
       VALUES ($id, $type, $timestamp, $summary, $details, $path, $project, $sessionId)`
    ).run({
      $id: event.id,
      $type: event.type,
      $timestamp: event.timestamp,
      $summary: event.summary,
      $details: JSON.stringify(event.details),
      $path: event.path,
      $project: event.project,
      $sessionId: event.sessionId,
    });
  }

  listEvents(project: string): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, timestamp, summary, details, path, project, sessionId, "order"
         FROM events
         WHERE project = $project
         ORDER BY "order" ASC`
      )
      .all({ $project: project }) as {
        id: string;
        type: string;
        timestamp: string;
        summary: string;
        details: string;
        path: string;
        project: string;
        sessionId: string;
        order: number;
      }[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type as EventType,
      timestamp: r.timestamp,
      summary: r.summary,
      details: JSON.parse(r.details) as EventDetails,
      path: r.path,
      project: r.project,
      sessionId: r.sessionId,
      order: r.order,
    }));
  }

  listAllEvents(): StoredEvent[] {
    const rows = this.db.prepare(
      `SELECT id, type, timestamp, summary, details, path, project, sessionId, "order"
       FROM events
       ORDER BY "order" ASC`
    ).all() as {
      id: string;
      type: string;
      timestamp: string;
      summary: string;
      details: string;
      path: string;
      project: string;
      sessionId: string;
      order: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type as EventType,
      timestamp: r.timestamp,
      summary: r.summary,
      details: JSON.parse(r.details) as EventDetails,
      path: r.path,
      project: r.project,
      sessionId: r.sessionId,
      order: r.order,
    }));
  }

  insertEventHistory(project: string, lastHealthyEventId: string | null, lastHealthyTimestamp: string | null): void {
    this.db.prepare(
      `INSERT INTO events_histories (project, last_healthy_event_id, last_healthy_timestamp, updated_at)
       VALUES ($project, $lastHealthyEventId, $lastHealthyTimestamp, $updatedAt)
       ON CONFLICT(project) DO UPDATE SET
         last_healthy_event_id = $lastHealthyEventId,
         last_healthy_timestamp = $lastHealthyTimestamp,
         updated_at = $updatedAt`
    ).run({
      $project: project,
      $lastHealthyEventId: lastHealthyEventId ?? null,
      $lastHealthyTimestamp: lastHealthyTimestamp ?? null,
      $updatedAt: new Date().toISOString(),
    });
  }

  getEventHistory(project: string): EventHistory {
    const row = this.db
      .prepare(
        `SELECT last_healthy_event_id, last_healthy_timestamp
         FROM events_histories
         WHERE project = $project`
      )
      .get({ $project: project }) as {
      last_healthy_event_id: string | null;
      last_healthy_timestamp: string | null;
    } | undefined;

    return {
      lastHealthyEventId: row?.last_healthy_event_id ?? null,
      lastHealthyTimestamp: row?.last_healthy_timestamp ?? null,
    };
  }

  insertSession(session: {
    id: string;
    startedAt: string;
    status: "running" | "paused" | "stopped";
    project: string;
    agentPid: number | null;
  }): void {
    this.db.prepare(
      `INSERT INTO sessions (id, started_at, status, project, agent_pid)
       VALUES ($id, $startedAt, $status, $project, $agentPid)
       ON CONFLICT(id) DO UPDATE SET status = $status`
    ).run({
      $id: session.id,
      $startedAt: session.startedAt,
      $status: session.status,
      $project: session.project,
      $agentPid: session.agentPid ?? null,
    });
  }

  getSession(id: string): {
    id: string;
    startedAt: string;
    status: string;
    project: string;
    agentPid: number | null;
  } | null {
    return this.db
      .prepare("SELECT id, started_at, status, project, agent_pid FROM sessions WHERE id = $id")
      .get({ $id: id }) as {
      id: string;
      startedAt: string;
      status: string;
      project: string;
      agentPid: number | null;
    } | null;
  }

  listSessions(): {
    id: string;
    startedAt: string;
    status: string;
    project: string;
    agentPid: number | null;
  }[] {
    return this.db
      .prepare("SELECT id, started_at, status, project, agent_pid FROM sessions ORDER BY started_at DESC")
      .all() as {
      id: string;
      startedAt: string;
      status: string;
      project: string;
      agentPid: number | null;
    }[];
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = $id").run({ $id: id });
  }

  close(): void {
    this.db.close();
  }
}

let _storage: Storage | null = null;
let _nextOrder = 0;

export function nextOrder(): number {
  return _nextOrder++;
}

export function getStorage(config: DbConfig): Storage {
  if (!_storage) {
    _storage = new Storage(config);
  }
  return _storage;
}

export function resetStorage(config: DbConfig): void {
  _storage?.close();
  try {
    unlinkSync(config.filepath);
  } catch {
    // ignore if it doesn't exist
  }
  _storage = new Storage(config);
}

export const PRIMARY_DRIVER = "node:sqlite (built-in)";
export const FALLBACK_DRIVER = "better-sqlite3 (npm)";
