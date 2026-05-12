#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 查询作业所属课程（AgentBrowser 方案）
 *
 * 用法：
 *   node list-assignment-courses.mjs [--pending-only] [--title <关键词>] [--json]
 *
 * 示例：
 *   node list-assignment-courses.mjs --pending-only
 *   node list-assignment-courses.mjs --title "Unit03"
 *   node list-assignment-courses.mjs --json
 *
 * 退出码：
 *   0  成功
 *   1  未找到课程
 *   2  环境问题
 */

import {
  open, getUrl, waitLoad, evalJS, wait, close, loadState
} from "./browser.mjs";

const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const ASSIGNMENT_URL = "https://ucloud.bupt.edu.cn/uclass/course.html#/student/studentAssignmentListPage?ind=3";

const isJson = process.argv.includes("--json");
const pendingOnly = process.argv.includes("--pending-only");
const titleIdx = process.argv.indexOf("--title");
const titleKeyword = titleIdx >= 0 ? process.argv[titleIdx + 1] : null;

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

    // 2. 等待课程卡片渲染
    wait(3000);

    // 3. 获取所有课程名
    const allNamesRaw = evalJS(`Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean).join("\\n")`);
    const courseNames = allNamesRaw.split("\n").filter(Boolean);
    if (courseNames.length === 0) {
      console.error("未找到课程");
      return 1;
    }

    if (!isJson) process.stderr.write(`共 ${courseNames.length} 门课程，逐一遍历中...\n`);

    // 4. 逐课遍历
    const allAssignments = [];

    for (const courseName of courseNames) {
      if (!isJson) process.stderr.write(`  处理：${courseName}\n`);

      // 确保在主页
      const curUrl = getUrl();
      if (!curUrl.includes("homePage")) {
        open(HOME_URL);
        waitLoad();
        wait(2000);
      }

      // 点击课程卡片
      const clickResult = evalJS(`(function(){
        const items = Array.from(document.querySelectorAll(".my-lesson-item"));
        const target = items.find(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()===${JSON.stringify(courseName)});
        if(!target) return "not found";
        target.click();
        return "clicked";
      })()`);

      if (clickResult !== "clicked") {
        if (!isJson) process.stderr.write(`  跳过：${courseName}（点击失败）\n`);
        continue;
      }

      // 等待跳转到课程主页
      wait(3000);

      // 导航到作业列表页
      open(ASSIGNMENT_URL);
      waitLoad();
      wait(1000);

      // 提取作业
      const assignmentsRaw = evalJS(`(function(){
        try {
          const fixedRows = Array.from(document.querySelectorAll(".el-table__fixed .el-table__row:not(.hidden-columns)"));
          const titles = fixedRows.map(r => {
            const tds = Array.from(r.querySelectorAll("td")).filter(td=>!td.classList.contains("is-hidden"));
            return tds[0]?.innerText?.trim()||"";
          });

          const mainRows = Array.from(document.querySelectorAll(".el-table__body-wrapper .el-table__row"));
          const rowData = mainRows.map(r => {
            const tds = Array.from(r.querySelectorAll("td")).filter(td=>!td.classList.contains("is-hidden"));
            return tds.map(td=>td.innerText?.trim()||"");
          });

          return JSON.stringify(titles.map((title,i) => {
            const cols = rowData[i]||[];
            return {
              title,
              mode: cols[0]||"",
              chapter: cols[1]||"",
              deadline: cols[2]||"",
              submitTime: cols[3]||"",
              status: cols[4]||"",
              myStatus: cols[5]||"",
            };
          }).filter(a=>a.title));
        } catch(e){ return JSON.stringify({ error: e.message }); }
      })()`);

      let assignments;
      try { assignments = JSON.parse(assignmentsRaw); } catch { assignments = []; }
      if (Array.isArray(assignments)) {
        assignments.forEach(a => {
          allAssignments.push({ course: courseName, ...a });
        });
      }
    }

    // 5. 过滤
    let filtered = allAssignments;
    if (pendingOnly) filtered = filtered.filter(a => a.status === "进行中");
    if (titleKeyword) filtered = filtered.filter(a => a.title.includes(titleKeyword));

    // 6. 输出
    if (isJson) {
      console.log(JSON.stringify({ total: filtered.length, assignments: filtered }, null, 2));
    } else {
      if (filtered.length === 0) {
        console.log("未找到匹配的作业");
        return 0;
      }
      console.log(`\n共 ${filtered.length} 条作业\n${"─".repeat(60)}`);
      filtered.forEach((a, i) => {
        console.log(`\n【${i + 1}】${a.title}`);
        console.log(`  所属课程：${a.course}`);
        console.log(`  章节：${a.chapter}  模式：${a.mode}  截止：${a.deadline}`);
        console.log(`  作业状态：${a.status}  我的状态：${a.myStatus}`);
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
