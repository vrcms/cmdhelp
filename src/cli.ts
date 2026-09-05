#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnUpdateCheck } from './update.js';
import { VERSION } from './version.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { complete, type AiError, type ChatMessage, type CompleteOptions } from './ai_client.js';
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
import { createContext, buildMessages, pushTurn } from './context.js';
import { dimLine, formatExplanation } from './format.js';
import {
  buildSourceNote,
  fetchHelp,
  fetchHelpDetailed,
  fetchVersionInfo,
  resolveWindowsCommand,
  validateExecutablePath,
  type CommandCandidate,
} from './help_source.js';
import {
  buildQuestionPrompt,
  buildQuestionSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompts.js';
import { extractCommand, extractTarget } from './tokenize.js';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_BAD_INPUT = 2;
const EXIT_NO_CONFIG = 3;
const DISPLAY_HELP_MAX_LINES = 60;

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

  const target = extractTarget(argv);
  if (!target) {
    process.stderr.write(`错误："${raw}" 不是有效的命令名（仅限字母/数字/._-，且不能以 - 开头；也可用完整路径如 "C:\\tools\\agy.exe"）。\n`);
    return EXIT_BAD_INPUT;
  }
  const command = target.name;
  // 完整路径输入：先校验文件有效性（只读元数据，不执行）
  if (target.fullPath) {
    const check = validateExecutablePath(target.fullPath);
    if (!check.ok) {
      process.stderr.write(`错误：完整路径无效（${check.reason}）：${target.fullPath}\n`);
      return EXIT_BAD_INPUT;
    }
  }

  const cacheCommand = target.fullPath || target.runHelp ? cacheKeyFor(command, target.fullPath) : command;
  const cached = readCache(cacheKey(cacheCommand, getLang(), getMode()));
  if (cached) {
    // Windows 校验缓存绑定的程序是否仍有效：失效（含旧版无 source 字段）则重新生成
    const now = process.platform === 'win32' ? await safeResolve(command) : [];
    const mismatch = cacheSourceMismatch(cached, target.fullPath ?? null, now);
    if (mismatch) {
      process.stderr.write(`${mismatch}\n`);
    } else {
      const done = await printCachedAndMaybeInteract(cached, command);
      if (done !== null) return done;
    }
  }

  const ai = resolveAi();
  if (!ai) {
    return handleNoConfig();
  }
  return explain(
    command,
    ai.config,
    { freeTier: ai.freeTier },
    { runHelp: target.runHelp, pinnedPath: target.fullPath, cacheCommand },
  );
}

async function printCachedAndMaybeInteract(
  cached: Exclude<ReturnType<typeof readCache>, null>,
  command: string,
): Promise<number | null> {
  if (isGarbledHelp(cached.help)) {
    // 旧缓存因 GBK 解码错误导致乱码，视为无效，直接走重新生成
    process.stderr.write('（检测到历史缓存乱码，已自动清理并重新生成…）\n');
    return null;
  }
  if (cached.changed) {
    printResult(cached.help, cached.explanation);
    process.stderr.write('（检测到命令帮助有更新，已重新生成结果）\n');
    writeCache({ ...cached, changed: false });
    if (shouldEnterInteractive()) {
      const ai = resolveAi();
      if (ai) await runInteractiveLoop(cached.command, cached.help, cached.explanation, ai.config, cached.lang, ai.freeTier);
    }
    return EXIT_OK;
  }
  printResult(cached.help, cached.explanation);
  if (cached.lastCheckedAt) {
    const at = new Date(cached.lastCheckedAt).toLocaleString();
    process.stderr.write(`（${at} 核查 · 命令帮助未改变，后台持续校验中…）\n`);
  } else {
    const at = new Date(cached.updatedAt).toLocaleString();
    process.stderr.write(`（${at} 生成 · 后台校验中…）\n`);
  }
  if (shouldEnterInteractive()) {
    const ai = resolveAi();
    if (ai) await runInteractiveLoop(cached.command, cached.help, cached.explanation, ai.config, cached.lang, ai.freeTier);
    return EXIT_OK;
  }
  spawnRefresh(command);
  return EXIT_OK;
}

/** 缓存命令名：pin 路径或 /? 输出单独成键（后缀源路径 hash），避免与按名查询的缓存串味 */
function cacheKeyFor(name: string, source: string | null): string {
  if (!source) return name;
  return `${name}__@${hashHelp(source.toLowerCase()).slice(0, 8)}`;
}

/** 安全版解析：失败（或被 mock）时返回空数组，不抛错 */
async function safeResolve(command: string): Promise<CommandCandidate[]> {
  try {
    if (typeof resolveWindowsCommand !== 'function') return [];
    return (await resolveWindowsCommand(command)) ?? [];
  } catch {
    return [];
  }
}

/** 缓存与当前系统是否仍指向同一程序；不匹配返回提示文案（Windows 专用，其他平台恒 null） */
function cacheSourceMismatch(
  cached: { source?: string | null },
  fullPath: string | null,
  now: CommandCandidate[],
): string | null {
  if (process.platform !== 'win32') return null;
  const changed = '（检测到同名命令指向已变化，重新生成…）';
  if (fullPath) {
    return cached.source && cached.source.toLowerCase() === fullPath.toLowerCase() ? null : changed;
  }
  // 旧版缓存（0.1.19 前）没有 source 字段，无法确认指向，强制重新解析一次自愈
  if (cached.source === undefined) return '（检测到旧版缓存，重新解析命令…）';
  if (now.length === 0) return cached.source ? changed : null;
  const ok = Boolean(cached.source) && now.some((c) => c.source.toLowerCase() === cached.source!.toLowerCase());
  return ok ? null : changed;
}

function isExeFile(path: string): boolean {
  return ['.exe', '.com'].includes(extname(path).toLowerCase());
}

function isScriptFile(path: string): boolean {
  return ['.bat', '.cmd', '.ps1'].includes(extname(path).toLowerCase());
}

/** exe 无本地帮助时的征询门：同意后才走 runExeHelp 加固执行；非交互只给提示，绝不静默执行 */
async function offerHardenedHelp(command: string, source: string): Promise<boolean> {
  const nonInteractive =
    !stdin.isTTY || !stdout.isTTY || process.env.CMDHELP_NO_INTERACTIVE === '1' || Boolean(process.env.CI);
  if (nonInteractive) {
    process.stderr.write(
      `（${command} 没有本地帮助文本。要直接读取该程序真实帮助：cmdhelp ${command} /? ，或 cmdhelp "${source}"）\n`,
    );
    return false;
  }
  process.stdout.write(
    `${command} 没有本地帮助文本（help/man/Get-Help 均未提供）。\n` +
      `是否以加固方式运行该程序的帮助参数（--help，必要时 /?）来读取真实帮助？\n` +
      `（完整路径直调、不经 shell、stdin 关闭、空临时目录、最小环境变量、5 秒超时；仅本次运行）\n`,
  );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('y = 读取真实帮助 / 回车跳过：')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

function resolveAi(): { config: Config; freeTier: boolean } | null {
  if (getMode() === 'free') {
    return {
      config: { base_url: FREE_PRESET.base_url, api_key: 'public', model: FREE_PRESET.model },
      freeTier: true,
    };
  }
  const config = loadConfig();
  // 兼容旧版本 bug：选了免费预设却被存成 custom（base_url/model 与 FREE_PRESET 一致），自动视为 free 并修复文件
  if (
    config &&
    config.base_url === FREE_PRESET.base_url &&
    config.model === FREE_PRESET.model &&
    (config.api_key === '' || config.api_key === 'public')
  ) {
    setMode('free');
    return {
      config: { base_url: FREE_PRESET.base_url, api_key: 'public', model: FREE_PRESET.model },
      freeTier: true,
    };
  }
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
  // Windows 完整路径（如 C:\tools\agy.exe）含空格也绝不是自然语言
  if (/^[A-Za-z]:[\\/]/.test(t) || /^["']?[A-Za-z]:[\\/]/.test(t)) return false;
  // 显式取帮助意图（cmdhelp agy /?）：尾部的 ? 是 /? 参数，不是疑问句
  if (/^\S+\s+(\/\?|-\?|--help|--run-help|-h|help)\s*$/.test(t)) return false;
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
  helpOpts: { runHelp?: boolean; pinnedPath?: string | null; cacheCommand?: string } = {},
): Promise<number> {
  const lang = getLang();
  let stop = startSpinner(`正在查询本地帮助（${command}）…`);
  let spinning = true;
  const stopSpin = (): void => {
    if (spinning) {
      stop();
      spinning = false;
    }
  };
  const startSpin = (message: string): void => {
    stopSpin();
    stop = startSpinner(message);
    spinning = true;
  };
  // Windows 同名处理：pin 路径直接用；多候选二选一；单候选/失败走传统链路（行为不变）
  const explicitPin = Boolean(helpOpts.pinnedPath) || Boolean(helpOpts.runHelp);
  let candidates: CommandCandidate[] = [];
  let pinned: string | null = helpOpts.pinnedPath ?? null;
  if (process.platform === 'win32' && !pinned) {
    candidates = await safeResolve(command);
    if (candidates.length > 1) {
      stopSpin();
      pinned = await selectCandidate(command, candidates);
      if (!pinned) return EXIT_FAIL;
      startSpin(helpOpts.runHelp ? `正在读取所选程序帮助（${command}）…` : `正在查询本地帮助（${command}）…`);
    } else if (candidates.length === 1 && helpOpts.runHelp) {
      // 单候选 + 显式 /?：直接 pin，避免 detail 里重复解析跑两次
      pinned = candidates[0]!.source;
    }
  }
  const canDetail = typeof fetchHelpDetailed === 'function';
  const needDetail = Boolean(pinned || helpOpts.runHelp) && canDetail;
  // 用户输入完整路径或显式 /? 即为同意执行（红线约定）；菜单选择的不算，缺帮助时再走征询门
  let detail = needDetail
    ? await fetchHelpDetailed(command, {
        pinnedPath: pinned ?? undefined,
        runHelp: helpOpts.runHelp,
        consent: explicitPin,
      })
    : null;
  let help = detail ? detail.help : await fetchHelp(command);
  stopSpin();

  // 本地帮助缺失的兜底：解析到了具体程序就尽量拿到真实内容——
  // 脚本型直接读文件（只读安全，无需征询）；exe 需征询同意后才加固执行（默认绝不执行）
  if (!help && process.platform === 'win32' && !explicitPin && canDetail) {
    const source = pinned ?? candidates[0]?.source ?? null;
    if (source && isScriptFile(source)) {
      const spin = startSpinner(`正在读取脚本内容（${command}）…`);
      detail = await fetchHelpDetailed(command, { pinnedPath: source });
      spin();
    } else if (source && isExeFile(source)) {
      if (await offerHardenedHelp(command, source)) {
        const spin = startSpinner(`正在读取真实帮助（${command}）…`);
        detail = await fetchHelpDetailed(command, { pinnedPath: source, consent: true });
        spin();
      }
    }
    if (detail?.help) help = detail.help;
  }

  const chosenSource = detail ? detail.chosenSource : !pinned && candidates.length === 1 ? candidates[0]!.source : null;
  let sourceNote = detail ? detail.sourceNote : null;
  if (!sourceNote && !help && chosenSource) {
    // 本地帮助确实拿不到：给 AI 明确的防编造备注，避免把不相关的同名软件当成答案
    sourceNote =
      `【命令解析】目标程序已解析为 ${chosenSource}，但未能读取其本地帮助文本（该程序不提供 help/man/Get-Help 帮助）。\n` +
      `要求：不要编造该程序的具体参数或子命令；若无法仅凭命令名可靠判断该程序是什么，请明确说明不确定，` +
      `并建议用户运行 cmdhelp ${command} /? 或 cmdhelp "${chosenSource}" 获取真实帮助。`;
  }
  if (detail?.authoritative && detail.chosenSource) {
    process.stderr.write(`（已定位到 ${detail.chosenSource}，帮助来自该程序本身）\n`);
  } else if (detail && detail.candidates.length > 1 && !detail.authoritative) {
    process.stderr.write(`（按名查到的帮助可能属于另一个同名程序，已要求 AI 以所选程序为准）\n`);
  }

  const messages: ChatMessage[] = [
    { role: 'system' as const, content: buildSystemPrompt(lang) },
    { role: 'user' as const, content: buildUserPrompt(command, help, sourceNote) },
  ];

  const stopAi = startSpinner('正在生成 AI 通俗解释…');
  let explanation: string;
  try {
    explanation = aiOpts.freeTier
      ? await completeFree(config, messages)
      : await complete(config, messages, aiOpts);
    stopAi();
  } catch (err) {
    stopAi();
    // 429 限流时，若有旧缓存的总结，优先展示缓存（比只展示英文 help 更有用）
    const fallbackCache = readCache(cacheKey(helpOpts.cacheCommand ?? command, lang, getMode()));
    if (fallbackCache && fallbackCache.explanation) {
      process.stderr.write('（AI 额度/限流，展示上次缓存的总结）\n');
      printResult(fallbackCache.help, fallbackCache.explanation);
      if (shouldEnterInteractive()) {
        await runInteractiveLoop(command, fallbackCache.help, fallbackCache.explanation, config, lang, aiOpts.freeTier);
      }
      return EXIT_OK;
    }
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
  }

  writeCache({
    command: helpOpts.cacheCommand ?? command,
    lang,
    mode: getMode(),
    source: chosenSource,
    help,
    explanation,
    helpHash: hashHelp(help),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastCheckedAt: null,
    changed: false,
  });
  printResult(help, explanation);
  if (shouldEnterInteractive()) {
    await runInteractiveLoop(command, help, explanation, config, lang, aiOpts.freeTier, sourceNote);
  }
  return EXIT_OK;
}

/** Windows 重名二选一：TTY 列出候选（含产品名/版本）让用户挑；非 TTY 默认 PATH 第一个 */
async function selectCandidate(command: string, candidates: CommandCandidate[]): Promise<string | null> {
  // 一次取齐版本信息，一次展示，避免多次弹窗式调用
  try {
    if (typeof fetchVersionInfo === 'function') {
      const info = await fetchVersionInfo(candidates.map((c) => c.source));
      for (const c of candidates) {
        const v = info.get(c.source);
        if (v) {
          if (v.product) c.product = v.product;
          if (v.version) c.fileVersion = v.version;
        }
      }
    }
  } catch {
    // 版本信息拿不到不影响选择
  }
  const lines = candidates.map((c, i) => {
    const extra = [c.commandType, c.product, c.fileVersion].filter(Boolean).join('，');
    const first = i === 0 ? '（PATH 第一个，直接回车即选它）' : '';
    return `  ${i + 1}) ${c.source}${extra ? `（${extra}）` : ''}${first}`;
  });
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write(
      `（发现 ${candidates.length} 个同名命令 ${command}，非交互终端默认使用 PATH 第一个：${candidates[0]!.source}\n${lines.join('\n')}\n` +
        `如需指定：cmdhelp "完整路径"，或交互终端运行后按序号选择）\n`,
    );
    return candidates[0]!.source;
  }
  process.stdout.write(`发现 ${candidates.length} 个同名命令 ${command}，请选择要解释的：\n${lines.join('\n')}\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('请输入序号（回车默认 1，q 取消）：')).trim().toLowerCase();
    if (!answer) return candidates[0]!.source;
    if (answer === 'q') return null;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= candidates.length) return candidates[n - 1]!.source;
    process.stderr.write(`无效序号，已取消（可用 cmdhelp "${candidates[0]!.source}" 直接指定）。\n`);
    return null;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

async function refresh(command: string): Promise<void> {
  const key = cacheKey(command, getLang(), getMode());
  const cached = readCache(key);
  if (!cached) return;
  if (cached.source) {
    // pin/二选一产生的缓存绑定了具体程序，后台静默不再碰目标程序，只更新核查时间
    writeCache({ ...cached, lastCheckedAt: Date.now() });
    return;
  }
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
  // 主输出为 AI 解释（功能/常用参数/常用范例/特别提示），不再展示原版帮助
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

function shouldEnterInteractive(): boolean {
  if (process.env.CMDHELP_NO_INTERACTIVE === '1' || process.env.CI) return false;
  // 仅 TTY 交互终端才进入追问模式，避免管道/CI 卡住
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function runInteractiveLoop(
  command: string,
  help: string | null,
  initialExplanation: string,
  config: Config,
  lang: string,
  freeTier?: boolean,
  sourceNote?: string | null,
): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  // 简易上下文管理：参考 opencode compaction/overflow
  // help 只在 helpPrompt 中出现一次（base），history 只存问答轮次，
  // 每次按 token 预算裁剪 tail，避免重复发送导致 8k 上下文溢出
  const ctx = createContext(command, help, lang, initialExplanation, sourceNote ?? null);

  process.stdout.write(`\n关于 ${command} 还有什么想问的？（例如：-p 参数原文是什么样的）直接回车退出。\n`);
  while (true) {
    let input: string;
    try {
      input = (await rl.question(`${command}> `)).trim();
    } catch {
      break; // Ctrl+D
    }
    if (!input) break;
    if (/^(exit|quit|:q|q|bye)$/i.test(input)) break;
    if (/^(clear|cls)$/i.test(input)) {
      console.clear();
      continue;
    }
    if (/^help$/i.test(input)) {
      process.stdout.write('输入问题继续提问，回车退出，clear 清屏，exit 退出。\n');
      continue;
    }

    // 直接把用户原文作为新提问，上下文管理器负责拼接 base+tail
    const followUp = buildMessages(ctx, input);
    const stopAi = startSpinner('正在思考…');
    try {
      const answer = freeTier ? await completeFree(config, followUp) : await complete(config, followUp, {});
      stopAi();
      console.log(formatExplanation(answer));
      pushTurn(ctx, input, answer);
    } catch (err) {
      stopAi();
      if (freeTier && (err as AiError).status === 429) {
        process.stderr.write('错误：免费模型当前限流（429），请稍后再试。\n');
      } else {
        process.stderr.write(`错误：AI 调用失败：${(err as Error).message}\n`);
      }
    }
  }
  rl.close();
  process.stdout.write('已退出交互。\n');
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
       cmdhelp <命令名> /?            显式跑所选程序的 /? 取帮助（Windows 重名时最准，默认不用）
       cmdhelp "<完整路径>"           按完整路径查询（例：cmdhelp "C:\\tools\\agy.exe"）
       cmdhelp <自然语言提问>        直接问 AI（例：cmdhelp 如何列目录）
      cmdhelp free on|off           开启/关闭免费模式（big-pickle，无需配置）
      cmdhelp setup                 配置自己的 AI 模型
      cmdhelp lang <代码>           设置解释语言（默认 cn，支持 en/ja/fr/ru 等）
      cmdhelp lang                  查看当前语言
      cmdhelp clear [命令]          清除缓存（例：cmdhelp clear ssh；不带参数清空全部）
示例：cmdhelp rm
      cmdhelp 如何列目录
      cmdhelp how to list files

说明：查询会给出 AI 总结（功能/常用参数/常用范例/特别提示），支持交互式追问（基于完整帮助原文，防上下文爆炸）。
  追问时会保留完整帮助上下文，例如：cmdhelp ssh 后可继续问“-p 参数原文是什么样的”。
  Windows 下同名命令（如 agy 有新老两个）会自动列出候选让你选；只有当你明确写 /? 或在征询时回答 y 才会执行所选程序取帮助（exe 无本地帮助文本时会先问你）。
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
    if (preset === FREE_PRESET) {
      setMode('free');
      process.stdout.write(`已写入 ${configPath()}。已切换到免费模式（big-pickle），现在可以查询了，例如：cmdhelp git\n`);
    } else {
      saveConfig({ base_url, api_key, model });
      process.stdout.write(`已写入 ${configPath()}。现在可以查询命令了，例如：cmdhelp git\n`);
    }
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