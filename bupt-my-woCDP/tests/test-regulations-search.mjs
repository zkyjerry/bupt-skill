#!/usr/bin/env node
/**
 * Test: Search regulations by keyword
 * 
 * Behavior: Script exits 0 when keyword matches, exits 1 when no match
 *           Output contains matching entries
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

// Test 1: keyword match
const result1 = runScript(`node "${searchScript}" --keyword "采购" --list-only`);
assert(result1.exit === 0, `Keyword "采购" match exits 0 (got ${result1.exit})`);
assert(result1.stdout.includes("采购"), "Output contains matching entries");
console.log(`Matched items: ${result1.stdout.split("\n").filter(l => l.match(/^\s+\d+\./)).length}`);

// Test 2: keyword no match
const result2 = runScript(`node "${searchScript}" --keyword "ZZZZZZZZZZ" --list-only`);
assert(result2.exit === 1, `Non-matching keyword exits 1 (got ${result2.exit})`);

// Test 3: JSON output
const result3 = runScript(`node "${searchScript}" --keyword "采购" --list-only --json`);
assert(result3.exit === 0, "JSON output exits 0");
const data = JSON.parse(result3.stdout);
assert(data.total > 0, `JSON has items (${data.total})`);
assert(data.keyword === "采购", "JSON has correct keyword");

console.log("\nAll keyword search tests PASSED");
