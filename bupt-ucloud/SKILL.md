---
name: bupt-campus
description: 北邮校园网自动化操作，通过 CDP 控制本地 Chrome 执行统一身份认证登录及后续校园系统操作。触发场景：用户提到访问北邮校园网、教学云平台、查成绩、查课表、图书馆预约等校园系统任务时。
---

# 北邮校园网自动化

## 前置条件

必须先加载并按照 web-access skill 启动 CDP Proxy（`localhost:3456`）。

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

**测试前清理会话**：

```bash
# 注销 CAS 会话（用于测试）
curl -s "http://localhost:3456/new?url=https%3A%2F%2Fauth.bupt.edu.cn%2Fauthserver%2Flogout" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['targetId'])" \
  | xargs -I{} sh -c 'sleep 3 && curl -s "http://localhost:3456/close?target={}"'
```

## 关键技术说明

| 问题 | 解决方案 |
|------|---------|
| 登录表单在 `<iframe id="loginIframe">` 内 | 通过 `iframe.contentDocument` 穿透 |
| iframe 内事件触发 | 必须用 `iframe.contentWindow` 的 Event 和 HTMLInputElement 原型，不能用外层 window |
| iframe readyState 停在 "loading" | 改为检测目标元素（`a[i18n="login.type.password"]`）是否出现 |
| tab 刚创建时 URL 为 about:blank | 等待 URL 不为 about:blank 后再判断是否已登录 |
| SPA 页面 `ready:complete` 后 eval 仍报 "Uncaught" | SPA 渲染异步，eval 内必须加 try/catch，ready-check 的 eval 异常视为未就绪继续重试 |
| ready-check 通过后立即提取报 400 | SPA 数据绑定需额外时间，ready 后 sleep(1000) 再提取 |
| el-table 标题列显示为空 | 标题在固定列（fixed column）的 tr 中，识别方式：第一个 td 不含 `is-hidden` 类；主 body 的 tr 第一个 td 含 `is-hidden`（占位空） |
| course.html 切换课程不重读 localStorage | course.html SPA 只在初次加载时读 localStorage.site；切换课程必须从 index.html 点击课程卡片触发完整导航 |

## 稳定选择器（基于 i18n 属性，比 class/id 更耐版本升级）

| 目标 | 选择器 |
|------|--------|
| 密码登录 tab | `a[i18n="login.type.password"]` |
| 学工号输入框 | `#username` |
| 密码输入框 | `#password` |
| 登录按钮 | `input[i18n="login.form.btn.login"]` |
| 错误信息 | `#errorMessage` |

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

### 课件相关脚本说明

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

### 课件技术说明

| 问题 | 解决方案 |
|------|---------|
| 获取下载URL需模拟用户点击 | 拦截 `window.open`（平台下载时通过 `window.open` 打开 CDN URL） |
| 点击下载按钮到 `window.open` 是异步的（先 XHR 再 open） | 点击后 sleep(4000) 再读取拦截到的 URL |
| 课件URL无需登录态 | `fileucloud.bupt.edu.cn` CDN URL 公开可访问，curl 直接下载 |
| carousel 翻页找课程 | 逐页翻页找到目标课程所在 active 页再点击，保证 localStorage.site 写入完整 |

### 作业相关脚本说明

**两步查询作业（推荐流程）：**

```bash
# 第一步：快速查看待办详情（只读首页待办区域，很快）
node list-pending-tasks.mjs

# 第二步：需要知道作业属于哪门课时，遍历所有课（较慢，约60秒）
node list-assignment-courses.mjs --pending-only
node list-assignment-courses.mjs --title "Unit03"  # 按标题关键词过滤
```

**作业 el-table 技术说明**：标题在 `.el-table__fixed` 固定列中，且固定列里有两套 tr（一套带 `is-hidden` class 是占位空行），需过滤掉 `is-hidden` 的 td 才能正确读取标题。

### 提交作业说明

```bash
node submit-assignment.mjs "U03-Section2" ./2023211442-赵康毅.zip
node submit-assignment.mjs "Lab01" ./report.zip --comment "详见附件"
```

**安全机制**：脚本上传附件后会**暂停**，在终端展示预览摘要并等待用户输入 `y` 确认，再点击"提交作业"按钮。输入 `n` 则取消并保留浏览器 tab，用户可手动继续或检查。

| 技术细节 | 说明 |
|---------|------|
| 文件上传方式 | `/setFiles` 直接注入 `input.el-upload__input`，无需弹出文件选择框 |
| 上传时机 | 文件选入后**不自动上传**，点"提交作业"按钮时一并提交到服务器 |
| 白屏处理 | 从 `index.html` 跳转到 `course.html` 偶发白屏，脚本检测到时自动 navigate 重载 |
