# CmdHelp 设计树（grill-with-docs 产出）

全部决策按 grilling 设计树遍历得出，每条给出采纳方案与理由；实现期若有异议可回改，改前先看对应 ADR。

## 1. 技术栈

- **语言**：TypeScript，运行环境 Node ≥ 18（`fetch`、`util.parseArgs`、`child_process` 均内置，无需 polyfill）。
- **运行时依赖**：零。Node 18+ 原生 fetch 与标准库覆盖 HTTP/JSON/子进程/参数解析全部需求。→ ADR-0002
- **开发依赖**：`typescript`、`@types/node`、`vitest`。
- **工程**：`tsc` 编译到 `dist/`；`package.json` 的 `bin` 指向 `dist/cli.js`（带 shebang）；`engines: node >= 18`；`files: ["dist"]`；`prepublishOnly` 钩子跑 `build && test`。
- **发布**：npm publish。包名 `cmdhelp` 已验证未被占用（registry 404），用户 `npx cmdhelp <命令名>` 即装即用。→ ADR-0004
- **静态检查**：MVP 不配 eslint，`tsc --strict` 兼做类型检查兜底。

## 2. 领域与安全（详见 CONTEXT.md）

- 核心概念：目标命令、命令名、本地帮助、帮助来源、AI 解释、来源标注、回退、安全边界、坏输入。
- **命令名提取**：手写约 20 行 tokenizer（处理单双引号与空白），取首个 token + 白名单校验 → ADR-0003。
- **执行模型**：`child_process.execFile`（参数列表，不经 shell）、`stdio: 'ignore'`、`timeout: 5000`、`maxBuffer` 限制输出。
- **输出上限**：`maxBuffer: 20000` 字符；超限时 Node 抛 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`，此时取 `error.stdout` 已捕获内容的前 200 行作为结果——视为成功而非失败（man 页超长是常态）。

## 3. 平台分派（Help Source 协议）

统一接口 `fetch(command) -> HelpText | null`：

- **Windows**（`process.platform === 'win32'`）：`execFile('powershell', ['-NoProfile', '-Command', 'Get-Help <name> -Full | Out-String -Width 200'])`。
- **Linux / macOS / 其他 POSIX**：`execFile('man', [name], { env: { ...process.env, MANPAGER: 'cat', MANWIDTH: '120' } })`——MANPAGER=cat 避免 less 交互卡死；MANWIDTH=120 保证非 TTY 下也折行，防止超长单行浪费 token。
- 命令不存在/输出为空 → 视为获取失败，进入回退（见 §6）。

## 4. AI 客户端

- **协议**：唯一协议 = OpenAI 兼容 `POST {base_url}/chat/completions`。→ ADR-0001
- **Ollama 接入**：`base_url=http://127.0.0.1:11434/v1`，`api_key` 留空。
- **实现**：原生 `fetch` + `AbortSignal.timeout(30000)`，单次请求（MVP 不做流式）。
- **重试**：对 408/429/5xx 重试 1 次（间隔 2s）；仍失败按 §6 处理。
- **调用参数**：`temperature=0.3`（确定性优先）、`max_tokens≈600`。
- **提示词**（中文）：system 固定角色与输出三段结构（功能简述 / 常用参数 / 典型示例）与来源标注规则；user 携带命令名 + 本地帮助原文（或"本地帮助不可用"标记）。

## 5. 配置

- 文件：`~/.cmdhelp/config.json`（`os.homedir()`，Windows 为 `%USERPROFILE%`），字段 `base_url` / `api_key` / `model`；POSIX 权限 0600。
- **内置服务预设**（`cmdhelp setup` 引导选择，30 秒完成）：智谱 GLM-Flash（免费额度、国内直连，默认推荐）/ Ollama 本地 / DeepSeek（低价按量）/ 自定义 OpenAI 兼容；预设只需填 key，base_url 与 model 自动带出。
- 环境变量覆盖（优先级：env > 文件）：`CMDHELP_BASE_URL` / `CMDHELP_API_KEY` / `CMDHELP_MODEL`。
- 首次运行：无配置且 stdin 为 TTY → 自动进入 setup 向导写文件；无配置且非 TTY（CI）→ stderr 报错并提示 `cmdhelp setup` 或环境变量。

## 6. 错误处理矩阵

| 场景 | 行为 |
|---|---|
| 帮助成功 + AI 成功 | 打印三段解释 |
| 帮助成功 + AI 失败 | 打印本地帮助原文（截断）给用户先行，再报 AI 错误 |
| 帮助失败 + AI 成功 | 回退：AI 纯通用知识，输出首行加"本地帮助不可用，以下基于通用知识，可能与当前系统版本有差异"提示 |
| 帮助失败 + AI 失败 | 友好报错，无输出垃圾 |
| 坏输入 | 拒绝查询，解释白名单规则 |
| 未配置 | 引导配置（见 §5） |

## 7. CLI 界面

- `cmdhelp <命令名>`：单位置参数；工具自身 `--help` / `--version` 用 `util.parseArgs` 提供（这俩是工具的，不是目标命令的）。
- **免费模式开关**：`cmdhelp free on` 开启 / `cmdhelp free off` 关闭 / `cmdhelp free` 查看状态。开启后 `cmdhelp <命令名>` 自动改走 OpenCode AI 免费池（`https://opencode.ai/zen/v1`，`Authorization: Bearer public` + 头 `x-opencode-client: desktop`），模型固定 `big-pickle`（`src/config.ts` 的 `FREE_PRESET`）。
- **免费双通道自动切换**（`src/free_client.ts`）：免费池有 public（`Bearer public`）与匿名（无 Authorization，`User-Agent: opencode` + `HTTP-Referer: https://hermes-agent.nousresearch.com` + `X-Title: Hermes Agent`）两个通道，配额相互独立。优先通道失败（401/403/429）即切换另一通道；成功则把通道记录持久化到 `~/.cmdhelp/config.json` 的 `free_channel`（下次直接走该通道），双通道均失败则回退 public 并给限流专属提示。网络类错误不切换。
- `cmdhelp setup`：配置自己的 AI 模型（写入 config 后模式自动转 custom，可 `free on` 切回）。
- 模式与通道持久化在 `~/.cmdhelp/config.json`（`mode` 与 `free_channel` 字段），自定义接口配置字段不受开关影响。
- **输出排版**：先原样输出本地帮助原文（截断后），再输出终端宽度自适应分隔线（`─`，置灰），最后是 AI 通俗解释；帮助不可用时仅有提示行 + AI 解释。
- **彩色输出**（`src/color.ts` + `src/format.ts`）：AI 解释的 `### 功能`（绿）、`### 常用参数`（黄）、`### 示例`（蓝）分节标题着色，行内 `\`参数名\`` 青色，回退提示行置灰；遵循 `NO_COLOR`（强制关）与 `FORCE_COLOR`（强制开）规范，非 TTY/管道自动无色降级。
- **多语言**：`cmdhelp lang <代码>` 切换解释语言（默认 `cn`，任意代码均可，内置 cn/en/ja/fr/ru/de/ko/es/pt/it 名称映射，未知代码原样传给模型）；`cmdhelp lang` 查看当前；持久化在 config 的 `lang` 字段，环境变量 `CMDHELP_LANG` 覆盖（优先级 env > 文件 > cn）。语言注入 system 提示词首行。
- 输出：AI 三段 markdown（`###` 标题）原样打印到 stdout；诊断信息走 stderr。
- MVP 不做：`--raw`、交互追问、缓存、shell 集成、危险命令预警（全部后移 v2，见 readme §7）。

## 8. 测试（vitest，仅开发依赖）

- `tests/tokenize.test.ts`：恶意/歧义输入矩阵（`rm -rf /`、`--help`、`a;b`、`./x`、空串、引号包裹）。
- `tests/help_source.test.ts`：mock `child_process` 验证 man/Get-Help 调用参数、env、timeout、maxBuffer 截断语义。
- `tests/ai_client.test.ts`：mock fetch 验证请求构造、响应解析、重试、失败分类。
- `tests/prompts.test.ts`：帮助可用/不可用两种提示词分支。
- `tests/cli.test.ts`：错误矩阵输出断言。
- 平台相关走 mock；等仓库 git init 后再补 CI（ubuntu + windows 矩阵）。