#!/usr/bin/env node
/**
 * Test: Login to my.bupt.edu.cn
 * 
 * Behavior: After login, script exits 0 and stdout contains "my.bupt.edu.cn"
 */
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const loginScript = join(__dirname, "..", "scripts", "login.mjs");

const STUDENT_ID = process.env.BUPT_STUDENT_ID;
const PASSWORD = process.env.BUPT_PASSWORD;

if (!STUDENT_ID || !PASSWORD) {
  console.error("SKIP: Set BUPT_STUDENT_ID and BUPT_PASSWORD env vars to run login test.");
  process.exit(0);
}

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

const cmd = `node "${loginScript}" "${STUDENT_ID}" "${PASSWORD}" "http://my.bupt.edu.cn"`;
const result = runScript(cmd);

assert(result.exit === 0, `Login exits 0 (got ${result.exit})`);
assert(result.stdout.includes("my.bupt.edu.cn"), `stdout contains my.bupt.edu.cn (got: "${result.stdout.substring(0, 200)}")`);
console.log("\nAll login tests PASSED");
