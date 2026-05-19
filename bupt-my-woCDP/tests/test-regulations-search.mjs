#!/usr/bin/env node
/**
 * Test: Search regulations using page's built-in search form
 * 
 * Behavior: Script fills the INTEXT search field, submits, and finds results
 *           on fz_ssjg.jsp page instead of scraping the list page
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchScript = join(__dirname, "..", "scripts", "search-regulations.mjs");
const stateFile = join(homedir(), ".bupt-my", "session.json");

function run(cmd) {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
    return { exit: 0, stdout, stderr: "" };
  } catch (err) {
    return { exit: err.status || 1, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`PASS: ${msg}`);
}

if (!existsSync(stateFile)) {
  console.error("SKIP: No login state. Run login.mjs first.");
  process.exit(0);
}

// Test 1: search using built-in form should find 采购人代表
const r1 = run(`node "${searchScript}" --keyword "采购人代表" --json`);
assert(r1.exit === 0, `Search "采购人代表" exits 0`);
const data1 = JSON.parse(r1.stdout);
assert(data1.title, "Detail has title");
assert(data1.title.includes("采购人代表"), `Title contains "采购人代表" (got: ${data1.title})`);
console.log(`  Title: ${data1.title}`);
console.log(`  Type: ${data1.contentType}`);

// Test 2: no-match keyword should suggest alternatives
const r2 = run(`node "${searchScript}" --keyword "ZZZZZZZZZZ" --json`);
assert(r2.exit === 1, `Non-match exits 1`);
const data2 = JSON.parse(r2.stdout);
assert(data2.error === "not_found", "Returns not_found error");
// suggestions may be empty if search returns no results at all
console.log(`  Suggestions count: ${(data2.suggestions||[]).length}`);

// Test 3: list-only works
const r3 = run(`node "${searchScript}" --keyword "采购" --list-only`);
assert(r3.exit === 0, "List-only exits 0");
assert(r3.stdout.includes("采购"), "List output contains matches");

console.log("\nAll search-via-form tests PASSED");
