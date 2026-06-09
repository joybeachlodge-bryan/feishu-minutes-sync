# 飞书妙记同步（Obsidian 插件）

定时轮询飞书妙记，自动把新妙记同步成 Obsidian 笔记。同步内容包括：

- 总结、待办、智能章节、关键决策、其他决策、金句时刻、相关链接
- 图文、图表（画板）——图片和画板下载为本地附件，画板自动裁掉白边
- AI 总结、逐字稿

每个模块都可在设置里单独开关。

---

## 一、前置依赖（必须先装好）

本插件不直接调飞书 API，而是通过本地的 `lark-cli` 工具。每台要用的电脑都需要：

1. 安装 `lark-cli`（飞书官方 CLI）。
2. 运行 `lark-cli auth login`，用**自己的飞书账号**完成授权。
3. 授权需包含妙记、视频会议纪要、云文档、媒体下载相关权限。

> 没装 lark-cli 或没授权，插件会提示不可用。插件设置里有「检查 cli 状态」按钮可自检。

环境要求：Node 22；桌面版 Obsidian（`isDesktopOnly`，不支持移动端）。

---

## 二、安装（用 BRAT 自动更新，推荐）

1. 在 Obsidian 社区插件里安装并启用 **BRAT**（Obsidian42 - BRAT）。
2. 命令面板（Cmd/Ctrl+P）→ 运行 **「BRAT: Add a beta plugin for testing」**。
3. 输入本仓库地址：`<你的GitHub用户名>/feishu-minutes-sync`
4. BRAT 会自动下载最新版并安装；到「设置 → 第三方插件」里启用「飞书妙记同步」。
5. 之后维护者每发一个新版本，BRAT 会**自动检查并更新**（BRAT 默认启动时检查，也可手动「Check for updates」）。

手动安装（不用 BRAT）：把 `main.js`、`manifest.json`、`styles.css` 放到
`<vault>/.obsidian/plugins/feishu-minutes-sync/`，重启 Obsidian 后启用。

---

## 三、使用

- 启用后会按设定间隔（默认 30 分钟）自动同步，也可点左侧 ribbon 的「同步飞书妙记」图标或命令「立即同步飞书妙记」手动触发。
- 设置 → 内容模块：可单独开关每个模块、是否下载图片/画板、是否裁白边。
- 旧笔记升级：命令「补全当前妙记图文/待办/决策/金句」可把当前打开的旧笔记升级到最新格式。

---

## 四、维护者：怎么发新版本（让大家自动更新）

1. 改完 `main.js`，同步更新 `manifest.json` 的 `version` 和 `versions.json`（加一行 `"新版本号": "最低Obsidian版本"`）。
2. 提交并推送：
   ```bash
   git add -A && git commit -m "release: x.y.z" && git push
   ```
3. 创建 GitHub Release，**tag 名必须等于 manifest 里的 version**（如 `0.4.0`，不带 v 前缀），并把
   `main.js`、`manifest.json`、`styles.css` 作为 release 附件上传。
   - 网页：仓库 → Releases → Draft a new release → 填 tag → 拖入三个文件 → Publish。
   - 或用 GitHub CLI：
     ```bash
     gh release create 0.4.0 main.js manifest.json styles.css -t "0.4.0" -n "见开发日志"
     ```
4. 同事端 BRAT 会自动检测到新 release 并更新。

> 技术细节、版本变更记录、踩坑约定见 `开发日志.md`。
