#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 下载指定课件文件
 *
 * 用法：
 *   node download-course-file.mjs <课程名关键词> <文件名关键词> [保存目录]
 *
 * 示例：
 *   node download-course-file.mjs 通信软件设计 Unit01-Course ~/Downloads
 *   node download-course-file.mjs 通信软件设计 教学进度表       # 保存到当前目录
 *
 * 退出码：
 *   0  下载成功，stdout 输出保存路径
 *   1  未找到文件或下载失败
 *   2  环境/参数问题
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const [courseKeyword, fileKeyword, saveDir = "."] = process.argv.slice(2);

if (!courseKeyword || !fileKeyword) {
  console.error("用法：node download-course-file.mjs <课程名关键词> <文件名关键词> [保存目录]");
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

function filenameFromUrl(url) {
  try {
    const match = url.match(/filename%3D([^&]+)/i) || url.match(/filename=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

async function downloadFile() {
  let targetId = null;
  try {
    // 打开主页
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;

    // 等主页加载
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

    // 等课程卡片渲染
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const c = await request(`/eval?target=${targetId}`, { method:"POST", body:`document.querySelectorAll(".my-lesson-item").length > 0 ? "ready" : "wait"` });
        if (c.value === "ready") break;
      } catch (_) {}
    }
    await sleep(500);

    // 读取所有课程名，找目标
    const allNamesResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean)`,
    });
    const allNames = allNamesResult.value || [];
    const targetName = allNames.find(n => n.includes(courseKeyword));
    if (!targetName) {
      console.error(`未找到包含"${courseKeyword}"的课程，可用课程：`);
      allNames.forEach(n => console.error(`  - ${n}`));
      return 1;
    }

    // 翻页找到目标课程并点击
    const totalPagesRes = await request(`/eval?target=${targetId}`, {
      method:"POST",
      body:`parseInt((document.querySelector(".my-lesson-section .banner-indicator")?.innerText||"1/1").split("/")[1])||4`,
    });
    const totalPages = totalPagesRes.value || 4;

    let clicked = false;
    for (let page = 0; page < totalPages; page++) {
      if (page > 0) {
        await request(`/eval?target=${targetId}`, { method:"POST", body:`document.querySelector(".my-lesson-section [title='下一页']")?.click();"next"` });
        await sleep(600);
      }
      const clickResult = await request(`/eval?target=${targetId}`, {
        method:"POST",
        body:`(function(){
          const active = document.querySelector(".my-lesson-section .el-carousel__item.is-active");
          if(!active) return "no-active";
          const target = Array.from(active.querySelectorAll(".my-lesson-item")).find(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()===${JSON.stringify(targetName)});
          if(!target) return "not-here";
          target.click();
          return "clicked";
        })()`,
      });
      if (clickResult.value === "clicked") { clicked = true; break; }
    }
    if (!clicked) throw new Error(`无法点击课程"${targetName}"`);

    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const info = await request(`/info?target=${targetId}`);
      if (info.url.includes("courseHomePage")) break;
    }

    // 等课程主页加载
    await sleep(3000);
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      try {
        const c = await request(`/eval?target=${targetId}`, { method: "POST", body: `(function(){try{return document.querySelectorAll(".el-collapse-item.chapter-item").length>0?"ready":"wait";}catch(e){return "wait";}})()` });
        if (c.value === "ready") break;
      } catch (_) {}
    }
    await sleep(1000);

    // 展开所有折叠块
    await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){try{document.querySelectorAll(".el-collapse-item:not(.is-active) .el-collapse-item__header").forEach(h=>h.click());return "ok";}catch(e){return "skip";}})()`,
    });
    await sleep(1000);

    // 找目标文件的下载按钮并点击，拦截 URL
    const result = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        try {
          window._targetDlUrl = null;
          const origOpen = window.open;
          window.open = function(url){ window._targetDlUrl = url; return null; };

          // 找所有文件，匹配关键词
          const allItems = Array.from(document.querySelectorAll(".resource-item"));
          const matched = allItems.filter(r => {
            const name = r.querySelector(".resource-name")?.innerText?.trim() || "";
            return name.includes(${JSON.stringify(fileKeyword)});
          });

          if (matched.length === 0) return { found: false, allNames: allItems.map(r=>r.querySelector(".resource-name")?.innerText?.trim()).filter(Boolean) };
          if (matched.length > 1) return { found: false, ambiguous: matched.map(r=>r.querySelector(".resource-name")?.innerText?.trim()) };

          const target = matched[0];
          const name = target.querySelector(".resource-name")?.innerText?.trim();
          const dlBtn = target.querySelector("i.by-icon-download");
          if (!dlBtn) return { found: false, error: "no download button" };

          dlBtn.click();
          return { found: true, name };
        } catch(e){ return { error: e.message }; }
      })()`,
    });

    if (result.value?.error) throw new Error(result.value.error);
    if (!result.value?.found) {
      if (result.value?.ambiguous) {
        console.error(`找到多个匹配文件，请更精确指定：`);
        result.value.ambiguous.forEach(n => console.error(`  - ${n}`));
      } else {
        console.error(`未找到包含"${fileKeyword}"的文件，可用文件：`);
        (result.value?.allNames || []).forEach(n => console.error(`  - ${n}`));
      }
      return 1;
    }

    // 等 XHR 完成，拿 URL
    await sleep(4000);
    const urlResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `window._targetDlUrl || null`,
    });

    const downloadUrl = urlResult.value;
    const fileName = result.value.name;
    if (!downloadUrl) { console.error("获取下载 URL 失败"); return 1; }

    // 下载文件
    const savePath = resolve(saveDir);
    if (!existsSync(savePath)) mkdirSync(savePath, { recursive: true });
    const outFile = join(savePath, fileName);

    console.error(`正在下载：${fileName}`);
    execSync(`curl -sL ${JSON.stringify(downloadUrl)} -o ${JSON.stringify(outFile)}`);
    console.log(outFile);
    return 0;
  } finally {
    if (targetId) await request(`/close?target=${targetId}`).catch(() => {});
  }
}

downloadFile()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
