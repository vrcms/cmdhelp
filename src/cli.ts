#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { complete, type AiError, type CompleteOptions } from './ai_client.js';
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
import { completeFree } from './free_client.js';
import { dimLine, formatExplanation } from './format.js';
import { fetchHelp } from './help_source.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { extractCommand } from './tokenize.js';

const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version as string;

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_BAD_INPUT = 2;
const EXIT_NO_CONFIG = 3;

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

  const raw = argv.join(' ');
  const command = extractCommand(raw);
  if (!command) {
    process.stderr.write(`错误："${raw}" 不是有效的命令名（仅限字母/数字/._-，且不能以 - 开头）。\n`);
    return EXIT_BAD_INPUT;
  }

  if (getMode() === 'free') {
    const freeConfig: Config = {
      base_url: FREE_PRESET.base_url,
      api_key: 'public',
      model: FREE_PRESET.model,
    };
    return explain(command, freeConfig, { freeTier: true });
  }

  const config = loadConfig();
  if (!config) {
    return handleNoConfig();
  }
  return explain(command, config);
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

async function explain(
  command: string,
  config: Config,
  aiOpts: CompleteOptions & { freeTier?: boolean } = {},
): Promise<number> {
  const help = await fetchHelp(command);
  const lang = getLang();
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt(lang) },
    { role: 'user' as const, content: buildUserPrompt(command, help) },
  ];

  try {
    const explanation = aiOpts.freeTier
      ? await completeFree(config, messages)
      : await complete(config, messages, aiOpts);
    if (help) {
      console.log(help);
      console.log(dimLine(separator()));
    } else {
      console.log('注：本地帮助不可用，以下基于通用知识，可能与当前系统版本有差异。\n');
    }
    console.log(formatExplanation(explanation));
    return EXIT_OK;
  } catch (err) {
    if (help) {
      console.log(help);
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
}

function separator(): string {
  const width = process.stdout.columns && process.stdout.columns > 20 ? process.stdout.columns : 60;
  return '─'.repeat(width);
}

async function printUsage(): Promise<void> {
  console.log(`cmdhelp v${VERSION} — 命令行智能助手
用法：cmdhelp <命令名>
      cmdhelp free on|off   开启/关闭免费模式（big-pickle，无需配置）
      cmdhelp setup         配置自己的 AI 模型
      cmdhelp lang <代码>   设置解释语言（默认 cn，支持 en/ja/fr/ru 等）
      cmdhelp lang          查看当前语言
示例：cmdhelp rm

说明：只查询 man/Get-Help 本地帮助文档，绝不执行目标命令；免费模式受限流影响，查不到时可 setup 配置其他服务。
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
    return true;
  } finally {
    rl.close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  });
}

async function main(): Promise<number> {
  return run(process.argv.slice(2));
}