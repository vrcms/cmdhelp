# 发布渠道：npm，交付形态 npx cmdhelp

**Status**: accepted

包名 `cmdhelp` 经验证未被占用（registry 返回 404），选定发布到 npm：`tsc` 编译产物（`dist/`）+ `bin` 指向 `dist/cli.js`，用户执行 `npx cmdhelp <命令名>` 即完成安装与使用，无需全局安装、无需克隆仓库。

备选：PyPI/pipx（PRD 以 Python 描述流程时隐含）、Homebrew 公式、直接发行脚本。拒绝理由：npx 免安装体验最接近用户诉求"一条命令装完"；npm 对开发者默认可用；包名即分发资产的稀缺性使先占先得。后果：Node ≥ 18 成为环境前提，README 需注明；版本发布纪律（semver、`prepublishOnly` 前置构建与测试）从此成为发布管道的一部分。