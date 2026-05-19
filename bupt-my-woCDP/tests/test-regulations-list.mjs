#!/usr/bin/env node
/**
 * Test: Access regulations list page and list items
 * 
 * Behavior: Script exits 0 and lists regulation titles from the list page
 * Requirement: login.mjs must have been run first (session state saved)
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchScript = join(__dirname, "..", "scripts", "search-regulations.mjs");
const stateFile = join(homedir(), ".bupt-my", "session.json");

function runScript(cmd) {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
    return { exit: 0, stdout, stderr: "" };
  } catch (err) {
    return { exit: err.status || 1, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

if (!existsSync(stateFile)) {
  console.error("SKIP: No login state found. Run login.mjs first.");
  process.exit(0);
}

const cmd = `node "${searchScript}" --list-only`;
const result = runScript(cmd);

assert(result.exit === 0, `Exits 0 (got ${result.exit})`);
assert(result.stdout.length > 0, "Output is non-empty");
assert(result.stdout.includes("规章制度"), "Output contains '规章制度'");
console.log(`\nOutput preview (first 500 chars):`);
console.log(result.stdout.substring(0, 500));
console.log("\nAll regulations list tests PASSED");
