#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { complete } from './ai_client.js';
import { configPath, loadConfig, saveConfig, type Config } from './config.js';
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
    printUsage();
    return EXIT_FAIL;
  }
  if (first === '--help' || first === '-h') {
    printUsage();
    return EXIT_OK;
  }
  if (first === '--version' || first === '-v') {
    console.log(VERSION);
    return EXIT_OK;
  }

  const raw = argv.join(' ');
  const command = extractCommand(raw);
  if (!command) {
    process.stderr.write(`错误："${raw}" 不是有效的命令名（仅限字母/数字/._-，且不能以 - 开头）。\n`);
    return EXIT_BAD_INPUT;
  }

  const config = loadConfig();
  if (!config) {
    return handleNoConfig();
  }

  const help = await fetchHelp(command);
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt() },
    { role: 'user' as const, content: buildUserPrompt(command, help) },
  ];

  try {
    const explanation = await complete(config, messages);
    if (!help) {
      console.log('注：本地帮助不可用，以下基于通用知识，可能与当前系统版本有差异。\n');
    }
    console.log(explanation);
    return EXIT_OK;
  } catch (err) {
    if (help) {
      process.stderr.write('AI 调用失败，展示本地帮助原文：\n');
      console.log(help);
    }
    process.stderr.write(`错误：AI 调用失败：${(err as Error).message}\n`);
    return EXIT_FAIL;
  }
}

function printUsage(): void {
  console.log(`cmdhelp v${VERSION} — 命令行智能助手
用法：cmdhelp <命令名>
示例：cmdhelp rm

选项：
  --help, -h    显示本帮助
  --version, -v 显示版本号

说明：只查询 man/Get-Help 本地帮助文档，绝不执行目标命令；首次运行需配置 AI 接口。`);
}

async function handleNoConfig(): Promise<number> {
  if (!stdin.isTTY) {
    process.stderr.write(
      '错误：未配置 AI 接口。请设置环境变量 CMDHELP_BASE_URL / CMDHELP_API_KEY / CMDHELP_MODEL，或先在交互终端运行本命令完成向导配置。\n',
    );
    return EXIT_NO_CONFIG;
  }
  process.stdout.write('首次使用，请配置 AI 接口（OpenAI 兼容协议，Ollama 可用 http://127.0.0.1:11434/v1）：\n');
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const base_url =
      (await rl.question('API 地址（回车默认 https://api.openai.com/v1）：')).trim() ||
      'https://api.openai.com/v1';
    const api_key = (await rl.question('API 密钥（本地模型可留空）：')).trim();
    const model = (await rl.question('模型名称：')).trim();
    if (!model) {
      process.stderr.write('错误：模型名称不能为空。\n');
      return EXIT_NO_CONFIG;
    }
    const cfg: Config = { base_url, api_key, model };
    saveConfig(cfg);
    process.stdout.write(`已写入 ${configPath()}。重新运行即可查询命令。\n`);
    return EXIT_NO_CONFIG;
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