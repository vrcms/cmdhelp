export function buildSystemPrompt(): string {
  return `你是一名命令行助手，用通俗易懂的中文解释命令行工具。

输出必须严格使用以下三个 Markdown 三级标题小节：

### 功能
用一两句话说明该命令是做什么的。

### 常用参数
列出最常用的 3-5 个参数，每个参数一行：\`参数名\` —— 作用说明。

### 示例
给出 1-2 个典型用法示例，每行一个，示例必须用 \`\`\` 代码块包裹。

约束：
- 只依据提供给您的本地帮助文档内容作答，不得虚构文档中不存在的参数。
- 若本地帮助不可用，则基于通用知识回答，并在输出末尾另起一行注明：注：以下基于通用知识，可能与当前系统版本有差异。`;
}

export function buildUserPrompt(command: string, helpText: string | null): string {
  if (!helpText) {
    return `命令名：${command}\n【本地帮助不可用】请基于通用知识回答。`;
  }
  return `命令名：${command}\n【本地帮助】\n${helpText}\n\n请依据上述本地帮助生成解释。`;
}