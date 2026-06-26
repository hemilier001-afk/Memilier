---
name: commit-message
description: 根据工作区的代码改动生成规范的 Git 提交信息（Conventional Commits 风格）
---

# 生成 Git 提交信息

当用户需要提交代码时，按以下步骤操作：

1. 用 `run_command` 执行 `git status --short` 和 `git diff --staged`（若无暂存改动则看 `git diff`），了解改动内容。
2. 按 **Conventional Commits** 规范生成提交信息：
   - 格式：`<type>(<scope>): <subject>`
   - 常用 type：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`
   - subject 用中文，简洁说明改动，不超过 50 字。
3. 如改动较多，在正文用要点列出关键变更。
4. 把生成的提交信息展示给用户确认，**不要自动执行 `git commit`**，除非用户明确要求。
