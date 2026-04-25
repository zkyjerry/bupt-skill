#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 查询作业所属课程
 *
 * 遍历本学期每门课的"作业"页，收集所有作业标题与所属课程的对应关系。
 * 可配合 list-pending-tasks.mjs 找到待办作业属于哪门课。
 *
 * 用法：
 *   node list-assignment-courses.mjs [--pending-only] [--title <关键词>] [--json]
 *
 * 参数：
 *   --pending-only     只显示状态为"进行中"的作业
 *   --title <关键词>   只显示标题包含关键词的作业
 *   --json             输出 JSON
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

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const ASSIGNMENT_URL = "https://ucloud.bupt.edu.cn/uclass/course.html#/student/studentAssignmentListPage?ind=3";

const isJson = process.argv.includes("--json");
const pendingOnly = process.argv.includes("--pending-only");
const titleIdx = process.argv.indexOf("--title");
const titleKeyword = titleIdx >= 0 ? process.argv[titleIdx + 1] : null;

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

async function waitForCards(targetId) {
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const r = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `document.querySelectorAll(".my-lesson-item").length`,
      });
      if (r.value > 0) return r.value;
    } catch (_) {}
  }
  return 0;
}

/** 提取当前课程作业页的所有作业行 */
async function extractAssignments(targetId) {
  // 等待 el-table 渲染
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const r = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `document.querySelectorAll(".el-table__body-wrapper .el-table__row").length`,
      });
      if (r.value >= 0) break;
    } catch (_) {}
  }
  await sleep(500);

  const result = await request(`/eval?target=${targetId}`, {
    method: "POST",
    body: `(function(){
      try {
        // 固定列中的标题（非 is-hidden 的 td）
        const fixedRows = Array.from(document.querySelectorAll(".el-table__fixed .el-table__row:not(.hidden-columns)"));
        const titles = fixedRows.map(r => {
          const tds = Array.from(r.querySelectorAll("td")).filter(td=>!td.classList.contains("is-hidden"));
          return tds[0]?.innerText?.trim()||"";
        });

        // 主 body 行
        const mainRows = Array.from(document.querySelectorAll(".el-table__body-wrapper .el-table__row"));
        const rowData = mainRows.map(r => {
          const tds = Array.from(r.querySelectorAll("td")).filter(td=>!td.classList.contains("is-hidden"));
          return tds.map(td=>td.innerText?.trim()||"");
        });

        // 表头顺序：模式、章节、截止时间、提交时间、作业状态、我的状态
        return titles.map((title,i) => {
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
        }).filter(a=>a.title);
      } catch(e){ return { error: e.message }; }
    })()`,
  });

  if (result.value?.error) throw new Error(result.value.error);
  return Array.isArray(result.value) ? result.value : [];
}

async function run() {
  let targetId = null;
  try {
    // 1. 打开主页
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;

    let info;
    for (let i = 0; i < 24; i++) {
      info = await request(`/info?target=${targetId}`);
      if (info.ready === "complete" && info.url && info.url !== "about:blank") break;
      await sleep(500);
    }
    if (!info?.url || info.url.includes("auth.bupt.edu.cn")) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    // 2. 等待课程卡片渲染
    await waitForCards(targetId);
    await sleep(500);

    // 3. 获取所有课程名（从所有 carousel 页）
    const allNamesResult = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `Array.from(document.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean)`,
    });
    const courseNames = allNamesResult.value || [];
    if (courseNames.length === 0) {
      console.error("未找到课程");
      return 1;
    }

    // 4. 获取总页数
    const totalPagesRes = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `parseInt((document.querySelector(".my-lesson-section .banner-indicator")?.innerText||"1/1").split("/")[1])||4`,
    });
    const totalPages = totalPagesRes.value || 4;

    if (!isJson) process.stderr.write(`共 ${courseNames.length} 门课程，逐一遍历中...\n`);

    // 5. 逐页逐课遍历
    const allAssignments = []; // { course, title, mode, chapter, deadline, status, myStatus }

    for (let page = 0; page < totalPages; page++) {
      // 翻到当前页
      if (page > 0) {
        // 导航回主页
        await request(`/navigate?target=${targetId}&url=${encodeURIComponent(HOME_URL)}`);
        await waitForCards(targetId);
        await sleep(300);
        // 翻页
        for (let p = 0; p < page; p++) {
          await request(`/eval?target=${targetId}`, {
            method: "POST",
            body: `document.querySelector(".my-lesson-section [title='下一页']")?.click();"next"`,
          });
          await sleep(600);
        }
      }

      // 当前 active 页的课程卡片
      const pageItemsRes = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `(function(){
          const active = document.querySelector(".my-lesson-section .el-carousel__item.is-active");
          if(!active) return [];
          return Array.from(active.querySelectorAll(".my-lesson-item")).map(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()||"").filter(Boolean);
        })()`,
      });
      const pageItems = pageItemsRes.value || [];

      for (let j = 0; j < pageItems.length; j++) {
        const courseName = pageItems[j];
        if (!isJson) process.stderr.write(`  处理：${courseName}\n`);

        // 确保在主页且在正确的 carousel 页
        const curInfo = await request(`/info?target=${targetId}`);
        if (!curInfo.url?.includes("homePage")) {
          await request(`/navigate?target=${targetId}&url=${encodeURIComponent(HOME_URL)}`);
          await waitForCards(targetId);
          await sleep(300);
          for (let p = 0; p < page; p++) {
            await request(`/eval?target=${targetId}`, {
              method: "POST",
              body: `document.querySelector(".my-lesson-section [title='下一页']")?.click();"next"`,
            });
            await sleep(600);
          }
        }

        // 点击课程卡片
        await request(`/eval?target=${targetId}`, {
          method: "POST",
          body: `(function(){
            const active = document.querySelector(".my-lesson-section .el-carousel__item.is-active");
            const items = active ? Array.from(active.querySelectorAll(".my-lesson-item")) : [];
            const target = items.find(el=>el.querySelector(".my-lesson-name")?.innerText?.trim()===${JSON.stringify(courseName)});
            target?.click();
            return !!target;
          })()`,
        });

        // 等待跳转到课程主页
        let onCoursePage = false;
        for (let i = 0; i < 16; i++) {
          await sleep(500);
          const inf = await request(`/info?target=${targetId}`);
          if (inf.url?.includes("courseHomePage")) { onCoursePage = true; break; }
        }
        if (!onCoursePage) {
          if (!isJson) process.stderr.write(`  跳过：${courseName}（进入课程主页失败）\n`);
          continue;
        }

        // 导航到作业列表页
        await request(`/navigate?target=${targetId}&url=${encodeURIComponent(ASSIGNMENT_URL)}`);
        for (let i = 0; i < 16; i++) {
          await sleep(500);
          const inf = await request(`/info?target=${targetId}`);
          if (inf.url?.includes("studentAssignmentListPage") && inf.ready === "complete") break;
        }
        await sleep(500);

        // 提取作业
        const assignments = await extractAssignments(targetId);
        assignments.forEach(a => {
          allAssignments.push({ course: courseName, ...a });
        });
      }
    }

    // 6. 过滤
    let filtered = allAssignments;
    if (pendingOnly) filtered = filtered.filter(a => a.status === "进行中");
    if (titleKeyword) filtered = filtered.filter(a => a.title.includes(titleKeyword));

    // 7. 输出
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
    if (targetId) await request(`/close?target=${targetId}`).catch(() => {});
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
