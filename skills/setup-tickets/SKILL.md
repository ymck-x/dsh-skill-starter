---
name: setup-tickets
description: "在一个项目里一次性建好本地票据约定。当用户说「初始化票据」「准备拆票」「建票据目录」，或 to-spec、to-tickets、implement 发现 docs/agents/issue-tracker.md 不存在时使用。"
---

在一个项目里建好票据约定，之后 `to-spec`、`to-tickets`、`implement` 都读它，不必各自兜底。

## 做三件事

1. 把同目录的 `ISSUE-TRACKER-TEMPLATE.md` 写到项目根目录的 `docs/agents/issue-tracker.md`。
2. 建空目录 `docs/agents/tickets/`，在里面放一个空的 `.gitkeep`，让空目录也能进版本控制。
3. 告诉用户三件事：约定文件在哪、票据会写在哪、要改格式就改那份约定文件。

项目根目录用当前工作目录。如果当前已经在子目录里，先跑 `git rev-parse --show-toplevel` 找根，找不到就用当前目录。

## 文件已经存在时

先读它，和模板逐段对比，只补缺失的部分，不要整体覆盖。用户可能已经按自己的习惯改过。

## 不要做

不要在这里创建任何票据。约定归约定，票据等 `to-tickets` 来拆。
