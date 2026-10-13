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
| `audit:contact` | `contactaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | **✓** | 首个用 3 的门（`#173`；**不是唯一** —— 见下 `grimscontact`） |
| （无 npm script，直接 `node tools/grimscontact.mjs`） | `grimscontact.mjs` | 门 | ✓ | ✓ | ✓ 自带 | ✓ | 图三《破碎罗盘》40×40 · 16 seeds 接触日。**硬判据 = 中位 ≤8**；带**阳性对照**（AI 被冻结 ⇒ 必须 >8，否则判「门为假绿」并 FAIL）；另有 `norush` 信息组 |
| （无 npm script，直接 `node tools/grimsdiff.mjs`） | `grimsdiff.mjs` | **报表** | **恒 0** | ✗ | ✓ 自带 | ✓ | **不判过否**；打印三档难度实测数字（起始资源 / 野怪 / 移动力 / `aggression` / 周增长） |
| `audit:scenario` | `scenarioaudit.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | 含 `NEG=1` 反测模式（`#165`）。**2026-10-12 整篇重写**：开局页精简后被测对象从「试玩场景那一行 4 张卡」换成「一张地图卡 + 一个难度」，见文件头 |
| `audit:tutorial` | `tutorialgate.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | **本轮新增**。首次启动自动进教学模式的三环节（自动进 / 菜单能跳过 / 跳过不再回来）。**必须跑在全新 Chrome profile**（`_chrome.mjs` 每次 `mkdtempSync` ⇒ 天然满足；若改成复用 profile，① 会假绿） |
| `audit:androidsync` | `androidsync.mjs` | 工具 | ✓ 隐式 | ✓ | ✓ | — | 无显式 `0`；成功走自然退出。⚠️ **第 1 步就是 `npx cap sync android` ⇒ 会清空 `android/app/src/main/assets/public/`**（该目录被 `android/.gitignore:96` ignore，是 `dist/` 的拷贝、可重新生成）。想跑断言必须先接受这次清空 |
| `audit:hpbudget` | `hpbudget.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | `#156` 英雄栏信息预算量尺。**2026-10-12**：场景卡没了 ⇒ 改走 `?devscenario=<id>` 进门（顺带消掉原来 12s 空等） |
| `audit:panelgate` | `panelgate.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | 拇指带「英雄」三向（能开能关能再开）。**2026-10-12**：入口改 `?devstart=1`、按钮文案「开始新游戏」→「开始」 |
| `audit:haloflip` | `haloflip.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | ④ halo 光环翻转；自带 dev server（`?devquick=` 起步） |
| （无 npm script，直接 `node tools/showcasegate.mjs`） | `showcasegate.mjs` | 门 | ✓ | ✓ | ✓ `requireFile` | — | 展示图可玩性门（点击数 / 开局页滚动比 / 常驻文字条）。**2026-10-12**：「试这张图」并入「开始」，A 组从"证明减法生效"改为"证明没倒退回 2 次点击" |
| （无 npm script，直接 `node tools/iaaccept.mjs`） | `iaaccept.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | **独立验收探针**（不复用被验方的 `scenarioaudit`）。⚠️ **默认连外部 5173**，须先 `node tools/serve.mjs`；**且必须带 `NO_PROXY='*'`**（见 §六） |
| （无 npm script，直接 `node tools/verify-static-map.mjs`） | `verify-static-map.mjs` | 门 | ✓ | ✓ | ✓ 自带 | — | 图三静态地形 24 项断言（地形逐格相等 / 城堡矿山英雄零冲突 / 36 条路径） |

> ★ **表外**（不判过否）：`build`（`tsc` + `postbuild.mjs`）、`typecheck`、`start`/`serve.mjs`、`watch`、`dev`、`assets:mobile`、`mobile:sync`。

## 四、三条通用纪律

1. **前置不满足一律 `2`** —— 走 `_dist.mjs` 的 **`requireFile()`**（缺文件即 `2` + 一句"先 `npm run build`"），**不要让它以模块解析栈崩在 `1`**。★ 现状（2026-10-13 重数）：**17 道门接 `_dist.mjs`**；其中 **10/17 走统一 `requireFile`**（`smoke` / `layoutaudit` / `minesaudit` / `b0audit` / `mapbadgeaudit` / `hpbudget` / `panelgate` / `haloflip` / `showcasegate` / `verify-static-map`），**7 道自带 `exit(2)` 分支**（`hoveraudit` / `tinytargetaudit` / `atlasaudit` / `contactaudit` / `grimscontact` / `scenarioaudit` / `tutorialgate`）⇒ **"自带分支是否覆盖全部前置"= 未核项**（不是已认定的缺陷）。另：**`iaaccept.mjs` 不接 `_dist.mjs`**（自带 `--dist=` + `exit(2)`，且默认连外部 5173 ⇒ 见 §五）。
2. **`--dist=<dir>` 一律** —— **17/17 已接**（`#164`；`iaaccept` 用同名参数、语义一致）。**不要写死 `../dist`**；要跑隔离构建就让**服务**也指向它（`_dist.mjs` 的 `serveInProcess` ⇒ "断言对象 = 被测对象"）。
3. **新增门时自查两句**：**「它会不会红？」「它会不会绿？」** —— 只能红的是**墙**，只能绿的是**假绿**。
   ★ 已被点过名的失效形态：`恒真计数` · `样本自带被测标记` · `空跑即绿` · **`算出失败却 exit 0`** · **`声明了纪律但没实现`** · **`grep 代理量`** · **`计数=0 未带阳性对照`** · **`0 == 0 静默空`** · **`正则被拒被读成无匹配`** · **`毫秒数当布尔用（0 = falsy）`**。
   - ★ 最后一条是 **2026-10-13 `showcasegate` G 组实测**到的：`waitInGame()` 返回的是**毫秒数**，判据写成 `const started = await waitInGame(evaluate)` ⇒ "第一次轮询就命中"= `0` ⇒ falsy ⇒ **假红**。同一份门里 E 组写的是 `waited !== null`（对），G 组漏了 —— **同一条判据两处写法不一致**，而机器快/缓存热时才会触发，冷机永远绿。⇒ **规矩：凡"等待函数返回时长/计数"的，判据必须是 `!== null` / `> 0`，不许直接把返回值塞进 `PASS()`。**

## 五、本轮（2026-10-12/13）新踩到的三个环境坑

都不是产品缺陷，但都会让门**看起来**在判代码：

| 坑 | 症状 | 正确处理 |
|---|---|---|
| **`HTTP_PROXY` 让 `fetch` 打不到本地服务** | `iaaccept.mjs` 前置 0b 报 `fetch failed` ⇒ 整门 `exit(2)`，而 `curl` 直连是 200 | 跑 `iaaccept` 必须 `NO_PROXY='*' no_proxy='*' node tools/iaaccept.mjs`。Node 的 undici **不会**因为目标是 `127.0.0.1` 就绕过代理 |
| **macOS 没有 `timeout`** | `for g in …; do timeout 400 npm run audit:$g; done` ⇒ 每门 `rc=127`，一行读数都没有 | 别用 `timeout`；要限时就用后台任务 |
| **`cap sync` 会清空 assets** | `audit:androidsync` 第 1 步就 `npx cap sync android` ⇒ 沙箱按"批量删除"拦下 `android/app/src/main/assets/public` | 该目录被 `android/.gitignore:96` ignore、是 `dist/` 的拷贝、可重生 ⇒ 删除无害，但**要先跟用户说清会删什么**再跑 |

> ★ 这三条与 §二 的「2 vs 1」是同一族病：**环境坏被读成代码坏**。区别只在于病因从"服务没起"扩到了"代理 / 缺命令 / 同步副作用"。

---

## 六、计数类结论：**计数与退出码不得分开看**（`#180`）

**缘起**：`#180` 点名两类"计数 = 0"的静默空。`art-director` 已按其口径全仓扫过（范围 = `homm-web/**` 除 `node_modules` 的 `.mjs`/`.json`/`.sh`/`.cjs`/`Makefile`/`.toml` + `package.json` 的 `scripts`）：

1. **字面 `\|`（BRE 交替）在门控里 = 0 命中** ⇒ 扫代码会扫空。**真实暴露面 = 交互式命令 + 文档片段（人）**，不在门控里。
   - ⚠️ BSD/macOS `grep` 下 `grep "A\|B"` **静默返回 0 行且 `rc=0`** —— 不是"没匹配"，是"这个模式在这个实现里没有那个含义"。
   - ⇒ **不要用 `\|`**：用 `grep -E 'A|B'`（`command grep -nE`）或 `rg` / Grep 工具。
2. **`grep` 的重复上限 = 255**（`art-director` 实测）⇒ `grep -o 'X.\{0,300\}' f` 报 `maximum repetition exceeds 255`、**`rc=2`**；**一旦加 `2>/dev/null` 就完全静默** ⇒ 输出 0 行，**与"匹配不到"逐字同形**。
   - 对照：同文件同模式把上限降到 **250** ⇒ 正常命中 **3**（排除"文件里没有"这一可能）。

### ★★ 规矩（可机械执行的三句）

1. **计数类结论必须同时看退出码**：
   ```
   grep: rc=0 命中 / rc=1 无匹配 / rc=2 正则或用法错
   ⇒ "计数 = 0" 只在 rc=1 时才叫"真的没有"；rc=2 叫"这道题没跑起来"。
   ```
2. **凡断言 `X 的计数 == 0`（含 `.length === 0` / `.every(… === 0)`）必须带阳性对照** —— 先证"这一趟真能命中非零"。
   - `Array.prototype.every` 在**空数组上恒 `true`** ⇒ 空集假绿（`contactaudit` `05308ef` 已补守卫）。
   - 现成范式：`b0audit` 的 `bad === 0 && nonEmpty`（`record(11,…)` / `record(10,…)`）。
3. **取代一条判据时，必须同时改它的机检表达式** —— 否则被废的规矩会以"可执行"的形态继续跑（team-lead 命名：**「旧口径被编译进门控」**）。

### 现状（陈述，非判定）

- 门控侧**字面 `\|` = 0**（`art-director` 全仓扫）；仓里**无 `.sh`、无 `.github/`（无 CI）**。
- 本表口径内**唯一**外调 shell 的是 `contactaudit.mjs:59`（`execSync('git status --porcelain')`）—— **非 grep**，且已降级为 **WARN 旁证**（`#173` / `94beeb2`）。
- **`androidsync.mjs` 已补阳性对照**（`#180`，2026-09-21）：标记命中数判据由 `d === s` 改为 **`d > 0 && d === s`**；另有"文件缺 / 阳性对照失败 / 两侧不等"三态分开报。
  - 双向可证（逻辑层逐格）：`(0,0)` 一格由**绿翻红** —— 正是 token 改名或功能掉了那一格；**其余格逐格不变**（不误红）。
  - 今日实测：6 个 `MARKERS` 在 `dist` 的命中数 = `4/3/1/3/3/1`（全 `> 0`）⇒ **补对照后不误红**。
- ⚠️ **未核项（归 `eng-sprites`，本条只报不改）**：`b0audit` 中**未带 `nonEmpty`** 的若干 `… === 0` 断言（`:205`/`:248`/`:299`/`:336`/`:464`/`:728`/`:765`）**是否可能空集通过**。
- ★ **补漏（`engineering-lead` 2026-09-21，`#180`）—— 上面那份清单少了"更危险的那一类"**：`b0audit` 的**汇总层**用的是 `.every()`（空数组恒 `true`），**比 `=== 0` 更易空集假绿**，且**清单里没列**：
  - `:874` `const rs = byId.get(id) ?? []` → `:875` `rs.every((r) => r.pass)` ⇒ 某 `id` 若**一次 `record()` 都没跑到**，`rs = []` ⇒ **该断言在汇总里显示 `PASS`（零样本）**。★ **有对照的只有 9/10/11**（`:821`/`:840`/`:856` 带 `nonEmpty`）⇒ **同一份门里守卫不一致**，正是"看起来绿了"的常见来源。
  - `:966` `[...verdict.values()].every(Boolean)` ⇒ 若 `verdict` 为空（上游全部被跳过）⇒ `allPass = true` ⇒ **整门 `exit 0`**。
  - 判据形（建议）：`rs.length > 0 && rs.every(r => r.pass)`；并在 `:966` 前加 `verdict.size > 0`（或断言 `verdict.size === 11`，把"该出的断言数"也钉住）。
  - **为何列而不改**：文件归属 `eng-sprites`（"只报不改"）；本行只补"清单的完整性"，不改语义。
- ★ **本次独立复核的三条实测**（`engineering-lead`，不依赖他人转述）：① `tools/*.mjs` 里**无任何 `grep` 外调**（`execSync` 只两处：`contactaudit` 的 `git status`、`tintab` 的 `git rev-parse`；`spawnSync` 一处：`scenarioaudit` 自跑）；② `grep -rnF '\|' tools/` 的命中**全是 PNG 二进制误报**（`tools/probes/*.png`，**仅在不加 `-I` 时出现**）；③ ★ **加 `-I`（忽略二进制）后文本命中 = 1，而那 1 处就是本文件**（第 63–65 行在**讲述这个陷阱**）——
  ⇒ **扫这条时请自带这个已知项**：**"唯一的文本命中是这份警告本身"**（自指）。**别把它读成"仓里真有一处 `\|`"。**
  ⇒ 附带教训（同族）：**`grep -rl` 不忽略二进制时，PNG 的随机字节会造出"命中"** —— 我第一次扫就得到 **68 个文件"命中"**，全在 `tools/probes/*.png`。**"扫到东西"和"扫到对象"是两件事**（同「量错对象」）。
- **`androidsync.mjs` 阳性对照的单元级两向**（`#180`，三步不分家的证据）：拿三个受控输入喂**逐字搬来的**标记判据 ⇒ `3/3` → **✓**；`0/0`（token 改名/功能掉了）→ **✗ 且报"★阳性对照失败"**（**旧式 `d === s` 在这一格是 ✓ = 假绿**）；`1/3` → **✗ 且报"两侧不等"** ⇒ `markBad=2`、`rc=1`。**三种成因分开报**、且**红色不误伤正常格**。

