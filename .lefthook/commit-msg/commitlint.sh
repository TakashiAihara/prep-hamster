#!/usr/bin/env bash
# Conventional Commits 形式の最低限チェック
#
# 受理:
#   <type>: <subject>
#   <type>(<scope>): <subject>
#   <type>!: <subject>           (breaking change)
#   <type>(<scope>)!: <subject>
# type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
#
# Merge / Revert / Fixup などの自動生成 message は除外。
#
# 引数: $1 = .git/COMMIT_EDITMSG のパス（lefthook の {1} placeholder で渡される）

set -eu

msg_file="${1:?commit-msg hook requires the message file path}"
first_line="$(head -n 1 "$msg_file")"

# 自動生成 / 中断系メッセージはスキップ
case "$first_line" in
  "Merge "* | "Revert "* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;;
  "") exit 0 ;;
esac

# Conventional Commits の最低形
pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+'

if [[ ! "$first_line" =~ $pattern ]]; then
  cat >&2 <<EOF

✗ Commit message must follow Conventional Commits.

  受け取り:
    "$first_line"

  期待形式:
    <type>(<scope>)?!?: <subject>

  type: feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert

  例:
    feat(api): add stock list endpoint
    fix: handle empty groupId in useStock
    chore!: drop Bun 1.2 support
    docs(stock): clarify FIFO policy

EOF
  exit 1
fi
