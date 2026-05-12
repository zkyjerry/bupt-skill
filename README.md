# bupt-skill

北邮（BUPT）系列校园网站自动化 SKILL。

## 背景

北邮的校园网站多而分散——教学平台、教务系统、信息门户……每个系统独立登录，界面逻辑各异，功能藏得深，用起来费劲。

这个项目的目标是用 **浏览器自动化**，把这些平台的常用操作封装成可直接调用的脚本，让同学们可以通过 SKILL 的方式能更方便地完成日常任务：查课、看作业、下课件、提交作业……不用再一个个页面去找。

后续计划陆续覆盖：
- **教务管理系统**（jwxt.bupt.edu.cn）：查成绩、选课、查课表
- **信息门户**（my.bupt.edu.cn）：一站式信息查看
- **图书馆系统**：座位预约、书目查询
- 以及其他常用校园平台

---

## 项目结构

```
bupt-skill/
├── README.md              # 本文件
├── bupt-ucloud/           # 云邮教学平台 - CDP 方案
│   ├── SKILL.md           # Cursor Skill 定义文件
│   └── scripts/           # Node.js 脚本（依赖 CDP Proxy）
└── bupt-ucloud-woCDP/     # 云邮教学平台 - AgentBrowser 方案（无需 CDP）
    ├── SKILL.md           # Cursor Skill 定义文件
    ├── package.json       # 自包含依赖
    └── scripts/           # Node.js 脚本（自动管理浏览器）
```

---

## 两种方案对比

| 特性 | CDP 方案 (`bupt-ucloud/`) | AgentBrowser 方案 (`bupt-ucloud-woCDP/`) |
|------|---------------------------|------------------------------------------|
| 浏览器 | 需手动启动 Chrome + 远程调试 | 自动管理，无需配置 |
| 登录态 | 复用 Chrome 已有会话 | 独立会话（需每次登录） |
| 安装 | 需 CDP Proxy | `npm install` 即可 |
| 适用场景 | 日常使用，复用已有登录态 | 无头自动化、CI/CD、不想开 Chrome |

**推荐**：日常使用选 CDP 方案，自动化场景选 AgentBrowser 方案。

---

## bupt-ucloud — CDP 方案

针对 [ucloud.bupt.edu.cn](https://ucloud.bupt.edu.cn) 的自动化脚本。

**前置条件**：Node.js 22+、Chrome 已开启远程调试、CDP Proxy 运行在 `localhost:3456`。

| 脚本 | 功能 |
|------|------|
| `login.mjs` | CAS 统一身份认证密码登录 |
| `list-courses.mjs` | 查看本学期所有课程 |
| `list-pending-tasks.mjs` | 快速查看首页"待办"中的作业详情 |
| `list-assignment-courses.mjs` | 遍历所有课程，找到每个作业所属的课程 |
| `list-course-files.mjs` | 列出指定课程的全部课件 |
| `download-course-file.mjs` | 下载指定课件到本地 |
| `submit-assignment.mjs` | 上传附件并提交作业（提交前有终端确认步骤） |

详细用法见 [`bupt-ucloud/SKILL.md`](bupt-ucloud/SKILL.md)。

---

## bupt-ucloud-woCDP — AgentBrowser 方案

无需 CDP、无需手动启动 Chrome，`npm install` 后即可使用。

**前置条件**：Node.js 18+

```bash
cd bupt-ucloud-woCDP
npm install    # 首次安装依赖（含 Chromium 浏览器）
```

| 脚本 | 功能 |
|------|------|
| `scripts/login.mjs` | CAS 统一身份认证密码登录 |
| `scripts/list-courses.mjs` | 查看本学期所有课程 |
| `scripts/list-pending-tasks.mjs` | 快速查看首页"待办"中的作业详情 |
| `scripts/list-assignment-courses.mjs` | 遍历所有课程，找到每个作业所属的课程 |
| `scripts/list-course-files.mjs` | 列出指定课程的全部课件 |
| `scripts/download-course-file.mjs` | 下载指定课件到本地 |
| `scripts/submit-assignment.mjs` | 上传附件并提交作业（提交前有终端确认步骤） |

详细用法见 [`bupt-ucloud-woCDP/SKILL.md`](bupt-ucloud-woCDP/SKILL.md)。

---

## 快速上手（AgentBrowser 方案）

```bash
# 安装依赖
cd bupt-ucloud-woCDP && npm install

# 登录
node scripts/login.mjs 学工号 密码

# 查看课程
node scripts/list-courses.mjs

# 下载课件
node scripts/list-course-files.mjs 通信软件设计
node scripts/download-course-file.mjs 通信软件设计 Unit01-Course ~/Downloads

# 提交作业
node scripts/submit-assignment.mjs "U03-Section2" ./2023211442-赵康毅.zip
```

---

## 注意事项

- 脚本操作对应当前登录用户的账号，请勿用于采集他人数据。
- 密码通过命令行参数传入，注意 shell 历史记录。
- 平台界面更新可能导致选择器失效，欢迎提 Issue 或 PR。

---

## License

MIT
