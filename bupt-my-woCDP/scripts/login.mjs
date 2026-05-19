#!/usr/bin/env node
/**
 * 北邮信息门户 - 密码登录（AgentBrowser 方案）
 *
 * 用法：
 *   node login.mjs <学工号> <密码> [目标服务URL]
 *
 * 参数：
 *   学工号     必填，如 2023211442
 *   密码       必填，如 zky~jerry666666
 *   目标服务   可选，默认 http://my.bupt.edu.cn
 *
 * 退出码：
 *   0  登录成功，stdout 输出目标页面 URL
 *   1  登录失败，stderr 输出错误信息
 *   2  参数错误或环境问题
 */

import {
  open, getUrl, waitLoad, snapshot, fill, click,
  switchFrame, mainFrame, evalJS, wait, close,
  saveState
} from "./browser.mjs";

const LOGIN_BASE = "https://auth.bupt.edu.cn/authserver/login";
const DEFAULT_SERVICE = "http://my.bupt.edu.cn";

const [username, password, service = DEFAULT_SERVICE] = process.argv.slice(2);

if (!username || !password) {
  console.error("用法：node login.mjs <学工号> <密码> [目标服务URL]");
  process.exit(2);
}

const LOGIN_URL = `${LOGIN_BASE}?service=${encodeURIComponent(service)}`;

async function login() {
  try {
    open(LOGIN_URL);
    waitLoad();
    const pageUrl = getUrl();

    if (!pageUrl.includes("auth.bupt.edu.cn")) {
      console.log(pageUrl);
      return 0;
    }

    switchFrame("#loginIframe");

    let snap = snapshot();
    const lines = snap.split("\n");

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

    fill(usernameRef, username);
    fill(passwordRef, password);
    click(loginBtnRef);

    waitLoad();
    const finalUrl = getUrl();

    if (finalUrl.includes("auth.bupt.edu.cn")) {
      mainFrame();
      const bodyText = evalJS("document.body.innerText");
      if (bodyText.includes("用户名或密码错误")) {
        console.error("登录失败：用户名或密码错误");
      } else {
        console.error("登录失败：页面未跳转");
      }
      return 1;
    }

    saveState();
    console.log(finalUrl);
    return 0;

  } finally {
    close();
  }
}

login().then((code) => process.exit(code)).catch((err) => {
  console.error(`脚本异常：${err.message}`);
  process.exit(2);
});
