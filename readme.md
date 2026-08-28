# cmdhelp — 命令行智能助手

> `npx cmdhelp <命令/提问>` · 本地 `man/help/Get-Help` + AI 通俗解释 · 零运行时依赖 · `Node >= 18`

[![npm version](https://img.shields.io/npm/v/cmdhelp)](https://www.npmjs.com/package/cmdhelp)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)

给命令行新手和“偶尔用一次”的开发者：输一个命令名，秒出**功能简述 + 常用参数 + 1-2 个可直接抄的示例**。绝不执行目标命令，只读本地帮助文档。

## 特性

- **安全第一**：只取首 token 做查询，只运行 `help` / `man` / `Get-Help`，绝不跑 `<命令> --help` / `/?`；`execFile` 参数列表 + `timeout 5s` + `20k/200行` 截断
- **自然语言直答**：`cmdhelp 如何列目录` / `cmdhelp how to list files` 自动识别为提问，直接走 AI，无需本地帮助，同样输出三段式（功能/参数/示例）
- **Windows 本地优先**：`help <命令>`（50ms，cmd 内部如 `dir/copy`）→ `man <命令>`（Git Bash）→ `Get-Help -Full`（PowerShell 兜底）→ 最后才走 AI 网络；中文 GBK 自动转码，无乱码
- **秒出 + 后台校验**：`~/.cmdhelp/cache/<命令>__<语言>__<模式>.json` 缓存，二次命中秒出旧结果，后台 `detached + windowsHide` 静默校验 `sha1`，无变化不调 AI
- **彩色 + 进度**：`功能绿/参数黄/示例蓝/代码青`，`NO_COLOR/FORCE_COLOR` 兼容；`startSpinner()` 覆盖所有等待（TTY 动画 / 非 TTY 提示行）
- **多语言**：`cmdhelp lang <代码>` 任意语言，`CMDHELP_LANG` 覆盖
- **双 AI 通道**：免费池 `big-pickle` 双通道 `public/anon` 自动切换，或 `cmdhelp setup` 配任意 OpenAI 兼容接口 / 本地 `Ollama`

## 安装

```bash
# 即用即走
npx cmdhelp git

# 或全局安装
npm i -g cmdhelp
cmdhelp git
```

要求 `Node.js >= 18`，零运行时依赖。

## 快速开始

```bash
# 1. 免费模式（无需配置，开箱即用）
cmdhelp free on
cmdhelp git
cmdhelp dir
cmdhelp 如何列目录          # 自然语言也行
cmdhelp how to list files

# 2. 想用自己的模型
cmdhelp setup          # 交互式选择预设（智谱 GLM-Flash 等）或填 OpenAI 兼容地址
cmdhelp free off
cmdhelp rm

# 3. 切换解释语言
cmdhelp lang en        # 英文
cmdhelp lang ja        # 日文
cmdhelp lang cn        # 切回中文（默认）
```

## 用法

```
cmdhelp <命令名>              # 只取首 token，忽略后续参数，例：cmdhelp rm -rf / → 查 rm
cmdhelp <自然语言提问>        # 含中文/疑问句自动走 AI，例：cmdhelp 如何列目录 / how to list files?
cmdhelp free on|off           # 开/关免费模式（big-pickle）
cmdhelp free                  # 查看当前模式
cmdhelp lang <代码>           # 设置解释语言（cn/en/ja/fr/ru… 任意 2-8 字母）
cmdhelp lang                  # 查看当前语言
cmdhelp setup                 # 交互式配置 AI
cmdhelp --help | -h
cmdhelp --version | -v
```

**输出**：
- 命令查询：本地帮助原文（截断）→ 自适应分隔线 → AI 通俗解释（功能 / 常用参数 / 示例），缺失时提示“基于通用知识”
- 自然语言：直接走 AI，同样三段式，含可直接复制的命令示例

## 配置

优先级：`CMDHELP_*` 环境变量 > `~/.cmdhelp/config.json` > 默认。

```jsonc
// ~/.cmdhelp/config.json
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "mode": "custom",        // free | custom
  "free_channel": "anon",  // 免费双通道记忆
  "lang": "cn"
}
```

环境变量：`CMDHELP_BASE_URL` / `CMDHELP_API_KEY` / `CMDHELP_MODEL` / `CMDHELP_LANG` / `CMDHELP_CACHE_DIR`
非 TTY（如 CI）下只能走环境变量，不会弹交互。

预设在 `src/config.ts:PRESETS`，含智谱 GLM-Flash 等；`Ollama` 即 `base_url=http://127.0.0.1:11434/v1`。

## 缓存与性能

- 路径：`~/.cmdhelp/cache/<命令>__<语言>__<模式>.json`，`CMDHELP_CACHE_DIR` 可覆盖
- 策略：`stale-while-revalidate`，命中秒出，后台重跑 `help/man/Get-Help` 对比 `sha1(帮助前12位)`，有变化才重调 AI 并标记 `changed` 下次直接出新结果
- 清理：`Remove-Item "$HOME\.cmdhelp\cache\*.json"` 或删单个 `git__cn__free.json`

## 常见问题

**Windows 下 `man git` 能用吗？**  
装了 `Git for Windows` 的 `Git Bash` 自带 `man`，`cmdhelp` 会自动走 `man git`；没装则回退 `Get-Help` / AI。

**乱码？**  
已对 `help.exe` 的 GBK 输出做 `TextDecoder('gbk')` 转码；旧缓存若仍乱码含 `�` 会自动丢弃重生。

**免费模型限流 429？**  
免费池有配额，双通道 `public→anon` 自动重试仍 429 时稍后再试，或 `cmdhelp setup` 配自己的模型。

**颜色不生效？**  
非 TTY 默认无色；`FORCE_COLOR=1 cmdhelp git` 强制彩色，`NO_COLOR=1` 强制无色。

## 本地开发

```bash
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

发布：`npm publish` 前 `prepublishOnly` 自动 `build + test`。包名 `cmdhelp` 已保留。

## 版本

当前 `0.1.1`（`0.1.0` 首发 → `0.1.1` 新增自然语言直答 + GBK 乱码修复）。后续保持 `0.1.x` 小步迭代：`0.1.2` → `0.1.3` … 末位 +1，不升 `0.2`，便于早期快速修复与验证。

### Changelog

- **0.1.1** — 新增 `cmdhelp 如何列目录` 自然语言识别（中文/英文疑问句直接走 AI，跳过本地帮助）；修复 Windows `help` GBK 乱码与 `help git` 误缓存；`--help` 同步更新
- **0.1.0** — 首发：`help/man/Get-Help` 三级本地优先、免费双通道、缓存秒出、彩色与进度

## 安全

- 绝不执行用户输入的目标命令
- 只运行 `help` / `man` / `Get-Help`，`windowsHide:true` 无弹窗
- 白名单校验命令名（字母/数字/._-，不以 `-` 开头）

## License

MIT
