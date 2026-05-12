/**
 * AgentBrowser 工具封装
 * 提供统一的浏览器操作接口，所有脚本通过此模块与 agent-browser CLI 交互
 */

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AB_BIN = join(__dirname, "..", "node_modules", ".bin", "agent-browser");

/**
 * 执行 agent-browser 命令
 * @param {string} args - 命令参数
 * @param {object} options - execSync 选项
 * @returns {string} stdout 输出
 */
export function ab(args, options = {}) {
  const cmd = `${AB_BIN} ${args}`;
  // 清理可能导致 Node 启动失败的环境变量
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_OPTIONS;
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: options.timeout || 30000,
      env: cleanEnv,
      ...options,
    }).trim();
  } catch (err) {
    throw new Error(`agent-browser ${args} failed: ${err.stderr || err.message}`);
  }
}

/**
 * 执行 agent-browser 命令，返回 JSON
 * @param {string} args - 命令参数
 * @param {object} options - execSync 选项
 * @returns {any} 解析后的 JSON
 */
export function abJson(args, options = {}) {
  const raw = ab(`${args} --json`, options);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * 打开 URL
 * @param {string} url
 * @returns {string} 页面标题
 */
export function open(url) {
  return ab(`open "${url}"`, { timeout: 30000 });
}

/**
 * 获取当前 URL
 * @returns {string}
 */
export function getUrl() {
  return ab("get url");
}

/**
 * 获取页面标题
 * @returns {string}
 */
export function getTitle() {
  return ab("get title");
}

/**
 * 获取页面快照（交互元素）
 * @returns {string}
 */
export function snapshot() {
  return ab("snapshot -i", { timeout: 15000 });
}

/**
 * 获取页面文本内容
 * @returns {string}
 */
export function getText() {
  return ab('eval "document.body.innerText"', { timeout: 15000 });
}

/**
 * 执行 JavaScript
 * @param {string} script - JS 代码
 * @returns {string}
 */
export function evalJS(script) {
  // 转义引号
  const escaped = script.replace(/"/g, '\\"');
  return ab(`eval "${escaped}"`, { timeout: 15000 });
}

/**
 * 点击元素（通过 ref）
 * @param {string} ref - 如 @e1
 */
export function click(ref) {
  return ab(`click ${ref}`);
}

/**
 * 填充输入框
 * @param {string} ref - 如 @e1
 * @param {string} text - 输入内容
 */
export function fill(ref, text) {
  const escaped = text.replace(/"/g, '\\"');
  return ab(`fill ${ref} "${escaped}"`);
}

/**
 * 等待指定毫秒
 * @param {number} ms
 */
export function wait(ms) {
  return ab(`wait ${ms}`);
}

/**
 * 等待页面加载完成
 */
export function waitLoad() {
  return ab("wait --load networkidle", { timeout: 30000 });
}

/**
 * 等待 URL 包含指定字符串
 * @param {string} pattern
 * @param {number} timeout
 */
export function waitUrl(pattern, timeout = 15000) {
  return ab(`wait --url "${pattern}" --timeout ${timeout}`, { timeout: timeout + 5000 });
}

/**
 * 切换到 iframe
 * @param {string} selector - iframe 选择器
 */
export function switchFrame(selector) {
  return ab(`frame "${selector}"`);
}

/**
 * 切换回主 frame
 */
export function mainFrame() {
  return ab("frame main");
}

/**
 * 关闭浏览器（容错：超时或失败时静默忽略）
 */
export function close() {
  try {
    return ab("close", { timeout: 5000 });
  } catch {
    return "";
  }
}

/**
 * 滚动页面
 * @param {string} direction - down/up
 * @param {number} amount - 像素
 */
export function scroll(direction = "down", amount = 500) {
  return ab(`scroll ${direction} ${amount}`);
}

/**
 * 列出所有 tab
 * @returns {string}
 */
export function listTabs() {
  return ab("tab");
}

/**
 * 关闭当前 tab
 */
export function closeTab() {
  return ab("tab close");
}

/**
 * 等待元素出现
 * @param {string} ref - 元素 ref
 */
export function waitElement(ref) {
  return ab(`wait ${ref}`, { timeout: 15000 });
}

/**
 * 检查元素是否可见
 * @param {string} ref
 * @returns {boolean}
 */
export function isVisible(ref) {
  const result = ab(`is visible ${ref}`);
  return result.toLowerCase() === "true";
}

/**
 * 获取元素文本
 * @param {string} ref
 * @returns {string}
 */
export function getElementText(ref) {
  return ab(`get text ${ref}`);
}

/**
 * 获取元素属性
 * @param {string} ref
 * @param {string} attr
 * @returns {string}
 */
export function getAttr(ref, attr) {
  return ab(`get attr ${ref} ${attr}`);
}

/**
 * 设置 localStorage
 * @param {string} key
 * @param {string} value
 */
export function setLocalStorage(key, value) {
  const escaped = value.replace(/"/g, '\\"');
  return evalJS(`localStorage.setItem("${key}", "${escaped}")`);
}

/**
 * 获取 localStorage
 * @param {string} key
 * @returns {string}
 */
export function getLocalStorage(key) {
  return evalJS(`localStorage.getItem("${key}")`);
}

/**
 * 截图
 * @param {string} path - 保存路径
 */
export function screenshot(path) {
  return ab(`screenshot ${path}`);
}

// ---------- 会话状态管理 ----------

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".bupt-ucloud");
const STATE_FILE = join(STATE_DIR, "session.json");

/**
 * 保存浏览器会话状态（cookies、localStorage 等）
 * 登录成功后调用，后续脚本可复用
 */
export function saveState() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  ab(`state save "${STATE_FILE}"`);
}

/**
 * 加载之前保存的会话状态
 * 在打开页面前调用，恢复登录态
 * @returns {boolean} 是否成功加载
 */
export function loadState() {
  if (!existsSync(STATE_FILE)) return false;
  try {
    ab(`state load "${STATE_FILE}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查是否有保存的会话状态
 * @returns {boolean}
 */
export function hasState() {
  return existsSync(STATE_FILE);
}

/**
 * 清除保存的会话状态
 */
export function clearState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}
