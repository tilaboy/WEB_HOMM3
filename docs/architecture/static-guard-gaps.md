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

## 它解释的"那一类"是什么（本文档第 1 版把这条说大了，已改）

「读代码看不出来」**不是读得不仔细，是工具不报** —— 单看每一处都对（`badgesVisible = true` 人畜无害）。

但**必须把两类分开**，不能混为一谈（本文档第 1 版混了，被它自己的表推翻）：

| 类 | 形态 | 例子 | 发现方式 |
|---|---|---|---|
| **A · 没通电** | 声明了 / 建好了 / 进图集了，**但没人读它** | `badgesVisible` 不读 · `u_*_map` 无消费者 | 端到端（子集） · grep 零引用（可读码） |
| **B · 算错** | 被消费了，但**读的是错的东西** | `meleeStyle()` 读旧 id · `HERO_BODY` 手抄常量 | **读码 / 测量** |

⇒ 准确口径：**端到端是读码的补集，不是替代** —— **读码抓"算错"（B 类），端到端抓"没通电"（A 类）**，性质不同。
端到端**独占**能抓的是 A 类里的一个子集：**"有引用、但那个引用只是赋值、从不被读"** ——
`grep` / 读码都会命中那个赋值、看起来"它被用上了"，**只有通电才现形**（`badgesVisible` 即是：`main.ts` 里
`renderer.badgesVisible = false` ⇒ grep 有命中 ⇒ 看着像接上了）。
（而 `u_*_map` 那种**零引用**的，grep 直接就能看出"没人用"。）

## 结论 / 做法

- **A 类里"有引用却只是赋值"的那部分，系统性答案是"通电看灯"，不是"更聪明的读码"。**
  本会话由端到端抓到 / 验证的：`badgesVisible`（`?devnobadge` 是 no-op，通电才发现）、
  `b0audit` 断言 13（S3）、探针 A′ 前提断言、徽标因果 A/B。
- **不要用弱静态检查兜。** 试过一个"公开字段写而不读"的启发式扫描：**8 候选 / 0 真（假阳性 100 %）**
  —— 加为门只会天天误报（`centered` / `mouseX` 这类"模块级 `let` 恰好缩进在函数里"会被反复点名）。**噪音 ≠ 守卫。**
- **加端到端断言**：新增**可见元素** ⇒ 开 / 关 **因果 A/B**（同帧、冻结时间，diff 应恰好落在该元素 bbox）；
  新增**开关** ⇒ 断言它**确实改变结果**（而不只是被赋值）。
