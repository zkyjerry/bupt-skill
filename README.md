# bupt-skill

北邮（BUPT）系列校园网站自动化 SKILL。

## 背景

北邮的校园网站多而分散——教学平台、教务系统、信息门户……每个系统独立登录，界面逻辑各异，功能藏得深，用起来费劲。

这个项目的目标是用 **Cursor Agent Skill + CDP 浏览器自动化**，把这些平台的常用操作封装成可直接调用的脚本，让同学们可以通过SKILL的方式能更方便地完成日常任务：查课、看作业、下课件、提交作业……不用再一个个页面去找。

后续计划陆续覆盖：
- **教务管理系统**（jwxt.bupt.edu.cn）：查成绩、选课、查课表
- **信息门户**（my.bupt.edu.cn）：一站式信息查看
- **图书馆系统**：座位预约、书目查询
- 以及其他常用校园平台

> 所有脚本均通过 CDP 直连用户本地 Chrome，天然携带登录态，无需另行配置 Cookie 或 Token。

---

## 项目结构

```
bupt-skill/
├── README.md          # 本文件
└── bupt-ucloud/       # 云邮教学平台（ucloud.bupt.edu.cn）
    ├── SKILL.md       # Cursor Skill 定义文件
    └── scripts/       # 可直接运行的 Node.js 脚本
```

---

## bupt-ucloud — 云邮教学平台

针对 [ucloud.bupt.edu.cn](https://ucloud.bupt.edu.cn) 的自动化脚本，覆盖以下功能：

| 脚本 | 功能 |
|------|------|
| `login.mjs` | CAS 统一身份认证密码登录 |
| `list-courses.mjs` | 查看本学期所有课程 |
| `list-pending-tasks.mjs` | 快速查看首页"待办"中的作业详情（名称、内容、截止时间、章节、分数等） |
| `list-assignment-courses.mjs` | 遍历所有课程，找到每个作业所属的课程 |
| `list-course-files.mjs` | 列出指定课程的全部课件（按章节/子块层级展示） |
| `download-course-file.mjs` | 下载指定课件到本地 |
| `submit-assignment.mjs` | 上传附件并提交作业（提交前有终端确认步骤） |

详细用法见 [`bupt-ucloud/SKILL.md`](bupt-ucloud/SKILL.md)。

### 快速上手

**前置条件**：Node.js 22+、Chrome 已开启远程调试、CDP Proxy 运行在 `localhost:3456`。

```bash
# 登录
node bupt-ucloud/scripts/login.mjs 学工号 密码

# 查看待办作业
node bupt-ucloud/scripts/list-pending-tasks.mjs

# 下载课件
node bupt-ucloud/scripts/list-course-files.mjs 通信软件设计
node bupt-ucloud/scripts/download-course-file.mjs 通信软件设计 Unit01-Course ~/Downloads

# 提交作业
node bupt-ucloud/scripts/submit-assignment.mjs "U03-Section2" ./2023211442-赵康毅.zip
```

---

## 前置环境配置

### 1. Node.js 22+

```bash
node --version  # 需要 v22 或以上
```

### 2. Chrome 开启远程调试

在地址栏打开 `chrome://inspect/#remote-debugging`，勾选 **Allow remote debugging for this browser instance**。

### 3. CDP Proxy

本项目依赖 CDP Proxy 在 `localhost:3456` 提供 HTTP API（由 [web-access skill](https://github.com/cursor-ide/web-access) 提供）。

---

## 注意事项

- 脚本操作对应当前登录用户的账号，请勿用于采集他人数据。
- 密码通过命令行参数传入，注意 shell 历史记录。
- 平台界面更新可能导致选择器失效，欢迎提 Issue 或 PR。

---

## License

MIT
