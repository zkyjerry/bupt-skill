#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 查看所有待办作业详情（AgentBrowser 方案）
 *
 * 用法：
 *   node list-pending-tasks.mjs [--json]
 *
 * 退出码：
 *   0  成功，stdout 输出作业列表
 *   1  未找到待办或获取失败
 *   2  环境问题
 */

import {
  open, getUrl, waitLoad, evalJS, wait, close, click, snapshot
} from "./browser.mjs";

const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const isJson = process.argv.includes("--json");

async function run() {
  try {
    // 1. 打开主页
    open(HOME_URL);
    waitLoad();

    const pageUrl = getUrl();
    if (pageUrl.includes("auth.bupt.edu.cn")) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // 2. 等待待办卡片渲染
    wait(3000);

    // 3. 检查待办数量
    const cardCount = parseInt(evalJS(`document.querySelectorAll(".in-progress-item").length`) || "0");
    if (cardCount === 0) {
      console.log("暂无待办作业");
      return 0;
    }

    // 4. 读取所有卡片标题
    const titlesRaw = evalJS(`Array.from(document.querySelectorAll(".in-progress-item")).map(c=>c.querySelector(".acitivity-name,.activity-name,[class*=name]")?.innerText?.trim()||c.innerText?.trim().split("\\n")[0]).join("\\n")`);
    const titles = titlesRaw.split("\n").filter(Boolean);

    // 5. 逐卡点击 → 提取详情
    const assignments = [];
    for (let i = 0; i < cardCount; i++) {
      if (!isJson) process.stderr.write(`提取第 ${i + 1}/${cardCount} 个作业...\n`);

      // 确保在主页
      const curUrl = getUrl();
      if (!curUrl.includes("homePage")) {
        open(HOME_URL);
        waitLoad();
        wait(2000);
      }

      // 点击第 i 张卡片
      evalJS(`document.querySelectorAll(".in-progress-item")[${i}]?.click(); "clicked"`);

      // 等待导航到详情页
      wait(2000);

      // 提取详情
      const detailUrl = getUrl();
      const details = evalJS(`(function(){
        try {
          const hash = location.href.split("#")[1]||"";
          const params = {};
          (hash.split("?")[1]||"").split("&").forEach(p=>{
            const [k,v] = p.split("=");
            if(k) params[decodeURIComponent(k)] = decodeURIComponent(v||"");
          });

          const timeEl = document.querySelector("[class*=time],[class*=date]");
          const timeText = timeEl?.innerText?.trim()||"";
          const startMatch = timeText.match(/开始时间\\s+([^/]+)/);
          const endMatch = timeText.match(/截止时间\\s+(.+)/);

          const labelPairs = {};
          document.querySelectorAll(".item-label").forEach(label => {
            const key = label.innerText?.trim();
            if(!key) return;
            const parent = label.parentElement;
            const siblings = parent ? Array.from(parent.children) : [];
            const labelIdx = siblings.indexOf(label);
            const valueEl = siblings[labelIdx+1];
            const value = valueEl?.innerText?.trim() || "";
            labelPairs[key] = value;
          });

          return JSON.stringify({
            assignmentId: params.assignmentId||"",
            title: params.assignmentTitle || params.assignmentId,
            startTime: startMatch?.[1]?.trim()||"",
            endTime: endMatch?.[1]?.trim()||"",
            content: labelPairs["作业内容"]||"",
            chapter: labelPairs["联系章节"]||"",
            lateSubmit: labelPairs["能否逾期补交"]||"",
            mode: labelPairs["作业模式"]||"",
            classInfo: labelPairs["班级"]||"",
            score: labelPairs["总分数"]||"",
          });
        } catch(e){ return JSON.stringify({ error: e.message }); }
      })()`);

      let data;
      try { data = JSON.parse(details); } catch { data = { error: "parse failed" }; }
      if (!data.error) assignments.push(data);
    }

    // 6. 输出
    if (isJson) {
      console.log(JSON.stringify({ total: assignments.length, assignments }, null, 2));
    } else {
      console.log(`\n共 ${assignments.length} 个待办作业\n${"─".repeat(50)}`);
      assignments.forEach((a, i) => {
        console.log(`\n【${i + 1}】${a.title}`);
        console.log(`  开始：${a.startTime}`);
        console.log(`  截止：${a.endTime}`);
        console.log(`  章节：${a.chapter}`);
        console.log(`  逾期补交：${a.lateSubmit}  模式：${a.mode}  班级：${a.classInfo}  总分：${a.score}`);
        if (a.content) {
          const brief = a.content.replace(/\s+/g, " ").slice(0, 120);
          console.log(`  内容：${brief}${a.content.length > 120 ? "..." : ""}`);
        }
      });
    }
    return 0;
  } finally {
    close();
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
