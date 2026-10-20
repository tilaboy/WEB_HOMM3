# 《骑士信条》(The Code of Chivalry) · 项目收尾说明

> **状态：停止开发** —— 2026-09-24 由项目所有者决定停止。
> **最后一条生产记录**：2026-09-21 16:37 —— 第二个包在真机（OPPO PMA110）安装成功，并从手机拉回 `base.apk` 逐字节复核通过。
> **本文件是「做完了什么 / 没做完什么」的权威清单。** 接手者（人或 AI）请先读这一份，再决定去读 `production/roadmap.md`（逐日流水）与 `design/` 下的规格。
>
> ⚠️ **2026-10-08 之后用户又回来做了两轮**（§11 单图 MVP / §12 开局页精简）。两轮的代码都已提交并推送到 `origin/main`。**"停开发"的判断以 §11/§12 的实测为准，不再以本文开头那句为准。**
>
> 📌 **要接着做？直接读 §13** —— 那里是 2026-10-13 复核过的开工清单，每条带文件:行号，不用重新调查。

---

## 0. TL;DR —— 一句话

一个**能真正玩通**的 HoMM 风格回合制策略游戏：冒险地图 → 遭遇/攻城 → 六边形战术战斗 → 城镇经营 → AI 对手 → 存档，闭环完整，web 与 Android 双端都能跑。

**它停在"内容差异化没做完 + 玩家可感知度不足"，不是停在"跑不起来"。**

---

## 1. 项目画像（实测数字，2026-09-24 复核）

| 项 | 数值 | 证据 |
|---|---|---|
| 技术栈 | TypeScript + Canvas2D，**零运行时依赖、零位图素材**；Capacitor 出 Android 壳 | `homm-web/package.json` |
| 源码规模 | `src/` **57 个 .ts / 21,104 行** + `style.css` 2,194 行 | `find homm-web/src` |
| 提交 | **533 次**，2026-09-13 → 2026-09-21 | `git rev-list --count HEAD` |
| 设计/架构/生产文档 | **26 份 .md**（含 1,415 行的 UX 信息架构规格、834 行卡通美术圣经、430 行难度规格） | `design/` `docs/` `production/` |
| 门控与测量脚本 | **40 个 .mjs**（15 道 `npm run audit:*` 门 + smoke + 抓图/测量工具链） | `homm-web/tools/` |
| Web 产物 | `dist/`（构建于 2026-09-21 16:28） | `dist/main.js` md5 `1c82e808369feef72ef1b8f0068ebbbf` |
| Android 产物 | `app-debug.apk` **5,235,587 B**，md5 `6811bc416a9ca478999294cc48aa72b0` | `android/app/build/outputs/apk/debug/` |
| 内容量 | 单位 **28 条**（20 阵营 + 5 旧通用 + 3 中立）· 法术 **17**（12 战斗 + 5 冒险）· 建筑 **15** · 宝物 6 · 战争机器 2 · 阵营 4 · 难度 3 · 地图尺寸 4 × 布局 4 | `src/core/data/` |

---

## 2. 已完成 ✅（有代码、接进主循环、实测能玩）

| 系统 | 证据 | 完成度 |
|---|---|---|
| **地图生成** | `core/map/generator.ts`（1,274 行）四族主城 / 中立城 / 分档野怪 / 矿场 / 宝库 / 要道守卫，**20 次自愈重试**，同种子必同图 | ✅ 完整 |
| **冒险地图渲染** | 正交 32px 网格、y 排序（画家算法）、昼夜光照、迷雾、可达染色、多级缩放相机 | ✅ 完整 |
| **寻路与移动** | `pathfinding.ts` Dijkstra + 移动力消耗 + 到达揭雾 + 动画 | ✅ 完整 |
| **战术战斗** | `core/combat/battle.ts`（1,278 行）15×11 尖顶六边形；移动/近战/射击/攻城/等待/防御/施法/撤退；**战前预估 = AI 真打一遍，与手动同一引擎同一种子** | ✅ 完整 |
| **攻城战** | `siege.ts`（283 行）10 段城墙 + 城门 + 箭塔 + 护城河 + 塌方传播 + 缺口扩张 | ✅ 完整 |
| **城镇与经济** | `town.ts`（650 行）15 建筑 / 3 条升级线、周增长带小数进位、征兵/驻守、市场、行会、战争机器、雇英雄 | ✅ 完整 |
| **AI 对手** | `ai.ts`（748 行）建造 / 经济 / 贸易 / 征兵 / 补兵 / 选目标 / 行军 / 交战 / 雇英雄 | ✅ 完整 |
| **难度系统** | `factions.ts` 已含玩家侧字段（`playerStartMul` / `playerGrowthBonus` / `playerMoveMul` / `monsterMul`），设计规格 `design/difficulty-spec.md` 与代码逐字段对齐 | ✅ 已实现（规格标"已实现并上线"） |
| **法术** | 17 个（12 战斗 + 5 冒险），5 个冒险法术全部实装 | ✅ 完整 |
| **胜负判定** | `victory.ts` 无城 7 天宽限 → 出局；玩家豁免 | ✅ 完整 |
| **存档** | `save/persistence.ts` 版本 7，native Preferences + localStorage 双写，含旧 id 迁移 | ✅ 完整 |
| **生命周期** | `app/lifecycle.ts` 前后台切换暂停 rAF + 强制存档 + 音频挂起恢复 | ✅ 完整 |
| **UI** | 7 个面板模块（战斗 / 城镇 5 标签 / 英雄 4 段 / 开始页 / HUD / 对话框 / 音效）+ 主循环内 5 个（日志 / 菜单 / 设置 / 法术书 / 结算） | ✅ 完整 |
| **音效** | 11 种全程序化 WebAudio 合成（点击/行军/拾取/命中/射击/法术/建造/过天/胜/负/错误），零音频文件 | ✅ 完整 |
| **出包与装机** | Capacitor 安卓壳 + `androidsync.mjs` 逐文件 md5 校验；2026-09-21 真机安装并**从手机拉回包复核 md5 一致** | ✅ 已验证 |

---

## 3. 未完成 ❌（按后果排序）

### P0 · 结构性问题（有数据、没接线）

> ⚠️ **2026-10-13 复核订正**：#1 **已修**（见 §11.1）；#3 的**后果比原描述严重**（见 §13.2）。
> 本表保留原文以便对账，但**以 §13 的复核结论为准**。

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| **1** | ~~**四族共用同一套兵种树**~~ → **✅ 已修（2026-10-12）** | `buildings.ts` 的 `growth` 现在只写 `tier`（`dwell1~5` → tier 1..5）；`units.ts:259` `unitIdForTier(owner, tier)` 运行时按城镇 owner 解析；`town.ts:238` 接进 build / 周增长 / 征兵 | 四族只差配色和名字 —— 这是"内容差异"最大的单点缺口 |
| **2** | **画质档误判（G-15）** —— 旗舰机被自动探测判成 `low` 档，而 `low` 档把 vignette / 暖色叠层 / 水面反光 / 城镇辉光 / 布景全部关掉、`dprCap=1.5` | `render/quality.ts` `TIER_TABLE`；roadmap G-15「误判已 A/B 坐实，**修复从未排期**」 | **用户"画面没提升"的机制性原因**：他看到的正是"全都关掉"那一档。**2026-10-12 分类器已修，但真机档位仍未实测**（`adb devices` 空）⇒ 修了一半 |
| **3** | ~~**T5 单位只存在于数据表**~~ → **✅ 已修（2026-10-14 · TP-1）** | `unitArt.ts` 新增 `B3_FRAMES` 12 帧并入 `UNIT_FRAMES`（现 60 帧）；`b0audit` 14/14 PASS（含新增 `[C]`/`[M]` 覆盖闸）；战斗截图四单位本体 + 数量牌 + 血条齐全 | 每族最高阶兵种曾不可达。**⚠️ 两处订正**：原写"招了 T5 的英雄从地图上消失"**位置错了**（真后果在战斗侧，地图侧只跳徽标且徽标默认关）；且**现已补齐** |

### P1 · 内容缺失

| # | 问题 | 状态 |
|---|---|---|
| 4 | **音乐与环境音整块缺失（G-5）** —— `src/` 内 `bgm\|mp3\|ogg\|wav` 命中数 = **0** | 方向规格 `design/audio-direction.md`（505 行）已写、基调已拍板，**未见开工** |
| 5 | **喜剧布景层未落盘** —— 用户要"人物和地图有点搞笑"，人物侧已对齐（`cartoon-style.md §1.3`），地图侧的「喜剧布景层」规格**在 `design/` 下零命中** | 口径（D-17）**待用户选定**：① 只做单位 ② 新增布景层不动地形砖（推荐）③ 解冻环境层 |
  > **⚠️ 2026-10-14 订正："零命中"不成立。** `cartoon-style.md` **§6.1 整节**就是喜剧布景层规格（501 行起，V2.1 增补 · D-17 方案②），
  > 且**已落最小切片**：`src/render/setDressing.ts` + `quality.setDressing`（off/static/full）+ `MapRenderer` 接线（§6.1.3 位置：地形之后、水面之前）。
  > D-17 也已拍板（方案②）。剩下的是第 6 行的 B/C 组，不是"规格不存在"。 |
| 6 | **布景层只做了 A 组** —— 规格 17 型 / 38 帧，只落地 5 型地面贴花（B 组立体道具、C 组活动物明确"本切片不做"） | `render/setDressing.ts:9` |
| 7 | **资源 7 → 5（D-35）** —— 已拍板但"真减"未排期 | 连带存档格式、~104 处 / 14 文件、四族经济平衡重做 |
| 8 | **解锁选族（D-48）** —— 已拍板，工程侧无落地记录 |

### P2 · 体验缺口（用户原话对应，见 §4）

| # | 问题 |
|---|---|
| 9 | 横屏手机 UI 挤压（G-16）：开局页要滚 3.4 屏（G-13，scrollHeight 1584 vs clientHeight 360） |
| 10 | ~~UI 两套图标系统并存：图集像素精灵 vs emoji `🔇🔊🌗☀️`（G-17，已排期未做）~~ → **⚠️ 2026-10-14 订正：emoji 那一半已不存在。** `src/` 下 `🔇🔊🌗☀️` **零命中**（ripgrep 复核）；HUD 资源读数早已是图集 `ic_*` 像素图标（`ui/HUD.ts:40` `atlas.url('ic_'+k)`）。**残留文本符号仅两处**：`core/game/interaction.ts:238` 城防 `'★'.repeat(wall)`、`ui/HeroPanel.ts:374` 目标勾选 `☑/☐`（已标 `aria-hidden`，且注释说明不是唯一语义载体）。其余 ★ 命中**全是注释里的标记符**，不是 UI 文本。⇒ 图标化要按这份实际清单重排，别按旧描述。 |
| 11 | 紫晶种族被动 hook 缺失（Q-9，≈0.5 人日）—— 紫晶是唯一在 AI 对局里没有身份的族 |
| 12 | 单位配色 `body/accent` 是阵营主题色占位；`expValue` 是设计缺口（`races.md` 未规定经验值） |
| 13 | iOS 只规划未启动（`docs/architecture/ios-port-plan.md` 232 行，**所有 iOS 命令未实测**） |
| 14 | 发布前卫生：589 KB sourcemap + 4 个测试页被打进 APK；**keystore（Q-2）从未生成** |

### 未获准 / 待判（**不要当成已完成**）

> **2026-10-20 更新**：G5 那七条已逐条落判，见 `production/tp9/tp8/tp8-g5-verdicts.md`。下表每行都改成了「判词 + 依据 + 判完的后果」；**仍标 ⚠️/❌ 的三项不是"未判"，而是"有明确前置条件的具体动作"**（`#154` 差 ③ 同构建重测、真机走查卡在设备不在）。

| 项 | 状态 |
|---|---|
| `#158` ④ 光环"翻默认" | ✅ **2026-10-20 判「过」**（`tp8-g5-verdicts.md` §1）：两向机检 PASS（`default≡=1` 差 28≤69；`default≠=0` 差 678≥290）+ 压到单位的频率 **0.2%**（`ownBands≥3` = **0.0%**）⇒ 默认保持开。~~渲染帧腿未判~~（已补） |
| `#155` 雾侧轮廓闭合 | ✅ **2026-10-20 合判「过」**：结构 **274/274 全补**；可读性 **1.02:1 不过**，但**明确不修**（两条修法均越界：`(ii)` 4 条带=8px>6px 上限；`(i)` 需按外侧底色分支改着色）。①地图外缘仍不开 = 设计意图，非缺陷 |
| `#154` 光照修法 | ⚠️ **判「不过（2/3）」**：①翻默认 ✓ ②真重建 ✓ ③同构建 WCAG 重测 **✗**。判据已钉死成三行可执行条件（`tintab` 逐类×逐带，最大值 ≥3:1 + Σn 守恒 + `n<200` 未判），见 `tp8-g5-verdicts.md` §3 |
| `#156` 英雄栏 | ✅ **2026-10-20 判「过」**：`hpbudget` **13/13 PASS**；`hp-head` 实测 **82 ≤ 96**；「属性」段内滚 ✓；tab 条 `top=92` 四段逐位相同 |
| `#162` 启动图 | **自家管线已做到"26 档可复算缩放"**（`homm-web/assets/_pipeline/`：母图 land/port + 26 档 `drawable*/splash.png` + `variants_report.md`，最近邻 / PNG-8 ≤92 色），**只差交给工程接进 `android/.../res/`** —— 比 roadmap 原记的"母图未交"要进得多 |
| `#173` 接触日重取 | ✅ **判「过」**（新构建）：rush 中位 **5 天**（≤18）、control **>21**、两图同构 8/8 |
| 开局页 / 英雄栏独立验收 | ✅ **2026-10-21 判「过」**：`tools/iaaccept.mjs` **38 PASS / 0 FAIL / 3 未判、exit 0**（前置「文件 + 标志」早已在 2026-10-12 修好，上一版判"不可判"是继承旧结论）。附修**门自己假红**：旧 `bootGame` 就绪判据会被上一份文档满足 ⇒ 冷启首跑读回上一局存档、假报 9 项 FAIL；已加"文档已换 + 目标场景 id"两件判据，负向对照 15 红。（旧记的 `#142`/`#147` 是主理人自编号，与任务列表同号条目**不是一回事**） |
| 暗缝类三选一 | ✅ **2026-10-20 裁 (a-1) 双色 halo**（亮芯+暗边）：现状正午 1.16 / 夜 1.14、`≥3:1` 占比 **0.0%**；单色带必然在另一极失败（`草·亮` 夜 2.92、`草·深` 正午 2.33 两只反向样本）。**决策已落，实施未做** |
| 真机走查 | ❌ **判「不过（不可判）」**：`adb devices` 空 ⇒ 设备不在。阻塞是**硬件**不是判据；仍是 alpha 门准入项 |

---

## 4. 为什么停：用户反馈 vs 我们做了什么

权威出处：`design/ux/playtest-feedback.md`（用户原话逐字存档，F-1.x ~ F-3.9）。

**最关键的三句**（2026-09-21 08:30）：

> **F-3.7**：「试玩一圈下来，**1. 画面也没有什么提升，2. 可玩性也没有什么提升，3. 对手的智力也没有什么提升**」
>
> **F-3.8**：「接下来的工作可不可以主要在这几方面？提升画面简洁、画面质量……我们之前讨论的各种贴图、各种画质，试玩感觉不到有什么提升啊」
>
> **F-2.5**（上一轮）：「试玩下来，和前一版没什么感受到太大变化」

**我们的应对与结果：**

| 用户的"没提升" | 查到的根因 | 做到了吗 |
|---|---|---|
| 对手智力没提升 | ① `aiMarch` repath 功能性死锁 —— **AI 从不出现**（control 中位 >21 天、7/8 从不接触）→ `RUSH_BIAS=600` 后 rush 中位 **4 天**、8/8 全接触；② **用户玩的是旧包**（android assets 停在 07:20:34）→ `androidsync.mjs` 修 | ✅ 根因已修 |
| 画面没提升 | `G-15` 画质档误判：旗舰被判 `low`，`low` 档关掉全部氛围层 | ❌ **修复从未排期**（§3-P0-2） |
| 可玩性没提升 | 面板信息过载、要滚 8.4 屏、文字过多 | ◐ 部分：城镇面板 48→148px、英雄栏 660→369、遭遇框压 2 行、撤队伍徽标、可达染色；**开局页滚 3.4 屏（G-13）、图标化（F-3.5）未完** |

**结论**：最后 5 天里 78/101 条生产记录都花在**观感/门控/元纪律的迭代**上，玩家侧可感知的改动很少 —— 这与用户的判断一致，所以停止是合理的。

---

## 5. 当前构建健康度（2026-09-24 实测）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ **exit 0**，零错误 |
| `node tools/smoke.mjs` | ✅ **621 PASS / 0 FAIL / exit 0** |
| 15 道 `audit:*` 门 | ✅ **13 绿**（layout 640 局 / mines / hover / b0 / atlas / badge / hpbudget / haloflip / panelgate / androidsync 等） |
| `audit:touch` | ⚠️ **exit 1** —— 但失败点在**环境**：脚本结尾清理探针文件时被沙箱的批量删除护栏拦下（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），**不是产品缺陷** |
| `audit:scenario` | ⚠️ **exit 1** —— 浏览器探针异常（`Cannot read properties of null`），**未取得读数**，属"门没跑成"而非"门判不过" |
| `dist` 新鲜度 | ✅ 无 `src/` 文件新于 `dist/main.js` |
| 安卓 assets | ✅ `audit:androidsync` 逐文件 md5 一致，"可以出包" |

> ⚠️ **给接手者的警告（来自 `tools/GATES.md` 与 roadmap 的血泪记录）**：
> 门控的**退出码与判词可能脱钩**，已具名五种失效机制 —— 恒真计数、样本自带被测标记、**空跑即绿**、算出失败却 `exit 0`、**声明了纪律却没实现**（最危险，看注释看不出来）。
> 另外 `audit:ai` / `audit:ai-diag` 两个脚本**从不设退出码 ⇒ 恒 0**，"跑过"不代表 AI 没问题。
> **`b0audit` 存在已记录但未修的空集假绿**（`.every()` 作用于空数组）。

---

## 6. 已知风险与坑（给未来接手者）

**代码层**
- `unitArt.ts` 2,458 行 = 16 组手写绘制函数，**签名没有 tier/体量参数** ⇒ "Tier 通道"从未实现；剪影矩阵跨族等级倒挂 **35/120 对（29%）**（规格要求 0）。要修就得改 16 个函数签名。
  > **⚠️ 2026-10-14 订正：倒挂已修。** `b0audit` 断言 `[10] H2` 现为 **PASS**（cu 战斗帧 20 帧倒挂对=0 / map 地图帧 20 帧倒挂对=0）；
  > 且"签名没有 tier 参数"也已过时——`normalizeTier()` 按 `TIER_TARGET_PCT` 统一归一化（B0–B3 共 60 帧）。
  > （TP-1 后 `unitArt.ts` 已增至约 2,900 行、60 帧；16 组函数的说法对 B0/B1 仍成立。）
- T4 撞车风险：p1 T1↔T4 高宽比只差 **0.01**，只能靠占地与对称性区分。
- `spells.ts:139` 维度之门把 `isRevealed(state, 'p1', …)` 写死，非 p1 施法者揭雾判断错误。
- 战斗图集横向只剩 **10px** 余量 —— 加宽战斗帧或加单位前必须重跑 `audit:atlas`。
- 单位 `body/accent` 是阵营主题色**占位**；`expValue` 是**自陈的设计缺口**。

**流程层**
- **`src ≠ dist` 会让量测静默量到空**（`NOGO_EDGE_INK` 在 src 是 `'#2a1a12'`、在 dist 是 `'rgba(0,0,0,0)'`）—— 脚本不报错，只给一个错数。
- **不要用 shell `grep` 得出"零命中"结论**（BSD grep 不支持 `\|`，会静默返回空）；一律用 `rg`。
- **零命中 ≠ 零；命中 ≠ 在用**（命中可能是墓碑/历史行/取代横幅里的引用型残留）。
- 两个同名实例并发写同一文件会"互删成零"（发生过：`in-game-ia.md §15.4` 正文一度整体消失）。
- `loadConfig()` 会让老用户沿用旧值 ⇒ 新默认只触达首次启动。

**发布层**
- keystore 未生成；**一旦生成必须离线备份、绝不入库，丢失即永久失去更新权**。
- APK 内混入了 589 KB sourcemap 与 4 个测试页，发布前须剥离。

---

## 7. 如果将来重启：最低成本、最高可感知度的顺序

> 判据只有一个：**玩家在一局之内能不能感觉到差别**。

| 序 | 动作 | 预估 | 为什么先做 |
|---|---|---|---|
| **1** | **修 `G-15` 画质误判**（`TIER_TABLE` 探测修正） | ≈0.5 天 | 一行表格的事，但直接把"全都关掉"的旗舰机画面打开 —— 直击 F-3.7① |
| **2** | **四族兵种接线（段 2）**：`town.ts` 三处改用 `unitIdForTier(owner, tier)`，建筑表 growth 换 tier | ≈1 天 | 20 兵种已定义、16 个已有精灵，**只差接线** —— 内容差异最大单点 |
| **3** | **UI 减法收尾**：开局页滚 3.4 屏（G-13）+ 图标化（F-3.5/G-17，≈0.8 人日） | ≈1.5 天 | 直击 F-3.2 / F-3.5 / F-3.8② |
| 4 | **音乐（G-5）**：按 `design/audio-direction.md` 做程序化 BGM + 环境音 | ≈3–5 天 | 规格已就绪；"有声音"是最容易被感知的升级 |
| 5 | **T5 四兵种**（精灵 + 接线） | ≈2 天 | 补齐每族顶点 |
| 6 | 资源 7→5（D-35）+ 解锁选族（D-48） | 大 | 动存档格式，排到后面 |
| 7 | iOS | 大 | 触发条件（中端安卓稳定 ≥45fps 且降级未用尽）**未达成** |

**重启前必读**：`design/ux/playtest-feedback.md`（用户原话）→ `production/roadmap.md`（101 条逐日记录 + 72 条决策 D-xx）→ 本文档 §3。

---

## 8. 资产清单：东西都在哪

```
PROJECT-WRAPUP.md                      ← 本文件（收尾总账）
README.md                              ← 项目说明 + 玩法 + 调试入口
DESIGN.md                              ← 视觉重制记录（HOMM2 风格化）

design/gdd/            game-concept.md · races.md · maps.md
design/art-bible/      cartoon-style.md(834) · asset-spec.md(676) ·
                       silhouette-audit.md · visual-levers.md ·
                       bitmap-asset-options.md(395) · shots/（对照截图）
design/ux/             in-game-ia.md(1415 信息架构) · playtest-feedback.md(114 用户原话)
design/maps/           homm3-map-design-lessons.md · playtest-scenarios.md
design/                difficulty-spec.md(430) · audio-direction.md(505) ·
                       accessibility-requirements.md(741)
docs/architecture/     adr-mobile-first · mobile-platform · ai-development-diagnosis ·
                       android-build-runbook · ios-port-plan · static-guard-gaps
production/            roadmap.md(708 逐日流水) · playtests/2026-09-18.md

homm-web/src/          57 .ts / 21,104 行
homm-web/tools/        40 .mjs（GATES.md 是门控契约，务必先读）
homm-web/dist/         web 产物（构建 2026-09-21 16:28）
homm-web/android/      Capacitor 壳 + app-debug.apk（md5 6811bc41…）
```

**怎么跑起来**
```bash
cd homm-web
npm run dev        # 构建 + 本地服务 http://localhost:5173
npm run typecheck  # 类型检查
node tools/smoke.mjs   # 621 项核心逻辑断言
```
调试入口见 `README.md` 末尾（`?devbattle=1` / `?devquick=2&devseed=4242` / `?devreveal=1` / `?devzoom=0.5` …共 20 余个 `?dev*` 开关）。

---

## 9. 遗留物（2026-09-24 已裁定并清理）

**已按「脚本/文档入库、证据截图不入库」处理**（用户选定方案 ①）：

| 处置 | 内容 |
|---|---|
| ✅ **已提交** | `homm-web/tools/iaaccept.mjs`（门控"三项必打印"账本）+ `homm-web/assets/_pipeline/` 的 **10 个 .mjs 脚本 + `README.md` / `AUDIT.md` + 13 个 `splash-src/` 输入小图**（≈6 KB，合成启动图的原料） |
| 🚫 **已加入 `.gitignore`** | `tools/probes/*.png` 与 `tintab/`、`p1_tier_norm/`（观感与调色证据截图，**36 MB**，可重跑）· `_pipeline/out/`（26 档变体 PNG，脚本可复算）· `_pipeline/deliver/`（A/B 对照图）· `assets/ai-drafts/`（**2 张 AI 生成位图，授权状态不明 —— 位图线已停，不得商用**） |
| 📌 保留在磁盘 | 上面这些文件**一个都没删**，只是不再进版本库；想看证据照旧在 `homm-web/tools/probes/` 与 `homm-web/assets/_pipeline/out/` |

清理后 `git status` 应为**干净**。`.gitignore` 里给这批规则写了注释说明理由，免得后来人误以为是随手加的。

---

## 10. 一句话交代

5 天（09-17 → 09-21）、533 次提交、21k 行代码、26 份规格、40 个门控脚本、1 个在真机上安装成功的 APK —— 换来的是**一个核心闭环完整、但差异化和可感知度不足的原型**。

停止的原因不是"做不出来"，而是**最后阶段的工作集中在观感与门控的元迭代上，没有转成玩家能感觉到的变化**（F-3.7）。这个判断是对的，已经写进档，将来重启时就从 §7 的顺序开始。

---

## 10. 后续（2026-09-29 更新）

用户决定再试一次：**希望在这张 HoMM3 地图（`grims_broken_compass_2175`）上同时看到画质、可玩性、兵种差异、AI 战斗四项提升**。

已做完可行性探针：h3m 地形可读，并已渲染预览。详细 3 天 MVP 计划见 **`production/showcase-plan.md`**。

> ✅ **该计划已执行完**，结果见 §11；随后又按用户裁定做了 §12 的开局页精简与版式重整。
> 📌 **下一轮要做的事在 §13。**

## 11. 2026-10-08 ~ 2026-10-12「最后一轮」实测结果

这一轮按 `production/showcase-plan.md` 的 3 天 MVP 执行，目标是**在同一张地图上同时验证**画质、可玩性、兵种、AI 四项提升。执行后代码未推（SSH 反复 reset），但本地提交与测量已完成。

### 11.1 已落地 ✅

| 项 | 改动 | 证据 |
|---|---|---|
| 静态地图导入 | `grims-showcase` 40×40 地表导入为固定场景 | `homm-web/src/core/data/static-maps/grims-broken-compass.json`；`verify-static-map.mjs` 24 PASS / 0 FAIL |
| 四族兵种真正分家 | `buildings.ts` growth 改 `tier`；`town.ts` 用 `unitIdForTier(owner, tier)`；无静默 fallback | 开局存档：p1 灯兵/弩手、p2 拾荒者/投斧手、p3 矮人/荆棘弓、p4 石魔/火学徒；中立城狼/野猪；`smoke.mjs` 695 PASS |
| AI 接触日与 aggression | `RUSH_BIAS=600` + `commit` 乘 `aggression` 用于攻敌城/敌英雄 | `grimscontact.mjs` rush 中位 3 天、0/16 不接触；`grimsdiff.mjs` 三档难度资源差异可测 |
| 展示图可玩性 | 顶部目标清单 ≤3 条；开始页「试这张图」一键入口；首屏化 | `showcasegate.mjs` 15 PASS / NEG 全过 |
| 画质档分类器 G-15 | 修复「两帧 spike 把整档误判为 low」的 bug：用「超预算帧占比 >10%」降级 | `src/render/quality.ts`；`showcasegate.mjs` N4 负测通过 |
| grims 氛围基线 | 该场景强制开启 vignette/warmOverlay/waterGlint/townGlow/setDressing（与画质档解耦） | `src/render/MapRenderer.ts` |
| 两个阻塞修复 | ① low 档不再把 40×40 静态图夹成 32×32（`main.ts` `staticSized`）；② 展示图难度可改（`difficultyEditable`），教学/对决仍锁定 | `showcasegate.mjs` E-low/mid/high 全 40×40；F1/F2/F3 轻松/普通/困难可选且存档生效 |
| 截图证据 | 开始页（难度行可点）、正午/黄昏/深夜三态地图 | `homm-web/screenshots/day3-showcase-start-difficulty.png` / `day3-showcase-map-{noon,dusk,night}.png` |

### 11.2 仍未实测 / 仍红 ⚠️

| 项 | 状态 | 说明 |
|---|---|---|
| 真机画质档位 | **未实测** | `adb devices` 为空，无法复现用户那台旗舰机被判 `low` 的现场；只能证明浏览器端分类器逻辑已修、grims 氛围基线已强开 |
| `scenarioaudit.mjs` | ✅ **已修（见 §12）** | 原 3 FAIL 的根因是**探针的 bug**：教学块落在英雄面板「属性」段，而探针只开了默认的「部队」段就去找 `.hp-teach` ⇒ 恒 null。不是产品不渲染 |

### 11.3 构建健康度（当前）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `node tools/smoke.mjs` | ✅ **695 PASS / 0 FAIL / exit 0** |
| `node tools/showcasegate.mjs` | ✅ 15 PASS / NEG=1 全过 |
| `node tools/verify-static-map.mjs` | ✅ 24 PASS / 0 FAIL |
| `node tools/scenarioaudit.mjs` | ✅ 31 PASS / 0 FAIL / NEG=1 全过 |
| `node tools/tutorialgate.mjs` | ✅ 6 PASS / 0 FAIL / NEG=1 全过（§12 新增） |
| `node tools/iaaccept.mjs` | ✅ 38 PASS / 0 FAIL（3 项「未判」为探针自陈能力边界） |
| `node tools/hpbudget.mjs` | ✅ 14 PASS / 0 FAIL |
| `node tools/panelgate.mjs` | ✅ 10 PASS / 0 FAIL |
| `node tools/androidsync.mjs` | ✅ 133 文件逐 md5 一致 + 8 标记命中数相等，「可以出包」 |
| `audit:hover` | ⚠️ **偶发 rc=2**（CDP `Execution context was destroyed`）。加载的是独立 `_hoverprobe.html`，与开局页无关；连跑 3/3 全绿 ⇒ **既有抖动，非本轮引入，也未修** |

### 11.4 本轮结论

**单图 MVP 的代码侧已跑通**：同一张 40×40 图上可以看到四族不同兵种、AI 3 天内接触、三档难度真的生效、氛围层在黄昏/深夜可见。未闭环的只剩**真机复测**（需要手机连上 adb）。

---

## 12. 2026-10-12/13「开局页精简」—— 用户裁定后整篇重写

用户原话：

> 「开局页面还是显得有点繁琐。可能只要只需要地图尺寸，地图布局，几个对手，还有难度就可以了。地图种子就不用要了，试玩场景也不用要吧，你不选了没有对手，就是教学场景是不是，它是自动的，然后选了这些之后就可以点击开始新游戏。」

追问后进一步裁定：**「现阶段我更倾向于删除随机地图的选项，只保留教学模式和破碎罗盘，后续我们会增加更多地图」**，并确认最终形态 = **首次启动直接进教学（可跳过）+ 开始页只剩一张地图卡 + 一个难度**。

### 12.1 开局页：7 行 + 1 按钮 → 1 张卡 + 1 行 + 1 按钮

| 下线 | 去向 |
|---|---|
| 「领主名字」 | 用 `DEFAULT_CONFIG.playerName` |
| 「试玩场景」4 张卡 | 教学模式改**首次自动进入**（可跳过）；破碎罗盘成为开始页唯一那张卡 |
| 「地图尺寸」「地图布局」「电脑对手」 | 整条随机地图线从 UI 下线，只留 `?devquick=` 调试入口 |
| 「地图种子」+「换一个」 | 静态图每局同一张，种子失去意义 |
| 「试这张图」按钮 | 并入「开始」 |

新增：`?devstart=1`（跳过首次自动教学，**门控专用**——否则门跑在全新 profile 上会被生产路径直接带去教学局，开始页永不出现 ⇒ 成片假红）。

### 12.2 连带废掉 / 改写的门（**被测对象变了，尺子也得换**）

| 门 | 处置 |
|---|---|
| `scenarioaudit.mjs` | **整篇重写**：旧断言量的东西（场景卡 / 种子行 / 快照回滚）全部随场景行下线。新断言 = 开始页只剩难度行 + 地图卡、教学模式仍是那条减法路径、§14.2 banner 与 3/3 转移逻辑不变 |
| `showcasegate.mjs` | A 组从「证明减法生效」改为「证明没倒退回 2 次点击」；G 组对照面从「自由对局」换成 `?devscenario=tutorial/duel` |
| `tutorialgate.mjs` | **新增**。证首次自动教学的三环节：自动进 / 菜单能跳过 / **跳过之后不再回来**（③ 最易漏 —— 靠 `localStorage['homm-tutorial-done']`，不随存档走） |
| `hpbudget.mjs` | 场景卡没了 ⇒ 改走 `?devscenario=<id>`；顺带消掉原来 12s 空等 |
| `panelgate.mjs` | 入口 `?devstart=1`、按钮文案「开始新游戏」→「开始」 |
| `iaaccept.mjs` | 定点修（保留独立性）：入口换成 `?devscenario=` / `?devstart=1`；**构建标记换成本轮新 token** |
| `androidsync.mjs` | 标记「试玩场景」换成 `ss-mapcard` + `devstart` |

### 12.3 本轮抓到并修掉的三个**探针自身**的 bug（都不是产品缺陷）

1. **教学块只在「属性」段**（`HeroPanel.ts:156`），默认段是「部队」⇒ 不切段 `.hp-teach` 恒 null。这一个 bug 让 `scenarioaudit` 的 2 条、`iaaccept` 的 4 条**长期假红**。
2. **标记放错文件**：`devstart` 在 `main.ts` ⇒ 编译进 `main.js`，**不在** `ui/StartScreen.js`。第一版放错 ⇒ `androidsync` 阳性对照失败、恒红。这与该文件头自己记的「把标记全压 main.js」是**同型错误的镜像** —— 放错文件比不写更糟。
3. **`NO_PROXY`**：本机 shell 有 `HTTP_PROXY`，Node 的 undici 不因目标是 `127.0.0.1` 就绕过 ⇒ `iaaccept` 前置核对 `fetch failed` ⇒ 整门 `exit(2)`，而服务其实是好的。

### 12.4 一处有意的设计权衡

教学模式完成后的 banner 按钮从「去对决场」改成「**去破碎罗盘**」——教程之后只剩这一个目的地。`duel` 场景**定义仍留在 `scenarios.ts`**（代码路径没删），但从 UI 下线，只能靠 `?devscenario=duel` 进门做回归。

---

## 13. 下一 session 开工清单（2026-10-13 复核，带证据，免重新调查）

> 本节是**已复核**的结论：每条都给了文件:行号，可直接动手，不必再查一遍。
> 复核方式 = 读代码 + 跑门，不依赖本文档旧描述（旧描述有三处已过期，见 §3 订正）。

### 13.1 复核对账：这三条**已经修了，别重做**

| 项 | 证据 |
|---|---|
| 四族兵种分家（P0#1） | `buildings.ts:93-125` `growth` 只写 `tier`；`units.ts:259` `unitIdForTier`；`town.ts:238` 已接进 build/周增长/征兵；`smoke` 有"中立/未知 owner 不 fallback 到 p1"断言 |
| 开局页滚 3.4 屏（P2#9） | `showcasegate` B 组实测 `scrollRatio = 1` |
| AI 从不接触 / 难度形同虚设 | `grimscontact` rush 中位 3 天、0/16 不接触；`showcasegate` F2/F3 实测 easy 金3000/木12/矿12、hard 金1750/木7/矿7 真进存档 |

### 13.2 待办（按"玩家会撞见 × 修起来值不值"排序）

#### ① 【最优先】T5 一招募，英雄从地图上消失 —— 真 bug，不是缺内容

> **⚠️ 2026-10-14 复核订正（本条的位置判断是错的，后果本身成立）**：
> 当时把后果定位在**地图侧**（"英雄不画了"）—— **错**。逐行复核：
> `MapRenderer.ts:510` 的 `if (!g) return;` 位于 **`drawTeamBadge()` 内**，而该函数第一行就是
> `if (!this.badgesVisible) return;`（**徽标默认关**，`?devbadge` 才开）⇒ 缺帧只跳过**队伍徽标**，
> **不跳过英雄**。英雄本体在 `MapRenderer.ts:835` `blit(hero_${owner})` 先画，:837 才画徽标。
> ⇒ **地图侧英雄不会消失。** 真正的后果在**战斗侧**：`BattleRenderer.ts` 取不到 `cu_*` 帧即早退
> ⇒ T5 在战斗中只剩队伍色底盘圈（无精灵 / 无数量牌 / 无血条），且**当时无任何提示**。
> 该缺帧分支现已改为**告警而非静默**（本仓约定 warn 不 throw，throw = 白屏），并新增 `[C]`/`[M]` 两条覆盖闸。
> **T5 精灵本身已于 2026-10-14 由 TP-1 补齐**（12 帧，14/14 断言 PASS，战斗截图四单位齐全）。

**证据链（四步，已逐行读过）**：
```
buildings.ts:125    growth: { tier: 5, count: 2 }        ← dwell5 真能招 T5（可达！）
units.ts:61-166     p1_overangel 等在 UNITS 表内         ← pickRepresentativeUnit 认它
mapBadge.ts:129     cand.tier > best.tier ⇒ T5 恒赢      ← 代表兵种选中的就是 T5
MapRenderer.ts:508  frameName = `u_${cid}_map`
MapRenderer.ts:510  silOf(...) = null ⇒ return，不画     ← 【订正】只不画徽标；徽标默认关
```
**后果**：玩家建 dwell5、招「加班天使」⇒ **战斗中该兵种只剩队伍色底盘圈**（地图侧英雄正常）。
原文档写"不可达"是**错的**——可达，且后果重；但**写"英雄从地图上消失"也是错的**（见顶部订正）。
**修法**：给 4 个 T5 补程序化精灵帧（`u_*_map` + `cu_*` + `cu_*_atk`），
**参照 `src/render/unitArt.ts`**（B0/B1 已立好的范式：结构、命名、绘制辅助函数照抄，别另起一套）。
**不依赖任何外部条件**（不需要手机、不需要用户决策）⇒ 可立即开工。

#### ② 真机画质档位仍未实测 —— G-15 只修了一半，且只有用户能解

`render/quality.ts` 分类器 bug 已修（浏览器端验证过），grims-showcase 的氛围层也强开。
但**用户那台 OPPO PMA110 到底被判成哪一档，至今无人知道**（`adb devices` 为空）。
这是用户原话「画面也没有什么提升」的机制根源 ⇒ 在测到之前，修复对他是否生效是未知的。
**前置**：手机连 USB + 开开发者模式/USB调试。连上后：`adb devices` → 重测档位 →
`npm run mobile:sync` → 出包装回 → **从手机拉回包对 md5**（项目既有纪律）。

#### ③ keystore 从未生成 + APK 里混着测试页与 sourcemap

- `find . -name "*.keystore" -o -name "*.jks"` = **0** ⇒ 没有签名密钥就不能正式发版/更新
- `dist/main.js.map` 67 KB + `dist/_battle.html` / `_hoverprobe.html` / `_map.html` / `_siege.html`
  四个测试页，仍会被 `cap sync` 打进 APK（`dist/` 整个被复制）
不影响继续装 debug 包测试；想正经发布才是硬阻塞。

#### ④ 音乐与环境音整块缺失（用户要过"可玩性/氛围"）

规格 `design/audio-direction.md`（38,960 B）已写好、基调已拍板，**实现 0**（`src/` 下 0 个音频文件）。
现有 `src/ui/sfx.ts` 是 10 种程序化 WebAudio 音效 —— 管线是现成的，扩成 BGM + 环境音即可。
**动手前先读 `sfx.ts` 确认现状**，别凭假设写方案。

#### ⑤ 喜剧布景层未落盘（用户明确要过：「人物和地图有点搞笑风格」）

`design/` 下 `喜剧布景` / `comedy set` **零命中**。两个 art-director 队友被派过，
都因额度/网络耗尽没产出 ⇒ 任务实质未开始。
已知口径（D-17）三选一，**待用户选定**：① 只做单位 ② 新增布景层不动地形砖（推荐）③ 解冻环境层。
注意 `cartoon-style.md §3.1` 把环境层列为「不动（容差 ≤10%）」⇒ 选 ②/③ 都要先改那条规格。

#### ⑥ 教学模式跳过之后回不去（2026-10-13 用户提问引出）

用户问「现在哪里选教学模式？」才发现：跳过/有存档后，UI 上**再无教学入口**。
唯一入口是 `main.ts` 首次启动自动进入分支；菜单里只有「跳过教学」没有「重玩教学」。
三个方案（我推荐 A，**用户尚未选定**）：
A. 菜单加「重玩教学」——开始页保持极简，符合 IA「低频项归菜单」
B. 开始页加第二张卡——违背用户"不要这么多选项"的方向
C. 保持现状——只有首次能玩到

### 13.3 环境坑（跑门前必读，已在 `tools/GATES.md` §五 同步）

| 坑 | 正确做法 |
|---|---|
| `iaaccept.mjs` 打不到本地服务 | 必须 `NO_PROXY='*' no_proxy='*' node tools/iaaccept.mjs`（shell 有 `HTTP_PROXY`，Node undici 不绕过 127.0.0.1） |
| macOS **没有 `timeout`** | 别写 `timeout 400 npm run audit:x` ⇒ 每门 rc=127 |
| `audit:androidsync` 会清空 assets | 第 1 步就是 `npx cap sync android` ⇒ 删 `android/app/src/main/assets/public/`（133 文件/2.1M，gitignore 的 dist 拷贝、可重生）。**跑前先跟用户说清会删什么** |
| Chrome delete 权限弹窗 | **不是门要删文件**。`RLZ/RlzStore.plist` / `QuarantineEventsV2-journal` / `code_sign_clone/**` / `GoogleUpdater/updater.log.old`（后者是 2026-07-27 装好的系统 launchd 服务，与本项目无关）。**间歇性出现，flags 不能稳定消除** —— 别在注释里声称能消 |
| 查代码/规则别用 shell `grep 'A\|B'` | BSD grep 静默返回空。**今天连踩三次**。一律用 Grep 工具 / `rg` |

### 13.4 当前健康度（2026-10-13 实测，可直接作为回归基线）

`npx tsc --noEmit` exit 0 · `smoke` **695 PASS / 0 FAIL** · `showcasegate` **23 PASS** ·
`scenarioaudit` **31** · `tutorialgate` **6** · `iaaccept` **38** · `hpbudget` **14** ·
`panelgate` **10** · `androidsync` 133 文件逐 md5 一致 · `verify-static-map` **24**
`audit:hover` 偶发 rc=2（CDP 竞态，连跑 3/3 绿）⇒ **既有抖动，未修，别声称修好了**。
工作树干净、与 `origin/main` 同步（HEAD = `8acc7d7`）。
