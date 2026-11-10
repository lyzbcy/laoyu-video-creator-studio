---
name: laoyu-tagger-dev
description: 捞鱼视频创作台开发入口。用于维护 BGM 打标、素材画布、剪辑时间线、Agent 回传和剪映草稿交换。
---

# 捞鱼视频创作台

给视频创作者使用的本地工具，BGM 打标与 AI 辅助剪辑是同级入口。界面采用 V3 莓紫、番茄红和青柠撞色。

开发前读 [模块导航](docs/agent.md) 并查当前 [路线图与验收](docs/roadmap.md)。本机开发版为 `0.1.4-dev`，版本来自 `package.json`，运行时看应用标题栏。Windows 从「捞鱼视频创作台」快捷方式或 `启动捞鱼视频创作台.cmd` 启动。桌面层用 Electron，界面用 HTML、CSS 和 JavaScript，服务使用 Node 标准库。

- `src/desktop.mjs` 管理窗口和进程。`scripts/package_windows.py` 构建 Windows 开发版，见 [技术方案](docs/tech.md)。
- `src/public/` 是外壳、素材画布、时间线与版本审阅。剪辑数据模型在 `timeline.mjs`。
- `src/tagger/` 从原 BGM 工具 2.14.2（`0a7a355`）复用。独立运行目录的旧程序、旧曲库和更新链留在原工程。
- `assets/` 放设计稿及生成记录，`docs/` 放使用、开发和验证说明。
- 运行数据默认写入 `%LOCALAPPDATA%/LaoyuCreatorStudio`。测试用 `LAOYU_STUDIO_DATA` 和 `LAOYU_STUDIO_PORT` 隔离。禁止把用户素材、曲库、配置、日志或凭证装进源码和制品。
- Agent 排障、BGM 图谱和商城遵守[对应文档](docs/Agent与商城.md)的输入输出边界。跨版本写入先核对修订号。原片标记和审片批注使用各自时间域。Agent 提案先核验基线、选区及锁定字段，再进入版本审阅。
- 开发同步代码、受影响文档、版本和实际制品。交付前按[路线图](docs/roadmap.md)核对反馈、诊断、Agent 交接、平台与启动渠道的实测状态。按功能拆分变更。修改旧更新器、启动器、存储或外部接口前读对应开发规范。
- 回归入口为 `node --test tests/legacy-bgm.test.mjs tests/agent-market.test.mjs tests/feedback.test.mjs tests/timeline.test.mjs`。剪映加密格式和原生导出以真实往返验证为准，见 [剪映草稿](docs/剪映草稿.md)。
