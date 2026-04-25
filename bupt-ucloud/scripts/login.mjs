#!/usr/bin/env node
/**
 * 北邮校园网统一身份认证 - 密码登录
 *
 * 用法：
 *   node login.mjs <学工号> <密码> [目标服务URL]
 *
 * 参数：
 *   学工号     必填，如 2023211442
 *   密码       必填，如 zky~jerry666666
 *   目标服务   可选，默认 https://ucloud.bupt.edu.cn
 *
 * 退出码：
 *   0  登录成功，stdout 输出目标页面 URL
 *   1  登录失败，stderr 输出错误信息
 *   2  参数错误或环境问题
 *
 * 依赖：CDP Proxy 需在 localhost:3456 运行
 */

const PROXY = "http://localhost:3456";
const LOGIN_BASE = "https://auth.bupt.edu.cn/authserver/login";
const DEFAULT_SERVICE = "https://ucloud.bupt.edu.cn";

// ---------- 参数解析 ----------
const [username, password, service = DEFAULT_SERVICE] = process.argv.slice(2);

if (!username || !password) {
  console.error("用法：node login.mjs <学工号> <密码> [目标服务URL]");
  process.exit(2);
}

const LOGIN_URL = `${LOGIN_BASE}?service=${encodeURIComponent(service)}`;

// ---------- 工具函数 ----------
async function request(path, options = {}) {
  const fetchOptions = { ...options };
  if (fetchOptions.body && !fetchOptions.headers) {
    fetchOptions.headers = { "Content-Type": "text/plain" };
  }
  const res = await fetch(`${PROXY}${path}`, fetchOptions);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json();
}

async function evalInIframe(targetId, script) {
  // 穿透 loginIframe，暴露 doc（文档）和 win（iframe 自己的 window）
  // 注意：事件构造器和原型必须用 win，不能用外层 window
  const wrapped = `
    (function() {
      try {
        const iframe = document.getElementById("loginIframe");
        if (!iframe) return { __error: "loginIframe not found" };
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        const win = iframe.contentWindow;
        if (!doc || !win) return { __error: "cannot access iframe contentDocument" };
        ${script}
      } catch(e) {
        return { __error: "eval threw: " + e.message };
      }
    })()
  `;
  const result = await request(`/eval?target=${targetId}`, {
    method: "POST",
    body: wrapped,
  });
  if (result.value?.__error) throw new Error(result.value.__error);
  return result.value;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 主流程 ----------
async function login() {
  let targetId = null;

  try {
    // 1. 打开登录页（新后台 tab）
    const newTab = await request(
      `/new?url=${encodeURIComponent(LOGIN_URL)}`
    );
    targetId = newTab.targetId;
    if (!targetId) throw new Error("创建 tab 失败");

    // 2. 等待页面导航并加载完成（最多 12s）
    // 条件：ready=complete 且 URL 不为 about:blank（排除 tab 初始状态）
    let pageUrl = "";
    for (let i = 0; i < 24; i++) {
      const info = await request(`/info?target=${targetId}`);
      if (info.ready === "complete" && info.url && info.url !== "about:blank") {
        pageUrl = info.url;
        break;
      }
      await sleep(500);
    }
    if (!pageUrl) throw new Error("登录页加载超时（未获得有效 URL）");

    // 检查是否已因存在 CAS 会话直接跳转到目标服务（已登录态）
    if (!pageUrl.includes("auth.bupt.edu.cn")) {
      console.log(pageUrl);
      return 0;
    }

    // 等 iframe 内的密码登录 tab 元素出现（最多 8s）
    let ready = false;
    for (let i = 0; i < 16; i++) {
      const check = await request(`/eval?target=${targetId}`, {
        method: "POST",
        body: `(function(){
          const f = document.getElementById("loginIframe");
          if (!f) return "no-iframe";
          const d = f.contentDocument || f.contentWindow?.document;
          if (!d || !d.body) return "not-ready";
          const tab = d.querySelector('a[i18n="login.type.password"]');
          return tab ? "ready" : "no-tab-yet";
        })()`,
      });
      if (check.value === "ready") { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error("登录页 iframe 加载超时");

    // 3. 切换到「密码登录」tab
    await evalInIframe(targetId, `
      const tab = doc.querySelector('a[i18n="login.type.password"]');
      if (!tab) return { __error: "密码登录 tab 未找到" };
      tab.click();
      return { ok: true };
    `);

    // 给 tab 切换动画留时间
    await sleep(300);

    // 4. 填入学工号和密码（触发响应式绑定）
    await evalInIframe(targetId, `
      function setVal(el, val) {
        if (!el) return false;
        // 必须用 iframe 自己的 win，外层 window 的原型对 iframe 元素无效
        const setter = Object.getOwnPropertyDescriptor(
          win.HTMLInputElement.prototype, "value"
        ).set;
        setter.call(el, val);
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
        return true;
      }
      const u = doc.getElementById("username");
      const p = doc.getElementById("password");
      if (!u || !p) return { __error: "输入框未找到，请确认已切换到密码登录 tab" };
      setVal(u, ${JSON.stringify(username)});
      setVal(p, ${JSON.stringify(password)});
      return { username: u.value, passwordLen: p.value.length };
    `);

    // 5. 点击「账号登录」按钮
    await evalInIframe(targetId, `
      const btn = doc.querySelector('input[i18n="login.form.btn.login"]');
      if (!btn) return { __error: "登录按钮未找到" };
      btn.click();
      return { ok: true };
    `);

    // 6. 等待跳转（最多 8s，每 500ms 检查一次）
    let finalUrl = null;
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      const info = await request(`/info?target=${targetId}`);
      // 跳出 auth 域 = 登录成功
      if (!info.url.includes("auth.bupt.edu.cn")) {
        finalUrl = info.url;
        break;
      }
    }

    // 7. 判断结果
    if (finalUrl) {
      console.log(finalUrl);
      return 0;
    }

    // 未跳转，读取错误信息
    const errMsg = await evalInIframe(targetId, `
      const errEl = doc.getElementById("errorMessage");
      return errEl ? errEl.innerText.trim() : "未知错误（页面未跳转）";
    `);
    console.error(`登录失败：${errMsg}`);
    return 1;

  } finally {
    // 无论成功失败，关闭创建的 tab
    if (targetId) {
      await request(`/close?target=${targetId}`).catch(() => {});
    }
  }
}

// ---------- 执行 ----------
login().then((code) => process.exit(code)).catch((err) => {
  console.error(`脚本异常：${err.message}`);
  process.exit(2);
});
