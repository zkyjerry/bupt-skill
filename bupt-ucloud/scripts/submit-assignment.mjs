#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 提交作业
 *
 * 从首页"待办"中找到对应作业，切换到"我的作业"tab，
 * 上传本地文件，展示预览后**等待用户确认**，再点击"提交作业"。
 *
 * 用法：
 *   node submit-assignment.mjs <作业标题关键词> <本地文件路径> [--comment <作业内容备注>]
 *
 * 示例：
 *   node submit-assignment.mjs "Unit03" ~/Downloads/2023211442-赵康毅.zip
 *   node submit-assignment.mjs "Unit03" ./report.zip --comment "详见附件"
 *
 * 流程：
 *   1. 在首页"待办"中定位作业
 *   2. 进入作业详情 → "我的作业" tab
 *   3. 上传附件（setFiles，不会立即提交到服务器）
 *   4. 展示摘要，**等待用户在终端输入 y 确认**
 *   5. 点击"提交作业"按钮
 *
 * 退出码：
 *   0  提交成功（或用户取消）
 *   1  未找到作业或操作失败
 *   2  环境/参数问题
 */

import { createInterface } from "readline";
import { existsSync, statSync } from "fs";
import { resolve, basename } from "path";

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const titleKeyword = process.argv[2];
const filePath = process.argv[3];
const commentIdx = process.argv.indexOf("--comment");
const comment = commentIdx >= 0 ? process.argv[commentIdx + 1] : "";

if (!titleKeyword || !filePath) {
  console.error("用法：node submit-assignment.mjs <作业标题关键词> <本地文件路径> [--comment <备注>]");
  process.exit(2);
}

const absFilePath = resolve(filePath);
if (!existsSync(absFilePath)) {
  console.error(`文件不存在：${absFilePath}`);
  process.exit(2);
}
const fileSize = statSync(absFilePath).size;
const fileName = basename(absFilePath);

async function request(path, options = {}) {
  const fetchOptions = { ...options };
  if (fetchOptions.body && !fetchOptions.headers?.["Content-Type"]) {
    fetchOptions.headers = { ...(fetchOptions.headers || {}), "Content-Type": "text/plain" };
  }
  const res = await fetch(`${PROXY}${path}`, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${path}\n  ${body.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 终端确认提示，返回 true 表示用户输入 y */
function confirm(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function waitForUrl(targetId, fragment, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await request(`/info?target=${targetId}`);
    if (info.url?.includes(fragment)) return info.url;
    await sleep(400);
  }
  throw new Error(`等待 URL 包含"${fragment}"超时`);
}

async function waitForReady(targetId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await request(`/info?target=${targetId}`);
    if (info.ready === "complete") return;
    await sleep(300);
  }
}

async function run() {
  let targetId = null;
  try {
    // ── 1. 打开主页 ──────────────────────────────────────────────────────────
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;

    let homeInfo;
    for (let i = 0; i < 24; i++) {
      homeInfo = await request(`/info?target=${targetId}`);
      if (homeInfo.ready === "complete" && homeInfo.url && homeInfo.url !== "about:blank") break;
      await sleep(500);
    }
    if (!homeInfo?.url || homeInfo.url.includes("auth.bupt.edu.cn")) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // ── 2. 等待待办卡片 ───────────────────────────────────────────────────────
    await sleep(2000); // SPA 初始渲染
    let cardCount = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const r = await request(`/eval?target=${targetId}`, {
          method: "POST", body: `document.querySelectorAll(".in-progress-item").length`,
        });
        if (r.value > 0) { cardCount = r.value; break; }
      } catch (_) {}
    }
    if (cardCount === 0) {
      console.error("待办区域无作业");
      return 1;
    }

    // ── 3. 找到匹配关键词的待办卡片 ───────────────────────────────────────────
    const cardsRes = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `Array.from(document.querySelectorAll(".in-progress-item")).map((c,i)=>({
        index:i,
        title: c.querySelector(".acitivity-name,.activity-name,[class*=name]")?.innerText?.trim()
               || c.innerText?.trim().split("\\n")[0]
      }))`,
    });
    const cards = cardsRes.value || [];
    const matchedCard = cards.find(c => c.title.includes(titleKeyword));

    if (!matchedCard) {
      console.error(`在待办中未找到包含"${titleKeyword}"的作业，当前待办：`);
      cards.forEach(c => console.error(`  - ${c.title}`));
      return 1;
    }

    // ── 4. 点击卡片，进入详情页 ───────────────────────────────────────────────
    await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `document.querySelectorAll(".in-progress-item")[${matchedCard.index}]?.click(); "clicked"`,
    });

    let detailUrl;
    try {
      detailUrl = await waitForUrl(targetId, "assignmentDetails", 10000);
    } catch {
      console.error("点击作业卡片后未跳转到详情页");
      return 1;
    }
    // course.html 有时需要重新 navigate 才能完整渲染
    await waitForReady(targetId, 8000);
    await sleep(2000);

    // 若页面空白（body 为空），重新 navigate
    const bodyCheck = await request(`/eval?target=${targetId}`, {
      method: "POST", body: `document.body.innerText.trim().length`,
    });
    if (bodyCheck.value < 10) {
      await request(`/navigate?target=${targetId}&url=${encodeURIComponent(detailUrl)}`);
      await waitForReady(targetId, 10000);
      await sleep(3000);
    }

    // 等待"我的作业"tab 出现在 DOM
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const r = await request(`/eval?target=${targetId}`, {
          method: "POST",
          body: `Array.from(document.querySelectorAll(".el-tabs__item")).some(t=>t.innerText?.trim()==="我的作业")`,
        });
        if (r.value === true) break;
      } catch (_) {}
    }

    // 从 URL 参数提取作业标题
    const urlParams = Object.fromEntries(
      new URL(detailUrl).hash.slice(1).split("?")[1]?.split("&").map(p => {
        const [k, v] = p.split("=");
        return [decodeURIComponent(k), decodeURIComponent(v || "")];
      }) || []
    );
    const assignmentTitle = urlParams.assignmentTitle || matchedCard.title;

    // ── 5. 切换到"我的作业" tab ───────────────────────────────────────────────
    const tabClick = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        const tab = Array.from(document.querySelectorAll(".el-tabs__item")).find(t=>t.innerText?.trim()==="我的作业");
        if(tab){ tab.click(); return "clicked"; }
        return "not found";
      })()`,
    });
    if (tabClick.value !== "clicked") {
      console.error('未找到"我的作业"tab');
      return 1;
    }
    await sleep(1000);

    // ── 6. 注入附件文件 ───────────────────────────────────────────────────────
    const setResult = await request(`/setFiles?target=${targetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector: "input.el-upload__input", files: [absFilePath] }),
    });
    if (!setResult.success) {
      console.error("文件注入失败");
      return 1;
    }
    await sleep(2000); // 等附件预览渲染

    // ── 7. 检查附件是否出现在页面上 ──────────────────────────────────────────
    const attachCheck = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        const area = document.querySelector(".common-button-wrapper.upload-attachment,[class*=upload-attachment]");
        return area?.innerText?.trim()||"";
      })()`,
    });

    // ── 8. 如有备注，填入作业内容框 ──────────────────────────────────────────
    if (comment) {
      await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `(function(){
          const ta = document.querySelector("textarea");
          if(!ta) return "no textarea";
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;
          setter.call(ta, ${JSON.stringify(comment)});
          ta.dispatchEvent(new Event("input",{bubbles:true}));
          return "ok";
        })()`,
      });
    }

    // ── 9. 展示摘要，等待用户确认 ────────────────────────────────────────────
    console.log("\n┌─────────────────────────────────────────────────────┐");
    console.log("│                  作业提交预览                       │");
    console.log("├─────────────────────────────────────────────────────┤");
    console.log(`│ 作业：${assignmentTitle.slice(0, 44).padEnd(44)}│`);
    console.log(`│ 附件：${fileName.slice(0, 44).padEnd(44)}│`);
    console.log(`│ 大小：${(fileSize / 1024).toFixed(1).padStart(6)} KB${" ".repeat(36)}│`);
    if (comment) {
      console.log(`│ 备注：${comment.slice(0, 44).padEnd(44)}│`);
    }
    console.log("└─────────────────────────────────────────────────────┘");
    console.log("\n请在浏览器中确认附件显示正确后再继续。");
    console.log(`附件区内容：${attachCheck.value || "(未检测到附件预览)"}\n`);

    const confirmed = await confirm("确认提交作业？(y/n) → ");
    if (!confirmed) {
      console.log("已取消。浏览器 tab 已保留，可手动继续操作。");
      targetId = null; // 不关闭 tab，让用户查看
      return 0;
    }

    // ── 10. 点击"提交作业" ────────────────────────────────────────────────────
    const submitRes = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        const btn = Array.from(document.querySelectorAll("button")).find(b=>b.innerText?.includes("提交作业"));
        if(!btn) return "not found";
        if(btn.disabled) return "disabled";
        btn.click();
        return "clicked";
      })()`,
    });

    if (submitRes.value !== "clicked") {
      console.error(`提交按钮状态异常：${submitRes.value}`);
      return 1;
    }

    await sleep(3000);

    // 检查提交结果（弹窗、跳转或成功提示）
    const resultCheck = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        // 找成功/失败提示
        const notice = document.querySelector(".el-message,.el-notification,[class*=success],[class*=toast]");
        const noticeText = notice?.innerText?.trim()||"";
        const bodyText = document.body.innerText.trim().slice(0,200);
        return { noticeText, bodyText };
      })()`,
    });

    console.log("\n─── 提交结果 ──────────────────────────────────────────");
    if (resultCheck.value?.noticeText) {
      console.log(`提示：${resultCheck.value.noticeText}`);
    }
    console.log(`页面：${resultCheck.value?.bodyText?.slice(0, 100) || "(无内容)"}`);

    return 0;
  } finally {
    if (targetId) await request(`/close?target=${targetId}`).catch(() => {});
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
