#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnUpdateCheck } from './update.js';
import { VERSION } from './version.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { complete, type AiError, type CompleteOptions } from './ai_client.js';
import { cacheKey, clearCache, hashHelp, readCache, writeCache } from './cache.js';
import {
  FREE_PRESET,
  PRESETS,
  configPath,
  getLang,
  getMode,
  loadConfig,
  saveConfig,
  setLang,
  setMode,
  type Config,
} from './config.js';
import { startSpinner } from './feedback.js';
import { completeFree } from './free_client.js';
import { dimLine, formatExplanation } from './format.js';
import { fetchHelp } from './help_source.js';
import {
  buildQuestionPrompt,
  buildQuestionSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompts.js';
import { extractCommand } from './tokenize.js';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_BAD_INPUT = 2;
const EXIT_NO_CONFIG = 3;
const DISPLAY_HELP_MAX_LINES = 60;
const TRANSLATION_SECTION = '### 帮助原文逐行对照翻译';

export async function run(argv: string[]): Promise<number> {
  const first = argv[0];
  if (argv.length === 0) {
    await printUsage();
    return EXIT_FAIL;
  }
  if (first === '--help' || first === '-h') {
    await printUsage();
    return EXIT_OK;
  }
  if (first === '--version' || first === '-v') {
    console.log(VERSION);
    return EXIT_OK;
  }
  if (first === 'setup') {
    const ok = await runSetup();
    return ok ? EXIT_OK : EXIT_NO_CONFIG;
  }
  if (first === 'free') {
    return handleFree(argv.slice(1));
  }
  if (first === 'lang') {
    if (argv.length < 2) {
      process.stdout.write(`当前解释语言：${getLang()}。可用 cmdhelp lang <代码> 切换（如 cn/en/ja/fr/ru）。\n`);
      return EXIT_OK;
    }
    const code = argv[1].toLowerCase();
    if (!/^[a-z]{2,8}$/.test(code)) {
      process.stderr.write('错误：语言代码无效（2-8 位字母，如 cn/en/ja）。\n');
      return EXIT_BAD_INPUT;
    }
    setLang(code);
    process.stdout.write(`解释语言已切换为 ${code}。\n`);
    return EXIT_OK;
  }
  if (first === 'refresh') {
    if (argv.length < 2) {
      process.stderr.write('内部用法：cmdhelp refresh <命令名>（后台校验缓存更新，无需手动调用）。\n');
      return EXIT_BAD_INPUT;
    }
    const command = extractCommand(argv.slice(1).join(' '));
    if (!command) {
      process.stderr.write('错误：无效的命令名。\n');
      return EXIT_BAD_INPUT;
    }
    await refresh(command);
    return EXIT_OK;
  }
  if (first === 'clear' || first === '-clear' || first === '--clear') {
    return handleClear(argv.slice(1));
  }

  const raw = argv.join(' ');
  // 后台检查更新（24h 一次，npx 场景仅提示，全局安装会后台自动更新）
  spawnUpdateCheck();

  if (isNaturalLanguageQuery(raw)) {
    const ai = resolveAi();
    if (!ai) return handleNoConfig();
    return answerQuestion(raw, ai.config, { freeTier: ai.freeTier });
  }

  const command = extractCommand(raw);
  if (!command) {
    process.stderr.write(`错误："${raw}" 不是有效的命令名（仅限字母/数字/._-，且不能以 - 开头）。\n`);
    return EXIT_BAD_INPUT;
  }

  const cached = readCache(cacheKey(command, getLang(), getMode()));
  // 0.1.8 起输出结构升级（含逐行中英对照翻译），旧格式缓存视为失效，强制重新生成
  const staleCache = cached && !cached.explanation.includes(TRANSLATION_SECTION);
  if (staleCache) {
    process.stderr.write('（检测到旧版缓存，正在用新格式重新生成…）\n');
  }
  if (cached && !staleCache) {
    if (isGarbledHelp(cached.help)) {
      // 旧缓存因 GBK 解码错误导致乱码，视为无效，直接走重新生成
      process.stderr.write('（检测到历史缓存乱码，已自动清理并重新生成…）\n');
    } else if (cached.changed) {
      printResult(cached.help, cached.explanation);
      process.stderr.write('（检测到命令帮助有更新，已重新生成结果）\n');
      writeCache({ ...cached, changed: false });
      return EXIT_OK;
    } else {
      printResult(cached.help, cached.explanation);
      if (cached.lastCheckedAt) {
        const at = new Date(cached.lastCheckedAt).toLocaleString();
        process.stderr.write(`（${at} 核查 · 命令帮助未改变，后台持续校验中…）\n`);
      } else {
        const at = new Date(cached.updatedAt).toLocaleString();
        process.stderr.write(`（${at} 生成 · 后台校验中…）\n`);
      }
      spawnRefresh(command);
      return EXIT_OK;
    }
  }

  const ai = resolveAi();
  if (!ai) {
    return handleNoConfig();
  }
  return explain(command, ai.config, { freeTier: ai.freeTier });
}

function resolveAi(): { config: Config; freeTier: boolean } | null {
  if (getMode() === 'free') {
    return {
      config: { base_url: FREE_PRESET.base_url, api_key: 'public', model: FREE_PRESET.model },
      freeTier: true,
    };
  }
  const config = loadConfig();
  return config ? { config, freeTier: false } : null;
}

function handleFree(args: string[]): number {
  const sub = args[0];
  if (sub === 'on') {
    setMode('free');
    process.stdout.write('已开启免费模式：后续查询将使用 OpenCode 免费模型（big-pickle），无需配置。\n');
    return EXIT_OK;
  }
  if (sub === 'off') {
    setMode('custom');
    process.stdout.write('已关闭免费模式。\n');
    return EXIT_OK;
  }
  if (sub === undefined) {
    process.stdout.write(getMode() === 'free' ? '免费模式：已开启（big-pickle）\n' : '免费模式：已关闭\n');
    return EXIT_OK;
  }
  process.stderr.write('用法：cmdhelp free on | off （开启/关闭免费模式）\n');
  return EXIT_BAD_INPUT;
}

function handleClear(args: string[]): number {
  const arg = args.join(' ').trim();
  if (!arg) {
    const removed = clearCache();
    process.stdout.write(
      removed > 0 ? `已清除全部缓存（${removed} 条）。\n` : '缓存目录为空，无需清理。\n',
    );
    return EXIT_OK;
  }
  const command = extractCommand(arg);
  if (!command) {
    process.stderr.write(`错误："${arg}" 不是有效的命令名（仅限字母/数字/._-，且不能以 - 开头）。\n`);
    return EXIT_BAD_INPUT;
  }
  const removed = clearCache(command);
  process.stdout.write(
    removed > 0
      ? `已清除 ${command} 的缓存（${removed} 条，含全部语言/模式）。\n`
      : `没有找到 ${command} 的缓存（可能尚未查询过）。\n`,
  );
  return EXIT_OK;
}
function isNaturalLanguageQuery(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // 任何含中文的输入都视为自然语言（命令名仅限 ASCII）
  if (/[\u4e00-\u9fa5]/.test(t)) return true;
  // 英文疑问句
  const lower = t.toLowerCase();
  if (/^(how|what|why|when|where|which|can you|please|help me)\b/.test(lower)) return true;
  if (t.includes('?') || t.includes('？')) return true;
  // 较长的英文句子且不像 "cmd -flag" 形式
  if (t.includes(' ') && t.length > 15 && /[a-z]{3,}\s+[a-z]{3,}/i.test(t)) {
    if (!/^\s*[a-z0-9._-]+\s+[-/]/i.test(t)) return true;
  }
  return false;
}

async function answerQuestion(
  question: string,
  config: Config,
  aiOpts: CompleteOptions & { freeTier?: boolean } = {},
): Promise<number> {
  const lang = getLang();
  const messages = [
    { role: 'system' as const, content: buildQuestionSystemPrompt(lang) },
    { role: 'user' as const, content: buildQuestionPrompt(question) },
  ];
  const stopAi = startSpinner('正在生成 AI 回答…');
  try {
    const explanation = aiOpts.freeTier
      ? await completeFree(config, messages)
      : await complete(config, messages, aiOpts);
    console.log(formatExplanation(explanation));
    return EXIT_OK;
  } catch (err) {
    if (aiOpts.freeTier && (err as AiError).status === 429) {
      process.stderr.write(
        '错误：免费模型当前限流（429），请稍后再试，或运行 cmdhelp setup 配置其他 AI 服务。\n',
      );
      return EXIT_FAIL;
    }
    process.stderr.write(`错误：AI 调用失败：${(err as Error).message}\n`);
    return EXIT_FAIL;
  } finally {
    stopAi();
  }
}

async function explain(
  command: string,
  config: Config,
  aiOpts: CompleteOptions & { freeTier?: boolean } = {},
): Promise<number> {
  const lang = getLang();
  const stop = startSpinner(`正在查询本地帮助（${command}）…`);
  const help = await fetchHelp(command);
  stop();

  const messages = [
    { role: 'system' as const, content: buildSystemPrompt(lang) },
    { role: 'user' as const, content: buildUserPrompt(command, help) },
  ];

  const stopAi = startSpinner('正在生成 AI 通俗解释…');
  try {
    const explanation = aiOpts.freeTier
      ? await completeFree(config, messages)
      : await complete(config, messages, aiOpts);
    writeCache({
      command,
      lang,
      mode: getMode(),
      help,
      explanation,
      helpHash: hashHelp(help),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastCheckedAt: null,
      changed: false,
    });
    printResult(help, explanation);
    return EXIT_OK;
  } catch (err) {
    if (help) {
      console.log(truncateHelp(help));
      console.log(dimLine(separator()));
      process.stderr.write('AI 解释失败，以上为本地帮助原文；\n');
    }
    if (aiOpts.freeTier && (err as AiError).status === 429) {
      process.stderr.write(
        '错误：免费模型当前限流（429），请稍后再试，或运行 cmdhelp setup 配置其他 AI 服务。\n',
      );
      return EXIT_FAIL;
    }
    process.stderr.write(`错误：AI 调用失败：${(err as Error).message}\n`);
    return EXIT_FAIL;
  } finally {
    stopAi();
  }
}

async function refresh(command: string): Promise<void> {
  const key = cacheKey(command, getLang(), getMode());
  const cached = readCache(key);
  if (!cached) return;
  const help = await fetchHelp(command);
  const hash = hashHelp(help);
  if (hash === cached.helpHash) {
    writeCache({ ...cached, lastCheckedAt: Date.now() });
    return;
  }
  try {
    const ai = resolveAi();
    if (!ai) return;
    const messages = [
      { role: 'system' as const, content: buildSystemPrompt(cached.lang) },
      { role: 'user' as const, content: buildUserPrompt(command, help) },
    ];
    const explanation = ai.freeTier
      ? await completeFree(ai.config, messages)
      : await complete(ai.config, messages);
    writeCache({
      ...cached,
      help,
      explanation,
      helpHash: hash,
      updatedAt: Date.now(),
      lastCheckedAt: Date.now(),
      changed: true,
    });
  } catch {
    writeCache({ ...cached, lastCheckedAt: Date.now() });
  }
}

function printResult(help: string | null, explanation: string | null): void {
  // 主输出为 AI 解释（含功能/常用参数/常用范例/特别提示 + 逐行中英对照翻译），不再展示原版帮助
  if (explanation) {
    console.log(formatExplanation(explanation));
    return;
  }
  // AI 解释失败时兜底：展示截断的本地帮助原文
  if (help) {
    console.log(truncateHelp(help));
    console.log(dimLine(separator()));
  } else {
    console.log('注：本地帮助不可用。\n');
  }
}

function truncateHelp(help: string): string {
  const lines = help.split('\n');
  if (lines.length <= DISPLAY_HELP_MAX_LINES) return help;
  const kept = lines.slice(0, DISPLAY_HELP_MAX_LINES).join('\n');
  return `${kept}\n… 共 ${lines.length} 行，此处仅显示前 ${DISPLAY_HELP_MAX_LINES} 行`;
}

function spawnRefresh(command: string): void {
  try {
    const cliPath = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [cliPath, 'refresh', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // 静默失败，不影响主流程
  }
}

function isGarbledHelp(text: string | null): boolean {
  if (!text) return false;
  // 旧版本将 GBK 按 UTF-8 解码会产生大量 U+FFFD 替换字符
  if (text.includes('�')) return true;
  return false;
}

function isNpxRun(): boolean {
  const exec = process.argv[1] ?? '';
  if (exec.includes('_npx') || exec.includes('.npm')) return true;
  const npmExec = process.env.npm_execpath ?? '';
  if (npmExec.includes('npx')) return true;
  return false;
}

function separator(): string {
  const width = process.stdout.columns && process.stdout.columns > 20 ? process.stdout.columns : 60;
  return '─'.repeat(width);
}

async function printUsage(): Promise<void> {
  console.log(`cmdhelp v${VERSION} — 命令行智能助手
用法：cmdhelp <命令名>              查询单个命令（例：cmdhelp rm）
      cmdhelp <自然语言提问>        直接问 AI（例：cmdhelp 如何列目录）
      cmdhelp free on|off           开启/关闭免费模式（big-pickle，无需配置）
      cmdhelp setup                 配置自己的 AI 模型
      cmdhelp lang <代码>           设置解释语言（默认 cn，支持 en/ja/fr/ru 等）
      cmdhelp lang                  查看当前语言
      cmdhelp clear [命令]          清除缓存（例：cmdhelp clear ssh；不带参数清空全部）
示例：cmdhelp rm
      cmdhelp 如何列目录
      cmdhelp how to list files

说明：查询会给出 AI 总结（功能/常用参数/常用范例/特别提示）+ 帮助逐行中英对照翻译，不执行目标命令。
  免费模式受限流影响，查不到时可 setup 配置其他服务。
  查询结果会缓存，再次运行时秒出旧结果并后台校验帮助是否有变化。
  当前通过 npx 运行；想直接用 cmdhelp 命令（免 npx 前缀），可全局安装：npm i -g cmdhelp
  请支持opencode，仅需10$。`);
}

async function handleNoConfig(): Promise<number> {
  if (!stdin.isTTY) {
    process.stderr.write(
      '错误：未配置 AI 接口。可执行 cmdhelp setup 交互配置，或 cmdhelp free on 使用免费模型；也可设置环境变量 CMDHELP_BASE_URL / CMDHELP_API_KEY / CMDHELP_MODEL。\n',
    );
    return EXIT_NO_CONFIG;
  }
  await runSetup();
  return EXIT_NO_CONFIG;
}

async function runSetup(): Promise<boolean> {
  if (!stdin.isTTY) {
    process.stderr.write(
      '错误：setup 需要在交互终端运行；或改用环境变量 CMDHELP_BASE_URL / CMDHELP_API_KEY / CMDHELP_MODEL。\n',
    );
    return false;
  }
  process.stdout.write('选择 AI 服务（首次使用建议选 1，免费）：\n');
  PRESETS.forEach((p, i) => {
    process.stdout.write(`  ${i + 1}) ${p.name}\n`);
  });
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const preset = PRESETS[Number((await rl.question('请输入序号：')).trim()) - 1];
    if (!preset) {
      process.stderr.write('错误：无效的序号，取消配置。\n');
      return false;
    }
    let base_url = preset.base_url;
    let model = preset.model;
    let api_key = '';
    if (!base_url) {
      base_url = (await rl.question('API 地址：')).trim();
      model = (await rl.question('模型名称：')).trim();
      if (!base_url || !model) {
        process.stderr.write('错误：地址与模型名称不能为空。\n');
        return false;
      }
      api_key = (await rl.question('API 密钥（可留空）：')).trim();
    } else if (preset.need_key) {
      process.stdout.write(`提示：${preset.key_hint}\n`);
      api_key = (await rl.question('API 密钥：')).trim();
      if (!api_key) {
        process.stderr.write('错误：密钥不能为空，取消配置。\n');
        return false;
      }
    }
    saveConfig({ base_url, api_key, model });
    process.stdout.write(`已写入 ${configPath()}。现在可以查询命令了，例如：cmdhelp git\n`);
    if (isNpxRun()) {
      process.stdout.write(
        '提示：当前通过 npx 临时运行，直接输入 cmdhelp 会提示 command not found。\n',
      );
      process.stdout.write('如需全局使用，请执行：npm i -g cmdhelp\n');
    }
    return true;
  } finally {
    rl.close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href || isMainViaSymlink();

function isMainViaSymlink(): boolean {
  // npx 通过 node_modules/.bin/cmdhelp 软链启动时，argv[1] 是软链路径，
  // 而 import.meta.url 已被 realpath 解析，二者不等；用 realpath 比较兜底。
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  });
}

async function main(): Promise<number> {
  return run(process.argv.slice(2));
}