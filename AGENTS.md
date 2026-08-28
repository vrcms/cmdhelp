# AGENTS.md

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
- 查询缓存：`src/cache.ts` 存 `~/.cmdhelp/cache/<命令>__<语言>__<模式>.json`（`CMDHELP_CACHE_DIR` 可覆盖）；命中秒出旧结果后**进程内**再校验（重新 man/Get-Help 比对帮助 sha1，勿用 detached 子进程——Windows 必弹控制台窗口）；变化则重生成解释并标记 `changed`，下次运行直接输出新结果；缓存键含语言/模式自动隔离。
- 进度反馈：`src/feedback.ts` 的 `startSpinner()` 覆盖所有耗时操作（TTY 旋转动画/非 TTY 静态提示行），任何等待都必须有 stderr 反馈。

## 开发与发布命令

- 构建：`npm run build`（tsc → dist/）；测试：`npm test`（vitest）；静态检查靠 `tsc --strict`，无 eslint。
- 发布到 npm：包名 `cmdhelp` 已保留，`npm publish` 前 `prepublishOnly` 自动跑 build + test。

## 其他

- `.opencode/skills/continual-learning/` 插件会维护 AGENTS.md 的 `## Learned User Preferences` / `## Learned Workspace Facts` 两个区块，不要删除或改写这两个区块。
- 本目录是 git 仓库（main 分支）；`.opencode/state/`（本机插件状态）与 `node_modules/`、`dist/` 已在 .gitignore 忽略，不要手动提交它们。
