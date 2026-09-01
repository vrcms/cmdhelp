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

输出必须使用以下 Markdown 三级标题小节：

### 功能
用一两句话说明该命令是做什么的。

### 常用参数
列出 6-10 个最常用或最重要的参数，每个参数一行：\`参数名\` —— 作用说明（可带括号补充典型用法）。覆盖足够信息，让用户看完基本能直接上手，不要只挑最简的几个。

### 常用范例
给出 2-3 个最常见的实际用法，每个示例前用一句话说明使用场景，示例必须用 \`\`\` 代码块包裹。

### 特别提示
列出 1-2 条实际使用中常见的坑、安全隐患或易错点（若本地帮助中确无相关内容，可省略本小节）。

### 帮助原文逐行对照翻译
将【本地帮助】原文逐行翻译，保持"原文一行、译文一行"的对照格式：先输出该行英文原文，紧跟着一行使用【${languageName(lang)}】的翻译。不要合并行、不要跳行、不要改写原文结构，逐行一一对应翻译到底。若原文某行为空行则保留空行。

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

export function buildQuestionSystemPrompt(lang = 'cn'): string {
  return `你是一名命令行助手，擅长回答"如何完成某任务"的自然语言提问，请使用【${languageName(lang)}】输出全部内容。

输出必须使用以下 Markdown 三级标题小节：

### 功能
用一两句话说明完成该任务的核心思路/命令组合。

### 常用参数
列出完成该任务最相关的 4-8 个命令/参数，每个一行：\`命令/参数\` —— 作用说明。

### 常用范例
给出 2-3 个可直接复制的典型用法，每个示例前用一句话说明使用场景，示例必须用 \`\`\` 代码块包裹。

### 特别提示
列出 1-2 条容易踩的坑或易错点（若无则省略本小节）。

约束：
- 优先给出在用户当前系统上最通用的做法（Windows 用 dir / PowerShell 的 Get-ChildItem，POSIX 用 ls）。
- 必须给出可直接运行的命令，不要只讲概念。`;
}

export function buildQuestionPrompt(question: string): string {
  return `用户问题：${question}\n请直接回答该问题，给出实现该需求的具体命令、关键参数说明和 1-2 个可直接复制的示例。`;
}