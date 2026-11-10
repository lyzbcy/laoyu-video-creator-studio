# Agent 排障、BGM 图谱与商城

现状：Windows 桌面开发版 `0.1.3-dev`  
负责人：捞鱼  
最后更新：2026-11-10

## Agent 排障与贡献

在「Agent 排障」预览或导出 JSON。诊断包只包含应用版本、平台、可取消的白名单事件和用户填写的复现步骤。「复制排障与 PR 指令」会交代独立分支、最小复现、回归命令和草稿 PR 要求。请在复制或导出前检查自己填写的内容。

源码与 PR 走 [私有开发仓库](https://github.com/lyzbcy/laoyu-video-creator-studio)。有权限的贡献者按 `SKILL.md` 复现、修复并验证，再按本次用户授权提交草稿 PR。没有源码权限的用户可以交付脱敏复现材料。桌面程序不会获取 GitHub 令牌或代发 PR。

## BGM 知识图谱

曲库来源有三种。已打标的本机 BGM 可在 BGM 页点「同步标签到图谱」，也可在图谱页选择已有 JSONL，或从商城下载曲库后手动加入。同步以对应来源为单位替换，图谱数据写入本机 `bgm-knowledge.json`。

图谱把原始曲目、标签及备注与 Agent 的场景用法分开显示。原始节点支持标签筛选、曲目搜索与查看原文。点击「导出标签证据包」和「复制内化指令」，将 JSON 与指令交给 Agent，导入返回的 JSON 后才能保存内化结果。

- 每条规则带 `scene`、`kind`、`reason`、可选的 `cue` 和逐字证据。`kind` 为「适合」「慎用」或「搭配」。`evidence` 中每条给出 `track` 和来自原标签或备注的 `quote`。搭配至少引用两首。
- 回传必须匹配 `revision`。旧库的规则在来源改变后标为待重新内化，原始记录保留。应用仅核验引用存在，场景判断和入点仍需人工试听确认。仅载入官方 58 条曲库时，可下载并导入[11 条内化示例](https://github.com/lyzbcy/laoyu-video-studio-marketplace/blob/main/assets/laoyu-bgm-graph-example.json)。
- 「复制选曲指令」同时导出图谱，供 Agent 结合分镜给出选曲、入点、降音量与留白建议。

## Skill 商城

桌面端随包只携带四条官方资源的目录信息。进入商城时核对本机官方 Skill 的 `SKILL.md`，从 `CODEX_HOME/skills`、`~/.codex/skills` 和 `~/.agents/skills` 识别同名入口。已连接的卡片直接复制本机使用指令。下载动作才从公开 GitHub 获取制品，核对 SHA-256 后写入本机 `market-downloads`。Skill ZIP 可导出后检查，再按所用 Agent 的方式安装。BGM 仅含标签和用法备注，需另备有权使用的音源，下载后手动加入图谱。

社区 [资源目录](https://github.com/lyzbcy/laoyu-video-studio-marketplace) 支持 Skill ZIP 和 BGM 标签 JSONL。贡献者在「上架免费资源」填写元数据、选择本地制品计算 SHA-256、导出条目或复制投稿指令。制品由贡献者发布到公开 GitHub，目录条目通过 Fork 与 PR 审核，合并后点击「刷新社区」即可看到。程序本身不会上传本地文件。

回归覆盖默认空下载、下载校验失败、社区目录缓存、图谱版本失配及证据校验。执行 `node --test tests/agent-market.test.mjs tests/feedback.test.mjs tests/timeline.test.mjs`。
