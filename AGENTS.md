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
- 配置：首次运行引导写入 `~/.cmdhelp/config.json`（`base_url`/`api_key`/`model`），环境变量 `CMDHELP_*` 覆盖。
- AI 输出结构：功能简述 + 常用参数说明 + 1-2 个典型示例（中文）。

## 开发与发布命令

- 构建：`npm run build`（tsc → dist/）；测试：`npm test`（vitest）；静态检查靠 `tsc --strict`，无 eslint。
- 发布到 npm：包名 `cmdhelp` 已保留，`npm publish` 前 `prepublishOnly` 自动跑 build + test。

## 其他

- `.opencode/skills/continual-learning/` 插件会维护 AGENTS.md 的 `## Learned User Preferences` / `## Learned Workspace Facts` 两个区块，不要删除或改写这两个区块。
- 本目录不是 git 仓库。
