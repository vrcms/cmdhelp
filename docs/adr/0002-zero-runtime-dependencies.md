# 运行时零第三方依赖：TypeScript + Node 原生能力

**Status**: accepted（v2，2026-08-28 由 Python 版重写）

本工具的运行时能力面只是"一次 HTTP POST + JSON 解析 + 子进程调用 + 参数解析"。选定 TypeScript 编写、编译到 `dist/` 发布，运行时只用 Node ≥ 18 内置能力：原生 `fetch`（HTTP）、`child_process.execFile`、`util.parseArgs`、`node:fs/os`。`typescript`、`@types/node`、`vitest` 仅作开发依赖。

备选：Python + pipx/PyPI。拒绝理由：用户要求 `npx cmdhelp` 即装即用，Node/npm 生态对开发者默认可用且免全局安装；零运行时依赖使 `npx` 无需安装任何包即可执行 `bin`。另备选 requests/httpx 或 axios/fastify 等库：单 POST 端点场景收益趋近于零，引入版本耦合，拒绝。后果：HTTP 错误分类与超时处理用 `fetch` + `AbortSignal.timeout` 手写薄层（约 20 行），接受。