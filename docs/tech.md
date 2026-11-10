# 合体技术方案

现状：Windows 桌面开发版  
负责人：捞鱼  
最后更新：2026-11-10

## 桌面程序与数据

- `src/desktop.mjs` 通过 Electron 管理独立窗口、单实例和退出时保存。Windows x64 主程序为 `LaoyuCreatorStudio.exe`，工具 ID 为 `laoyu-creator-studio`。从桌面或项目目录快捷方式启动，关闭窗口退出。
- 内部 HTTP 服务在应用主进程绑定 127.0.0.1，主界面与旧打标模块共用源站。桌面会话只给自身窗口的同源请求注入临时令牌。应用关闭时结束内部服务。独立 Node 入口仅供本机开发调试。
- Windows 开发制品放在 `%LOCALAPPDATA%/Programs/LaoyuCreatorStudio/<version>`，用 `python scripts/package_windows.py` 从本机缓存构建。需要 Python 3.11+、Pillow、`package.json` 指定的 Electron Windows x64 ZIP 和 electron-builder 缓存中的 `rcedit-x64.exe`。更新快捷方式目标和 `.cmd` 后从实际 EXE 核对标题栏版本。开发版未登记到软件中心，也未配置公开更新源。
- 源码在本项目。运行数据在 `%LOCALAPPDATA%/LaoyuCreatorStudio`。剪辑项目分别保存 `board.json`、`editor.json` 和素材，两个文档独立修订，写入用同目录原子替换。
- 素材按支持的扩展名流式落盘，记录大小与 SHA-256。旧画布导入或缺片重链需匹配原哈希。媒体端点支持字节 Range。某些旧编码需要用户提供兼容预览文件。
- Electron 的偏好与浏览器存储分开，保存在运行数据目录的 `desktop-profile` 中。文件型剪辑项目沿用 `projects`。旧 BGM 工具中仅保存在浏览器的标签可通过曲库导出、导入迁移。

## 旧 BGM 标签库接入

- 在本机运行目录配置 `legacy-bgm.json`。字段 `library` 为旧标签 JSONL 的绝对路径，`audioDirs` 为原音源目录的绝对路径数组。默认只读。经用户授权后将 `writeEnabled` 设为 `true`，进入 BGM 打标时自动连接原文件，修改写回同一个 JSONL。显式手动绑定的数据库优先。
- 写入仅提交发生变化的记录。若同一条记录或标签组已被另一处更新，保留原文件，当前修改留在本机。覆盖前把旧字节保存为 `legacy-bgm.previous.jsonl`，原库通过同目录临时文件替换。退出打标页或关闭窗口时提交已排队的保存。
- 音源按确切文件名、完整源 ID 或唯一的旧导出短 ID 匹配。配置的音源目录只补入可匹配的音频。经完整 MD5 确认后找回的文件可按源 ID 存入本机 `bgm-recovered`，加入音源目录。缺音源的条目保留备注，仍可同步到知识图谱。
- 已在 Windows 桌面包验证 58 条旧标签、26 条匹配音源。4 条为本轮通过完整 MD5 找回的音频。已验证播放、数据库副本自动写入、备份、冲突保护和重启回读。

## 时间线与 Agent

- 源片标记用素材 ID 与源时间定位。成片片段使用独立成片位置和原片入点，时间线统一毫秒。版本审阅批注绑定版本 ID。
- 画布生成候选粗剪时沿分镜顺序选用明确的素材入出点或关联区间。人工编辑维护轨道、时长、锁定及音量。
- Agent 交接带项目 ID、当前修订、选区、稳定片段 ID、锁定及源素材引用。回传先拒绝过期基线、范围外改动、重叠或触及锁定，随后逐项采用。当前采用本机外部 Agent 工作流。
- 剪映适配器读明文基础轨道，目录外素材由用户补选。原生导出仍以目标版本实测为准。见 [剪映草稿](剪映草稿.md)。

### 外部 Agent 交接格式

从「剪辑时间线」复制修改指令，并同时导出时间线包。`mediaDirectory` 指向本机素材目录，资产 `file` 的末段是实际文件名。`clips` 里 `at` 为成片时间，`from` 为源片时间，`length` 为成片持续时间，单位均为毫秒。修改要求或选区改变后重新复制指令，采用前先在版本审阅查看差异。

回传文件带 `schema: 1`、`project`、`baseRevision`、`ticket` 和 `operations`。`update` 带 `id` 与 `fields`，`remove` 带 `id`，`add` 带完整 `clip` 及新 ID。保留旧片段 ID，遵守锁定和选区。以 `src/public/timeline.mjs` 的校验和 `tests/timeline.test.mjs` 的示例为准。
