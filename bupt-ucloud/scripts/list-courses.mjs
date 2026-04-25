#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 获取本学期所有课程
 *
 * 用法：
 *   node list-courses.mjs [--json]
 *
 * 选项：
 *   --json   以 JSON 格式输出，默认输出可读文本
 *
 * 退出码：
 *   0  成功，stdout 输出课程列表
 *   1  获取失败
 *   2  环境问题（CDP Proxy 未运行等）
 *
 * 说明：
 *   el-carousel 组件所有页的数据已全部渲染在 DOM 中，
 *   无需模拟点击箭头翻页，直接遍历所有 .el-carousel__item 即可。
 */

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const AUTH_DOMAIN = "auth.bupt.edu.cn";

const isJson = process.argv.includes("--json");

async function request(path, options = {}) {
  const fetchOptions = { ...options };
  if (fetchOptions.body && !fetchOptions.headers) {
    fetchOptions.headers = { "Content-Type": "text/plain" };
  }
  const res = await fetch(`${PROXY}${path}`, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${path}\n  body: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listCourses() {
  let targetId = null;
  try {
    // 1. 打开主页
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;
    if (!targetId) throw new Error("创建 tab 失败");

    // 2. 等待页面加载（URL 不为 about:blank 且 ready=complete）
    let pageUrl = "";
    for (let i = 0; i < 24; i++) {
      const info = await request(`/info?target=${targetId}`);
      if (info.ready === "complete" && info.url && info.url !== "about:blank") {
        pageUrl = info.url;
        break;
      }
      await sleep(500);
    }
    if (!pageUrl) throw new Error("页面加载超时");

    // 3. 如果跳转到登录页，提示先登录
    if (pageUrl.includes(AUTH_DOMAIN)) {
      console.error("未登录，请先运行 login.mjs 获取有效会话");
      return 1;
    }

    // 4. 等待课程区域渲染（最多 12s，eval 异常视为未就绪继续重试）
    let ready = false;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      try {
        const check = await request(`/eval?target=${targetId}`, {
          method: "POST",
          body: `(function(){
            const section = document.querySelector(".my-lesson-section");
            if (!section) return "no-section";
            const items = section.querySelectorAll(".el-carousel__item .my-lesson-item");
            return items.length > 0 ? "ready" : "loading";
          })()`,
        });
        if (check.value === "ready") { ready = true; break; }
      } catch (_) {
        // SPA 还在渲染，忽略异常继续等待
      }
    }
    if (!ready) throw new Error("课程区域加载超时");

    // 多给 SPA 1s 完成数据绑定
    await sleep(1000);

    // 5. 一次性提取所有页的课程（el-carousel 全部数据已在 DOM 中）
    const result = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `(function(){
        try {
          const section = document.querySelector(".my-lesson-section");
          if (!section) return { error: "section not found" };
          const pages = Array.from(section.querySelectorAll(".el-carousel__item"));
          const courses = [];
          pages.forEach((page, pageIdx) => {
            page.querySelectorAll(".my-lesson-item").forEach(item => {
              courses.push({
                page: pageIdx + 1,
                name: item.querySelector(".my-lesson-name")?.innerText?.trim() || "",
                teacher: item.querySelector(".my-lesson-teachers")?.innerText?.trim() || "",
                dept: item.querySelector(".my-lesson-area")?.innerText?.trim() || ""
              });
            });
          });
          const indicator = Array.from(document.querySelectorAll(".banner-indicator"))
            .find(el => /^\\d+\\/\\d+$/.test(el.innerText.trim()));
          return { total: courses.length, pageTotal: indicator?.innerText.trim(), courses };
        } catch(e) {
          return { error: e.message };
        }
      })()`,
    });

    if (result.value?.error) throw new Error(`提取课程失败：${result.value.error}`);
    const { courses, total, pageTotal } = result.value;

    if (isJson) {
      console.log(JSON.stringify({ total, pageTotal, courses }, null, 2));
    } else {
      console.log(`本学期课程（共 ${total} 门，${pageTotal} 页）\n`);
      let lastPage = 0;
      courses.forEach((c, i) => {
        if (c.page !== lastPage) {
          console.log(`── 第 ${c.page} 页 ──`);
          lastPage = c.page;
        }
        console.log(`  ${i + 1}. ${c.name}`);
        console.log(`     教师：${c.teacher}  | ${c.dept}`);
      });
    }

    return 0;
  } finally {
    if (targetId) {
      await request(`/close?target=${targetId}`).catch(() => {});
    }
  }
}

listCourses()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`脚本异常：${err.message}`);
    process.exit(2);
  });
