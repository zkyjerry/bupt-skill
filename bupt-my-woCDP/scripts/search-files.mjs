#!/usr/bin/env node
/**
 * 北邮信息门户 - 检索校内文件
 *
 * 用法：
 *   node search-files.mjs --keyword <关键词> [--page N] [--list-only] [--json] [--download-dir DIR]
 *
 * 选项：
 *   --keyword      搜索关键词（必填，--list-only 除外）
 *   --page N       页码，默认 1
 *   --list-only    只列出匹配条目
 *   --json         JSON 格式输出
 *   --download-dir 下载图片到指定目录（图片类内容时使用）
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

const LIST_URL = "http://my.bupt.edu.cn/list.jsp?urltype=tree.TreeTempUrl&wbtreeid=2001";
const AUTH_DOMAIN = "auth.bupt.edu.cn";

const args = process.argv.slice(2);
const isListOnly = args.includes("--list-only");
const isJson = args.includes("--json");

const keywordIdx = args.indexOf("--keyword");
const keyword = keywordIdx !== -1 ? args[keywordIdx + 1] : null;

const pageIdx = args.indexOf("--page");
const page = pageIdx !== -1 ? parseInt(args[pageIdx + 1]) : 1;

const downloadIdx = args.indexOf("--download-dir");
const downloadDir = downloadIdx !== -1 ? args[downloadIdx + 1] : null;

async function downloadImages(imageUrls, title, baseDir) {
  const safeName = title.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 30);
  const dir = join(baseDir, safeName);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = ".jpg";
      const path = join(dir, `page_${String(i + 1).padStart(3, "0")}${ext}`);
      writeFileSync(path, buf);
      process.stderr.write(`  已下载 ${i + 1}/${imageUrls.length}: ${path}\n`);
    } catch (e) {
      process.stderr.write(`  下载失败 ${i + 1}/${imageUrls.length}: ${e.message}\n`);
    }
  }
  return dir;
}

async function run() {
  try {
    loadState();

    let targetUrl = LIST_URL;
    if (page > 1) {
      targetUrl += `&page=${page}`;
    }
    open(targetUrl);
    waitLoad();

    const pageUrl = getUrl();
    if (pageUrl.includes(AUTH_DOMAIN)) {
      console.error("未登录，请先运行 login.mjs");
      return 1;
    }

    wait(2000);

    const itemsRaw = evalJS(`JSON.stringify(Array.from(document.querySelectorAll('a[href*="wbnewsid"]')).map(a => ({text: a.innerText?.trim(), href: a.href})).filter(item => item.text && item.text.length > 0))`);
    let items = [];
    try {
      let parsed = itemsRaw;
      while (typeof parsed === 'string' && parsed.startsWith('"') && parsed.endsWith('"')) {
        try { parsed = JSON.parse(parsed); } catch { break; }
      }
      items = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch {}

    if (items.length === 0) {
      console.log("未找到校内文件条目");
      return 1;
    }

    let matches = items;
    if (keyword) {
      matches = items.filter(item => item.text.includes(keyword));
    }

    // --list-only: just list matching items
    if (isListOnly) {
      if (isJson) {
        console.log(JSON.stringify({ keyword: keyword || "all", page, total: matches.length, items: matches }, null, 2));
      } else {
        console.log(`校内文件${keyword ? ` - 搜索"${keyword}"` : ""}（第 ${page} 页，共 ${matches.length} 条）\n`);
        matches.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.text}`);
        });
      }
      return matches.length > 0 ? 0 : 1;
    }

    // keyword search + detail extraction
    if (!keyword) {
      console.error("error: --keyword is required (or use --list-only)");
      return 2;
    }

    if (matches.length === 0) {
      if (isJson) {
        console.log(JSON.stringify({ error: "not_found", keyword, suggestions: items.map(i => i.text) }));
      } else {
        console.log(`未找到包含"${keyword}"的校内文件`);
        console.log(`\n当前页面的列表（可能相关）：`);
        items.forEach((item, i) => console.log(`  ${i + 1}. ${item.text}`));
      }
      return 1;
    }

    // Navigate to first matching item detail page
    const firstMatch = matches[0];
    if (!isJson) process.stderr.write(`找到匹配："${firstMatch.text}"\n`);
    open(firstMatch.href);
    waitLoad();
    wait(2000);

    // Extract detail content
    const detailRaw = evalJS(`JSON.stringify((function(){
      const title = document.querySelector("h1")?.innerText?.trim() || "";
      const vc = document.querySelector(".v_news_content");
      const imgs = vc ? Array.from(vc.querySelectorAll("img")).filter(img => img.className.includes("img_vsb_content")).map(img => img.src) : [];
      const textContent = vc ? vc.innerText?.trim() || "" : "";
      const meta = {};
      const bodyText = document.body.innerText || "";
      const deptMatch = bodyText.match(/发布部门[：:]\\s*([^\\n]+)/);
      const dateMatch = bodyText.match(/发布时间[：:]\\s*([^\\n]+)/);
      if (deptMatch) meta.department = deptMatch[1].trim();
      if (dateMatch) meta.date = dateMatch[1].trim();
      
      // Check for PDF attachments
      const attachMatch = bodyText.match(/公告附件如下[：:]\\s*[\\s\\S]*?([^\\s]+\\.pdf)/);
      if (attachMatch) meta.attachment = attachMatch[1].trim();
      
      if (imgs.length > 0 && !textContent) {
        return JSON.stringify({ title, contentType: "images", content: textContent, imageUrls: imgs, meta });
      }
      return JSON.stringify({ title, contentType: "text", content: textContent, meta });
    })())`);

    let detailData;
    try {
      let parsed = detailRaw;
      // Handle double JSON encoding from evalJS
      while (typeof parsed === 'string' && parsed.startsWith('"') && parsed.endsWith('"')) {
        try { parsed = JSON.parse(parsed); } catch { break; }
      }
      detailData = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch (e) {
      console.error(`解析详情数据失败: ${e.message}`);
      return 1;
    }

    // Handle image download
    if (detailData.contentType === "images" && downloadDir && detailData.imageUrls?.length > 0) {
      await downloadImages(detailData.imageUrls, detailData.title || keyword, downloadDir);
      detailData.downloadedTo = join(downloadDir, detailData.title?.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 30) || keyword);
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
