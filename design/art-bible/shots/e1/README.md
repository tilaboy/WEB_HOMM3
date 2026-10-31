# E1 · 六角格缩格 + 地图默认缩放 1.0（2026-10-31）

本目录是 **E1 之后**的四张基线截图。E1 之前仓库里**没有**战斗/地图的几何基线
（`design/art-bible/shots/` 里那批 `a_* / b_* / c_* / i_* / k_*` 是地形与光照的 A/B 实验，
不是布局基线），所以这次是**新建**，没有覆盖任何旧图。

| 文件 | 口径 | 用途 |
|---|---|---|
| `battle-792x320.png` | 792×320 CSS @DPR3（OPPO PMA110 实测视口）· `?devbattle=1&devsiege=2` | 缩格后的手机战场：格宽 30.3、战场 469.8×297.5、`s = 1.0`（1:1，不再先缩再画） |
| `battle-desktop.png` | 1280×900 窗口 · 同一 URL | 桌面放大后的观感：格线在 1.9× 下是否还读得成"格子" |
| `map-792x320.png` | 792×320 @DPR3 · `?devquick=0&devsize=medium` | 地图默认 **zoom 1.0**（旧 1.2）：源像素 1:1，格线不再时粗时细 |
| `map-desktop.png` | 1280×900 窗口 · 同一 URL | 同上，桌面 |

## 这一批证明什么、不证明什么

- **证明**：几何落到了设计值（`probe:hexgeom` 的 469.795×297.5 / 格心 0.000px / 444 对共享边 0.000px 错位），
  且 792×320 下战斗画布不再被缩小（`audit:expr` 的 k 从 2.475 变成 **3.000** 设备 px/美术 px）。
- **不证明**："好不好看"。格子从 38 缩到 30.3 之后，`cf_*` 的 1px 暗边在整屏上占比变大，
  战场读起来比之前"线更密"——这是缩格的直接后果，属于美术判断（S3 阶段随地图/战场风格一起定），
  **不是**几何错误。真机试玩若读着"格线太重"，改的是 `combatAtlas.ts` 的 `hexFloor` 描边色，不动 `hex.ts`。

## 复现

```bash
npm run build
PORT=5199 node tools/serve.mjs          # 另一个终端
PORT=5199 node tools/deviceshot.mjs  out.png '<URL>' high     # 手机视口
PORT=5199 node tools/chromeshot.mjs  out.png '<URL>'          # 1280×900
node tools/probes/hexgeom.mjs                                 # 几何闸（纯 Node）
```
