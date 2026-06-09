#!/bin/bash
# 一键发版：从 Obsidian 插件目录同步最新文件，更新 versions.json，commit/push，建 GitHub release。
# 用法: ./publish.sh <版本号>    例如  ./publish.sh 0.5.0
set -e
VER="$1"
if [ -z "$VER" ]; then echo "用法: ./publish.sh <版本号>  例如 ./publish.sh 0.5.0"; exit 1; fi

export PATH="/opt/homebrew/bin:$PATH"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_PLUGIN="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/.obsidian/plugins/feishu-minutes-sync"
MIN_APP="1.4.0"

# 1. 从 Obsidian 插件目录复制最新文件
cp "$VAULT_PLUGIN/main.js" "$REPO_DIR/main.js"
cp "$VAULT_PLUGIN/manifest.json" "$REPO_DIR/manifest.json"
cp "$VAULT_PLUGIN/styles.css" "$REPO_DIR/styles.css" 2>/dev/null || true
cp "$VAULT_PLUGIN/开发日志.md" "$REPO_DIR/开发日志.md" 2>/dev/null || true

# 2. 校验 manifest version 与传入版本一致
MV=$(python3 -c "import json;print(json.load(open('$REPO_DIR/manifest.json'))['version'])")
if [ "$MV" != "$VER" ]; then
  echo "版本不一致：manifest 是 $MV，你传的是 $VER。请先把 manifest.json 的 version 改成 $VER。"; exit 1
fi

# 3. 更新 versions.json
python3 -c "import json;p='$REPO_DIR/versions.json';d=json.load(open(p));d['$VER']='$MIN_APP';json.dump(d,open(p,'w'),indent=2,ensure_ascii=False);open(p,'a').write('\n')"

# 4. 自动走代理（如直连不通）
if ! curl -s --max-time 8 https://api.github.com >/dev/null 2>&1; then
  export HTTPS_PROXY=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890
fi

# 5. commit + push + release
cd "$REPO_DIR"
git add -A
git commit -m "release: $VER" || echo "(无改动可提交)"
git push
gh release create "$VER" main.js manifest.json styles.css -t "$VER" -n "见 开发日志.md"
echo "已发布 $VER：https://github.com/joybeachlodge-bryan/feishu-minutes-sync/releases/tag/$VER"
echo "同事 BRAT 将自动更新。"
