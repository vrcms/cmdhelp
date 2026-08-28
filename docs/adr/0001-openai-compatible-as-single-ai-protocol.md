# 统一走 OpenAI 兼容协议，Ollama 不写第二套客户端

**Status**: accepted

Ollama 原生提供 `http://127.0.0.1:11434/v1` 的 OpenAI 兼容端点（`/chat/completions` 协议），故 AI 客户端只实现 OpenAI 兼容协议一套；配置中的 Ollama 仅表现为 `base_url=http://127.0.0.1:11434/v1` + 空 `api_key`。配置模型因此只有 `base_url`、`api_key`、`model` 三个字段，无 provider 分支逻辑。

备选：为 Ollama 原生 REST API（`/api/chat`）写独立适配器。拒绝理由：双协议增加两倍测试面，而功能收益为零——/v1 端点已覆盖本工具的全部对话需求。附属收益：vLLM、LM Studio、One-API 等一切提供 /v1 的服务开箱即用。