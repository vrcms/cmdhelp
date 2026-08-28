# 命令名白名单校验：拒绝以 `-` 开头的 token 与路径分隔符

**Status**: accepted

命令名 = `shlex.split` 后的第一个 token，且必须整体通过白名单：非空、不以 `-` 开头、仅含 `[A-Za-z0-9._-]`、不含路径分隔符。不通过则拒绝查询并提示原因，而不是把 token 传进 man/Get-Help。

理由：以 `-` 开头的 token 语义含糊——`man --help` 会返回 man 自身的帮助而非目标命令文档，且这类输入正是"命令名伪装成参数"的典型形态；白名单同时天然免疫 Get-Help 字符串注入（默认参数分隔、命名空间操作）。这是安全边界的实现核心，测试必须覆盖 `cmdhelp rm -rf /`、`cmdhelp --help`、`cmdhelp "a;b"` 等恶意与歧义输入。