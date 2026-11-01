# 交接文档 · S2 战斗兵牌重构（2026-11-01 中午封盘）

> 给接手的 Agent / Harness：先读 `.workbuddy/memory/MEMORY.md`（项目长期记忆，含铁律），
> 再读本文。规格唯一权威是 `production/ui-redesign-2026-10-28/spec-implementation.md`
> （§29.4 排期：S0 → B1 → **S2（本批）** → S3a–S3d → S4）。

## 一、你在哪

- 仓库 `tilaboy/WEB_HOMM3` 分支 `main`，HEAD `e25f9b5`（= origin/main，已推送的最后一笔）。
- **S2 批次已全部完成、全部验证通过，但一笔未提交** —— 500+ 行改动躺在工作区里
  （见 §三）。这是刻意的：项目纪律是「35 门全量回归 exit 0 才提交」，本批只复跑了
  受影响的 3 门 + 自检（见 §四），全量回归留给接手后的第一件事。
- 当前波次：TP-10 → alpha。

## 二、S2 做了什么（本会话定稿的设计）

1. **牌面彻底无文字**（主理人 2026-11-01 裁定）：
   - 名字 → 只挂 `aria-label`（形如「小孩 ×40`）+ `title` + 点击详情卡；
   - **数量 ×N 也撤了**（不重复战场脚下已有的读数）；
   - 常驻牌 = **立绘 43×37 + 3px 通栏贴底血条**，行高 **48**；
   - 预估行 `.fc` 是牌上唯一文字（「伤55 · 杀3」，要挨反击时数字转红 `.hurt`），
     只出现在**本回合真打得着**的敌卡上；有它时卡高 48→~63，没有时严格 48。
2. **左上 HUD 文字撤除**：回合/法力/行动队列全删；「现在轮到谁」靠**兵牌金框**
   （`.act`）表达，且随出手切换（点「等待」后金框换卡）。
3. **删掉的死代码**：回合胶囊第二行行动队列（`bt-chip`/`bt-next` 整块）、
   `:has(nth-child(4))` 与 `:has(nth-child(6))` 两条预估护栏（滚动已解决"卡被顶出
   屏幕"；护栏留着会在满编——最需要预估的局面——关掉触屏唯一的预估通道）。
4. **立绘帧烘焙**：23 帧（20 正编 + 3 中立野怪）43×37 进图集；剪影宽高比误差
   ≤15%（实测最大 5.1%）；外缘 1px 描边；`image-rendering: crisp-edges`、
   `background-size: 43px 37px` 1:1 铺满。`cu_*` 战斗帧不缩（单位允许溢出 1.6 格）。
5. 目视证据：`design/art-bible/shots/s2/`（battle-792×320、battle-3stack、
   card-6x、portraits-8x，共 1.2MB），由新工具 `tools/cardsheet.mjs` 出图。

## 三、改动清单（全部未提交）

| 文件 | 内容 |
|---|---|
| `homm-web/src/ui/BattleScreen.ts` (−185 行净) | 删胶囊/队列/法力 DOM；`renderSides` 改无文字卡 + `.fc` 预估行；aria 挂名字 |
| `homm-web/src/style.css` (~386 行) | 牌面 grid 重排（43×37 盒 + 3px 通栏血条）；删 `bt-chip`/`bt-next`/`bt-round`/`bt-mana` 与两条护栏 |
| `homm-web/src/render/unitArt.ts` (+110) | 43×37 立绘帧绘制（保持剪影比例 + 1px 描边） |
| `homm-web/src/render/unitFrames.ts` (+16) / `atlas.ts` (±26) | 帧注册与图集 |
| `homm-web/tools/probes/card.mjs`（**新**，`probe:card`） | 兵牌机检 20 条 + 负向对照（拉伸误差 119% ≫ 15%） |
| `homm-web/tools/uip0probe.mjs` (~140 行) | queue 判据整体替换为 **nohud** 判据；`INJECT_CSS` 增 nohud 臂；selfcheck 扩到 12 个负向对照 |
| `homm-web/tools/probes/touchtap.mjs` | 侧列名单改从 `aria-label` 取（顺带验"名字真挂上了"） |
| `homm-web/tools/serve.mjs` | **EPIPE 免疫**（探针连开多个 Chrome，客户端先断开导致 res 崩溃 → 进程死 → 后续门报 null/exit 2）+ MIME typo |
| `homm-web/tools/cardsheet.mjs`（**新**） | 目视证据出图（裁切坐标从页面实测 rect 取，不写死） |
| `homm-web/package.json` | 加 `probe:card` script |
| `design/art-bible/shots/s2/`（新，1.2MB） | 四张目视证据 |
| `production/tp9/tp8/tp8-expr-{manifest,scoresheet}` | 材料版本指纹更新（md5 28391542…） |

## 四、验证状态（2026-11-01 实测）

- `probe:card` → **rc=0 全过**（20 条，含 3 栈臂与 6 队滚动臂）；
- `probe:uip0` 主检 → **rc=0，17 ✅**（含新 nohud 闸：左上无文字 + 金框随出手切换）；
- `probe:uip0 --selfcheck` → **rc=0**：12 个负向对照
  （press/type/material/touch/hpbar/contrast/townfit/sides/icons/forecast/hud/nohud）
  **全部正确翻红**；selfcheck 一门约 27 分钟，全量回归要排时段；
- `probe:touchtap` → rc=0 两臂过；
- `dist/` 是新鲜的：combo `14935f45…`、main.js md5 `28391542…`（build 于 10:34，
  之后只动过 tools/，不影响 dist）。
- ⚠️ **35 门全量回归未跑**——提交前必须补（基线见 MEMORY「35 门全 exit 0」）。
- ⚠️ 曾出现的 `Cannot read properties of null (reading 'x')` 是 dev server 被 EPIPE
  打死后探针读不到 DOM 的**瞬态**，serve.mjs 修复后复跑即绿。遇到 exit=2 /
  null 崩溃，先查 5199 是否活着。

## 五、接手后第一件事（按序）

1. `cd homm-web && PORT=5199 node tools/serve.mjs`（后台挂着）；
2. **全量 35 门回归**（一门一门跑，`npm run -s x > /tmp/x.log; echo $?`；别并发多
   Chrome 门，会互相污染读数）；
3. 全绿后提交 S2 批次（建议信息：
   `feat(s2): 兵牌无文字化 — 立绘 43×37 + 金框认人 + 预估行唯一文字`）；
4. S2 收尾欠账：
   - **5 人盲测**未做（`production/tp9/tp8/tp8-expr-scoresheet.md` 表已备好、指纹已更新）；
   - X1 对比度口径仍待主理人拍板（MEMORY 待确认项）；
5. 之后的排期：S3a–d（20 个 `cu_*` 按新体形档重画，先 p1 一族验证）；
   老欠账见 MEMORY「仍欠」1–6（含 estimateDamage 必须与 B4 同批重标）。

## 六、环境与坑（本会话又踩/又见的）

- dev server 必须 5199 常驻；`curl` 要 `NO_PROXY='*'`；
- macOS 无 `timeout`；连跑多门后残留 headless Chrome 会饿死 rAF，`pgrep` 清理；
- **BSD grep 不支持 `\|`**（本会话又栽一次：找 `.more` 没找到，纯 grep 的锅）——
  搜代码一律用 Grep 工具；
- `x | tail` 拿到的是 tail 的退出码 —— 一律重定向后 `echo $?`；
- 地形/对比类门要钉 `homm.tierMode=high`（quality.ts 按帧率改档会污染读数）；
- push 走 `git push git@140.82.113.3:tilaboy/WEB_HOMM3.git main`（本机 github.com
  DNS 被劫，`HostKeyAlias` 已配）。
