---
name: bupt-my-woCDP
description: 北邮信息门户自动化，通过 AgentBrowser 检索校内新闻、校内通知、校内文件、办事指南、规章制度。触发场景：用户提到查信息门户、查规章制度、查校内通知、查校内新闻、查办事指南、查校内文件等。
---

# 北邮信息门户自动化（AgentBrowser 方案）

针对 [http://my.bupt.edu.cn](http://my.bupt.edu.cn) 的自动化检索脚本，覆盖以下功能：

## 前置条件

首次使用需安装依赖：

```bash
cd "${SKILL_DIR}"
npm install
```

## 操作模块

### 登录

**脚本**：`scripts/login.mjs`

```bash
node "${SKILL_DIR}/scripts/login.mjs" <学工号> <密码>
```

- 成功：exit 0，stdout 输出目标页面 URL
- 失败：exit 1，stderr 输出错误原因
- 异常：exit 2

### 已实现模块

| 脚本 | 功能 | 用法 |
|------|------|------|
| `scripts/login.mjs` | CAS 统一身份认证登录 | `node login.mjs <学工号> <密码>` |
| `scripts/search-regulations.mjs` | 检索规章制度 | `node search-regulations.mjs --keyword <关键词> [--list-only] [--json] [--download-dir DIR]` |
| `scripts/search-news.mjs` | 检索校内新闻 | `node search-news.mjs --keyword <关键词> [--list-only] [--json]` |
| `scripts/search-notices.mjs` | 检索校内通知 | `node search-notices.mjs --keyword <关键词> [--list-only] [--json]` |
| `scripts/search-files.mjs` | 检索校内文件 | `node search-files.mjs --keyword <关键词> [--list-only] [--json]` |
| `scripts/search-guides.mjs` | 检索办事指南 | `node search-guides.mjs --keyword <关键词> [--list-only] [--json]` |
| `scripts/reset-browser.mjs` | 关闭 agent-browser 实例 | `node reset-browser.mjs` |

## 推荐执行顺序

```bash
node scripts/login.mjs <学工号> <密码>   # 单独执行
node scripts/search-regulations.mjs --keyword "采购" --json
```

从云平台 skill 切换过来时，先 `node scripts/reset-browser.mjs`。

## 故障排查

| 现象 | 处理 |
|------|------|
| login 后 search 报未登录 | 重跑 `login.mjs`（勿链式 `&&`） |
| daemon 连接失败 | `node scripts/reset-browser.mjs` |
| 办事指南站内搜索 0 条 | 脚本会自动回退到列表页客户端过滤 |
| 正文为图片 | stderr 会提示，用 `--download-dir` 下载 |

## 使用示例

```bash
# 登录
node scripts/login.mjs 学工号 密码

# 列出所有规章制度
node scripts/search-regulations.mjs --list-only

# 搜索包含"采购"的规章制度
node scripts/search-regulations.mjs --keyword "采购"

# 查看匹配条目的详细信息
node scripts/search-regulations.mjs --keyword "采购" --json

# 下载图片类制度的图片
node scripts/search-regulations.mjs --keyword "学生管理规定" --download-dir ~/Downloads

# 搜索校内通知
node scripts/search-notices.mjs --keyword "考试"

# 搜索校内新闻
node scripts/search-news.mjs --keyword "学术" --list-only
```

## 智能检索示例

当用户说"我想知道关于报销的相关制度"时，模型应：

1. 先运行 `scripts/search-regulations.mjs --keyword "报销" --json`
2. 如果找到匹配，输出标题和内容（文本类）或图片 URL（图片类）
3. 如果图片类，提示用户"该制度为图片形式，可使用 --download-dir 下载"
4. 如果未找到匹配，输出当前页面的相关制度列表

## 关键技术说明

| 问题 | 解决方案 |
|------|---------|
| my.bupt.edu.cn 仅支持 HTTP | 启动 Chrome 时添加 `--unsafely-treat-insecure-origin-as-secure=http://my.bupt.edu.cn` |
| 登录表单在 `<iframe id="loginIframe">` 内 | 使用 `frame "#loginIframe"` 切换 |
| 内容以图片形式展示 | 检测 `.v_news_content` 中的 `img_vsb_content` 类图片，提取 URL 并支持下载 |
| 内容以文本形式展示 | 直接提取 `.v_news_content` 的 `innerText` |
| evalJS 返回双重 JSON 编码 | `parseEvalJson` / 循环 `JSON.parse` |
| 办事指南站内搜索无结果 | 自动回退列表页按关键词过滤 |
| 详情 URL 参数丢失 | `open()` 自动去除 evalJS 多余的 JSON 引号 |
| 翻页机制 | 列表页底部有页码输入框和"跳转"按钮 |

## 退出码

所有脚本：`0` = 找到匹配，`1` = 未找到，`2` = 参数/环境错误
