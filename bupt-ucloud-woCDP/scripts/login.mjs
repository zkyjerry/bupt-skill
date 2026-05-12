#!/usr/bin/env node
/**
 * 北邮校园网统一身份认证 - 密码登录（AgentBrowser 方案）
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
 * 依赖：agent-browser（本地安装）
 */

import {
  open, getUrl, waitLoad, snapshot, fill, click,
  switchFrame, mainFrame, evalJS, wait, close
} from "./browser.mjs";

const LOGIN_BASE = "https://auth.bupt.edu.cn/authserver/login";
const DEFAULT_SERVICE = "https://ucloud.bupt.edu.cn";

// ---------- 参数解析 ----------
const [username, password, service = DEFAULT_SERVICE] = process.argv.slice(2);

if (!username || !password) {
  console.error("用法：node login.mjs <学工号> <密码> [目标服务URL]");
  process.exit(2);
}

const LOGIN_URL = `${LOGIN_BASE}?service=${encodeURIComponent(service)}`;

// ---------- 主流程 ----------
async function login() {
  try {
    // 1. 打开登录页
    open(LOGIN_URL);

    // 2. 等待页面加载
    waitLoad();
    const pageUrl = getUrl();

    // 检查是否已登录（直接跳转）
    if (!pageUrl.includes("auth.bupt.edu.cn")) {
      console.log(pageUrl);
      return 0;
    }

    // 3. 切换到 loginIframe
    switchFrame("#loginIframe");

    // 4. 点击「密码登录」tab
    let snap = snapshot();
    const lines = snap.split("\n");

    // 找到「密码登录」链接的 ref
    let pwdTabRef = null;
    for (const line of lines) {
      if (line.includes("密码登录")) {
        const match = line.match(/\[ref=(e\d+)\]/);
        if (match) pwdTabRef = `@${match[1]}`;
      }
    }

    if (!pwdTabRef) {
      console.error("未找到「密码登录」tab");
      return 1;
    }

    click(pwdTabRef);
    wait(500);

    // 5. 获取输入框 ref
    snap = snapshot();
    let usernameRef = null;
    let passwordRef = null;
    let loginBtnRef = null;

    for (const line of snap.split("\n")) {
      if (line.includes("请输入学工号") || line.includes("username")) {
        const match = line.match(/\[ref=(e\d+)\]/);
        if (match) usernameRef = `@${match[1]}`;
      }
      if (line.includes("请输入密码") || line.includes("password")) {
        const match = line.match(/\[ref=(e\d+)\]/);
        if (match) passwordRef = `@${match[1]}`;
      }
      if (line.includes("账号登录") || line.includes("登录")) {
        const match = line.match(/\[ref=(e\d+)\]/);
        if (match) loginBtnRef = `@${match[1]}`;
      }
    }

    if (!usernameRef || !passwordRef || !loginBtnRef) {
      console.error("未找到输入框或登录按钮");
      return 1;
    }

    // 6. 填入学工号和密码
    fill(usernameRef, username);
    fill(passwordRef, password);

    // 7. 点击登录
    click(loginBtnRef);

    // 8. 等待跳转
    waitLoad();
    const finalUrl = getUrl();

    if (finalUrl.includes("auth.bupt.edu.cn")) {
      // 未跳转，可能登录失败
      mainFrame();
      const bodyText = evalJS("document.body.innerText");
      if (bodyText.includes("用户名或密码错误")) {
        console.error("登录失败：用户名或密码错误");
      } else {
        console.error("登录失败：页面未跳转");
      }
      return 1;
    }

    // 登录成功
    console.log(finalUrl);
    return 0;

  } finally {
    // 关闭浏览器
    close();
  }
}

// ---------- 执行 ----------
login().then((code) => process.exit(code)).catch((err) => {
  console.error(`脚本异常：${err.message}`);
  process.exit(2);
});
