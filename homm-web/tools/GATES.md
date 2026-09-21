# 门控的退出码口径（`tools/` · 0/1/2/3）

> **一句话**：读 `rc` 之前，先问 **「这个脚本的 `rc` 是判词吗」** —— 本目录有三种角色，**只有"门"的 `rc` 才有意义**。
>
> **为什么有这份文档**：本会话反复在治同一族病 —— **退出码与判词脱钩**（`engineering-lead` `#173` 点名）；另有 **`grep 类名当验收`** 这种"代理量"。这张表把口径固定下来，**免得"看到 `rc=0` 就当通过"**。

---

## 一、先分清角色（★ 读 `rc` 前必看）

| 角色 | `rc` 是判词吗 | 含义 |
|---|---|---|
| **门**（gate） | ✅ **是** | `rc` = 结论。见 §二四码 |
| **报表 / 诊断工具** | ❌ **不是，恒 0** | 只打印数字 / 落盘。**"有没有问题"要看人读表** ⇒ **`rc=0` 不表示通过** |
| **构建 / 服务 / 助手** | ❌ 不是 | `rc` 只报"跑没跑成"，不报"好不好" |

> ★ **本目录目前有两个"名叫 audit、实为报表"的脚本：`ailayout`（`audit:ai`）与 `aidiagnose`（`audit:ai-diag`）** —— 它们**从不设退出码**（源码里没有任何 `process.exit` / `process.exitCode` 作用于结论）⇒ **恒 0**。`npm run audit:ai` 成功**不代表 AI 没问题**，只代表**表打出来了**。

## 二、四码约定

| 码 | 含义 | 落地方式 |
|---|---|---|
| **0** | 全过 | 所有门 |
| **1** | 有 FAIL（**量到了，结论"不过"**） | 所有门 |
| **2** | **前置不满足**（无 Chrome / 构建缺被测对象 / 服务没起）—— **不吐模块解析栈** | 统一入口 `_dist.mjs` 的 `requireFile()`；各门也可自带分支 |
| **3** | **读数不可信**（跑的过程中**被测对象变了**）⇒ **本次结论作废**，**与 1 区分** | 目前仅 `contactaudit`（`#173`） |

> ★ **2 vs 1**：`2` = "这次**没量到**"（环境/前置）；`1` = "**量到了，不过**"（结论）。**把 2 混进 1，会让"环境坏"看起来像"代码坏"。**
> ★ **3 vs 1**：`3` = "量到了，但**量错了对象**" ⇒ **既不该报过、也不该报不过**，**必须重跑**。例：`contactaudit` 跑的中途 `dist` 指纹变了（`94beeb2` / `185ad5b`）。

## 三、逐脚本表

| npm script | 文件 | 角色 | 0 | 1 | 2 | 3 | 备注 |
|---|---|---|---|---|---|---|---|
| `smoke` | `smoke.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | |
| `audit:layout` | `layoutaudit.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | |
| `audit:mines` | `minesaudit.mjs` | 门 | ✓ | ✓ | ✓ | — | |
| `audit:ai` | `ailayout.mjs` | **报表** | **恒 0** | ✗ | ✓ `requireFile` | — | **不判过否**；打印布局指标表 |
| `audit:hover` | `hoveraudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | **未走统一 `requireFile`** |
| `audit:touch` | `tinytargetaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | **未走统一 `requireFile`** |
| `audit:b0` | `b0audit.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | |
| `audit:atlas` | `atlasaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | **未走统一 `requireFile`** |
| `audit:ai-diag` | `aidiagnose.mjs` | **报表** | **恒 0** | ✗ | ✓ `requireFile` | — | **不判过否**；落盘 `_aidiagnose.json/.log` |
| `audit:badge` | `mapbadgeaudit.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | |
| `audit:contact` | `contactaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | **✓** | **唯一用 3 的门**（`#173`） |
| `audit:scenario` | `scenarioaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | 含 `NEG=1` 反测模式（`#165`） |
| `audit:androidsync` | `androidsync.mjs` | 工具 | ✓ 隐式 | ✓ | ✓ | — | 无显式 `0`；成功走自然退出 |
| `audit:hpbudget` | `hpbudget.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | `#156` 英雄栏信息预算量尺 |

> ★ **表外**（不判过否）：`build`（`tsc` + `postbuild.mjs`）、`typecheck`、`start`/`serve.mjs`、`watch`、`dev`、`assets:mobile`、`mobile:sync`。

## 四、三条通用纪律

1. **前置不满足一律 `2`** —— 走 `_dist.mjs` 的 **`requireFile()`**（缺文件即 `2` + 一句"先 `npm run build`"），**不要让它以模块解析栈崩在 `1`**。★ 现状：**14 门都接了 `_dist.mjs`**；其中 **8/14 走统一 `requireFile`**，**6 门自带 `exit(2)` 分支**（`hoveraudit` / `tinytargetaudit` / `atlasaudit` / `contactaudit` / `scenarioaudit` / `androidsync`）⇒ **"自带分支是否覆盖全部前置"= 未核项**（不是已认定的缺陷）。
2. **`--dist=<dir>` 一律** —— **14/14 已接**（`#164`）。**不要写死 `../dist`**；要跑隔离构建就让**服务**也指向它（`_dist.mjs` 的 `serveInProcess` ⇒ "断言对象 = 被测对象"）。
3. **新增门时自查两句**：**「它会不会红？」「它会不会绿？」** —— 只能红的是**墙**，只能绿的是**假绿**。
   ★ 已被点过名的失效形态：`恒真计数` · `样本自带被测标记` · `空跑即绿` · **`算出失败却 exit 0`** · **`声明了纪律但没实现`** · **`grep 代理量`**。
