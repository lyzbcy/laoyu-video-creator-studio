# 捞鱼视频创作台

本地桌面应用。提供视频素材画布、剪辑时间线、BGM 打标与知识图谱，以及免费 Skill 和曲库标签的按需下载。

开发入口见 [SKILL.md](SKILL.md) 和 [文档导航](docs/agent.md)。Windows 开发构建使用 `python scripts/package_windows.py`，运行前准备 Electron Windows x64 缓存、Pillow 和 rcedit。回归用 `node --test tests/agent-market.test.mjs tests/feedback.test.mjs tests/timeline.test.mjs`。

修复请先使用隔离测试项目复现，避免将运行数据、日志、素材、账号配置及密钥加入提交。社区资源上架使用独立的[公开资源目录](https://github.com/lyzbcy/laoyu-video-studio-marketplace)。
