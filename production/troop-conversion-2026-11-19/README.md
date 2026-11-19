# 存量转换落地（决策 59 / spec §2.5 · 2026-11-19）

## 起因
上一批收口时留的最后一个已知缺口：**已招到手的基础版兵换不成升级版**。
规格其实早就写死了（§2.5 表「存量转换」、决策 59），但只有"兵营 L2 时池子免费转"
实现了，玩家部队那条路一直是空的。本批补上。

## 规则（照 spec，不自创）
- **价格 = 升级版单价 − 基础版单价，逐资源再 ×数量**。新增 `conversionCostOf()` 从两张
  `cost` 表实算，不写死 `基础价 × 0.2`：鹰 240→288 = 48 金；骑士 3 矿→`round(3×1.2)=4`
  矿 ⇒ 差价 **1 矿**，写 0.2 会把 0.6 矿取整成 0 或 1，都是错的。
- **解锁 = 本城对应 tier 兵营 L2+**，且该族升级形态已画（`upgradeUnlockedFor`）。
  复用 `dwellUnitId()` 的同一把尺，L1 城不给转。
- **只转本城本族**：p1 城不能替外族兵转换（owner 拿错钱、tier 对不上）。
- **不限数量、不占行动**：整格一次转完，不写 `builtDay`，不共享建造的"每日一次"。
- **失败零写入**：全部前置在 `canConvertStack()` 判完；`pay()` 不足不扣；
  测试逐字节比钱/部队/日志。
- **升级版已存在一格 ⇒ 合并**，不新增格（否则会顶到 `MAX_STACKS` 凭空失败）。
  踩过的坑：原地换 id 时先把 count 扣成 0 再 `splice` 会把兵删掉 —— 必须原地写回。

## 改动
- `src/core/data/units.ts`：`conversionCostOf(baseId)`。
- `src/core/game/town.ts`：`canConvertStack()` / `convertStack()` / `ConvertCheck` / `ConvertResult`。
- `src/ui/TownDialog.ts`：驻军页每格基础兵一行「转<升级名> 造价」；买不起/没升兵营
  时按钮禁用并把原因 inline 显示（触屏没有 hover，只放 title 等于没写）。
  新增 `?devnoconvert=1` 负向臂；`act()`→`say()` 已重绘，去掉一次多余 `opts.onChange()`。
- `src/style.css`：`.cv-wrap` / `.cv-why`（禁用原因 inline）。
- `tools/probes/upgrade.mjs`：F 段纯 Node 断言 —— 定价、整格转换、合并、**四条负向对照**
  （L1 / 差 1 金 / 外族兵 / 无形态兵种，全部拒绝且零写入）、不占建造次数。
- `tools/probes/townview.mjs`：U8 真 Chrome 断言（驻军页有按钮、造价写在标签上、点一下
  真的换帧）、N3 `devnoconvert=1` 按钮全消失。
- `tools/GATES.md`：`probe:townview` 行补 U7/U8 + N2/N3（闸门数仍 54）。

## 验收
- `probe:upgrade`：**PASS**，F 段 25 条断言全绿。
- `probe:townview --gate`：T0–T4 / N0 / U0–U8 / N1–N3 全过；实拍读数
  `按钮=1 可点=1 换帧=true 标签=["转连弩手 220 金"]`。
- 844×390 手机横屏实拍：`production/troop-conversion-2026-11-19/army-tab-844x390.png`
  —— 造价在按钮上、无重叠、触摸目标未变。
- 全量门：54 道逐条跑，见提交信息。

## 边界
- 中立怪没有升级形态，不进转换表（规格明写）。
- 转换只换兵种 id 与数值，不改速度；数值仍由 `makeUpgrade()` 的 §2.5 五条系数生成。
- 经济口径：这笔钱**不进** §27.5 的零升级基线（68% 那张表），验收脚本不许把它算进去。
