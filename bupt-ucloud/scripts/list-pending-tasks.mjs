#!/usr/bin/env node
/**
 * 北邮云邮教学平台 - 查看所有待办作业详情
 *
 * 从首页"待办"区域依次点击每张卡片，提取：
 *   名称、作业内容、开始时间、截止时间、联系章节、
 *   能否逾期补交、作业模式、班级、总分数
 *
 * 用法：
 *   node list-pending-tasks.mjs [--json]
 *
 * 退出码：
 *   0  成功，stdout 输出作业列表
 *   1  未找到待办或获取失败
 *   2  环境问题
 */

const PROXY = "http://localhost:3456";
const HOME_URL = "https://ucloud.bupt.edu.cn/uclass/index.html#/student/homePage";

const isJson = process.argv.includes("--json");

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

/** 等待页面加载到指定 URL 前缀 */
async function waitForUrl(targetId, urlFragment, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await request(`/info?target=${targetId}`);
    if (info.url?.includes(urlFragment) && info.ready === "complete") return info.url;
    await sleep(400);
  }
  throw new Error(`等待 URL 包含 "${urlFragment}" 超时`);
}

/** 等待首页待办卡片渲染 */
async function waitForCards(targetId) {
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const r = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `document.querySelectorAll(".in-progress-item").length`,
      });
      if (r.value > 0) return r.value;
    } catch (_) {}
  }
  return 0;
}

/** 从作业详情页 URL + DOM 提取完整字段 */
async function extractDetails(targetId, pageUrl) {
  // 等页面渲染
  await sleep(1500);
  const result = await request(`/eval?target=${targetId}`, {
    method: "POST",
    body: `(function(){
      try {
        // URL 参数
        const hash = location.href.split("#")[1]||"";
        const params = {};
        (hash.split("?")[1]||"").split("&").forEach(p=>{
          const [k,v] = p.split("=");
          if(k) params[decodeURIComponent(k)] = decodeURIComponent(v||"");
        });

        // 时间段
        const timeEl = document.querySelector("[class*=time],[class*=date]");
        const timeText = timeEl?.innerText?.trim()||"";
        const startMatch = timeText.match(/开始时间\\s+([^/]+)/);
        const endMatch = timeText.match(/截止时间\\s+(.+)/);

        // .item-label 标签 → 父容器内的值
        const labelPairs = {};
        document.querySelectorAll(".item-label").forEach(label => {
          const key = label.innerText?.trim();
          if(!key) return;
          // 找父级里的值（label 的下一个兄弟，或父级的值节点）
          const parent = label.parentElement;
          const siblings = parent ? Array.from(parent.children) : [];
          const labelIdx = siblings.indexOf(label);
          const valueEl = siblings[labelIdx+1];
          const value = valueEl?.innerText?.trim() || "";
          labelPairs[key] = value;
        });

        return {
          assignmentId: params.assignmentId||"",
          assignmentType: params.assignmentType||"",
          title: params.assignmentTitle || params.assignmentId,
          startTime: startMatch?.[1]?.trim()||"",
          endTime: endMatch?.[1]?.trim()||"",
          content: labelPairs["作业内容"]||"",
          chapter: labelPairs["联系章节"]||"",
          lateSubmit: labelPairs["能否逾期补交"]||"",
          mode: labelPairs["作业模式"]||"",
          classInfo: labelPairs["班级"]||"",
          score: labelPairs["总分数"]||"",
        };
      } catch(e){ return { error: e.message }; }
    })()`,
  });
  if (result.value?.error) throw new Error(result.value.error);
  return result.value;
}

async function run() {
  let targetId = null;
  try {
    // 1. 打开主页
    const newTab = await request(`/new?url=${encodeURIComponent(HOME_URL)}`);
    targetId = newTab.targetId;

    // 2. 等待主页加载
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

    // 3. 等待待办卡片
    const cardCount = await waitForCards(targetId);
    if (cardCount === 0) {
      console.log("暂无待办作业");
      return 0;
    }

    // 4. 读取所有卡片的标题（用于进度展示）
    const cardTitles = await request(`/eval?target=${targetId}`, {
      method: "POST",
      body: `Array.from(document.querySelectorAll(".in-progress-item")).map(c=>c.querySelector(".acitivity-name,.activity-name,[class*=name]")?.innerText?.trim()||c.innerText?.trim().split("\\n")[0])`,
    });
    const titles = cardTitles.value || [];

    // 5. 逐卡点击 → 进详情页提取 → 返回
    const assignments = [];
    for (let i = 0; i < cardCount; i++) {
      if (!isJson) process.stderr.write(`提取第 ${i + 1}/${cardCount} 个作业...\n`);

      // 确保在主页
      const curInfo = await request(`/info?target=${targetId}`);
      if (!curInfo.url?.includes("homePage")) {
        await request(`/navigate?target=${targetId}&url=${encodeURIComponent(HOME_URL)}`);
        await waitForCards(targetId);
        await sleep(500);
      }

      // 点击第 i 张卡片
      await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `document.querySelectorAll(".in-progress-item")[${i}]?.click(); "clicked"`,
      });

      // 等待导航到详情页
      let detailUrl;
      try {
        detailUrl = await waitForUrl(targetId, "assignmentDetails", 8000);
      } catch {
        process.stderr.write(`  警告：第 ${i + 1} 个卡片点击后未跳转到详情页，跳过\n`);
        continue;
      }

      // 提取详情
      const details = await extractDetails(targetId, detailUrl);
      assignments.push(details);
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
    if (targetId) await request(`/close?target=${targetId}`).catch(() => {});
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
