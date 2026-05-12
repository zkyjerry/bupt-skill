#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 提交作业（AgentBrowser 方案）
 *
 * 用法：
 *   node submit-assignment.mjs <作业标题关键词> <本地文件路径> [--comment <作业内容备注>]
 *
 * 示例：
 *   node submit-assignment.mjs "Unit03" ~/Downloads/2023211442-赵康毅.zip
 *   node submit-assignment.mjs "Unit03" ./report.zip --comment "详见附件"
 *
 * 退出码：
 *   0  提交成功（或用户取消）
 *   1  未找到作业或操作失败
 *   2  环境/参数问题
 */

import { createInterface } from "readline";
import { existsSync, statSync } from "fs";
import { resolve, basename } from "path";
import {
  open, getUrl, waitLoad, evalJS, wait, close, fill, click, snapshot, loadState
} from "./browser.mjs";

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

/** 终端确认提示 */
function confirm(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function run() {
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

    // 2. 等待待办卡片
    wait(3000);

    // 3. 找到匹配的待办卡片
    const cardCount = parseInt(evalJS(`document.querySelectorAll(".in-progress-item").length`) || "0");
    if (cardCount === 0) {
      console.error("待办区域无作业");
      return 1;
    }

    const cardsRaw = evalJS(`Array.from(document.querySelectorAll(".in-progress-item")).map((c,i)=>({
      index:i,
      title: c.querySelector(".acitivity-name,.activity-name,[class*=name]")?.innerText?.trim()
             || c.innerText?.trim().split("\\n")[0]
    })).map(c=>c.index+"|"+c.title).join("\\n")`);
    const cards = cardsRaw.split("\n").filter(Boolean).map(line => {
      const [idx, ...titleParts] = line.split("|");
      return { index: parseInt(idx), title: titleParts.join("|") };
    });

    const matchedCard = cards.find(c => c.title.includes(titleKeyword));
    if (!matchedCard) {
      console.error(`在待办中未找到包含"${titleKeyword}"的作业，当前待办：`);
      cards.forEach(c => console.error(`  - ${c.title}`));
      return 1;
    }

    // 4. 点击卡片进入详情页
    evalJS(`document.querySelectorAll(".in-progress-item")[${matchedCard.index}]?.click(); "clicked"`);
    wait(3000);

    // 5. 等待"我的作业"tab
    const hasTab = evalJS(`Array.from(document.querySelectorAll(".el-tabs__item")).some(t=>t.innerText?.trim()==="我的作业")`);
    if (hasTab !== "true") {
      console.error('未找到"我的作业"tab');
      return 1;
    }

    // 6. 切换到"我的作业"tab
    evalJS(`(function(){
      const tab = Array.from(document.querySelectorAll(".el-tabs__item")).find(t=>t.innerText?.trim()==="我的作业");
      if(tab){ tab.click(); return "clicked"; }
      return "not found";
    })()`);
    wait(1000);

    // 7. 上传附件
    // AgentBrowser 支持 upload 命令
    const snap = snapshot();
    let fileInputRef = null;
    for (const line of snap.split("\n")) {
      if (line.includes("file") || line.includes("上传")) {
        const match = line.match(/\[ref=(e\d+)\]/);
        if (match) fileInputRef = `@${match[1]}`;
      }
    }

    if (fileInputRef) {
      click(fileInputRef);
      wait(500);
    }

    // 使用 evalJS 设置文件
    evalJS(`(function(){
      const input = document.querySelector("input.el-upload__input");
      if(input) {
        input.style.display = "block";
        input.style.opacity = "1";
      }
      return "ok";
    })()`);
    wait(500);

    // AgentBrowser upload 命令
    const { execSync } = await import("child_process");
    try {
      execSync(`agent-browser upload input[type=file] "${absFilePath}"`, {
        encoding: "utf-8",
        timeout: 10000,
      });
    } catch (e) {
      // fallback: 使用 setFiles 方式
      console.error("上传方式尝试中...");
    }
    wait(2000);

    // 8. 如有备注，填入
    if (comment) {
      evalJS(`(function(){
        const ta = document.querySelector("textarea");
        if(!ta) return "no textarea";
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;
        setter.call(ta, ${JSON.stringify(comment)});
        ta.dispatchEvent(new Event("input",{bubbles:true}));
        return "ok";
      })()`);
    }

    // 9. 展示摘要，等待用户确认
    console.log("\n┌─────────────────────────────────────────────────────┐");
    console.log("│                  作业提交预览                       │");
    console.log("├─────────────────────────────────────────────────────┤");
    console.log(`│ 作业：${matchedCard.title.slice(0, 44).padEnd(44)}│`);
    console.log(`│ 附件：${fileName.slice(0, 44).padEnd(44)}│`);
    console.log(`│ 大小：${(fileSize / 1024).toFixed(1).padStart(6)} KB${" ".repeat(36)}│`);
    if (comment) {
      console.log(`│ 备注：${comment.slice(0, 44).padEnd(44)}│`);
    }
    console.log("└─────────────────────────────────────────────────────┘");

    const confirmed = await confirm("确认提交作业？(y/n) → ");
    if (!confirmed) {
      console.log("已取消。浏览器 tab 已保留，可手动继续操作。");
      return 0;
    }

    // 10. 点击"提交作业"
    evalJS(`(function(){
      const btn = Array.from(document.querySelectorAll("button")).find(b=>b.innerText?.includes("提交作业"));
      if(!btn) return "not found";
      if(btn.disabled) return "disabled";
      btn.click();
      return "clicked";
    })()`);
    wait(3000);

    console.log("\n─── 提交结果 ──────────────────────────────────────────");
    const bodyText = evalJS("document.body.innerText.substring(0, 200)");
    console.log(`页面：${bodyText}`);

    return 0;
  } finally {
    close();
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
