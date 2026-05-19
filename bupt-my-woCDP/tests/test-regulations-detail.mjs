#!/usr/bin/env node
/**
 * Test: Regulation detail extraction (text + images)
 * 
 * Behavior: When keyword matches, clicking entry shows detail page
 *           Text content extracted from .v_news_content
 *           Image content detected and reported
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

// Test: detail extraction with --json flag
const result = runScript(`node "${searchScript}" --keyword "学生管理规定" --json`);
assert(result.exit === 0, "Detail extraction exits 0");
const data = JSON.parse(result.stdout);

assert(data.title, "Detail has title");
assert(typeof data.contentType === "string", "Detail has contentType (text/images)");
assert(typeof data.content === "string", "Detail has content");

console.log(`Title: ${data.title}`);
console.log(`Content type: ${data.contentType}`);
console.log(`Content length: ${data.content.length}`);
if (data.contentType === "images") {
  assert(data.imageUrls && data.imageUrls.length > 0, "Image entries have imageUrls");
  console.log(`Image count: ${data.imageUrls.length}`);
}

console.log("\nAll detail extraction tests PASSED");
