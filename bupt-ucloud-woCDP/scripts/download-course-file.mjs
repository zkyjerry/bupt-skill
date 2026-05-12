#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 下载指定课件文件（AgentBrowser 方案）
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
import {
  open, getUrl, waitLoad, evalJS, wait, close, click, snapshot, loadState
} from "./browser.mjs";

const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const [courseKeyword, fileKeyword, saveDir = "."] = process.argv.slice(2);

if (!courseKeyword || !fileKeyword) {
  console.error("用法：node download-course-file.mjs <课程名关键词> <文件名关键词> [保存目录]");
  process.exit(2);
}

function filenameFromUrl(url) {
  try {
    const match = url.match(/filename%3D([^&]+)/i) || url.match(/filename=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

async function downloadFile() {
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

    // 3. 读取所有课程名，找目标
    const allNamesRaw = evalJS(`Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean).join("\\n")`);
    const allNames = allNamesRaw.split("\n").filter(Boolean);
    const targetName = allNames.find(n => n.includes(courseKeyword));
    if (!targetName) {
      console.error(`未找到包含"${courseKeyword}"的课程，可用课程：`);
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

    // 6. 展开所有折叠块
    evalJS(`(function(){try{document.querySelectorAll(".el-collapse-item:not(.is-active) .el-collapse-item__header").forEach(h=>h.click());return "ok";}catch(e){return "skip";}})()`);
    wait(1000);

    // 7. 设置 window.open 拦截器
    evalJS(`window._capturedUrls = []; const origOpen = window.open; window.open = function(url) { if(url) window._capturedUrls.push(url); return null; };`);

    // 8. 找目标文件的下载按钮并点击
    const result = evalJS(`(function(){
      try {
        const allItems = Array.from(document.querySelectorAll(".resource-item"));
        const matched = allItems.filter(r => {
          const name = r.querySelector(".resource-name")?.innerText?.trim() || "";
          return name.includes(${JSON.stringify(fileKeyword)});
        });

        if (matched.length === 0) return JSON.stringify({ found: false, allNames: allItems.map(r=>r.querySelector(".resource-name")?.innerText?.trim()).filter(Boolean) });
        if (matched.length > 1) return JSON.stringify({ found: false, ambiguous: matched.map(r=>r.querySelector(".resource-name")?.innerText?.trim()) });

        const target = matched[0];
        const name = target.querySelector(".resource-name")?.innerText?.trim();
        const dlBtn = target.querySelector("i.by-icon-download");
        if (!dlBtn) return JSON.stringify({ found: false, error: "no download button" });

        dlBtn.click();
        return JSON.stringify({ found: true, name });
      } catch(e){ return JSON.stringify({ error: e.message }); }
    })()`);

    let data;
    try { data = JSON.parse(result); } catch { data = { error: "parse failed" }; }

    if (data.error) throw new Error(data.error);
    if (!data.found) {
      if (data.ambiguous) {
        console.error(`找到多个匹配文件，请更精确指定：`);
        data.ambiguous.forEach(n => console.error(`  - ${n}`));
      } else {
        console.error(`未找到包含"${fileKeyword}"的文件，可用文件：`);
        (data.allNames || []).forEach(n => console.error(`  - ${n}`));
      }
      return 1;
    }

    // 9. 等待 XHR 完成，拿 URL
    wait(4000);
    const downloadUrl = evalJS(`window._capturedUrls[0] || ""`);

    const fileName = data.name;
    if (!downloadUrl) {
      console.error("获取下载 URL 失败");
      return 1;
    }

    // 10. 下载文件
    const savePath = resolve(saveDir);
    if (!existsSync(savePath)) mkdirSync(savePath, { recursive: true });
    const outFile = join(savePath, fileName);

    console.error(`正在下载：${fileName}`);
    execSync(`curl -sL ${JSON.stringify(downloadUrl)} -o ${JSON.stringify(outFile)}`);
    console.log(outFile);
    return 0;
  } finally {
    close();
  }
}

downloadFile()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
