# 飞书妙记同步（Obsidian 插件）

定时轮询飞书妙记，自动把新妙记同步成 Obsidian 笔记。同步内容包括：

- 总结、待办、智能章节、关键决策、其他决策、金句时刻、相关链接
- 图文、图表（画板）——图片和画板下载为本地附件，画板自动裁掉白边
- AI 总结、逐字稿

每个模块都可在设置里单独开关。

---

## 一、前置依赖

本插件不直接调飞书 API，而是通过本地的 `lark-cli`。每台电脑都需要装 lark-cli 并用**自己的飞书账号**授权，且授权必须包含以下权限（**缺一不可**，否则图文/画板/智能纪要拉取不完整）：

```
minutes:minutes:readonly
minutes:minutes.search:read
minutes:minutes.transcript:export
minutes:minutes.artifacts:read
vc:note:read
docx:document:readonly
docs:document.media:download
```

环境要求：Node 22；桌面版 Obsidian（`isDesktopOnly`，不支持移动端）。插件设置里有「检查 cli 状态」按钮可自检权限是否齐全。

---

## 二、最省事的安装方式：把这段提示词发给你的 AI

复制整段发给你的 AI（Claude Code / OpenClaw 等带 lark-cli 的环境），它会帮你装 lark-cli、发起飞书授权（给你授权链接）、并指导你装插件：

```
帮我安装配置"飞书妙记同步"Obsidian 插件，一步到位：

1) 装 lark-cli（已装就跳过）：npm i -g @larksuite/cli

2) 飞书授权（务必带上图文/画板权限，否则智能纪要拉不全）。运行：
   lark-cli auth login --no-wait --json --scope "minutes:minutes:readonly minutes:minutes.search:read minutes:minutes.transcript:export minutes:minutes.artifacts:read vc:note:read docx:document:readonly docs:document.media:download"
   把返回 JSON 里的授权链接(verification_uri)和用户码(user_code)发给我，我用自己的飞书账号在浏览器打开链接、输入码授权。
   我回复"好了"之后，你用返回的 device_code 完成登录：
   lark-cli auth login --device-code <上一步返回的 device_code>
   最后跑 lark-cli auth status，确认这 7 个权限都在（尤其 docx:document:readonly 和 docs:document.media:download）。

3) 然后告诉我在 Obsidian 里怎么装插件：
   - 社区插件里安装并启用 BRAT
   - 命令面板 →「BRAT: Add a beta plugin」→ 填 joybeachlodge-bryan/feishu-minutes-sync → 勾 Enable after installing → Add plugin
   - 在"飞书妙记同步"插件设置里点"检查 cli 状态"，确认权限齐全
```

---

## 三、手动安装（不借助 AI）

1. 装 lark-cli：`npm i -g @larksuite/cli`
2. 授权（带全权限）：
   ```bash
   lark-cli auth login --scope "minutes:minutes:readonly minutes:minutes.search:read minutes:minutes.transcript:export minutes:minutes.artifacts:read vc:note:read docx:document:readonly docs:document.media:download"
   ```
   按提示在浏览器用自己的飞书账号授权，完成后 `lark-cli auth status` 自检。
3. Obsidian 社区插件装并启用 **BRAT** → 命令面板「BRAT: Add a beta plugin」→ 填 `joybeachlodge-bryan/feishu-minutes-sync` → 勾 Enable → Add plugin。
4. 插件设置点「检查 cli 状态」确认就绪。

> 之后维护者每发一个新版本，BRAT 会**自动检查并更新**。
> 纯手动（不用 BRAT）：把 `main.js`、`manifest.json`、`styles.css` 放到 `<vault>/.obsidian/plugins/feishu-minutes-sync/` 后重启 Obsidian。

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
