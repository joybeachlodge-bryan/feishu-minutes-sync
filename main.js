const { Plugin, PluginSettingTab, Setting, Notice, TFile, normalizePath } = require("obsidian");
const { execFile, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_VERSION = "0.4.0";
const CLI_CANDIDATES = [
  "/opt/homebrew/opt/node@22/bin/lark-cli",
  "/opt/homebrew/bin/lark-cli",
  "/usr/local/bin/lark-cli",
];
const NODE_22_BIN = "/opt/homebrew/opt/node@22/bin";

const DEFAULT_SETTINGS = {
  cliPath: "",
  syncFolder: "FeishuMinutes",
  attachmentFolder: "FeishuMinutes/assets",
  pollIntervalMinutes: 30,
  autoSync: true,
  lookbackDays: 7,
  includeTranscript: true,
  includeSummary: true,
  includeSmartDoc: true,
  // 智能纪要内各模块独立开关（includeSmartDoc 开启时生效）
  includeSmartSummary: true,
  includeChapters: true,
  includeTodos: true,
  includeDecisions: true,
  includeHighlights: true,
  includeLinks: true,
  includeImages: true,
  includeWhiteboards: true,
  trimImageWhitespace: true,
  includeArtifactBackups: false,
  updateExisting: false,
  backupBeforeEnrich: true,
  debug: true,
  syncedTokens: {},
};

class FeishuMinutesSyncPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.syncing = false;
    this.nodeDir = null;
  }

  async onload() {
    await this.loadSettings();
    if (!this.settings.cliPath || !fs.existsSync(this.settings.cliPath)) {
      this.settings.cliPath = this.detectCli();
      await this.saveSettings();
    }

    this.addRibbonIcon("refresh-cw", "同步飞书妙记", () => this.runSync(true));
    this.addCommand({
      id: "feishu-minutes-sync-now",
      name: "立即同步飞书妙记",
      callback: () => this.runSync(true),
    });
    this.addCommand({
      id: "feishu-minutes-enrich-current",
      name: "补全当前妙记图文/待办/决策/金句",
      callback: () => this.enrichCurrentFile(),
    });
    this.addCommand({
      id: "feishu-minutes-check-cli",
      name: "检查 lark-cli 状态",
      callback: () => this.checkCli(),
    });

    this.addSettingTab(new FeishuMinutesSettingTab(this.app, this));
    this.scheduleAutoSync();
    this.log("插件已加载", { version: PLUGIN_VERSION, cliPath: this.settings.cliPath });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.syncedTokens = this.settings.syncedTokens || {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  log(...args) {
    if (this.settings && this.settings.debug) {
      console.log("[飞书妙记同步]", ...args);
    }
  }

  detectCli() {
    const candidates = [];
    const viaShell = this.whichViaLoginShell("lark-cli");
    if (viaShell) candidates.push(viaShell);
    try {
      const nvmRoot = path.join(os.homedir(), ".nvm/versions/node");
      if (fs.existsSync(nvmRoot)) {
        for (const version of fs.readdirSync(nvmRoot)) {
          candidates.push(path.join(nvmRoot, version, "bin/lark-cli"));
        }
      }
    } catch (_) {}
    candidates.push(
      ...CLI_CANDIDATES,
      path.join(os.homedir(), ".local/bin/lark-cli"),
      path.join(os.homedir(), ".npm-global/bin/lark-cli"),
    );
    for (const candidate of candidates) {
      try {
        if (candidate && fs.existsSync(candidate)) return candidate;
      } catch (_) {}
    }
    return "lark-cli";
  }

  getNodeDir() {
    if (this.nodeDir == null) this.nodeDir = this.detectNodeDir();
    return this.nodeDir;
  }

  detectNodeDir() {
    const viaShell = this.whichViaLoginShell("node");
    if (viaShell) return path.dirname(viaShell);
    try {
      const nvmRoot = path.join(os.homedir(), ".nvm/versions/node");
      if (fs.existsSync(nvmRoot)) {
        for (const version of fs.readdirSync(nvmRoot).sort().reverse()) {
          const nodePath = path.join(nvmRoot, version, "bin/node");
          if (fs.existsSync(nodePath)) return path.dirname(nodePath);
        }
      }
    } catch (_) {}
    for (const nodePath of [
      "/opt/homebrew/opt/node@22/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
    ]) {
      try {
        if (fs.existsSync(nodePath)) return path.dirname(nodePath);
      } catch (_) {}
    }
    return "";
  }

  whichViaLoginShell(command) {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const output = execSync(`${shell} -lic 'command -v ${command}' 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 8000,
      });
      const lines = String(output).split("\n").map((line) => line.trim()).filter(Boolean);
      for (const line of lines.reverse()) {
        if (line.startsWith("/") && fs.existsSync(line)) return line;
      }
    } catch (_) {}
    return "";
  }

  scheduleAutoSync() {
    if (!this.settings.autoSync) return;
    const interval = Math.max(5, this.settings.pollIntervalMinutes) * 60 * 1000;
    this.registerInterval(window.setInterval(() => {
      this.runSync(false).catch((err) => this.log("自动同步出错", err));
    }, interval));
    this.log(`自动同步开启，每 ${this.settings.pollIntervalMinutes} 分钟`);
  }

  runCli(args, cwd) {
    if (this.settings.cliPath && this.settings.cliPath.includes("/") && !fs.existsSync(this.settings.cliPath)) {
      const detected = this.detectCli();
      if (detected) {
        this.settings.cliPath = detected;
        this.saveSettings();
      }
    }

    return new Promise((resolve, reject) => {
      const cliDir = path.dirname(this.settings.cliPath || "");
      const nodeDir = this.getNodeDir();
      const pathParts = [cliDir, nodeDir, "/opt/homebrew/bin", NODE_22_BIN, "/usr/local/bin"].filter(Boolean);
      const env = Object.assign({}, process.env, {
        PATH: `${pathParts.join(":")}:${process.env.PATH || ""}`,
      });
      execFile(this.settings.cliPath, args, {
        env,
        cwd,
        maxBuffer: 80 * 1024 * 1024,
        timeout: 240000,
      }, (err, stdout, stderr) => {
        const combined = `${stdout || ""}\n${stderr || ""}`;
        if (this.settings.debug) {
          console.log("[飞书妙记同步] cli", args.join(" "), "->", combined.slice(0, 1600));
        }
        const json = this.extractJson(combined);
        if (json) {
          resolve(json);
          return;
        }
        if (err) {
          reject(new Error(`lark-cli 执行失败：${err.message}\n${combined.slice(0, 1200)}`));
          return;
        }
        reject(new Error("无法解析 lark-cli 输出（见控制台日志）"));
      });
    });
  }

  extractJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }

  async checkCli() {
    try {
      const status = await this.runCli(["auth", "status"]);
      const user = status && status.identities && status.identities.user;
      if (user && user.status === "ready") {
        const scope = user.scope || "";
        const required = [
          "minutes:minutes:readonly",
          "minutes:minutes.search:read",
          "minutes:minutes.transcript:export",
          "minutes:minutes.artifacts:read",
          "vc:note:read",
          "docx:document:readonly",
          "docs:document.media:download",
        ];
        const missing = required.filter((s) => !scope.includes(s));
        if (missing.length) {
          new Notice(`已登录 ${user.userName || ""}，但缺少权限：\n${missing.join("\n")}\n缺少这些权限会导致图文/画板/智能纪要拉取不完整。`, 15000);
        } else {
          new Notice(`lark-cli 已就绪：${user.userName || ""}，妙记图文同步权限齐全`);
        }
      } else {
        new Notice("lark-cli 未授权，请先完成飞书授权登录");
      }
    } catch (err) {
      new Notice(`lark-cli 不可用：${err.message}`);
    }
  }

  async searchMinutes(startDate, endDate, participantFlag) {
    const result = [];
    let pageToken;
    for (let page = 0; page < 50; page += 1) {
      const args = [
        "minutes", "+search",
        participantFlag || "--owner-ids", "me",
        "--start", startDate,
        "--end", endDate,
        "--format", "json",
        "--page-size", "30",
      ];
      if (pageToken) args.push("--page-token", pageToken);
      const response = await this.runCli(args);
      if (!response || !response.ok) {
        this.log("search 非 ok", response);
        break;
      }
      const data = response.data || {};
      for (const item of data.items || []) {
        if (!item || !item.token) continue;
        result.push({
          token: item.token,
          title: (item.display_info || "").split("\n")[0] || "(无标题妙记)",
          url: item.meta_data && item.meta_data.app_link || "",
          startMs: this.parseStartMs(item),
        });
      }
      if (data.has_more && data.page_token) pageToken = data.page_token;
      else break;
    }
    return result;
  }

  async searchRange(startMs, endMs) {
    const seen = new Set();
    const all = [];
    let cursor = endMs;
    let guard = 0;
    while (cursor >= startMs && guard++ < 120) {
      const chunkStart = Math.max(startMs, cursor - 29 * 86400000);
      const owner = await this.searchMinutes(this.fmtDate(chunkStart), this.fmtDate(cursor), "--owner-ids");
      const participant = await this.searchMinutes(this.fmtDate(chunkStart), this.fmtDate(cursor), "--participant-ids");
      for (const minute of [...owner, ...participant]) {
        if (!seen.has(minute.token)) {
          seen.add(minute.token);
          all.push(minute);
        }
      }
      cursor = chunkStart - 86400000;
    }
    return all;
  }

  async fetchNotes(minuteToken) {
    const tmpDir = path.join(os.tmpdir(), `obsidian-feishu-minutes-${minuteToken}-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    let transcript = "";
    let summary = "";
    let notReady = false;
    let noteDocToken = "";
    let verbatimDocToken = "";
    let artifacts = {};
    let smartDocMarkdown = "";
    let smartDocXml = "";
    let title = "";
    let createTime = "";

    const response = await this.runCli([
      "vc", "+notes",
      "--minute-tokens", minuteToken,
      "--overwrite",
      "--format", "json",
      "--output-dir", ".",
    ], tmpDir);
    const note = response && response.data && response.data.notes && response.data.notes[0];
    if (!note) return { transcript, summary, artifacts, notReady };
    if (note.error) {
      if (String(note.error).includes("not ready")) notReady = true;
      this.log("note error", note.error);
      return { transcript, summary, artifacts, notReady };
    }

    title = note.title || "";
    createTime = note.create_time || "";
    noteDocToken = note.note_doc_token || "";
    verbatimDocToken = note.verbatim_doc_token || "";
    artifacts = note.artifacts || {};
    if (this.settings.includeSummary) summary = this.extractText(artifacts.summary);
    if (this.settings.includeTranscript) {
      if (typeof artifacts.transcript === "string" && artifacts.transcript.trim()) {
        transcript = artifacts.transcript;
      } else if (artifacts.transcript_file) {
        let transcriptFile = artifacts.transcript_file;
        if (!path.isAbsolute(transcriptFile)) transcriptFile = path.resolve(tmpDir, transcriptFile);
        try {
          transcript = fs.readFileSync(transcriptFile, "utf-8");
        } catch (err) {
          this.log("读逐字稿文件失败", transcriptFile, err);
        }
      }
    }

    if (this.settings.includeSmartDoc && noteDocToken) {
      try {
        const markdownResponse = await this.runCli([
          "docs", "+fetch",
          "--api-version", "v2",
          "--doc", noteDocToken,
          "--doc-format", "markdown",
          "--detail", "simple",
          "--format", "json",
        ], tmpDir);
        smartDocMarkdown = markdownResponse && markdownResponse.data && markdownResponse.data.document && markdownResponse.data.document.content || "";
      } catch (err) {
        this.log("读取智能纪要 Markdown 失败", noteDocToken, err);
      }

      if (this.settings.includeImages || this.settings.includeWhiteboards) {
        try {
          const xmlResponse = await this.runCli([
            "docs", "+fetch",
            "--api-version", "v2",
            "--doc", noteDocToken,
            "--doc-format", "xml",
            "--detail", "full",
            "--format", "json",
          ], tmpDir);
          smartDocXml = xmlResponse && xmlResponse.data && xmlResponse.data.document && xmlResponse.data.document.content || "";
        } catch (err) {
          this.log("读取智能纪要 XML 失败", noteDocToken, err);
        }
      }
    }

    if (smartDocMarkdown && (this.settings.includeImages || this.settings.includeWhiteboards)) {
      smartDocMarkdown = await this.localizeSmartDocMedia(smartDocMarkdown, smartDocXml, minuteToken, title || minuteToken, tmpDir);
    }
    if (smartDocMarkdown) smartDocMarkdown = this.normalizeSmartMarkdown(smartDocMarkdown);
    if (smartDocMarkdown) smartDocMarkdown = this.filterSmartSections(smartDocMarkdown);

    return {
      transcript,
      summary,
      artifacts,
      notReady,
      noteDocToken,
      verbatimDocToken,
      smartDocMarkdown,
      title,
      createTime,
    };
  }

  extractText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => this.extractText(item)).filter(Boolean).join("\n");
    if (typeof value === "object") {
      for (const key of ["content", "text", "summary", "md", "value"]) {
        if (typeof value[key] === "string" && value[key].trim()) return value[key];
      }
      try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }
    return String(value);
  }

  async runSync(manual) {
    if (this.syncing) {
      if (manual) new Notice("正在同步中…");
      return;
    }
    this.syncing = true;
    if (manual) new Notice("开始同步飞书妙记…");
    try {
      const end = Date.now();
      const start = end - this.settings.lookbackDays * 86400000;
      const minutes = await this.searchRange(start, end);
      const queue = [];
      for (const minute of minutes) {
        if (!this.settings.syncedTokens[minute.token]) {
          queue.push(minute);
          continue;
        }
        if (this.settings.updateExisting) {
          const existing = await this.findExistingMinuteFile(minute.token);
          if (existing && !(await this.isFileAtCurrentVersion(existing))) queue.push(minute);
        }
      }

      this.log(`搜到 ${minutes.length} 条，待处理 ${queue.length} 条`);
      if (queue.length === 0) {
        if (manual) new Notice("没有新的妙记需要同步");
        return;
      }
      await this.ensureFolder(this.settings.syncFolder);
      if (manual && queue.length > 3) new Notice(`找到 ${queue.length} 条待处理妙记，逐条同步中…`);

      let created = 0;
      let updated = 0;
      let pending = 0;
      for (const minute of queue) {
        try {
          const notes = await this.fetchNotes(minute.token);
          if (notes.notReady) {
            pending += 1;
            continue;
          }
          const result = await this.writeMinuteNote(minute, notes);
          if (result === "created") created += 1;
          if (result === "updated") updated += 1;
          this.settings.syncedTokens[minute.token] = new Date().toISOString();
        } catch (err) {
          this.log("处理妙记失败", minute.token, err);
        }
      }
      await this.saveSettings();
      new Notice(`同步完成：新增 ${created} 条，补全 ${updated} 条${pending ? `，${pending} 条还在生成中（稍后自动重试）` : ""}`);
    } catch (err) {
      this.log("runSync 异常", err);
      new Notice(`同步出错：${err.message || err}`);
    } finally {
      this.syncing = false;
    }
  }

  async enrichCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("请先打开一条 FeishuMinutes 妙记笔记");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    let minuteToken = cache && cache.frontmatter && cache.frontmatter.minute_token;
    if (!minuteToken) {
      const text = await this.app.vault.read(file);
      const match = text.match(/minute_token:\s*(\S+)/) || text.match(/minutes\/([a-z0-9]+)/);
      minuteToken = match && match[1];
    }
    if (!minuteToken) {
      new Notice("当前笔记没有 minute_token，无法补全");
      return;
    }

    new Notice("开始补全当前妙记的图文/待办/决策/金句…");
    try {
      const original = await this.app.vault.read(file);
      if (this.settings.backupBeforeEnrich) {
        const backupPath = await this.uniquePath(`${file.path}.bak-${this.timestamp()}`);
        await this.app.vault.create(backupPath, original);
      }
      const notes = await this.fetchNotes(minuteToken);
      const frontmatter = cache && cache.frontmatter || {};
      const minute = {
        token: minuteToken,
        title: frontmatter.title || notes.title || file.basename.replace(/^\d{4}-\d{2}-\d{2}\s+/, ""),
        url: frontmatter.source || `https://beike.feishu.cn/minutes/${minuteToken}`,
        startMs: frontmatter.date ? new Date(`${frontmatter.date}T00:00:00`).getTime() : Date.now(),
      };
      const content = this.buildMinuteMarkdown(minute, notes);
      await this.app.vault.modify(file, content);
      this.settings.syncedTokens[minuteToken] = new Date().toISOString();
      await this.saveSettings();
      new Notice("当前妙记已补全：图文、待办、关键决策、其他决策、金句时刻已同步");
    } catch (err) {
      this.log("补全当前妙记失败", err);
      new Notice(`补全失败：${err.message || err}`);
    }
  }

  async writeMinuteNote(minute, notes) {
    const existing = await this.findExistingMinuteFile(minute.token);
    const content = this.buildMinuteMarkdown(minute, notes);
    if (existing) {
      if (!this.settings.updateExisting) {
        this.settings.syncedTokens[minute.token] = new Date().toISOString();
        this.log("已存在相同 minute_token 笔记，跳过", existing.path);
        return "skipped";
      }
      await this.app.vault.modify(existing, content);
      this.log("已补全", existing.path);
      return "updated";
    }

    const date = this.fmtDate(minute.startMs || Date.now());
    const title = this.sanitize(minute.title || notes.title || "未命名妙记");
    const folder = normalizePath(this.settings.syncFolder);
    let notePath = normalizePath(`${folder}/${date} ${title}.md`);
    if (this.app.vault.getAbstractFileByPath(notePath)) {
      notePath = normalizePath(`${folder}/${date} ${title} ${minute.token.slice(-6)}.md`);
    }
    await this.ensureFolder(folder);
    await this.app.vault.create(notePath, content);
    this.log("已写入", notePath);
    return "created";
  }

  buildMinuteMarkdown(minute, notes) {
    const date = this.fmtDate(minute.startMs || Date.now());
    const title = (minute.title || notes.title || "未命名妙记").replace(/\n/g, " ");
    const source = minute.url || `https://beike.feishu.cn/minutes/${minute.token}`;
    const lines = [];

    lines.push("---");
    lines.push("type: feishu-minute");
    lines.push(`minute_token: ${minute.token}`);
    if (notes.noteDocToken) lines.push(`note_doc_token: ${notes.noteDocToken}`);
    if (notes.verbatimDocToken) lines.push(`verbatim_doc_token: ${notes.verbatimDocToken}`);
    lines.push(`title: ${this.yamlQuote(title)}`);
    lines.push(`date: ${date}`);
    lines.push(`source: ${source}`);
    lines.push(`sync_version: ${PLUGIN_VERSION}`);
    lines.push(`synced_at: ${new Date().toISOString()}`);
    lines.push("tags: [飞书妙记]");
    lines.push("---", "");

    lines.push(`# ${title}`, "");
    if (source) lines.push(`> 妙记链接：[${source}](${source})`);
    if (notes.noteDocToken) lines.push(`> 智能纪要文档：\`${notes.noteDocToken}\``);
    if (notes.verbatimDocToken) lines.push(`> 逐字稿文档：\`${notes.verbatimDocToken}\``);
    lines.push("");

    if (notes.smartDocMarkdown) {
      lines.push("## 飞书智能纪要原文（含图文/待办/决策/金句）", "");
      lines.push("> 来源：`note_doc_token` 对应的飞书智能纪要 Docx；图片和画板已尽量下载为本地 Obsidian 附件。", "");
      lines.push(notes.smartDocMarkdown, "");
    } else {
      const fallback = this.buildArtifactSections(notes.artifacts, source);
      if (fallback.trim()) lines.push(fallback, "");
    }

    if (this.settings.includeSummary && notes.summary) {
      lines.push("## AI 总结", "", notes.summary, "");
    }
    if (this.settings.includeTranscript && notes.transcript) {
      lines.push("## 逐字稿", "", notes.transcript, "");
    }
    if (!notes.smartDocMarkdown && !notes.summary && !notes.transcript) {
      lines.push("> （暂无逐字稿/总结内容）", "");
    }
    return lines.join("\n");
  }

  buildArtifactSections(artifacts, source) {
    const lines = [];
    const todos = artifacts && artifacts.todos || artifacts && artifacts.minute_todos || [];
    const chapters = artifacts && artifacts.chapters || artifacts && artifacts.minute_chapters || [];
    const keywords = artifacts && artifacts.keywords || [];

    if (todos.length) {
      lines.push("## 飞书待办", "");
      for (const todo of todos) {
        const text = typeof todo === "string" ? todo : todo.content || this.extractText(todo);
        if (text) lines.push(`- [ ] ${text}`);
      }
      lines.push("");
    }
    if (chapters.length) {
      lines.push("## 智能章节", "");
      for (const chapter of chapters) {
        const startMs = Number(chapter.start_ms || 0);
        const time = this.msToTimestamp(startMs);
        const link = source ? `[${time}](${source}?t=${startMs})` : time;
        lines.push(`### ${link} ${chapter.title || "未命名章节"}`, "", chapter.summary_content || chapter.summary || "", "");
      }
    }
    if (keywords.length) {
      lines.push("## 关键词", "", keywords.map((k) => `#${String(k).replace(/\s+/g, "")}`).join(" "), "");
    }
    return lines.join("\n");
  }

  async findExistingMinuteFile(token) {
    const folder = normalizePath(this.settings.syncFolder);
    const abstract = this.app.vault.getAbstractFileByPath(folder);
    if (!abstract || !abstract.children) return null;
    for (const child of abstract.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const cache = this.app.metadataCache.getFileCache(child);
      if (cache && cache.frontmatter && cache.frontmatter.minute_token === token) return child;
      try {
        const text = await this.app.vault.cachedRead(child);
        if (new RegExp(`minute_token:\\s*${this.escapeRegExp(token)}\\b`).test(text)) return child;
      } catch (_) {}
    }
    return null;
  }

  async isFileAtCurrentVersion(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache && cache.frontmatter && cache.frontmatter.sync_version === PLUGIN_VERSION) return true;
    try {
      const text = await this.app.vault.cachedRead(file);
      return text.includes(`sync_version: ${PLUGIN_VERSION}`) && text.includes("飞书智能纪要原文（含图文/待办/决策/金句）");
    } catch (_) {
      return false;
    }
  }

  parseMediaFromXml(xml) {
    const images = [];
    const whiteboards = [];
    if (!xml) return { images, whiteboards };

    // 按文档顺序保留每个 <img>，与 markdown 里的图片一一对应。
    // src 是持久 file_token（可走 media-download）；href 带 authcode，几分钟后过期，不可用。
    const imgRegex = /<img\b[^>]*>/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(xml))) {
      const attrs = this.parseAttrs(imgMatch[0]);
      images.push({
        fileToken: attrs.src || "",
        href: attrs.href || "", // 与 markdown 图片 URL 相同（同次抓取的 authcode 直链），用作强匹配键
        caption: this.cleanCaption(attrs.caption),
        name: attrs.name || "",
        mime: attrs.mime || "image/png",
      });
    }

    const wbRegex = /<whiteboard\b[^>]*>/g;
    let wbMatch;
    while ((wbMatch = wbRegex.exec(xml))) {
      const attrs = this.parseAttrs(wbMatch[0]);
      if (attrs.token) whiteboards.push({ token: attrs.token, caption: this.cleanCaption(attrs.caption) || "智能纪要画板" });
    }
    return { images, whiteboards };
  }

  cleanCaption(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  parseAttrs(tag) {
    const attrs = {};
    const regex = /([\w:-]+)="([^"]*)"/g;
    let match;
    while ((match = regex.exec(tag))) {
      attrs[match[1]] = this.decodeEntities(match[2]);
    }
    return attrs;
  }

  async localizeSmartDocMedia(markdown, xml, minuteToken, title, tmpDir) {
    const { images, whiteboards } = this.parseMediaFromXml(xml);
    let output = markdown;
    await this.ensureFolder(this.settings.attachmentFolder);
    await this.ensureFolder(`${this.settings.attachmentFolder}/${minuteToken}`);

    // ----- 图片：按文档顺序，用 XML 的 src(file_token) 走 media-download，持久不依赖 authcode -----
    if (this.settings.includeImages) {
      // 优先用 href 强匹配（md 图片 URL === XML <img href>，同次抓取一致），下标仅作兜底，
      // 避免极端情况下 md 图片数 != XML <img> 数时按下标错位“串图”。
      const hrefToMeta = new Map();
      for (const im of images) if (im.href) hrefToMeta.set(im.href, im);
      const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const jobs = [];
      let m, i = 0;
      while ((m = mdImgRe.exec(output))) {
        const meta = hrefToMeta.get(m[2]) || images[i] || {};
        jobs.push({ alt: m[1], url: m[2], index: i, fileToken: meta.fileToken, caption: meta.caption });
        i += 1;
      }
      if (i !== images.length) {
        this.log(`警告：markdown 图片数 ${i} 与 XML <img> 数 ${images.length} 不一致，已用 href 强匹配兜底定位`);
      }
      for (const job of jobs) {
        if (!job.fileToken) { this.log("图片缺少 src(file_token)，跳过", job.index); continue; }
        try {
          job.local = await this.downloadDocMedia({
            token: job.fileToken,
            type: "media",
            minuteToken,
            title,
            index: job.index + 1,
            caption: job.caption || `图片 ${job.index + 1}`,
            tmpDir,
          });
        } catch (err) {
          this.log("下载图片失败", job.fileToken, err);
        }
      }
      let k = 0;
      output = output.replace(mdImgRe, (full, alt, url) => {
        const job = jobs[k++];
        if (!job || !job.local) return full;
        const cap = (alt && alt.trim()) || job.caption;
        return `![[${job.local}]]${cap ? `\n> 图：${cap}` : ""}`;
      });
    }

    // ----- 画板：用 token 走 media-download --type whiteboard -----
    if (this.settings.includeWhiteboards) {
      const tokens = [];
      const tagRegex = /<whiteboard\b[^>]*token="([^"]+)"[\s\S]*?<\/whiteboard>/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(markdown))) if (!tokens.includes(tagMatch[1])) tokens.push(tagMatch[1]);
      for (const wb of whiteboards) if (wb.token && !tokens.includes(wb.token)) tokens.push(wb.token);

      const tokenToLocal = new Map();
      let index = 1;
      for (const token of tokens) {
        try {
          tokenToLocal.set(token, await this.downloadDocMedia({
            token,
            type: "whiteboard",
            minuteToken,
            title,
            index,
            caption: "画板",
            tmpDir,
          }));
          index += 1;
        } catch (err) {
          this.log("下载画板失败", token, err);
        }
      }
      output = output.replace(tagRegex, (full, token) => {
        const localPath = tokenToLocal.get(token);
        return localPath ? `![[${localPath}]]\n> 画板` : full;
      });
    }

    return output;
  }

  async downloadDocMedia({ token, type, minuteToken, index, caption, tmpDir }) {
    const baseName = `${String(index).padStart(2, "0")}-${this.sanitize(caption || token).slice(0, 40) || token}`;
    // 注意：docs +media-download 不支持 --format（会报 unknown flag）；默认输出即 JSON，runCli 能解析
    const response = await this.runCli([
      "docs", "+media-download",
      "--token", token,
      "--type", type,
      "--output", baseName,
      "--overwrite",
    ], tmpDir);
    if (!response || !response.ok || !response.data || !response.data.saved_path) {
      throw new Error(`media-download failed: ${JSON.stringify(response).slice(0, 500)}`);
    }
    const savedPath = response.data.saved_path;
    let buffer = fs.readFileSync(savedPath);
    const contentType = response.data.content_type || "";
    const ext = path.extname(savedPath) || this.extFromMime(contentType) || ".bin";
    // 画板导出是固定 2560x2560 正方形，内容多在一隅、四周大片白边；裁掉白边只保留内容区
    buffer = await this.trimImageBuffer(buffer, contentType || this.mimeFromExt(ext));
    const vaultPath = normalizePath(`${this.settings.attachmentFolder}/${minuteToken}/${baseName}${ext}`);
    if (!this.app.vault.getAbstractFileByPath(vaultPath)) {
      await this.writeBinary(vaultPath, buffer);
    }
    return vaultPath;
  }

  mimeFromExt(ext) {
    const e = String(ext || "").toLowerCase();
    if (e.includes("png")) return "image/png";
    if (e.includes("jpg") || e.includes("jpeg")) return "image/jpeg";
    if (e.includes("gif")) return "image/gif";
    if (e.includes("webp")) return "image/webp";
    return "image/png";
  }

  // 用 Canvas 裁掉图片四周纯白边（Obsidian 是 Electron，必有 Canvas）。
  // 算法与 Python 验证版一致：任一 RGB 通道 < 248 视为非白，逐边收敛 + 16px padding。
  // node 等无 document 环境优雅降级返回原图（集成测试照常跑通）。
  async trimImageBuffer(buffer, mime) {
    if (this.settings.trimImageWhitespace === false) return buffer;
    if (typeof document === "undefined" || typeof Image === "undefined" || typeof URL === "undefined") return buffer;
    let url;
    try {
      const blob = new Blob([buffer], { type: mime || "image/png" });
      url = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("image decode failed"));
        im.src = url;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return buffer;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const TH = 248, PAD = 16;
      const nonBlank = (x, y) => {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 10) return false; // 透明视为空
        return data[i] < TH || data[i + 1] < TH || data[i + 2] < TH;
      };
      let top = 0, bottom = h - 1, left = 0, right = w - 1;
      const rowHas = (y) => { for (let x = 0; x < w; x++) if (nonBlank(x, y)) return true; return false; };
      const colHas = (x) => { for (let y = top; y <= bottom; y++) if (nonBlank(x, y)) return true; return false; };
      while (top < bottom && !rowHas(top)) top++;
      while (bottom > top && !rowHas(bottom)) bottom--;
      while (left < right && !colHas(left)) left++;
      while (right > left && !colHas(right)) right--;
      top = Math.max(0, top - PAD); left = Math.max(0, left - PAD);
      bottom = Math.min(h - 1, bottom + PAD); right = Math.min(w - 1, right + PAD);
      const cw = right - left + 1, ch = bottom - top + 1;
      if (cw <= 0 || ch <= 0 || (cw >= w && ch >= h)) return buffer; // 没有可裁的白边
      const out = document.createElement("canvas");
      out.width = cw; out.height = ch;
      out.getContext("2d").drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
      const isJpg = /jpe?g/i.test(mime || "");
      const dataUrl = out.toDataURL(isJpg ? "image/jpeg" : "image/png", isJpg ? 0.92 : undefined);
      const b64 = (dataUrl.split(",")[1]) || "";
      if (!b64) return buffer;
      this.log(`裁白边 ${w}x${h} -> ${cw}x${ch}`);
      return Buffer.from(b64, "base64");
    } catch (err) {
      this.log("裁白边失败，保留原图", err);
      return buffer;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  async writeBinary(vaultPath, buffer) {
    const parent = path.posix.dirname(vaultPath);
    await this.ensureFolder(parent);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    await this.app.vault.adapter.writeBinary(vaultPath, arrayBuffer);
  }

  normalizeSmartMarkdown(markdown) {
    let text = markdown || "";
    text = text.replace(/<title>[\s\S]*?<\/title>\s*/g, "");
    text = text.replace(/<readonly-block\b[^>]*>\s*<\/readonly-block>\s*/g, "");
    text = text.replace(/<readonly-block\b[^>]*\/>\s*/g, "");
    text = text.replace(/<\/?grid\b[^>]*>/g, "");
    text = text.replace(/<\/?column\b[^>]*>/g, "");
    // 兜底：清除任何未被本地化替换的残留画板标签，避免裸 <whiteboard> 暴露在正文
    text = text.replace(/<whiteboard\b[^>]*>[\s\S]*?<\/whiteboard>\s*/g, "");
    text = text.replace(/<whiteboard\b[^>]*\/>\s*/g, "");
    text = text.replace(/^# /gm, "## ");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  // 按 ## 章节切分智能纪要，根据各模块开关过滤；未识别章节默认保留
  filterSmartSections(markdown) {
    if (!markdown) return markdown;
    const titleToKey = {
      "总结": "includeSmartSummary",
      "待办": "includeTodos",
      "智能章节": "includeChapters",
      "关键决策": "includeDecisions",
      "其他决策": "includeDecisions",
      "金句时刻": "includeHighlights",
      "相关链接": "includeLinks",
    };
    const lines = markdown.split("\n");
    const blocks = [];
    let cur = { title: null, lines: [] };
    for (const line of lines) {
      const m = line.match(/^##\s+(.+?)\s*$/);
      if (m) {
        blocks.push(cur);
        cur = { title: m[1].trim(), lines: [line] };
      } else {
        cur.lines.push(line);
      }
    }
    blocks.push(cur);
    const kept = blocks.filter((b) => {
      if (!b.title) return true; // 头部（录音主题/时间等）保留
      const key = titleToKey[b.title];
      if (!key) return true; // 未识别章节默认保留，避免误删
      return this.settings[key] !== false;
    });
    return kept.map((b) => b.lines.join("\n")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async ensureFolder(folderPath) {
    const clean = normalizePath(folderPath);
    if (!clean || clean === ".") return;
    const parts = clean.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); } catch (_) {}
      }
    }
  }

  async uniquePath(basePath) {
    let candidate = normalizePath(basePath);
    if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    for (let i = 2; i < 1000; i += 1) {
      candidate = normalizePath(`${basePath}-${i}`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
    return normalizePath(`${basePath}-${Date.now()}`);
  }

  timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  sanitize(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  yamlQuote(value) {
    const s = String(value || "").replace(/"/g, "\\\"");
    return `"${s}"`;
  }

  fmtDate(value) {
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  parseStartMs(item) {
    const meta = item && item.meta_data || {};
    const text = `${item && item.display_info || ""} ${meta.description || ""}`;
    let match = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const d = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
    match = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (match) {
      const d = new Date(+match[1], +match[2] - 1, +match[3]);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
    return undefined;
  }

  msToTimestamp(ms) {
    const totalSeconds = Math.floor(Number(ms || 0) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  extFromMime(mime) {
    if (!mime) return "";
    if (mime.includes("png")) return ".png";
    if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
    if (mime.includes("gif")) return ".gif";
    if (mime.includes("webp")) return ".webp";
    return "";
  }

  decodeEntities(value) {
    return String(value || "")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

class FeishuMinutesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "飞书妙记同步（基于 lark-cli）" });
    containerEl.createEl("p", {
      text: "v0.2.0 起优先同步 note_doc_token 对应的飞书智能纪要 Docx，可拉取图文、画板、待办、智能章节、关键决策、其他决策和金句时刻。",
      cls: "fms-section-desc",
    });

    new Setting(containerEl)
      .setName("lark-cli 路径")
      .setDesc("留空自动探测")
      .addText((text) => text
        .setPlaceholder("/opt/homebrew/opt/node@22/bin/lark-cli")
        .setValue(this.plugin.settings.cliPath)
        .onChange(async (value) => {
          this.plugin.settings.cliPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("检查 cli 状态")
      .setDesc("确认 lark-cli 已登录且具备妙记、智能纪要、媒体下载权限")
      .addButton((button) => button.setButtonText("检查").setCta().onClick(() => this.plugin.checkCli()));

    containerEl.createEl("h3", { text: "同步设置" });
    new Setting(containerEl)
      .setName("存放文件夹")
      .addText((text) => text.setValue(this.plugin.settings.syncFolder).onChange(async (value) => {
        this.plugin.settings.syncFolder = value.trim() || "FeishuMinutes";
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("附件文件夹")
      .setDesc("图片、画板缩略图会保存到这里，默认按 minute_token 分子文件夹")
      .addText((text) => text.setValue(this.plugin.settings.attachmentFolder).onChange(async (value) => {
        this.plugin.settings.attachmentFolder = value.trim() || "FeishuMinutes/assets";
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("自动同步")
      .setDesc("Obsidian 开着时按间隔定时同步")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
        this.plugin.settings.autoSync = value;
        await this.plugin.saveSettings();
        new Notice("重启 Obsidian 后生效");
      }));

    new Setting(containerEl)
      .setName("轮询间隔（分钟）")
      .addText((text) => text.setValue(String(this.plugin.settings.pollIntervalMinutes)).onChange(async (value) => {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n >= 5) {
          this.plugin.settings.pollIntervalMinutes = n;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName("回看天数")
      .setDesc("每次往回搜索最近多少天")
      .addText((text) => text.setValue(String(this.plugin.settings.lookbackDays)).onChange(async (value) => {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 730) {
          this.plugin.settings.lookbackDays = n;
          await this.plugin.saveSettings();
        }
      }));

    containerEl.createEl("h3", { text: "内容模块" });
    this.addToggle("同步飞书智能纪要 Docx", "总开关：关掉则不抓智能纪要，仅保留 AI 总结/逐字稿", "includeSmartDoc");
    containerEl.createEl("p", { text: "智能纪要内各模块（上面总开关开启时生效）：", cls: "fms-section-desc" });
    this.addToggle("　└ 总结", "智能纪要的总结段（通常含画板/图）", "includeSmartSummary");
    this.addToggle("　└ 待办", "智能纪要的待办清单", "includeTodos");
    this.addToggle("　└ 智能章节", "带时间戳的分章节摘要", "includeChapters");
    this.addToggle("　└ 关键决策 / 其他决策", "决策模块", "includeDecisions");
    this.addToggle("　└ 金句时刻", "金句时刻", "includeHighlights");
    this.addToggle("　└ 相关链接", "妙记/逐字稿文档链接", "includeLinks");
    this.addToggle("下载图片到本地", "把飞书图片转成 Obsidian ![[附件]]，避免链接过期", "includeImages");
    this.addToggle("下载画板缩略图", "把 whiteboard token 下载为本地 jpg/png", "includeWhiteboards");
    this.addToggle("裁掉图片白边", "画板导出是 2560 正方形大白边；自动裁到内容区，去掉冗余空白", "trimImageWhitespace");
    this.addToggle("包含 AI 总结（纯文本）", "artifacts 里的纯文本总结，兼容自动台账脚本", "includeSummary");
    this.addToggle("包含逐字稿", "同步完整逐字稿", "includeTranscript");
    this.addToggle("补全已同步笔记", "打开后，自动同步会把旧版笔记升级到最新版；默认关闭以避免后台覆盖", "updateExisting");
    this.addToggle("补全当前笔记前备份", "使用命令补全当前笔记时，先创建 .bak 备份", "backupBeforeEnrich");
    this.addToggle("调试日志", "在开发者控制台打印 lark-cli 输出片段", "debug");

    containerEl.createEl("h3", { text: "操作" });
    new Setting(containerEl)
      .setName("立即同步")
      .addButton((button) => button.setButtonText("同步一次").setCta().onClick(() => this.plugin.runSync(true)));
    new Setting(containerEl)
      .setName("补全当前打开的妙记")
      .setDesc("适合旧笔记：补上图文、画板、待办、决策和金句")
      .addButton((button) => button.setButtonText("补全当前笔记").setCta().onClick(() => this.plugin.enrichCurrentFile()));
    new Setting(containerEl)
      .setName("清空同步记录")
      .setDesc(`已记录 ${Object.keys(this.plugin.settings.syncedTokens).length} 条`)
      .addButton((button) => button.setButtonText("清空").setWarning().onClick(async () => {
        this.plugin.settings.syncedTokens = {};
        await this.plugin.saveSettings();
        new Notice("已清空同步记录");
        this.display();
      }));
  }

  addToggle(name, desc, key) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
      }));
  }
}

module.exports = FeishuMinutesSyncPlugin;
module.exports.default = FeishuMinutesSyncPlugin;
