# cmdhelp — 命令行智能助手

> `npx cmdhelp <命令/提问>` · 本地 `man/help/Get-Help` + AI 通俗解释 · 零运行时依赖 · `Node >= 18`

[![npm version](https://img.shields.io/npm/v/cmdhelp)](https://www.npmjs.com/package/cmdhelp)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)

为命令行新手和“偶尔用一次”的开发者准备：输一个命令名，就能看到**功能简述 + 常用参数 + 1-2 个可直接复制的示例**。设计上不执行目标命令，仅读取本地帮助文档来生成解释。

## 特性

- **更安全**：仅取首个 token 作为命令名，仅通过 `help` / `man` / `Get-Help` 读取帮助，不通过 `<命令> --help` / `/?` 获取；使用 `execFile` 参数列表、`timeout 5s`、`20k/200行` 截断来减少风险
- **自然语言提问**：`cmdhelp 如何列目录` 或 `cmdhelp how to list files` 会被识别为提问，直接由 AI 回答，同样以三段式呈现
- **Windows 尽量走本地**：尝试 `help <命令>`（适合 `dir/copy` 等内部命令，约 50ms）→ `man <命令>`（Git Bash 自带时）→ `Get-Help -Full`，都未命中再走 AI；已处理中文 GBK 转码
- **缓存与后台校验**：结果缓存在 `~/.cmdhelp/cache/<命令>__<语言>__<模式>.json`，二次命中可较快返回旧结果，后台会静默对比帮助文档的 `sha1`，有变化时才会重新调用 AI
- **可读的输出**：`功能/参数/示例` 分块着色，支持 `NO_COLOR` / `FORCE_COLOR`；耗时操作有进度提示
- **多语言**：`cmdhelp lang <代码>` 切换解释语言，`CMDHELP_LANG` 可覆盖
- **灵活的 AI 接入**：内置免费池 `big-pickle`（双通道自动切换），也可在 `cmdhelp setup` 中配置任意 OpenAI 兼容接口或本地 `Ollama`

## 安装

```bash
# 试一下
npx cmdhelp git

# 或全局安装
npm i -g cmdhelp
cmdhelp git
```

需要 `Node.js >= 18`，无运行时依赖。

## 快速开始

```bash
# 1. 免费模式（开箱即用）
cmdhelp free on
cmdhelp git
cmdhelp dir
cmdhelp 如何列目录
cmdhelp how to list files

# 2. 使用自己的模型
cmdhelp setup          # 选择预设（如智谱 GLM-Flash）或填写 OpenAI 兼容地址
cmdhelp free off
cmdhelp rm

# 3. 切换语言
cmdhelp lang en
cmdhelp lang ja
cmdhelp lang cn        # 默认中文
```

## 用法

```
cmdhelp <命令名>              # 仅取首个 token，例：cmdhelp rm -rf / 会查询 rm
cmdhelp <自然语言提问>        # 含中文或疑问句时会直接询问 AI，例：cmdhelp 如何列目录
cmdhelp free on|off           # 开启/关闭免费模式（big-pickle）
cmdhelp free                  # 查看当前模式
cmdhelp lang <代码>           # 设置解释语言（cn/en/ja/fr/ru … 2-8 字母）
cmdhelp lang                  # 查看当前语言
cmdhelp setup                 # 交互式配置 AI
cmdhelp --help | -h
cmdhelp --version | -v
```

**输出说明**
- 命令查询：尽量展示本地帮助原文（截断后）+ 分隔线 + AI 解释；本地帮助未找到时会说明是基于通用知识
- 自然语言提问：直接由 AI 给出命令、参数说明和可复制示例

## 配置

优先级：`CMDHELP_*` 环境变量 > `~/.cmdhelp/config.json` > 默认值。

```jsonc
// ~/.cmdhelp/config.json
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "mode": "custom",        // free | custom
  "free_channel": "anon",
  "lang": "cn"
}
```

常用环境变量：`CMDHELP_BASE_URL` / `CMDHELP_API_KEY` / `CMDHELP_MODEL` / `CMDHELP_LANG` / `CMDHELP_CACHE_DIR`  
非交互终端（如 CI）下仅读取环境变量，不会弹出交互。

预设见 `src/config.ts:PRESETS`，`Ollama` 可用 `base_url=http://127.0.0.1:11434/v1`。

## 缓存与性能

- 路径：`~/.cmdhelp/cache/<命令>__<语言>__<模式>.json`，可用 `CMDHELP_CACHE_DIR` 覆盖
- 策略：类似 `stale-while-revalidate`，命中时先返回旧结果，后台再对比帮助文档是否有变化，有变化才会重新生成
- 清理：`Remove-Item "$HOME\.cmdhelp\cache\*.json"` 或删除单个如 `git__cn__free.json`

## 常见问题

**Windows 下 `man git` 可用吗？**  
如果安装了 `Git for Windows`，`Git Bash` 会自带 `man`，`cmdhelp` 会尝试使用；未安装时会回退到 `Get-Help` 或 AI。

**出现乱码？**  
已对 `help.exe` 的 GBK 输出做转码；旧的乱码缓存（包含 `�`）会在下次查询时自动丢弃并重新生成。

**免费模型提示限流 429？**  
免费池有配额，内置了 `public`/`anon` 双通道重试，仍受限时可稍后再试，或通过 `cmdhelp setup` 配置自己的模型。

**颜色不生效？**  
非 TTY 终端默认不着色；可用 `FORCE_COLOR=1` 强制着色，`NO_COLOR=1` 强制关闭。

## 本地开发

```bash
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

发布前 `prepublishOnly` 会自动执行 `build + test`。包名 `cmdhelp` 已保留。

## 版本

当前 `0.1.1`。`0.1.0` 为首个可用版本，后续在 `0.1.x` 范围内以末位递增为主（`0.1.2`、`0.1.3` …），暂不升至 `0.2`，以便快速迭代与修复。

### Changelog

- **0.1.1** — 支持 `cmdhelp 如何列目录` 这类自然语言提问（自动走 AI）；修复 Windows `help` 的 GBK 乱码及 `help git` 误缓存问题
- **0.1.0** — 初始版本：`help/man/Get-Help` 本地优先、免费双通道、缓存、着色与进度

## 安全说明

- 不执行用户输入的目标命令，仅读取本地帮助文档
- 仅通过 `help` / `man` / `Get-Help` 获取信息，并使用 `windowsHide:true` 避免弹窗
- 命令名会做白名单校验（字母/数字/._-，不以 `-` 开头）

## 免责声明

本软件按“现状”（AS IS）提供，不附带任何明示或默示的担保，包括但不限于适销性、特定用途适用性及非侵权性的担保。您理解并同意，您对本软件的使用由您自行承担风险。

开发者及贡献者在法律允许的最大范围内，不对您因使用或无法使用本软件而产生的任何直接、间接、附带、特殊、惩罚性或后果性损失承担责任，包括但不限于数据丢失、业务中断、设备或系统故障等情形。

`cmdhelp` 输出的命令解释与示例由本地帮助文档及第三方 AI 模型生成，可能存在不准确、过时或不完整之处（AI 幻觉）。所有示例命令在执行前，请您自行结合实际环境、权限及数据重要性进行审阅与测试；因您复制、执行或依赖本软件提供的任何内容而导致的后果，均由您自行承担，与 `cmdhelp` 及其作者、贡献者无关。

您使用本软件即视为已阅读、理解并接受本免责声明的全部内容。

## License

MIT
