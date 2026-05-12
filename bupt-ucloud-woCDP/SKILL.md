---
name: bupt-campus-woCDP
description: 北邮校园网自动化操作，通过 AgentBrowser（Playwright）控制无头浏览器执行统一身份认证登录及后续校园系统操作。无需 CDP、无需手动启动 Chrome。触发场景：用户提到访问北邮校园网、教学云平台、查成绩、查课表、图书馆预约等校园系统任务时。
---

# 北邮校园网自动化（AgentBrowser 方案）

无需 CDP、无需手动启动 Chrome，自动管理浏览器生命周期。

## 前置条件

首次使用需安装依赖：

```bash
cd "${SKILL_DIR}"
npm install
```

这会自动安装 `agent-browser` 及其 Chromium 浏览器。

## 操作模块

### 登录（统一身份认证 CAS）

**脚本**：`scripts/login.mjs`

```bash
node "${SKILL_DIR}/scripts/login.mjs" <学工号> <密码> [目标服务URL]
```

- 成功：exit 0，stdout 输出落地 URL（含 CAS ticket）
- 失败：exit 1，stderr 输出错误原因（如「用户名或密码错误」）
- 异常：exit 2，stderr 输出技术原因

**默认目标服务**：`https://ucloud.bupt.edu.cn`（教学云平台）

**访问其他服务示例**：

```bash
node "${SKILL_DIR}/scripts/login.mjs" 2023211442 "密码" "https://jwxt.bupt.edu.cn"
```

**已登录态处理**：若浏览器已有有效 CAS 会话，脚本检测到直接跳转后立即返回，不重复登录。

## 已实现模块

| 脚本 | 功能 | 用法 |
|------|------|------|
| `scripts/login.mjs` | CAS 统一身份认证密码登录 | `node login.mjs <学工号> <密码> [服务URL]` |
| `scripts/list-courses.mjs` | 获取本学期所有课程 | `node list-courses.mjs [--json]` |
| `scripts/list-pending-tasks.mjs` | 查看首页待办中所有作业的完整详情 | `node list-pending-tasks.mjs [--json]` |
| `scripts/list-assignment-courses.mjs` | 遍历每门课找作业所属课程 | `node list-assignment-courses.mjs [--pending-only] [--title <关键词>] [--json]` |
| `scripts/list-course-files.mjs` | 列出指定课程所有课件文件（含章节/子块层级） | `node list-course-files.mjs <课程名关键词> [--json]` |
| `scripts/download-course-file.mjs` | 下载指定课件文件到本地 | `node download-course-file.mjs <课程名> <文件名关键词> [保存目录]` |
| `scripts/submit-assignment.mjs` | 提交作业（附件上传 + 用户确认后提交） | `node submit-assignment.mjs <作业标题关键词> <文件路径> [--comment <备注>]` |

## 关键技术说明

| 问题 | 解决方案 |
|------|---------|
| 登录表单在 `<iframe id="loginIframe">` 内 | 使用 `agent-browser frame "#loginIframe"` 切换 |
| SPA 页面数据渲染延迟 | 等待后使用 `eval` 提取数据 |
| el-table 标题列显示为空 | 标题在固定列（fixed column）的 tr 中，识别方式：第一个 td 不含 `is-hidden` 类 |
| course.html 切换课程不重读 localStorage | course.html SPA 只在初次加载时读 localStorage.site；切换课程必须从 index.html 点击课程卡片触发完整导航 |
| 获取下载URL需模拟用户点击 | 拦截 `window.open`（平台下载时通过 `window.open` 打开 CDN URL） |
| 课件URL无需登录态 | `fileucloud.bupt.edu.cn` CDN URL 公开可访问，curl 直接下载 |

## 课件相关脚本说明

**列出课件**：

```bash
node list-course-files.mjs 通信软件设计
# 输出：按章节分组的文件树，✓ 表示下载URL已获取
```

**下载课件**（用文件名关键词匹配，精确到能唯一确定一个文件）：

```bash
node download-course-file.mjs 通信软件设计 Unit01-Course ~/Downloads
# stdout 输出保存路径，文件不需要登录态即可直接下载
```

## 作业相关脚本说明

**两步查询作业（推荐流程）：**

```bash
# 第一步：快速查看待办详情（只读首页待办区域，很快）
node list-pending-tasks.mjs

# 第二步：需要知道作业属于哪门课时，遍历所有课（较慢，约60秒）
node list-assignment-courses.mjs --pending-only
node list-assignment-courses.mjs --title "Unit03"  # 按标题关键词过滤
```

## 提交作业说明

```bash
node submit-assignment.mjs "U03-Section2" ./2023211442-赵康毅.zip
node submit-assignment.mjs "Lab01" ./report.zip --comment "详见附件"
```

**安全机制**：脚本上传附件后会**暂停**，在终端展示预览摘要并等待用户输入 `y` 确认，再点击"提交作业"按钮。输入 `n` 则取消并保留浏览器 tab，用户可手动继续或检查。

## 与 CDP 方案对比

| 特性 | CDP (bupt-ucloud) | AgentBrowser (bupt-ucloud-woCDP) |
|------|-------------------|----------------------------------|
| 浏览器 | 需手动启动 Chrome + 远程调试 | 自动管理，无需配置 |
| 登录态 | 复用 Chrome 已有会话 | 每次独立会话 |
| 安装 | 需 CDP Proxy | npm install 即可 |
| 适用场景 | 需要复用已有登录态 | 无头自动化、CI/CD |
