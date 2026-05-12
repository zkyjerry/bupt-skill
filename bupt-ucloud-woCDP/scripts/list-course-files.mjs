#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 列出课程所有课件文件（AgentBrowser 方案）
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

import {
  open, getUrl, waitLoad, evalJS, wait, close, loadState
} from "./browser.mjs";

const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const keyword = process.argv[2];
const isJson = process.argv.includes("--json");

if (!keyword) {
  console.error("用法：node list-course-files.mjs <课程名关键词> [--json]");
  process.exit(2);
}

function filenameFromUrl(url) {
  try {
    const match = url.match(/filename%3D([^&]+)/i) || url.match(/filename=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

async function listFiles() {
  try {
    // 0. 加载保存的会话状态
    loadState();

    // 1. 打开主页
    open(HOME_URL);
    waitLoad();

    const pageUrl = getUrl();
    if (pageUrl.includes("auth.bupt.edu.cn")) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // 2. 等待课程卡片渲染
    wait(3000);

    // 3. 扫描所有课程名
    const allNamesRaw = evalJS(`Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean).join("\\n")`);
    const allNames = allNamesRaw.split("\n").filter(Boolean);
    const targetName = allNames.find(n => n.includes(keyword));
    if (!targetName) {
      console.error(`未找到包含"${keyword}"的课程，可用课程：`);
      allNames.forEach(n => console.error(`  - ${n}`));
      return 1;
    }

    // 4. 点击目标课程
    const clickResult = evalJS(`(function(){
      const items = Array.from(document.querySelectorAll(".my-lesson-item"));
      const target = items.find(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()===${JSON.stringify(targetName)});
      if(!target) return "not found";
      target.click();
      return "clicked";
    })()`);

    if (clickResult !== "clicked") {
      console.error(`无法点击课程"${targetName}"`);
      return 1;
    }

    // 5. 等待课程主页加载
    wait(3000);

    // 6. 展开所有折叠章节
    evalJS(`(function(){try{document.querySelectorAll(".el-collapse-item:not(.is-active) .el-collapse-item__header").forEach(h=>h.click());return "ok";}catch(e){return "skip";}})()`);
    wait(1000);

    // 7. 设置 window.open 拦截器
    evalJS(`window._dlUrls = []; const origOpen = window.open; window.open = function(url) { if(url) window._dlUrls.push(url); return null; };`);

    // 8. 提取章节+文件结构并点击所有下载按钮
    const extractResult = evalJS(`(function(){
      try {
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
        return JSON.stringify({ fileList, course: ${JSON.stringify(targetName)} });
      } catch(e){ return JSON.stringify({ error: e.message }); }
    })()`);

    // 9. 等待 XHR 完成
    wait(4000);

    // 10. 获取拦截到的 URL
    const urlsRaw = evalJS(`window._dlUrls.join("\\n")`);
    const dlUrls = urlsRaw.split("\n").filter(Boolean);

    let data;
    try { data = JSON.parse(extractResult); } catch { data = { error: "parse failed" }; }

    if (data.error) throw new Error(data.error);
    const { fileList, course } = data;

    // 11. 用文件名匹配 URL
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
    close();
  }
}

listFiles()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
