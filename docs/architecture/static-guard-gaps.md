# 静态守卫盲区：`noUnusedLocals` 不守 `public` 字段

> 作者：程基岩（技术 / 引擎） | 复现：下面最小用例，`tsc 5.9.3`
> 起因：D-64 接线期，「通了电没接负载」这一形状**第 4 次**出现
> （`badgesVisible` 声明了、也设了，但 `drawTeamBadge()` 不读它 ⇒ `?devnobadge` 是 no-op）。

## 事实（可复现）

本项目 `tsconfig.json` 开着 `noUnusedLocals: true`。用**同样的 flags** 编译下面这个最小用例：

```ts
class A {
  private unusedPriv = 1; // ✅ TS6133: 'unusedPriv' is declared but its value is never read.
  unusedPub = 2;          // ❌ 不报
}
```

⇒ **`noUnusedLocals` 只守 `private` 字段，不守 `public` 字段。**

而 `badgesVisible` **必须是 public**（`src/main.ts` 从外部 `renderer.badgesVisible = false` 来设），
**⇒ 它从设计上就落在 typecheck 的盲区里**。本仓**无 eslint**（`devDependencies` 只有 `@capacitor/*` 与 `typescript`）
⇒ **"public 字段 / 开关声明了却没人读"这个形状没有任何静态守卫。**

## 它解释了一整类现象

「读代码看不出来」**不是读得不仔细，是工具不报** —— 单看每一处都对（`badgesVisible = true` 人畜无害），
只有"通电看灯"能抓。本会话同类共 4 例，**全部由端到端抓到，读码一次都没抓到过**：

| 实例 | 存在 | 但 |
|---|---|---|
| `u_*_map` 48 帧 | 画好、进图集 | 地图上没人画 |
| `meleeStyle()` | 函数在、被调用 | 读的是旧 id |
| `HERO_BODY` | 探针在用 | 是手抄常量 |
| `badgesVisible` | 声明了、也设了 | `drawTeamBadge()` 不读 |

## 结论 / 做法

- **这一类的系统性答案是"通电看灯"，不是"更聪明的读码"。**
  本会话真正抓住它的都是**端到端断言**：`b0audit` 断言 13（S3）、探针 A′ 前提断言、徽标因果 A/B。
- **不要用弱静态检查兜。** 试过一个"公开字段写而不读"的启发式扫描：**8 候选 / 0 真（假阳性 100 %）**
  —— 加为门只会天天误报（`centered` / `mouseX` 这类"模块级 `let` 恰好缩进在函数里"会被反复点名）。**噪音 ≠ 守卫。**
- **加端到端断言**：新增**可见元素** ⇒ 开 / 关 **因果 A/B**（同帧、冻结时间，diff 应恰好落在该元素 bbox）；
  新增**开关** ⇒ 断言它**确实改变结果**（而不只是被赋值）。
