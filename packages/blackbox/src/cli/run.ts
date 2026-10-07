import { spawn } from "node:child_process";
import { join } from "node:path";
import { getStorage } from "../storage/index.js";
import { createCommandEvent, createErrorEvent, isBuildFailed } from "../events.js";

export class RunCommand {
  private storage: ReturnType<typeof getStorage>;

  constructor(private projectDir: string) {
    this.storage = getStorage({
      filepath: join(this.projectDir, ".blackbox", "blackbox.db"),
    });
  }

  run(args: string[]): void {
    const command = args.join(" ");
    if (!command) {
      console.error("blackbox run: no command specified. Usage: blackbox run <command...>");
      process.exitCode = 1;
      return;
    }

    console.log(`\n$ ${command}\n`);

    const start = Date.now();
    const child = spawn(command, args, {
      cwd: this.projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stdout.write(chunk);
    });

    child.on("error", (error) => {
      const end = Date.now();
      const event = createCommandEvent(
        this.projectDir,
        this.getSessionId(),
        command,
        String(start),
        String(end),
        -1,
        stdout,
        stderr ?? ""
      );
      this.storage.insertEvent({ ...event });

      const failed = createErrorEvent(
        this.projectDir,
        this.getSessionId(),
        error.message,
        "",
        command,
        new Date().toISOString()
      );
      this.storage.insertEvent({ ...failed });

      console.log(`\n✕ Black Box recorded: BUILD FAILED`);
      process.exitCode = 1;
    });

    child.on("close", (code) => {
      const end = Date.now();
      const exitCode = code ?? 1;

      const commandEvent = createCommandEvent(
        this.projectDir,
        this.getSessionId(),
        command,
        String(start),
        String(end),
        exitCode,
        stdout,
        stderr ?? ""
      );
      this.storage.insertEvent({ ...commandEvent });

      if (exitCode !== 0) {
        const errorEvent = createErrorEvent(
          this.projectDir,
          this.getSessionId(),
          `Command failed with exit code ${exitCode}`,
          stderr ?? "",
          command,
          new Date().toISOString()
        );
        this.storage.insertEvent({ ...errorEvent });
      }

      if (isBuildFailed(commandEvent)) {
        console.log(`\n✕ Black Box recorded: BUILD FAILED`);
        process.exitCode = 1;
      } else {
        console.log(`\n✓ Black Box recorded: BUILD PASSED`);
      }
    });

    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }, 5000);
  }

  private getSessionId(): string {
    return `session-${Date.now()}-${process.pid}`;
  }
}
