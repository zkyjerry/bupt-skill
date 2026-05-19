#!/usr/bin/env node
/**
 * 北邮信息门户 - 检索办事指南
 *
 * 用法：
 *   node search-regulations.mjs --keyword <关键词> [--list-only] [--json] [--download-dir DIR]
 *
 * 选项：
 *   --keyword      搜索关键词
 *   --list-only    只列出匹配条目
 *   --json         JSON 格式输出
 *   --download-dir 下载图片到指定目录
 *
 * 退出码：
 *   0  找到匹配
 *   1  未找到
 *   2  参数/环境错误
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  open, getUrl, waitLoad, evalJS, wait, close,
  loadState
} from "./browser.mjs";

const LIST_URL = "http://my.bupt.edu.cn/list.jsp?urltype=tree.TreeTempUrl&wbtreeid=1524";
const AUTH_DOMAIN = "auth.bupt.edu.cn";
const LABEL = "办事指南";

const args = process.argv.slice(2);
const isListOnly = args.includes("--list-only");
const isJson = args.includes("--json");

const keywordIdx = args.indexOf("--keyword");
const keyword = keywordIdx !== -1 ? args[keywordIdx + 1] : null;

const downloadIdx = args.indexOf("--download-dir");
const downloadDir = downloadIdx !== -1 ? args[downloadIdx + 1] : null;

async function downloadImages(imageUrls, title, baseDir) {
  const safeName = title.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 30);
  const dir = join(baseDir, safeName);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const res = await fetch(imageUrls[i]);
      const buf = Buffer.from(await res.arrayBuffer());
      const path = join(dir, `page_${String(i + 1).padStart(3, "0")}.jpg`);
      writeFileSync(path, buf);
      process.stderr.write(`  已下载 ${i + 1}/${imageUrls.length}: ${path}\n`);
    } catch (e) {
      process.stderr.write(`  下载失败 ${i + 1}/${imageUrls.length}: ${e.message}\n`);
    }
  }
  return dir;
}

function parseEvalResult(raw) {
  try {
    let parsed = raw;
    while (typeof parsed === 'string' && parsed.startsWith('"') && parsed.endsWith('"')) {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch { return raw; }
}

async function run() {
  try {
    loadState();

    // 1. Open list page
    open(LIST_URL);
    waitLoad();
    if (getUrl().includes(AUTH_DOMAIN)) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }
    wait(2000);

    // For --list-only without keyword: just scrape list page
    if (isListOnly && !keyword) {
      const itemsRaw = evalJS(`JSON.stringify(Array.from(document.querySelectorAll('a[href*="wbnewsid"]')).map(function(a){return {text:a.innerText.trim(),href:a.href};}).filter(function(item){return item.text.length > 0;}))`);
      const items = parseEvalResult(itemsRaw);
      if (isJson) {
        console.log(JSON.stringify({ total: items.length || 0, items: items || [] }, null, 2));
      } else {
        console.log(`${LABEL}（共 ${(items||[]).length} 条）\n`);
        (items||[]).forEach((item, i) => console.log(`  ${i + 1}. ${item.text}`));
      }
      return (items||[]).length > 0 ? 0 : 1;
    }

    if (!keyword) {
      console.error("error: --keyword is required");
      return 2;
    }

    // 2. Submit search via the built-in form
    const searchResult = evalJS(`(function(){
      const input = document.querySelector('input[name="INTEXT"]');
      if (!input) return "no-input";
      input.value = ${JSON.stringify(keyword)};
      const btn = input.closest('form')?.querySelector('input[type="image"]');
      if (btn) { btn.click(); return "clicked"; }
      return "no-button";
    })()`);

    // 3. Wait for search results page
    wait(2000);
    waitLoad();
    const resultUrl = getUrl();

    // 4. Extract items from search results page
    let items = [];
    if (resultUrl.includes("fz_ssjg.jsp") || resultUrl.includes("search") || resultUrl.includes("ssjg")) {
      const itemsRaw = evalJS(`JSON.stringify(Array.from(document.querySelectorAll('a[href*="wbnewsid"]')).map(function(a){return {text:a.innerText.trim(),href:a.href};}).filter(function(item){return item.text.length > 0;}))`);
      items = parseEvalResult(itemsRaw);
      if (!Array.isArray(items)) items = [];
    }

    // 5. Fallback: if search didn't work, try scraping list page
    if (items.length === 0) {
      const itemsRaw2 = evalJS(`JSON.stringify(Array.from(document.querySelectorAll('a[href*="wbnewsid"]')).map(function(a){return {text:a.innerText.trim(),href:a.href};}).filter(function(item){return item.text.length > 0;}))`);
      items = parseEvalResult(itemsRaw2);
      if (!Array.isArray(items)) items = [];
    }

    const matches = items.filter(item => item.text.includes(keyword));

    // --list-only mode
    if (isListOnly) {
      if (isJson) {
        console.log(JSON.stringify({ keyword, total: matches.length, items: matches }, null, 2));
      } else {
        console.log(`${LABEL} - 搜索"${keyword}"（共 ${matches.length} 条）\n`);
        matches.forEach((item, i) => console.log(`  ${i + 1}. ${item.text}`));
      }
      return matches.length > 0 ? 0 : 1;
    }

    // Not found
    if (matches.length === 0) {
      if (isJson) {
        console.log(JSON.stringify({ error: "not_found", keyword, suggestions: items.map(i => i.text) }));
      } else {
        console.log(`未找到包含"${keyword}"的${LABEL}`);
        if (items.length > 0) {
          console.log(`\n当前${LABEL}列表（可能相关）：`);
          items.forEach((item, i) => console.log(`  ${i + 1}. ${item.text}`));
        }
      }
      return 1;
    }

    // Navigate to first match detail
    const firstMatch = matches[0];
    if (!isJson) process.stderr.write(`找到匹配："${firstMatch.text}"\n`);
    open(firstMatch.href);
    waitLoad();
    wait(2000);

    // Extract detail
    const detailRaw = evalJS(`JSON.stringify((function(){
      const title = document.querySelector("h1")?.innerText?.trim() || "";
      const vc = document.querySelector(".v_news_content");
      const imgs = vc ? Array.from(vc.querySelectorAll("img")).filter(function(img){return img.className.includes("img_vsb_content");}).map(function(img){return img.src;}) : [];
      const textContent = vc ? (vc.innerText||"").trim() : "";
      const bodyText = document.body.innerText || "";
      const deptMatch = bodyText.match(/发布部门[：:]\\s*([^\\n]+)/);
      const dateMatch = bodyText.match(/发布时间[：:]\\s*([^\\n]+)/);
      const attachMatch = bodyText.match(/公告附件如下[：:]\\s*[\\s\\S]*?([^\\s]+\\.pdf)/);
      var meta = {};
      if(deptMatch) meta.department = deptMatch[1].trim();
      if(dateMatch) meta.date = dateMatch[1].trim();
      if(attachMatch) meta.attachment = attachMatch[1].trim();
      if(imgs.length > 0 && !textContent) {
        return JSON.stringify({title:title,contentType:"images",content:textContent,imageUrls:imgs,meta:meta});
      }
      return JSON.stringify({title:title,contentType:"text",content:textContent,meta:meta});
    })())`);

    const detailData = parseEvalResult(detailRaw);

    if (detailData.contentType === "images" && downloadDir && detailData.imageUrls?.length > 0) {
      await downloadImages(detailData.imageUrls, detailData.title || keyword, downloadDir);
      detailData.downloadedTo = join(downloadDir, (detailData.title || keyword).replace(/[\/\\:*?"<>|]/g, "_").substring(0, 30));
    }

    if (isJson) {
      console.log(JSON.stringify(detailData, null, 2));
    } else {
      console.log(`\n标题：${detailData.title}`);
      if (detailData.meta?.department) console.log(`发布部门：${detailData.meta.department}`);
      if (detailData.meta?.date) console.log(`发布时间：${detailData.meta.date}`);
      console.log(`内容类型：${detailData.contentType === "images" ? "图片" : "文本"}`);
      if (detailData.contentType === "images") {
        console.log(`图片数量：${detailData.imageUrls?.length || 0}`);
        if (detailData.downloadedTo) {
          console.log(`已下载到：${detailData.downloadedTo}`);
        } else {
          console.log("使用 --download-dir 选项可下载图片");
        }
      } else if (detailData.content) {
        console.log(`\n${detailData.content}`);
      }
      if (detailData.meta?.attachment) {
        console.log(`\n附件：${detailData.meta.attachment}`);
      }
    }

    return 0;

  } finally {
    close();
  }
}

run()
  .then(code => process.exit(code))
  .catch(err => { console.error(`脚本异常：${err.message}`); process.exit(2); });
