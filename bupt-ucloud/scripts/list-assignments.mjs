#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 获取本学期所有课程的作业
 *
 * 用法：
 *   node list-assignments.mjs [--json] [--pending-only]
 *
 * 选项：
 *   --json          以 JSON 格式输出
 *   --pending-only  只输出未提交（待办）的作业
 *
 * 退出码：
 *   0  成功
 *   1  获取失败（未登录等）
 *   2  环境异常
 *
 * 原理：
 *   顺序导航。每门课：index.html 点课程卡片 → course.html 点「作业」tab
 *   → 等 DOM 渲染 → 从表格提取作业数据。
 *   course.html 的课程上下文由 index.html 点击行为注入，无法跳过。
 */

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const AUTH_DOMAIN = "auth.bupt.edu.cn";

const isJson = process.argv.includes("--json");
const pendingOnly = process.argv.includes("--pending-only");

// ── 工具函数 ────────────────────────────────────────────
async function req(path, options = {}) {
  const opts = { ...options };
  if (opts.body && !opts.headers) opts.headers = { "Content-Type": "text/plain" };
  const res = await fetch(`${PROXY}${path}`, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${path} — ${body.slice(0, 150)}`);
  }
  return res.json();
}

async function evalIn(targetId, js) {
  const r = await req(`/eval?target=${targetId}`, { method: "POST", body: js });
  return r.value;
}

async function evalSafe(targetId, js) {
  try { return await evalIn(targetId, js); } catch (_) { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitUrl(targetId, { notContains = "", contains = "", timeoutMs = 12000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await req(`/info?target=${targetId}`);
    const url = info.url || "";
    const ready = info.ready === "complete";
    const urlOk = url !== "about:blank"
      && (!notContains || !url.includes(notContains))
      && (!contains || url.includes(contains));
    if (ready && urlOk) return url;
    await sleep(400);
  }
  throw new Error("waitUrl 超时");
}

// ── 从作业列表页 DOM 提取作业 ─────────────────────────────
// el-table 结构：标题列是 is-hidden（主 body），标题实际渲染在 .el-table__fixed 固定列里
// 其余列（模式/章节/截止/提交/状态）在主 body 的可见 td 里
const EXTRACT_JS = `(function(){
  try {
    const courseName = document.querySelector(".course-nav")
      ?.innerText?.trim().split("\\n")[0] || "";

    // el-table 渲染两套 tr（按 DOM 顺序）：
    //   主 body 行 (0..N-1)：td[0] 有 is-hidden 类（标题占位，内容为空）
    //   固定列行 (N..2N-1)：td[0] 无 is-hidden 类（内容是作业标题）
    const allBodyRows = Array.from(document.querySelectorAll(".el-table__body tr"));
    const mainRows  = allBodyRows.filter(r => r.querySelector("td")?.classList.contains("is-hidden"));
    const fixedRows = allBodyRows.filter(r => !r.querySelector("td")?.classList.contains("is-hidden"));
    const titles = fixedRows.map(r => r.querySelector("td .cell")?.innerText?.trim() || "");

    if (!mainRows.length) return { courseName, assignments: [], noData: true };

    const assignments = mainRows.map((row, i) => {
      const allTds = Array.from(row.querySelectorAll("td"));
      const visibleTds = allTds.filter(td => !td.classList.contains("is-hidden"));
      const title       = titles[i] || allTds.find(td=>td.classList.contains("is-hidden"))?.querySelector(".cell")?.innerText?.trim() || "";
      const mode        = visibleTds[0]?.querySelector(".cell")?.innerText?.trim() || "";
      const chapter     = visibleTds[1]?.querySelector(".cell")?.innerText?.trim() || "";
      const endTime     = visibleTds[2]?.querySelector(".cell")?.innerText?.trim() || "";
      const submitTime  = visibleTds[3]?.querySelector(".cell")?.innerText?.trim() || "";
      const assignStatus= visibleTds[4]?.querySelector(".cell")?.innerText?.trim() || "";
      const myStatus    = visibleTds[5]?.querySelector(".cell")?.innerText?.trim() || "";
      return { title, mode, chapter, endTime, submitTime, assignStatus, myStatus };
    }).filter(a => a.endTime);

    return { courseName, assignments };
  } catch(e) { return { error: e.message }; }
})()`;

// ── 主流程 ───────────────────────────────────────────────
async function listAssignments() {
  let targetId = null;
  try {
    // 1. 打开主页
    const tab = await req(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = tab.targetId;

    // 2. 等主页加载
    const homeUrl = await waitUrl(targetId, { contains: "homePage" });
    if (homeUrl.includes(AUTH_DOMAIN)) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // 3. 等课程卡片出现
    process.stderr.write("等待主页加载...");
    let courseCount = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const r = await evalIn(targetId, `(function(){
          try {
            const items = document.querySelectorAll(".my-lesson-item");
            return items.length;
          } catch(e) { return 0; }
        })()`);
        if (r > 0) { courseCount = r; break; }
      } catch (_) {}
    }
    if (!courseCount) throw new Error("未找到课程卡片");
    await sleep(1000); // 等 SPA 数据绑定
    process.stderr.write(` 找到 ${courseCount} 门课\n`);

    // 4. 逐门课处理
    const allResults = [];

    for (let i = 0; i < courseCount; i++) {
      process.stderr.write(`  [${i + 1}/${courseCount}] 正在获取...`);

      // 4a. 确保在主页，点第 i 个课程卡片
      const curUrl = (await req(`/info?target=${targetId}`)).url;
      if (!curUrl.includes("index.html")) {
        // 导回主页
        await evalIn(targetId, `location.href = ${JSON.stringify(HOME_URL)}`);
        await waitUrl(targetId, { contains: "homePage" });
        await sleep(1000);
        for (let j = 0; j < 16; j++) {
          await sleep(500);
          try {
            const c = await evalIn(targetId, `(function(){
              try { return document.querySelectorAll(".my-lesson-item").length; } catch(e){ return 0; }
            })()`);
            if (c > 0) break;
          } catch (_) {}
        }
        await sleep(500);
      }

      // 4b. 点课程卡片
      const clicked = await evalSafe(targetId, `(function(){
        try {
          const items = document.querySelectorAll(".my-lesson-item");
          if (!items[${i}]) return false;
          items[${i}].click();
          return true;
        } catch(e) { return false; }
      })()`);

      if (!clicked) {
        process.stderr.write(` 跳过（点击失败）\n`);
        allResults.push({ course: `课程${i + 1}`, assignments: [], error: "click failed" });
        continue;
      }

      // 4c. 等 course.html 加载
      await waitUrl(targetId, { contains: "course.html" });
      await sleep(800);

      // 4d. 读课程名（左侧导航）
      let courseName = `课程${i + 1}`;
      for (let j = 0; j < 10; j++) {
        await sleep(400);
        const name = await evalSafe(targetId, `(function(){
          try {
            const nav = document.querySelector(".course-nav");
            return nav?.innerText?.trim().split("\\n")[0] || "";
          } catch(e) { return ""; }
        })()`);
        if (name) { courseName = name; break; }
      }

      // 4e. 点「作业」tab
      const tabClicked = await evalSafe(targetId, `(function(){
        try {
          const tab = Array.from(document.querySelectorAll(".nav-item"))
            .find(el => el.innerText?.trim() === "作业");
          if (!tab) return false;
          tab.click();
          return true;
        } catch(e) { return false; }
      })()`);

      if (!tabClicked) {
        process.stderr.write(` ${courseName} — 作业 tab 未找到\n`);
        allResults.push({ course: courseName, assignments: [] });
        continue;
      }

      // 4f. 等作业表格出现（最多 8s）
      let tableReady = false;
      for (let j = 0; j < 16; j++) {
        await sleep(500);
        const r = await evalSafe(targetId, `(function(){
          try {
            const rows = document.querySelectorAll(".el-table__body tr");
            const noData = document.querySelector(".el-table__empty-block");
            return rows.length > 0 ? "rows" : (noData ? "empty" : "loading");
          } catch(e) { return "err"; }
        })()`);
        if (r === "rows" || r === "empty") { tableReady = true; break; }
      }

      // 4g. 提取作业数据
      const extracted = await evalSafe(targetId, EXTRACT_JS);
      const assignments = extracted?.assignments || [];

      process.stderr.write(` ${courseName} — ${assignments.length} 项作业\n`);
      allResults.push({ course: courseName, assignments });
    }

    // 5. 输出结果
    const filtered = pendingOnly
      ? allResults.map(r => ({ ...r, assignments: r.assignments.filter(a => a.myStatus.includes("未提交")) })).filter(r => r.assignments.length > 0)
      : allResults;

    if (isJson) {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      let hasAny = false;
      filtered.forEach(({ course, assignments }) => {
        if (!assignments.length) return;
        hasAny = true;
        console.log(`\n【${course}】（${assignments.length} 项）`);
        assignments.forEach((a, i) => {
          const pending = a.myStatus.includes("未提交") ? " ⚠️ 未提交" : "";
          console.log(`  ${i + 1}. ${a.title}${pending}`);
          console.log(`     截止：${a.endTime || "—"}  |  状态：${a.myStatus || "—"}  |  章节：${a.chapter || "—"}`);
        });
      });
      if (!hasAny) console.log("（所有课程均无作业）");
    }

    return 0;
  } finally {
    if (targetId) await req(`/close?target=${targetId}`).catch(() => {});
  }
}

listAssignments()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(`脚本异常：${err.message}`);
    process.exit(2);
  });
