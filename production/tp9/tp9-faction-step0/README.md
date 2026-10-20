# 四族差异化 Step 0 + Step 2 证据（2026-10-20）

对应设计与拍板：`production/faction-gameplay-review-2026-10-20.md` §11。
本轮落地：`growthPerWeek` 接活 · 英雄模板按族映射 · 赤焰「冲锋」动词 · 侧别偏置 probe。

> ⚠️ 本目录下的 `*.log` 被 `.gitignore` 忽略（项目惯例：证据目录只提交图片/文档）。
> 关键读数已经抄进本文与 §11，日志本身可用下面的命令随时复跑。

## 复跑命令

```bash
cd homm-web
npm run build
npm run probe:factionverbs        # node tools/probes/factionverbs.mjs
npm run probe:sidebias            # 报告模式（不判定退出码）
node tools/probes/sidebias.mjs --gate   # 闸模式（修好后接入）
npm run smoke
npm run audit:b0 && npm run audit:atlas && npm run audit:townart && npm run audit:neutral
```

## 退出码记录

| 项 | 退出码 | 说明 |
|---|---|---|
| `build` / `smoke` / `audit:b0` / `audit:atlas` / `audit:townart` / `audit:neutral` / `audit:scenario` / `audit:tutorial` | **0 / 0 / 0 / 0 / 0 / 0 / 0 / 0** | 本轮改动后全绿 |
| `probe:factionverbs`（正常） | **0** | 30/30 断言 |
| `probe:factionverbs`（深层桩） | **1** | 把 dist 里 `chargeAtkBonus` 首行改成 `return 0` ⇒ 5 条红 |
| `probe:sidebias`（报告模式） | **0** | 只诊断，不判定 |
| `probe:sidebias --gate` | **1** | 12 条对称性断言里 9 条红（已知缺陷，未修） |

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

AI 使用率（整军对局，30 seeds）：攻晨曦 **37%** / 攻翠林 **39%** / 攻紫晶 **54%** 的近战是"冲起来"的。

### 侧别偏置（整军镜像，60 seeds）

| 族 | 攻方胜率 | 贴脸对峙攻方胜率 | 首次近战由后动方拿到 |
|---|---|---|---|
| 晨曦 | 0% | 75% | 100% |
| 赤焰 | 65% | 92% | 100% |
| 翠林 | 78% | 68% | 0% |
| 紫晶 | 58% | 92% | 100% |

结论：**D1 走位让先 + D2 先手决定性**，两者叠加。详见 §11.2。

### 冲锋对矩阵的影响（2 周产量，60 seeds，攻方胜率%）

| 攻\守 | 晨曦 | 赤焰 | 翠林 | 紫晶 |
|---|---|---|---|---|
| 晨曦 | — | 8（旧 3） | 0 | 58 |
| 赤焰 | 100（98） | — | 0 | 100 |
| 翠林 | 100 | 83（92） | — | 37 |
| 紫晶 | 72 | **93（旧 52）** | 48 | — |

括号 = 未接动词时的旧值。`紫晶→赤焰` 的 41 点翻转见 §11.3。

## 深层桩复跑方法（负向对照）

```bash
cp dist/core/combat/battle.js /tmp/battle.bak
# 在 dist/core/combat/battle.js 的 chargeAtkBonus 首行插入： return 0;
node tools/probes/factionverbs.mjs ; echo $?   # 期望 1，且 [C1]/[C5]/[C6] 变红
cp /tmp/battle.bak dist/core/combat/battle.js  # 恢复
node tools/probes/factionverbs.mjs ; echo $?   # 期望 0
```
