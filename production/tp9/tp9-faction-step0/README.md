# 四族差异化 Step 0 + Step 2 证据（2026-10-20）

对应设计与拍板：`production/faction-gameplay-review-2026-10-20.md` §11。
本轮落地：`growthPerWeek` 接活 · 英雄模板按族映射 · 赤焰「冲锋」· 紫晶「弹跳袭击」· **晨曦「加班」** · 侧别偏置 probe · **D1 走位让先修复** · **D2 反击全额**。

> ⚠️ 本目录下的 `*.log` 被 `.gitignore` 忽略（项目惯例：证据目录只提交图片/文档）。
> 关键读数已经抄进本文与 §11，日志本身可用下面的命令随时复跑。

## 复跑命令

```bash
cd homm-web
npm run build
npm run probe:factionverbs        # node tools/probes/factionverbs.mjs
npm run probe:sidebias            # 报告模式（不判定退出码）
npm run probe:d1                  # D1 走位闸（= sidebias.mjs --gate=d1）
npm run probe:d2                  # D2 反击全额 + 攻方先手区间（= --gate=d2）
npm run smoke
npm run audit:b0 && npm run audit:atlas && npm run audit:townart && npm run audit:neutral
```

## 退出码记录

| 项 | 退出码 | 说明 |
|---|---|---|
| `build` / `smoke` / `audit:b0` / `audit:atlas` / `audit:townart` / `audit:neutral` / `audit:scenario` / `audit:tutorial` / `audit:score` | **0 × 9** | D1 改动后全绿 |
| `probe:factionverbs`（正常） | **0** | **49/49** 断言：[A] 周产 · [B] 英雄映射 · [C] 冲锋（20 条） · [D] 弹跳袭击（8 条） · **[E] 加班（11 条）** |
| `probe:factionverbs`（冲锋深层桩） | **1** | 把 dist 里 `chargeAtkBonus` 首行改成 `return 0` ⇒ 6 条红 |
| **`probe:factionverbs`（关掉 `noRetaliate`）** | **1** | dist `units.js` 里 `noRetaliate: true` → `false` ⇒ **[D] 4 条红** |
| **`probe:factionverbs`（删掉移动前提）** | **1** | 把 `actMelee` 条件里的 `u.moveDist > 0` 删掉 ⇒ **[D3] 1 条红** |
| **`probe:factionverbs`（关掉加班）** | **1** | dist 里 `overtimeAtkBonus` 首行 `return 0` ⇒ **[E] 4 条红** |
| **`probe:factionverbs`（反击不吃加班）** | **1** | `retaliationAtkBonus` 去掉加班项 ⇒ **只有 [E4] 1 条红**（证明这条断言是特异的） |
| `probe:sidebias`（报告模式） | **0** | 只诊断，不判定 |
| **`probe:d1`（正常）** | **0** | 9 条 D1 断言全绿 |
| **`probe:d1`（深层桩）** | **1** | dist `incomingAt` 首行 `return 0`（威胁区失效）⇒ **5 条红**：合计 68%、攻方首杀 25% |
| **`probe:d2`（正常）** | **0** | 14 条 D2 断言全绿（首击→反击 0.71~0.96、贴脸 45~70%、整军 63~85%） |
| **`probe:d2`（把 ×0.5 注回 dist）** | **1** | **7 条红**：首击→反击掉回 0.36~0.48，翠林整军 98% |
| **`probe:d2`（把同速排序改成洗牌）** | **1** | **3 条红**：回合首发 0 侧 49%、赤焰整军 30% |
| `probe:sidebias --gate`（D1+D2 一起） | **0** | 两个闸都绿；这条不再是"预期红" |

## 关键读数

### 周产（`applyWeeklyGrowth`，正常难度、无城墙加成）

| 族 | T1 兵种 | 改前 | 改后 |
|---|---|---|---|
| 晨曦 | `p1_lampbearer` | +10 | **+11** |
| 赤焰 | `p2_scavenger` | +10 | **+12** |
| 翠林 | `p3_dwarf` | +10 | **+10** |
| 紫晶 | `p4_stoneimp` | +10 | **+9** |

### 赤焰冲锋（固定种子 4242、赤焰 T3 狼骑 10 打晨曦 T1 20）

| 本回合移动 | 伤害 | 规则 |
|---|---|---|
| 0 格 | 60 | −1 |
| 1 格 | 63 | 0 |
| 2 格 | 63 | 0 |
| 3 格 | 68 | +2 |
| 5 格 | 68 | +2（不叠加） |

对照：晨曦 T3 同条件 **46 / 46 / 46**（无变化）；赤焰远程 T2 **44 / 44**（整条不参与）；反击 **16 / 16**（不吃冲锋）。

AI 使用率（整军对局，30 seeds，**D1 修后**）：攻晨曦 **19%** / 攻翠林 **39%** / 攻紫晶 **30%**，合计 **264/917 = 29%**。
（D1 修前是 37 / 39 / 54%。下降原因：AI 不再"走到最远格"，接战距离从 5~6 格缩到 1~2 格，
"跑 3 格再打"的机会窗口变少 —— 走位变聪明的代价，不是动词失效。`factionverbs` [C9] 因此改判**合计** ≥25%。）

### D1 走位让先（修前 / 修后，同一把尺子）

"推进了但没打出去"最后停在**近战敌人一步之内**的比例（= 把"走一步+打一下"白送）：

| 族 | 修前（深层桩复现） | 修后 |
|---|---|---|
| 晨曦 | 80% | **53%** |
| 赤焰 | 92% | **34%** |
| 翠林 | 54% | **39%** |
| 紫晶 | 65% | **51%** |
| **合计** | **68%** | **43%** |

配套读数：首次近战归**攻方**从 25% → **100%**；平局仍为 0；平均回合 8~12（未把仗拖长）。

> 旧诊断"AI 走到脸前结束回合"是**错的**（实测 `endAdjNoHit = 0`）：它停在离敌人 2 格处。
> 详见 §11.2 ①。

### 侧别偏置（整军镜像，60 seeds）

**修前**

| 族 | 攻方胜率 | 贴脸对峙攻方胜率 | 首次近战由后动方拿到 |
|---|---|---|---|
| 晨曦 | 0% | 75% | 100% |
| 赤焰 | 65% | 92% | 100% |
| 翠林 | 78% | 68% | 0% |
| 紫晶 | 58% | 92% | 100% |

**修后**

| 族 | 攻方胜率 | 贴脸对峙攻方胜率 | 首次近战归攻方 |
|---|---|---|---|
| 晨曦 | 90% | 75% | 100% |
| 赤焰 | 68% | 92% | 100% |
| 翠林 | 98% | 68% | 100% |
| 紫晶 | 63% | 92% | 100% |

结论：**D1 已修**（不再白送先手），**D2 未修**（贴脸 68~92% 原封不动）。
镜像胜率偏置没消失、只是翻了向 ⇒ 证明胜率主因是 D2。详见 §11.2 / §11.4。

### 冲锋对矩阵的影响（2 周产量，60 seeds，攻方胜率%）

> ⚠️ **D1 修前旧口径**，只留作"冲锋接入前后"的对照；D1 改走位后这些数已经过期。
> D2 修完前不重跑：镜像胜负是刀刃式（同一对局 60 个种子几乎同向），重跑只会把 100/0 换个方向，
> 读不出平衡信息。等 D2 落地、探针 `--gate` 能绿之后再重建这张表。

| 攻\守 | 晨曦 | 赤焰 | 翠林 | 紫晶 |
|---|---|---|---|---|
| 晨曦 | — | 8（旧 3） | 0 | 58 |
| 赤焰 | 100（98） | — | 0 | 100 |
| 翠林 | 100 | 83（92） | — | 37 |
| 紫晶 | 72 | **93（旧 52）** | 48 | — |

括号 = 未接动词时的旧值。`紫晶→赤焰` 的 41 点翻转见 §11.3。

## 深层桩复跑方法（负向对照）

```bash
# ① 动词桩（factionverbs）
cp dist/core/combat/battle.js /tmp/battle.bak
# 在 dist/core/combat/battle.js 的 chargeAtkBonus 首行插入： return 0;
node tools/probes/factionverbs.mjs ; echo $?   # 期望 1，且 [C1]/[C5]/[C6] 变红
cp /tmp/battle.bak dist/core/combat/battle.js  # 恢复
node tools/probes/factionverbs.mjs ; echo $?   # 期望 0

# ② 威胁区桩（probe:d1）
md5 -q dist/core/combat/battle.js > /tmp/md5.txt
# 在 dist/core/combat/battle.js 的 incomingAt 首行插入： return 0;
node tools/probes/sidebias.mjs --gate=d1 ; echo $?   # 期望 1，合计 68% / 攻方首杀 25%
cp /tmp/battle.bak dist/core/combat/battle.js
md5 -q dist/core/combat/battle.js | diff - /tmp/md5.txt && echo restored
# （或直接 npm run build 重建）
```
