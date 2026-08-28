# AGENTS.md

## 核心原则（所有改动均须遵守）

- **做软件就像做游戏**：用户的每一个动作都必须得到即时、明确的反馈——开始做什么、正在做什么、结果如何（成功/失败/中间态）。任何等待（网络、子进程、AI 调用）都必须有进度提示，任何操作结束都必须有结果提示，任何失败都必须有原因和下一步建议。禁止无反馈的干等、禁止静默失败。

## 项目状态

- **尚无代码**：仓库只有 `readme.md`（PRD 需求文档，待实现规范）和 `.opencode/skills/`。不要寻找 src/、测试或构建配置，实现需从零开始。
- `readme.md` 是**需求文档（PRD）**，不是使用说明；实现前先读它，MVP 范围见其第 6 节。
- 项目文档与 AI 提示词均为**中文**，产出物保持中文。
- **实现决策已定，勿再推翻**：技术栈 TypeScript + Node ≥ 18、零运行时依赖、npm 发布（`npx cmdhelp` 即装即用）。完整设计树见 `docs/design.md`，硬性技术决策见 `docs/adr/`，领域术语见 `CONTEXT.md`。

## 安全红线（来自 PRD 4.1，实现时必须遵守）

- **绝不执行用户输入的目标命令**；只运行帮助查询命令 `man` / `Get-Help`。
- 只取输入的第一个 token 作为命令名，忽略其余所有参数（如 `cmdhelp rm -rf /` 只查询 `rm`）。
- **绝不运行 `<命令> --help` 或 `<命令> /?`**——可能被设计不良的程序忽略参数而直接执行。
- 子进程必须设超时（约 5s）和输出大小上限（约前 200 行/5000 字符）。

## 关键实现约定（docs/design.md 已定，勿偏离）

- 命令名提取用**手写 tokenizer + 白名单校验**（见 ADR-0003）；子进程一律 `child_process.execFile`（参数列表、不经 shell）、`stdio: 'ignore'`、`timeout: 5000`、`maxBuffer: 20000`（超限取已捕获前段，视为成功）。
- 帮助获取：POSIX 用 `man`（env 加 `MANPAGER=cat`、`MANWIDTH=120`）；Windows 用 `powershell -NoProfile -Command "Get-Help <cmd> -Full | Out-String -Width 200"`。
- `Get-Help` 对非 PowerShell 的 exe 支持有限，失败时回退为仅 AI 解释并**明确提示可能不准确**。
- AI 客户端只用 OpenAI 兼容 `POST {base_url}/chat/completions`；Ollama 即 `base_url=http://127.0.0.1:11434/v1`（见 ADR-0001）。
- `cmdhelp free on|off` 开关免费模式（持久化在 `~/.cmdhelp/config.json` 的 `mode` 字段）：开启后查询自动直连 OpenCode 免费池（`https://opencode.ai/zen/v1`，`Authorization: Bearer public`，固定模型 `big-pickle`，头 `x-opencode-client: desktop`）；`free_client.ts` 实现双通道自动切换——public 失败（401/403/429）即试匿名通道（无 Authorization，`User-Agent: opencode` + hermes `HTTP-Referer`/`X-Title` 头），成功记 `free_channel: anon` 供下次直达，双败回退 public 并给限流提示，不改模型。
- 配置：首次运行或 `cmdhelp setup` 引导写入 `~/.cmdhelp/config.json`（`base_url`/`api_key`/`model`），内置免费服务预设（智谱 GLM-Flash 等，见 `src/config.ts` 的 `PRESETS`）；环境变量 `CMDHELP_*` 覆盖，非 TTY 时只能走环境变量。
- AI 输出结构：功能简述 + 常用参数说明 + 1-2 个典型示例（中文/按 `lang` 配置的语言）。
- 输出排版：本地帮助原文（截断）→ 宽度自适应分隔线 → AI 解释（见 `cli.ts` 的 `separator()`）；`cmdhelp lang <代码>` 切换语言（默认 cn，任意代码，`CMDHELP_LANG` 环境变量覆盖，语言名映射在 `src/prompts.ts` 的 `LANGUAGE_NAMES`）。
- 颜色：`src/color.ts`（NO_COLOR/FORCE_COLOR 规范，非 TTY 无色）+ `src/format.ts`（功能绿/参数黄/示例蓝/内联代码青/提示灰），`FORCE_COLOR=1` 可用于真机验证。
- 查询缓存：`src/cache.ts` 存 `~/.cmdhelp/cache/<命令>__<语言>__<模式>.json`（`CMDHELP_CACHE_DIR` 可覆盖）；命中秒出旧结果后以 `detached + stdio ignore + windowsHide:true` 静默后台校验（重新 man/Get-Help 比对帮助 sha1，无变化不调 AI，有变化才重生成并标记 `changed` 下次直接输出新结果）；帮助获取在 Windows 下同样 `windowsHide:true` 避免弹窗；缓存键含语言/模式自动隔离。
- 进度反馈：`src/feedback.ts` 的 `startSpinner()` 覆盖所有耗时操作（TTY 旋转动画/非 TTY 静态提示行），任何等待都必须有 stderr 反馈。

## 开发与发布命令

- 构建：`npm run build`（tsc → dist/）；测试：`npm test`（vitest）；静态检查靠 `tsc --strict`，无 eslint。
- 发布到 npm：包名 `cmdhelp` 已保留，`npm publish` 前 `prepublishOnly` 自动跑 build + test。

## 其他

- `.opencode/skills/continual-learning/` 插件会维护 AGENTS.md 的 `## Learned User Preferences` / `## Learned Workspace Facts` 两个区块，不要删除或改写这两个区块。
- 本目录是 git 仓库（main 分支）；`.opencode/state/`（本机插件状态）与 `node_modules/`、`dist/` 已在 .gitignore 忽略，不要手动提交它们。

## Learned User Preferences

- 做软件就像做游戏，每一步操作都必须有明确反馈，覆盖空状态、加载中、成功、失败四态，写入 AGENTS.md 核心原则
- 所有产出与交互保持中文
- 偏好直接落地代码而非停留分析，并行批量执行，一次性收集上下文并给出完整修改
- 要求彩色输出区分主要功能、重要参数、重要示例等信息层级
- 讨厌额外弹窗，要求后台任务完全静默无窗口
- 要求缓存二次运行时秒出旧结果，无变化时只做本地帮助 hash 对比不调用 AI
- 要求首次运行等耗时操作即时给出加载进度反馈，禁止无反馈干等
- 偏好自主决策与批量完成同类修改，减少往返确认

## Learned Workspace Facts

- 技术栈 TypeScript + Node≥18、零运行时依赖、包名 cmdhelp 通过 npx cmdhelp 发布
- 安全红线：只取首 token 白名单校验，绝不执行目标命令，仅运行 man/Get-Help 且设超时 5s 与输出上限 200 行/5000 字符
- 帮助获取 POSIX 用 man（MANPAGER=cat MANWIDTH=120），Windows 用 powershell Get-Help -Full 需 windowsHide:true 避免弹窗
- 免费模式走 https://opencode.ai/zen/v1 固定模型 big-pickle，双通道 public/anon 自动切换并持久化 free_channel
- 配置持久化于 ~/.cmdhelp/config.json（mode/free_channel/lang/base_url/api_key/model），CMDHELP_* 环境变量覆盖，非 TTY 只能走环境变量
- 查询缓存路径 ~/.cmdhelp/cache/<命令>__<语言>__<模式>.json，CMDHELP_CACHE_DIR 可覆盖，缓存键含语言/模式自动隔离
- 缓存策略为 stale-while-revalidate：命中秒出旧结果，后台以 detached + stdio ignore + windowsHide:true 静默校验 sha1，无变化不调 AI，有变化标记 changed 下次直接输出新结果
- 输出排版为本地帮助原文（截断）→ 宽度自适应分隔线 → AI 解释，颜色由 src/color.ts + src/format.ts 实现，遵循 NO_COLOR/FORCE_COLOR 且非 TTY 无色
- 进度反馈统一走 src/feedback.ts 的 startSpinner，TTY 旋转动画，非 TTY 静态提示行，覆盖所有耗时操作
