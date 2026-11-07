# S3c · p3 翠林五兵换树（体形档直画）

> 2026-11-07 · 自动部分全过；**五人盲测未做**（材料已生成）。
> 上游：S3a（p1 晨曦）/ S3b（p2 赤焰）同一条管线。本次只做 p3，**不碰 p4**。
> 相关文档：`s3b-p2-bodyplan-2026-11-06.md`（管线与 R5 换尺的出处）、`design/art-bible/asset-spec.md` §15.2 / §15.4 / §16.1。

---

## 1. 做了什么

把 p3 五个兵从「旧 `cu_p3_*` 帧 → 多数票缩图成 43×37 兵牌」切到 `BODY_PLAN` 直画树：

- 兵牌走 `buildPortraitFrame` 的 `bodyPlanTargetHeight()` 分支 ⇒ `drawBodyPlanUnit(..., { detail: 'card', fitHeight, bottomPad: 2 })`，**每兵只在最终像素高度上画一次，零重采样**。
- 旧 p3 帧（`cu_p3_thornarcher` / `cu_p3_vineguard` / `cu_p3_unicorn` 等）从 `B1/B2/B3_FRAMES` 退休，由新 `P3V3_FRAMES`（15 帧 = 5 兵 × map/idle/atk）顶替。
- `FRAME_ALIAS` 里 p3 的五行**删除**（`probe:frames` ⑥ 的期望值从「2 个恒等」改成「0 个恒等」——这是契约变更，不是放宽）。
- `FACE_LAW` 的 profile 行从 `cu_p3_unicorn` 换成 `cu_p3_greendragon`；`UNIT_CN` 换成新 p3 名。
- `TIER_OF` 修正：`p3_treant` 由 4 改 **3**（新阵容里它是 T3），并补 `p3_junglearcher: 2 / p3_ape: 4 / p3_greendragon: 5`。

## 2. 档位分配（照抄 §15.2 的 p3 行，不按 tier 顺排）

| 兵 | 档 | 声明 h | 实测 cu | 实测 w/h | 识别点 |
|---|---|---|---|---|---|
| `p3_dwarf` 矮人 | 矮 | 0.65 | 27×24 | 0.74 · h=0.66 | 大头 + 宽胡子 + 宽刃斧 |
| `p3_junglearcher` 丛林射手 | 中 | 0.88 | 29×32 | 0.80 · h=0.88 | **竖**长弓 + 叶披风（p1 是横弩） |
| `p3_treant` 树人 | 高 | 1.22 | 48×44 | 1.32 · h=1.21 | 树冠 + 开花 + 根系；**w 必须 <1.35h**，否则掉进宽体档 |
| `p3_ape` 猿人 | 宽体 | 0.95 | 61×35 | 1.68 · h=0.96 | 横张肩背 + 举石（R1 的机械判据只有 w≥1.35h，**不许真四足**） |
| `p3_greendragon` 绿龙 | 巨物·飞行 | 1.50 | 59×55 | 1.62 · h=1.51 | 长颈 + 横身 + 长尾 + 下掠翼 |

**绿龙与 p2 恶魔**：两者都是下掠翼（§16.1 明确 p3 没有翼向对比）。分家只靠**长颈 + 横身 + 长尾**，不靠翼向。代码注释里把旧的「四足长颈」改成「横身长颈长尾」——因为目检后腿改成两条折腿，再写「四足」就是文档骗人。

## 3. 代码改动

### 3.1 `src/render/unitBodyPlan.ts`

- `BODY_PLAN` 增 5 条 p3（见上表）。
- `BODY_PLAN_FAMILIES`：`['p1','p2']` → `['p1','p2','p3']`。
- 新增 `P3` 色板（全部 `B0_PALETTE` 字面值）：
  `cloth #1f7a45` / `trim #3fbe6e` / `leaf #6fc24a` / `leafDark #2f5a24` / `bark #5f4022` / `barkLite #a8703c` / `skin #d8a878` / `rock #cfc6b4` / `bloom #e0538f` / `ink #2a1a12` / `hi #ffffff`。
- 新增五个 `draw*`，签名与 p1/p2 一致（末尾 `card = false`），dispatch 加五个 case：
  `drawDwarf` / `drawJungleArcher` / `drawTreant` / `drawApe` / `drawGreenDragon`。
- 所有 `card` 分支只改**形状取舍**，不改坐标比例：删 <2px 特征、放大识别点、减少根/腿/叶脉、面部切 `cardFace`（只眼无嘴）。

### 3.2 `src/render/unitArt.ts`

- 旧 p3 三段帧块从 `B1/B2/B3_FRAMES` 退休（5 兵 × 3 帧）。
- 新增 `P3V3_FRAMES`：15 帧，槽位与其他族一致（map 52×44 / cu 64×56，锚点 −10/−12 与 −32/−48）。
- `UNIT_FRAMES` 追加 `...P3V3_FRAMES`；帧数注释修正为**真值** `B0 0 + B1 6 + B2 6 + B3 3 + B4 3 + P1V3 15 + P2V3 15 + P3V3 15 = 63`（旧注释写 78，比实际多 15 —— 属于「声明了却没实现」的计数，按项目规矩改成从数组现算的值）。
- `B0FrameSpec.unit` 联合类型补 `p3_junglearcher` / `p3_ape` / `p3_greendragon`（`p3_dwarf` / `p3_treant` 旧名已在）。

### 3.3 `src/render/unitFrames.ts`

- 删掉 p3 五行别名（`p3_junglearcher → p3_thornarcher` 等）。现在 `cu_p3_*` 是真帧，不再有「看的是旧图」的风险；只剩 p4 五行等 S3d。

### 3.4 工具与判据

| 文件 | 改动 |
|---|---|
| `tools/b0audit.mjs` | 引入并登记 `P3V3_FRAMES`（否则扫范围自检报 `48 ≠ 63`）。结论自动变成 `63 帧 = ... + P3v3 15`。 |
| `tools/bodyplanaudit.mjs` | 判词里的族名改为从 `BODY_PLAN_FAMILIES` **现算**（旧版写死「S3a p1 + S3b p2」，S3c 覆盖 p3 后仍打印上一轮）；`--png` 提示里的族与手册路径随之现算。 |
| `tools/probes/frames.mjs` | ⑥ 的期望从「2 个恒等」改「0 个恒等」，注释说明是契约变更。 |
| `tools/tp8exprtest.mjs` | `FACE_LAW`：`cu_p3_unicorn: profile` → `cu_p3_greendragon: profile`；`UNIT_CN` 换新 p3 名。 |
| `tools/probes/card.mjs` | 注释里「p3/p4 + 中立怪缩图」改为「S3c 后只剩 p4 + 中立怪缩图」。运行期判据不变：直画 15 帧 ≤35% / 缩图 8 帧 ≤15%。 |
| `tools/unitsheet.mjs` | `BATCHES` 增 `P3V3`，用法串补 `P3V3`。 |
| `tools/blindkit.mjs` | `FAMS` 增 p3 五兵（cn + 档）。 |
| `tools/GATES.md` | `audit:bodyplan` 行更新为 p1+p2+p3 = 15 兵 / 45 帧 + 15 张兵牌，并记下「判词族名现算」这条。 |

## 4. 色板：断言 8 的三次红

`b0audit` 断言 8 = 相邻不同材质 ΔL* ≥8；色相差 <30° 时 ≥12。首版 p3 全帧红，修了三轮：

1. **矮人**：`barkLite #a8703c` 的胡子高光贴 `cloth #1f7a45`，ΔL*=7.0（需 8）。
   → 换 `rock` 仍红：`rock ↔ skin #d8a878` ΔL*=7.9（ΔH 10° ⇒ 需 12）。
   → **最终删掉胡子高光**。胡子本体与斧刃的对比已经够，高光是 1px 装饰，不值得为它换材质。
2. **丛林射手**：`skin ↔ leaf` ΔL*=1.0、`skin ↔ trim` 3.4、`leaf ↔ trim` 2.4、`leafDark ↔ bark` 4.1 —— 四处同时红。
   → 领口加一圈 `cloth`（对脸 27 / 对叶 26）；叶披风顶边下移离开脸；删 1px 叶脉；躯干亮条从 `trim` 换 `bark`。
3. **结论**：p3 的绿色只留 `cloth`（万能中间调）和 `leaf`（亮档），`trim` **只贴 cloth**，`leafDark` **只贴 leaf / cloth**，`rock` 离脸远一点。这条已写进 `P3` 的注释。

## 5. 目检：四个「门抓不到」的形状问题

门的读数是「盒子、色板、表情签名、R5 漂移」，**没有一条量「看起来像不像」**。×8 总览 + ×12/×16 单张暴露了四处，全部改到能读为止：

### 5.1 丛林射手的弓 —— 改了三版

| 版本 | 画法 | 读成 |
|---|---|---|
| ① 原版 | 两段折线 + 1px **墨**弦 | **拐杖**：折点硬，墨弦在深色卡面上等于没画 |
| ② 第一改 | 四段平滑弧 + 弯度 0.13h + `rock` 弦 | **盾牌**：弦与弓臂之间只剩 ~1px，被描边灌满 |
| ③ 定稿 | 弯度 **0.20h** + 弓臂 **2px** + `rock` 弦画在所有身体形状之后 | **张开的 D**：中间留 4px 透空，43×37 上也一眼是弓 |

教训：像素级的「两张皮」形状，**间距必须 ≥3px 且不能被描边吃掉**；靠"更平滑"救不了，要拉大间距。

### 5.2 树人 —— 冠上的两团暗斑是「第二双眼睛」

原版在冠内上层放了两团对称 `leafDark` 椭圆，正好长在树皮脸的正上方，×12 读成一张闭着眼的脸 + 下面一张真脸。
→ 删掉暗斑，改成**错落的三簇 `bloom` 花**（兵牌一簇）。只给"开花的树"一条识别点，不制造任何左右对称的孔洞。`bloom ↔ leaf` ΔL*=15.1，断言 8 安全。

### 5.3 猿人 —— 从「桌子」改了两次

| 版本 | 画法 | 读成 |
|---|---|---|
| ① 原版 | 一条 ±0.74h 的**水平通栏** + 两根直腿 | **桌子**（头是桌上的罐子） |
| ② 第一改 | 两块斜肩楔子 + 脖子 + 一垂一举的臂 | **还是桌子**：两块楔子拼起来仍是一条通栏 |
| ③ 定稿 | **∧ 形拱顶**（无水平边）+ 左右圆肩头 + `barkLite` 胸斑 + 折肘长臂 + 折腿 | **宽肩猿** |

另外两处：
- 出手帧原本会同时出现**两块石头**（持石 + 脱手石）⇒ 改成同一颗石头换位置。
- s22（22×30）上前臂与拳只重叠 0.02h < 1px，取整后断成一颗孤立的点 ⇒ 重叠加到 0.09h。

### 5.4 绿龙 —— 翼读成斜杆、腿读成栅栏

原版翼膜是 `leafDark`（深色卡面上几乎看不见），只剩两条亮 `leaf` 斜线 ⇒ **两根斜杆**；四条等宽直腿 + 一条通栏腹亮边 ⇒ **栅栏 / 桌子**。
→ 翼膜换 `leaf`（亮）、翼骨换 `leafDark`（暗），并把所有翼点推到 |x| ≥ 0.30h 避开腿区；腹甲拆成三片短甲；四条直腿收成**两条折腿**（大腿 → 膝 → 胫 → 足）。

## 6. 门的读数（2026-11-07 定稿版）

| 门 | 结果 | 关键读数 |
|---|---|---|
| `audit:b0` | **rc=0** | 13 条自动断言全过；实扫 **63 帧**，含 `P3v3 15` |
| `audit:bodyplan` | **rc=0** | `[0]` 3 族 · 45 帧 + 15 张兵牌；`[1]` p3 五档独占；`[2]` p3 最差一对 treant/greendragon **20%**（门槛 18%）；`[3]` R5 p3 漂移 −2% / +3% / +3% / +1% / +3%（门槛 35%）；`[4]` 22×30 最接近一对 **41%**（门槛 15%）；`[N3]` 原样 0 / 拉宽 15 |
| `audit:expr` | **rc=0** | 7/7；profile 行已从独角兽换到绿龙 |
| `probe:frames` | **rc=0** | ⑥ 5 个真改名 + **0 个恒等** |
| `audit:atlas` | **rc=0** | — |
| `probe:card` | **rc=0** | ④ 23 帧：直画 15 ≤35% / 缩图 8 ≤15%，最大 23.0%（`cu_p1_eagle`）；⑥ 负向 124.1% > 35%；⑩ 立框 43×37 |
| `probe:touchtap` | **rc=0** | — |
| 全量回归 | **rc=0** | **60 门**（几何定稿后实测 2026-11-07 09:26 起）：`typecheck/build` + 全部 audit/probe/smoke + `grimscontact` 全绿。批跑里 `probe:uip0` / `probe:mapshadow` 各报一次 **rc=2**，日志明写「dev server 没在 5199 上跑」——是 5173 实例抢端口导致的设施故障、不是判据红；重启到 5199 后单独复跑**双双 rc=0**（`[sideclear-ctl]` 对照仍翻红、`[grounded]` 净效果 −19.4） |

## 7. 还欠什么

- [ ] **5 人 × p3 盲测**：材料已生成（`production/s3c/blind/`，`quiz-p3-t1..t5` 43×37 ×2 / `quiz22-*` / `study-p3.png` / `KEY.md`），**一次都没做**。手册 `blind/PROTOCOL.md`。
- [ ] **p3 跨族五对**：`blindkit --fam` 只接受单族，跨族页需另生成；目前未生成、未做。
- [ ] **真正的 H3 对照**：仓库里没有 H3 的兵种图 ⇒ 记「未做」，**不许写成「已通过」**。
- [ ] **`cu_p2_threewolf` 仍是"一个头"**：S3b 的遗留；必须与 `audit:expr` 的表情通道重标注一起改，不能单独改。
- [ ] **p4 的 10 张兵牌仍在缩图**（5 个兵 × cu/pt），等 S3d 换树后自动切到直画分支，函数不用再改。
- [ ] p1+p2 的五人盲测 0/5（S3a/S3b 起就欠着）。

## 8. 复现

```bash
cd homm-web
npm run build
npm run audit:b0
npm run audit:bodyplan
npm run audit:expr
npm run probe:frames
npm run probe:card
npm run probe:touchtap

# 肉眼验收（×8 单帧）
node tools/bodyplanaudit.mjs --png ../production/s3c --fam=p3
# 三行对照表（map / idle / atk）
node tools/unitsheet.mjs ../production/s3c/p3v3-sheet.png P3V3 6
# 盲测套件（注意：参数是空格分隔，不是 --out=...）
node tools/blindkit.mjs --out ../production/s3c/blind --fam p3 --testers 5 --seed 20261106
```

**验收图**：`production/s3c/cards-direct-2026-11-07.png`（5 张兵牌 ×5 + 1× 真尺寸条）、`production/s3c/p3v3-sheet.png`（15 帧三行表）。
