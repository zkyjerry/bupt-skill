#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 列出课程所有课件文件
 *
 * 用法：
 *   node list-course-files.mjs <课程名关键词> [--json]
 *
 * 示例：
 *   node list-course-files.mjs 通信软件设计
 *   node list-course-files.mjs 软件体系结构 --json
 *
 * 退出码：
 *   0  成功，stdout 输出文件列表
 *   1  未找到课程或获取失败
 *   2  环境问题
 */

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const keyword = process.argv[2];
const isJson = process.argv.includes("--json");

if (!keyword) {
  console.error("用法：node list-course-files.mjs <课程名关键词> [--json]");
  process.exit(2);
}

async function request(path, options = {}) {
  const fetchOptions = { ...options };
  if (fetchOptions.body && !fetchOptions.headers) {
    fetchOptions.headers = { "Content-Type": "text/plain" };
  }
  const res = await fetch(`${PROXY}${path}`, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${path}\n  ${body.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 从下载 URL 中解析文件名
function filenameFromUrl(url) {
  try {
    const match = url.match(/filename%3D([^&]+)/i) || url.match(/filename=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

async function listFiles() {
  let targetId = null;
  try {
    // 1. 打开主页
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;

    // 2. 等待主页加载
    let pageUrl = "";
    for (let i = 0; i < 24; i++) {
      const info = await request(`/info?target=${targetId}`);
      if (info.ready === "complete" && info.url && info.url !== "about:blank") {
        pageUrl = info.url; break;
      }
      await sleep(500);
    }
    if (!pageUrl) throw new Error("主页加载超时");
    if (pageUrl.includes("auth.bupt.edu.cn")) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // 3. 等课程卡片渲染，收集所有课程名（用于报错提示）
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const c = await request(`/eval?target=${targetId}`, { method:"POST", body:`document.querySelectorAll(".my-lesson-item").length > 0 ? "ready" : "wait"` });
        if (c.value === "ready") break;
      } catch (_) {}
    }
    await sleep(500);

    // 4. 扫描所有页的课程名（不阻止导航，只读取）
    const allNamesResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean)`,
    });
    const allNames = allNamesResult.value || [];
    const targetName = allNames.find(n => n.includes(keyword));
    if (!targetName) {
      console.error(`未找到包含"${keyword}"的课程，可用课程：`);
      allNames.forEach(n => console.error(`  - ${n}`));
      return 1;
    }

    // 5. 翻页找到目标课程并点击（逐页翻，直到在 active 页找到）
    const section = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        const section = document.querySelector(".my-lesson-section");
        const totalPages = parseInt((section?.querySelector(".banner-indicator")?.innerText||"1/1").split("/")[1])||1;
        return totalPages;
      })()`,
    });
    const totalPages = section.value || 4;

    let clicked = false;
    for (let page = 0; page < totalPages; page++) {
      if (page > 0) {
        // 点右箭头翻页
        await request(`/eval?target=${targetId}`, {
          method: "POST",
          body: `document.querySelector(".my-lesson-section [title='下一页']")?.click(); "next"`,
        });
        await sleep(600);
      }
      // 在 active 页找目标课程
      const clickResult = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `(function(){
          const active = document.querySelector(".my-lesson-section .el-carousel__item.is-active");
          if(!active) return "no-active";
          const items = Array.from(active.querySelectorAll(".my-lesson-item"));
          const target = items.find(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()===${JSON.stringify(targetName)});
          if(!target) return "not-here";
          target.click();
          return "clicked";
        })()`,
      });
      if (clickResult.value === "clicked") { clicked = true; break; }
    }
    if (!clicked) throw new Error(`无法点击课程"${targetName}"`);

    // 等待导航到课程主页
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const info = await request(`/info?target=${targetId}`);
      if (info.url.includes("courseHomePage")) break;
    }

    // 6. 等课程主页加载
    await sleep(3000);
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      try {
        const check = await request(`/eval?target=${targetId}`, {
          method: "POST",
          body: `(function(){
            try {
              const items = document.querySelectorAll(".el-collapse-item.chapter-item");
              return items.length > 0 ? "ready" : "wait";
            } catch(e) { return "wait"; }
          })()`,
        });
        if (check.value === "ready") break;
      } catch (_) {}
    }
    await sleep(1000);

    // 7. 展开所有折叠章节（点击未激活的章节标题）
    await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        try {
          document.querySelectorAll(".el-collapse-item:not(.is-active) .el-collapse-item__header").forEach(h=>h.click());
          return "expanded";
        } catch(e){ return "skip"; }
      })()`,
    });
    await sleep(1000);

    // 8. 提取章节+文件结构（同时拦截下载URL）
    const extractResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        try {
          window._dlUrls = [];
          window._origWinOpen = window._origWinOpen || window.open;
          window.open = function(url){ window._dlUrls.push(url||""); return null; };

          const chapters = Array.from(document.querySelectorAll(".el-collapse-item.chapter-item"));
          const fileList = [];
          chapters.forEach(ch => {
            const chTitle = ch.querySelector(".chapter-item-title")?.innerText?.trim() || "";
            ch.querySelectorAll(".resource-item").forEach(r => {
              const branch = r.closest(".el-collapse-item.branch-item")?.querySelector(".branch-item-title")?.innerText?.trim() || "";
              const name = r.querySelector(".resource-name")?.innerText?.trim() || "";
              const dlBtn = r.querySelector("i.by-icon-download");
              if (name) {
                fileList.push({ chapter: chTitle, branch, name });
                dlBtn?.click();
              }
            });
          });

          // 不在此处恢复 window.open，等 XHR 异步完成后再恢复
          return { fileList, course: "${targetName}" };
        } catch(e){ return { error: e.message }; }
      })()`,
    });

    await sleep(4000); // 等所有 XHR 完成
    const urlsResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){ const urls = window._dlUrls||[]; window.open = window._origWinOpen||window.open; return urls; })()`,
    });

    if (extractResult.value?.error) throw new Error(extractResult.value.error);
    const { fileList, course } = extractResult.value;
    const dlUrls = urlsResult.value || [];

    // 9. 用文件名匹配 URL（URL 中含 filename 参数）
    const urlMap = {};
    dlUrls.forEach(url => {
      const fname = filenameFromUrl(url);
      if (fname) urlMap[fname] = url;
    });

    const files = fileList.map(f => ({
      ...f,
      downloadUrl: urlMap[f.name] || "",
    }));

    if (isJson) {
      console.log(JSON.stringify({ course, total: files.length, files }, null, 2));
    } else {
      console.log(`课程：${course}（共 ${files.length} 个文件）\n`);
      let lastChapter = "";
      files.forEach((f, i) => {
        if (f.chapter !== lastChapter) {
          console.log(`\n【${f.chapter}】`);
          lastChapter = f.chapter;
        }
        const prefix = f.branch ? `  [${f.branch}] ` : "  ";
        const hasUrl = f.downloadUrl ? "✓" : "✗";
        console.log(`${prefix}${i + 1}. ${f.name} ${hasUrl}`);
      });
    }
    return 0;
  } finally {
    if (targetId) await request(`/close?target=${targetId}`).catch(() => {});
  }
}

listFiles()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
