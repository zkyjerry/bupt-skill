#!/usr/bin/env node
/**
 * Test: Image download for image-based regulations
 * 
 * Behavior: When --download-dir is specified, images are downloaded to a named folder
 */
import { execSync } from "child_process";
import { existsSync, readdirSync, rmdirSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchScript = join(__dirname, "..", "scripts", "search-regulations.mjs");
const stateFile = join(homedir(), ".bupt-my", "session.json");
const tmpDir = join(tmpdir(), "bupt-my-test-download");

function runScript(cmd) {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
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

try {
  // Clean up any previous test downloads
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

  const result = runScript(`node "${searchScript}" --keyword "学生管理规定" --json --download-dir "${tmpDir}"`);
  assert(result.exit === 0, "Download exits 0");

  const data = JSON.parse(result.stdout);
  assert(data.contentType === "images", "Content is image type");
  assert(data.imageUrls && data.imageUrls.length > 0, "Has image URLs");

  // Check downloaded files
  const folders = readdirSync(tmpDir);
  assert(folders.length > 0, "Files were downloaded to a folder");

  const downloadFolder = join(tmpDir, folders[0]);
  const files = readdirSync(downloadFolder);
  console.log(`Downloaded ${files.length} images to ${downloadFolder}`);
  assert(files.length > 0, "Image files exist in download folder");

  // Clean up
  rmSync(tmpDir, { recursive: true });
} finally {
  // Ensure cleanup
  if (existsSync(tmpDir)) {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

console.log("\nAll image download tests PASSED");
