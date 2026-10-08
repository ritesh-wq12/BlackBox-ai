// Deterministic build simulation.
// Exits 0 when all source files parse as valid JS; exits 1 on syntax errors.
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { Script } from "node:vm";

const srcDir = new URL("./src/", import.meta.url);
const files = globSync("**/*.js", { cwd: srcDir, nodir: true });

let ok = true;
for (const f of files) {
  const fp = new URL(`./${f}`, srcDir);
  const code = readFileSync(fp, "utf-8");
  try {
    // Validate syntax by parsing. Wrap in async function to support top-level await.
    new Script(code, { filename: fp.pathname || fp });
  } catch (err) {
    ok = false;
    console.error(`Build failed: syntax error in src/${f}: ${err.message}`);
  }
}

if (ok) {
  console.log("✓ Demo build passed — all source files parse correctly.");
  process.exit(0);
} else {
  console.error("✕ Demo build failed.");
  process.exit(1);
}
