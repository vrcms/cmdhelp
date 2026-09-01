# cmdhelp — 命令行智能助手

> 不会执行你的命令，仅读取帮助文档并用 AI 解释 · `npx cmdhelp <命令>` 即可用

[![npm version](https://img.shields.io/npm/v/cmdhelp)](https://www.npmjs.com/package/cmdhelp)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)

输一个命令名，就能看懂它怎么用；不知道怎么描述需求，也能直接提问。

## 安装

```bash
npx cmdhelp git          # 试一下，无需安装
npm i -g cmdhelp         # 或全局安装
```

需要 Node.js 18 以上。

## 快速开始

```bash
cmdhelp git              # 解释 git
cmdhelp dir              # 解释 dir
cmdhelp 如何列目录       # 直接提问
cmdhelp how to list files
```

首次使用会引导你选择 AI 服务，选择“免费模型”即可开箱即用。之后也可在任意时候运行：

```bash
cmdhelp setup            # 重新配置 AI
cmdhelp free on          # 使用免费模型
cmdhelp free off         # 使用自己配置的模型
cmdhelp lang en          # 切换为英文
cmdhelp clear ssh        # 清除某个命令的缓存
cmdhelp clear            # 清空全部缓存
```

## 怎么用

```bash
cmdhelp <命令名>         # 例：cmdhelp rm
cmdhelp <一句话提问>     # 例：cmdhelp 如何解压 zip
cmdhelp --help           # 查看帮助
cmdhelp --version        # 查看版本
```

**会得到什么？**
- AI 总结：功能 / 常用参数 / 常用范例 / 特别提示（范例均为真实可运行的值，如 `ssh root@192.168.1.100`）
- 支持交互式追问：总结后可继续提问（例如 `-p 参数原文是什么样的`），AI 会基于完整帮助原文回答，直接回车退出

不再展示原版帮助全文，交互式追问时可随时查看原文片段。

如果本地没有该命令的帮助，会说明是基于通用知识，并提醒你注意版本差异。

## 常见问题

**Windows 上能用吗？**
可以，Windows、macOS、Linux 都可使用。

**需要配置 AI 吗？**
首次运行选“免费模型”即可，不用自己申请 key。想用自己的 OpenAI 兼容接口或本地 Ollama，也可在 `cmdhelp setup` 中配置。

**可以追问吗？**
可以。`cmdhelp ssh` 总结后会进入交互状态，直接输入问题即可（例如 `-p 原文是什么`），AI 会引用帮助原文段落回答。直接回车、`exit` 或 `Ctrl+D` 退出。管道/非交互环境自动跳过交互。

**第二次查询很快？**
会缓存上次的结果，之后打开更快。若想清理，删除 `~/.cmdhelp/cache` 目录即可，或用 `cmdhelp clear <命令>` / `cmdhelp clear` 单独清除缓存。

**必须用 npx cmdhelp 才能用吗？**
`npx cmdhelp` 是临时运行，不会注册全局命令，所以 `cmdhelp xxx` 会提示 command not found。想直接输入 `cmdhelp`，全局安装一次即可：`npm i -g cmdhelp`。

**会自动更新吗？**
会。每天首次运行时会静默检查新版本；`npx` 使用时会提示新版本，全局安装的会在后台自动更新。可用 `CMDHELP_NO_UPDATE=1` 关闭。

## 免责声明

本软件按“现状”提供，不附带任何担保。你对使用本软件的行为自行承担风险。

命令解释由本地帮助文档及 AI 生成，可能不准确或过时。所有示例在执行前，请结合你的实际环境自行判断；因使用本软件内容而产生的任何后果，由你自行承担，与 cmdhelp 及其作者无关。

使用本软件即表示你已理解并接受本声明。

## License

MIT
