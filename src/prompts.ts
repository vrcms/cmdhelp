const LANGUAGE_NAMES: Record<string, string> = {
  cn: '中文',
  zh: '中文',
  zhcn: '中文',
  en: '英文（English）',
  ja: '日语（日本語）',
  jp: '日语（日本語）',
  fr: '法语（Français）',
  de: '德语（Deutsch）',
  ru: '俄语（Русский）',
  ko: '韩语（한국어）',
  es: '西班牙语（Español）',
  pt: '葡萄牙语（Português）',
  it: '意大利语（Italiano）',
};

export function languageName(code: string): string {
  const key = code.toLowerCase().replace(/[-_]/g, '');
  return LANGUAGE_NAMES[key] ?? code;
}

export function buildSystemPrompt(lang = 'cn'): string {
  return `你是一名命令行助手，请使用【${languageName(lang)}】输出全部内容（包括所有标题、说明与示例）。

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