#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 获取本学期所有课程（AgentBrowser 方案）
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
 *   2  环境问题
 */

import {
  open, getUrl, waitLoad, evalJS, wait, close, loadState
} from "./browser.mjs";

const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";
const AUTH_DOMAIN = "auth.bupt.edu.cn";

const isJson = process.argv.includes("--json");

async function listCourses() {
  try {
    // 0. 加载保存的会话状态
    loadState();

    // 1. 打开主页
    open(HOME_URL);
    waitLoad();

    const pageUrl = getUrl();

    // 2. 检查是否登录
    if (pageUrl.includes(AUTH_DOMAIN)) {
      console.error("未登录，请先运行 login.mjs 获取有效会话");
      return 1;
    }

    // 3. 等待课程区域渲染
    wait(3000);

    // 4. 提取所有课程（el-carousel 全部数据已在 DOM 中）
    const result = evalJS(`(function(){
      try {
        const section = document.querySelector(".my-lesson-section");
        if (!section) return JSON.stringify({ error: "section not found" });
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
        return JSON.stringify({ total: courses.length, pageTotal: indicator?.innerText.trim(), courses });
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()`);

    let data;
    try {
      // 处理可能的双重引号包裹
      let parseTarget = result;
      if (parseTarget.startsWith('"') && parseTarget.endsWith('"')) {
        try { parseTarget = JSON.parse(parseTarget); } catch {}
      }
      data = typeof parseTarget === 'string' ? JSON.parse(parseTarget) : parseTarget;
    } catch (e) {
      console.error("解析课程数据失败:", e.message);
      return 1;
    }

    if (data.error) {
      console.error(`提取课程失败：${data.error}`);
      return 1;
    }

    const { courses, total, pageTotal } = data;

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
    close();
  }
}

listCourses()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`脚本异常：${err.message}`);
    process.exit(2);
  });
