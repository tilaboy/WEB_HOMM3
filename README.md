# 英雄之歌 · homm-web

A Heroes of Might and Magic II-style turn-based strategy game built from scratch in TypeScript and Canvas — zero runtime dependencies and zero art assets, with every terrain tile, building, unit and spell icon drawn procedurally into a sprite atlas at boot.

用 TypeScript + Canvas 从零写的网页版《魔法门之英雄无敌 2》风格策略游戏。
**零运行时依赖、零美术素材** —— 所有地形、建筑、单位、法术图标都是启动时用代码画进图集的。

```
npm run dev     # 构建 + 起本地服务，打开 http://localhost:5173
npm run build   # tsc 编译到 dist/
node tools/smoke.mjs   # 跑 293 项核心逻辑断言
```

## 它现在能玩什么

**冒险地图** 32×32 正交网格（32px 一格）。随机生成地形、18 组野怪、12 个宝箱、20 堆资源、4 处泉水、6 件地面宝物，1 座主城 + 3 座中立城。迷雾未揭，A\* 寻路带移动力消耗，英雄每回合走完就没点数了。野怪守着矿和宝物 —— 打赢才拿得到，撤退会退回上一格并清空当日移动力。

**城镇建设** 14 座建筑分三条线：居住（5 级兵种）、防御（3 级城墙）、魔法（3 级行会）。每周按增长池产兵，可招进部队或驻守城防，酒馆雇英雄、市场换资源。己方城镇不用英雄亲自跑回去，侧栏直接远程管理。

**战术战斗** 15×11 六边形战场。移动 + 攻击一回合兼得但不能走两次；反击每回合限一次、伤害减半；弓手全场可射，但被贴身不能放箭、弹道被挡减半、超远距离抛射减半。防御 / 等待 / 撤退。血量是 `(count-1)×hp + 队首残血` 的真实模型，击杀数是整数。

**魔法** 法力 = 知识 × 10，每天回满。12 个战斗魔法（伤害 / 时效增益 / 复活）+ 5 个冒险魔法（侦察 / 揭雾 / 回城 / 瞬移），从魔法行会学得。战前预估、自动战斗、亲手指挥跑的是同一个引擎、同一颗种子 —— 预估显示的数字就是 AI 真打出来的数字。

## 结构

```
homm-web/
  src/core/     纯逻辑，不碰 DOM
    combat/       hex.ts 六边形坐标 · battle.ts 战术引擎（唯一规则源）
    game/         交互 · 城镇 · 英雄 · 回合 · 冒险魔法
    data/         单位 8 · 建筑 14 · 法术 17 · 宝物 6 · 英雄模板
    map/          生成 · 寻路 · 迷雾
  src/render/   Canvas 渲染：pixel.ts 像素画布 · atlas.ts 程序化图集 · ortho.ts 正交投影
  src/ui/       HUD · HeroPanel（HOMM3 布局右侧查看器）· BattleScreen · TownDialog
  tools/        smoke.mjs 断言 · serve.mjs 零依赖静态服务 · postbuild.mjs
```

`core/` 完全不依赖 DOM，所以整套战斗规则能在 Node 里直接跑测试 —— 这是 293 项断言和数值平衡实验的基础。

## 两个设计取舍

**不做打包器。** esbuild 的原生二进制在这台机器上被系统策略拦了，索性用 `tsc` 直接输出 ESM，浏览器原生加载。代价是没压缩（JS 29KB / 全站 880KB，也无所谓），好处是构建链只有一个 TypeScript 依赖。

**规则只有一份。** 早期有个无位置的快速结算器用来出战前预估，结果预估、自动战斗、手动三者的数字会打架。现在它删了，三路都调 `quickBattle()` —— 同一个引擎、同一颗种子。

## 进度

M1 探索 · M2 城建 · M3 六边形战斗 · M4 魔法 已完成（存档 v5）。设计决策与数值实测记录在 `homm-web/DESIGN.md`。
M5（AI 领主）未开始，暂无电脑对手。

调试入口：`?devbattle=1` 直开战斗，`&devauto=1` 交给 AI，`&devinstant=1` 跳过动画，`&devspell=1` 展开法术面板，`?devarts=1` 展开宝物格。
