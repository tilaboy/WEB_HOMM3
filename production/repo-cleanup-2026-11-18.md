# Repo 清理台账（2026-11-18）

> 触发：主理人「清理一下 repo，看有没有过期的或者没有文档的，从 repo 里边删除掉」。
> 口径不是"看着旧就删"，而是三条判据**同时**成立才删：① 没有任何 md / 代码引用它；
> ② 它是**可复算的产物**（重跑一条命令就能再出一份）；③ 它不是某个决议的唯一记录。
> 反过来，只要占住任意一条 —— 被引用 / 不可复算 / 是唯一证据 —— 一律保留，哪怕它很旧、很大。

## 1. 删了什么（55 个文件 · 11.9 MB）

| 路径 | 文件数 | 体积 | 判据 |
|---|---:|---:|---|
| `homm-web/screenshots/**`（除 `day3-showcase-*`） | 28 | 11.7 MB | 全仓 0 引用；M2/M9/H2/M21/P0/P1/Day4 各期截图，画面已被后续批次取代；`destaudit.mjs` 一条命令可重拍 |
| `production/ui-redesign-2026-10-28/portraits34/` | 27 | 0.3 MB | 该批自己的规格书判了死刑：`spec-implementation.md:188`「37×36 头肩裁切的 `portraits34` 图集……都不再使用」；生成器 `tools/portraits34.mjs` 仍在，可重跑 |

保留的 `homm-web/screenshots/day3-showcase-*.png` 6 张：`PROJECT-WRAPUP.md:283` 逐张点名（含 `{noon,dusk,night}` 花括号写法，按 basename 搜会漏），是"开始页难度行可点 + 三态地图"的唯一证据。

**为什么这批截图在我们自己的规则下本来就该出库**：`.gitignore` 2026-09-24 那一段已经写死「观感判定与调色实验的截图证据……**不入库**（可随时重跑，体积大）」；`screenshots/p1/light-*`、`p1/p12-fringes-*` 正是那一类，属于当年漏网的例外。

## 2. 看过但**故意没删**的（避免下次再翻一遍）

| 路径 | 体积 | 为什么不删 |
|---|---:|---|
| `design/art-bible/shots/` | 31 MB | 目录里有 `README.md` 逐对说明"只差一个变量"，`index.html` 是它的阅览页；删了等于删掉"画面提升"这类结论的唯一视觉证据 |
| `production/tp9/` | 21 MB | TP-1~TP-11 的实验与读数，被 `PROJECT-WRAPUP.md` / `overall-repair-plan.md` 等 20+ 处引用 |
| `production/{b1,b2,s3a-d,s5}/art/` | 3.4 MB | 批次文档用 `art/p{1..4}_*.png` 花括号引用 —— basename 检索会全部误判成"无引用"，**别按这个删** |
| `homm-web/android/**/mipmap-*`、`/res/**` | 1.6 MB | 名字不会被任何文档提到，但 `AndroidManifest` / 资源系统按目录约定加载 |
| `homm-web/assets/_pipeline/splash-src/` | 6 KB | 启动图管线的**输入**（`splash.mjs:31` 硬编码路径），删了管线不可复算 |
| `homm-web/assets/bitmap-proof/` | 3.7 MB | 位图路线虽已停，但这是"为什么停"的对照页（含 README） |
| `production/ui-review-2026-10-22.html` | 1.8 MB | `.md` 第 4 行点名它是配套可视化对照 |

## 3. 顺带发现：`smoke` 是红的（与本次删除无关）

清理时顺手跑了一遍 `npm run -s smoke`（`GATES.md` 把它登记为"门"），结果 **724 PASS / 7 FAIL**（修完口袋后是 726 / 6，攻城段尺子修完 **733 / 0**）。
先说明：**这 7 条在删除之前就已经红**（删的只有 `production/` 与 `homm-web/screenshots/` 的图片，没有代码参与）。

### 3.1 已修：两条因 P0 封闭宝地而过期的断言

- 「所有野怪都带守卫奖励」—— P0 之后**口袋入口守卫故意不背 `guard`**（奖励在口袋里，见 `generator.ts:1205`）。
  实测 5 个种子 × 3 个入口：无守卫的野怪 **15/15 全是口袋入口**，非口袋入口没有一条漏。
  改成「无守卫的只能是口袋入口」，并把矿的判定写成 `payload.guard?.kind`（原来会在 `undefined` 上 TypeError，整个门直接崩）。
- 「随便挑一个野怪算路径」—— 挑到被封死的口袋入口时 `path.length=0` 会抛栈、盖住后面 40 多条读数。
  改成挑**走得到**的野怪，并加「至少有一支走得到的野怪」兜底。

### 3.2 真 bug：约 5.7% 的封闭宝地是**封死**的

`seed 42` 的两个不可达物件是「口袋入口守卫 + 口袋里的属性物件」—— 门本身走不到，这块宝地永远进不去。

| 尺寸 | 20 个种子的口袋数 | 封死 | 受影响种子 |
|---|---:|---:|---:|
| small | 57 | 5 | 5/20 |
| medium | 59 | 4 | 4/20 |
| large | 60 | 1 | 1/20 |

根因在 `src/core/map/pockets.ts`：门只要求「只贴住 1 个内部格」（`gates.push`），
但没要求它**朝外有开口**。门落在外圈的拐角上时，另外 3 个邻居全是同一圈要种树的格子
⇒ 门朝里开，墙把门封在口袋里。

**已修（同日，`production/p0-pocket-seal-2026-11-18.md`）**：三层 —— 门要朝外有开口（`pockets.ts`）+
墙种完验连通 + 门口留 3 格空走廊 + **成品图总闸**（任何门不可达就整张图重来）。
60 图复量 **0 封死**，`probe:pockets` 新增 [G7] 与负向对照（144 块）。代价是地图重排、基线重录。

### 3.3 另外 6 条：攻城段比 B3b / D-12 老

`进城的最后一步必定落在城门正面` · `城墙没破之前攻方过不了城墙列` · `护城河格子可达` ·
`攻方踩进护城河 ⇒ 本回合结束` · `20 场 2 星攻城全部破墙` · `城防越高损失越大`（2 星 100% > 3 星 44%）。

**已修（同日，`production/smoke-revival-2026-11-18.md`）**：**一条都不是代码坏**。
根因只有三个：① 地图 8 向移动 ⇒ 城门（2×2 左下角）的正面是三格（西/南/**西南**）；
② 移动类夹具放了 `p1_eagle`，飞行兵按设计飞越城墙、落点禁护城河；
③ 损失单调只用一颗种子（单场方差 24%~100%，seed 11 的 L2 撞全灭）。
夹具改全地面、损失改 16 颗均值，并补"带飞行兵可以不破墙也赢"的负向对照 ⇒ **733 PASS / 0 FAIL**。

## 4. 复核

- 逐个 md/html 的相对链接跑了一遍：**全仓 0 条因本次删除而失效**（唯一一条失效链接在 `design/ux/in-game-ia.md:996`，是 Markdown 里的 `[去对决场](48×)` 尺寸标注被当成链接，与本次无关）。
- 体积：已跟踪文件 **131 MB → 119 MB**。
- `git ls-files | check-ignore` = 0：没有"已被 .gitignore 忽略却仍在库里"的漏网文件。
- 顺手清掉的工作区垃圾（未入库，不影响 commit）：`production/.DS_Store`、`production/ui-redesign-2026-10-28/.DS_Store`、空目录 `homm-web/production_evidence_tmp/` 与 `homm-web/assets/splash-variants/`。

## 5. 怎么找回

删除只发生在工作树与索引，历史里原样都在：

```bash
git show <本提交>^:homm-web/screenshots/p1/light-0_5.png > /tmp/x.png
# 或整目录：
git checkout <本提交>^ -- homm-web/screenshots production/ui-redesign-2026-10-28/portraits34
```
