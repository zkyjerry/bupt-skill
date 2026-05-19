#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stateFile = join(homedir(), ".bupt-my", "session.json");

function run(cmd) {
  try { return { exit: 0, stdout: execSync(cmd, { encoding: "utf-8", timeout: 60000 }) }; }
  catch (err) { return { exit: err.status || 1, stdout: err.stdout || "" }; }
}
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`PASS: ${msg}`);
}

if (!existsSync(stateFile)) { console.error("SKIP: No login state."); process.exit(0); }

const categories = [
  { name: "news", label: "校内新闻", keyword: "活动" },
  { name: "notices", label: "校内通知", keyword: "通知" },
  { name: "files", label: "校内文件", keyword: "北京邮电大学" },
  { name: "guides", label: "办事指南", keyword: "办理" },
];

for (const cat of categories) {
  const script = join(__dirname, "..", "scripts", `search-${cat.name}.mjs`);
  const result = run(`node "${script}" --keyword "${cat.keyword}" --list-only`);
  assert(result.exit === 0, `search-${cat.name}.mjs --keyword "${cat.keyword}" exits 0`);
  assert(result.stdout.includes(cat.label), `Output contains "${cat.label}"`);
  console.log(`  ${cat.label}: ${result.stdout.trim().split("\n").length} lines`);
}

console.log("\nAll category tests PASSED");
