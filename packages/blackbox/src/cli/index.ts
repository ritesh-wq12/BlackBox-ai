#!/usr/bin/env node
/**
 * blackbox — the CLI entry.
 *
 * Usage:
 *   blackbox start
 *   blackbox start --port 8999
 *   blackbox run <command...>
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StartCommand } from "./start.js";
import { RunCommand } from "./run.js";

const __filename = fileURLToPath(import.meta.url);
const _here = dirname(__filename);
const __dirname = resolve(_here, "..", "..");

function readPackageName(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).name ?? "blackbox";
  } catch {
    return "blackbox";
  }
}

function parseArgs(args: string[]): {
  projectDir: string;
  portParam: number | undefined;
  rest: string[];
} {
  let projectDir = process.cwd();
  let portParam: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1] !== undefined) {
      const next = args[i + 1] as string;
      projectDir = next;
      i++;
    } else if (args[i] === "--project=") {
      const key = args[i] as string;
      projectDir = key.slice(9);
    } else if (args[i] === "--port" && args[i + 1] !== undefined) {
      const next = args[i + 1] as string;
      portParam = Number(next);
      i++;
    } else if (args[i] === "--port=") {
      const p = args[i] as string;
      portParam = Number(p.slice(7));
    } else {
      const a = args[i] as string;
      rest.push(a);
    }
  }
  return { projectDir, portParam, rest };
}

function printUsage(): void {
  console.log(`
Digital Black Box — local, evidence-first flight recorder for software projects.

Usage:
  blackbox start                                   Start recording for a project folder.
  blackbox run <command...>                        Run a command and record it as an event.

Demo flow:
  blackbox start                 # CLI starts, prints confirmation, opens dashboard
  blackbox run npm run build     # passes command through, records event
  blackbox run npm run build     # after breaking a file -> BUILD FAILED

See README.md for the full demo loop.
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "start": {
      const { projectDir, portParam } = parseArgs(args.slice(1));
      const start = new StartCommand({ projectDir });
      start.run(portParam);
      break;
    }
    case "run": {
      const { projectDir, rest } = parseArgs(args.slice(1));
      const run = new RunCommand(projectDir);
      run.run(rest);
      break;
    }
    case "--help":
    case "-h": {
      printUsage();
      break;
    }
    case "--version":
    case "-v": {
      console.log(readPackageName());
      break;
    }
    case undefined:
      printUsage();
      break;
    default: {
      console.error(`blackbox: unknown command "${command}"`);
      printUsage();
      process.exitCode = 1;
    }
  }
}

main();
