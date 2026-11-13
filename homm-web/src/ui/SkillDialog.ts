import type { GameState, Hero } from '../core/types.js';
import { SKILLS, SKILL_MAX_LEVEL, SKILL_SLOTS } from '../core/data/skills.js';
import { heroSkills, learnSkill, pendingPicks, skillOffers } from '../core/game/skills.js';
import { closeModal, showModal } from './Dialogs.js';

const LEVEL_NAME = ['基础', '高级', '专家'];

/**
 * §21.9 · 副技能二选一弹窗（H5）。
 *
 * 三个必须成立的不变式（都有断言在 `probe:heroskills` 里）：
 *  ① 报价**可复现**：同一个英雄、同一投入点数 ⇒ 永远是那两条（`skillOffers` 按种子取；
 *     这里**不缓存、不重掷**，关掉再开还是同一对）；
 *  ② 已学满 3 级的技能不出现在报价里（选了也升不了）；
 *  ③ 学完**还有余点**就接着弹 —— 一次战斗连升两级时不能吞掉第二点。
 *
 * 为什么是弹窗而不是面板内选择：844×390 上英雄栏只有 184px 宽，
 * 两条技能 + 说明 + 槽位在那里无论如何放不下；而"升级那一刻"本来就是一个
 * 该停下来的时刻（§21.9 的"5 个点"就是 5 次决策）。
 */
export function openSkillPick(
  stage: HTMLElement,
  state: GameState,
  hero: Hero,
  onDone?: () => void,
): void {
  const picks = pendingPicks(hero);
  if (picks <= 0) {
    onDone?.();
    return;
  }
  const offers = skillOffers(state, hero);
  const learned = heroSkills(hero);

  const body: (Node | string)[] = [];
  const tip = document.createElement('p');
  tip.className = 'sk-tip';
  tip.textContent = `还剩 ${picks} 点 · 槽位 ${learned.length}/${SKILL_SLOTS}（每条最高 ${SKILL_MAX_LEVEL} 级）`;
  body.push(tip);

  const cards = document.createElement('div');
  cards.className = 'sk-cards';
  for (const id of offers) {
    const def = SKILLS[id];
    const cur = learned.find((s) => s.id === id)?.level ?? 0;
    const next = Math.min(SKILL_MAX_LEVEL, cur + 1);
    const card = document.createElement('button');
    card.className = 'btn sk-card';
    const name = document.createElement('b');
    name.textContent = `${def.name}${cur ? `（${LEVEL_NAME[cur - 1]}）` : ''}`;
    const eff = document.createElement('span');
    // 显示**选完之后**的效果，而不是当前效果：玩家是在为"下一级"做决定
    eff.textContent = `${cur ? '升级到' : '学会'} ${LEVEL_NAME[next - 1]}：${def.desc[next - 1]}`;
    card.append(name, eff);
    card.addEventListener('click', () => {
      if (!learnSkill(hero, id)) return;
      /* 最后一点花完就**收尾并关窗**，不能再靠递归走"picks ≤ 0 ⇒ onDone"那条路：
       * 那条路只回调、不重绘，屏幕上会留着这一对已经选完的卡片，
       * 而再点它们时 `learnSkill` 已返回 null ⇒ 看起来像"点了没反应"的死窗。
       * （`showModal` 内部 `host.innerHTML = ''`，所以递归本身不会叠窗。） */
      if (pendingPicks(hero) <= 0) {
        closeModal();
        onDone?.();
        return;
      }
      // 还有余点：重新打开 = 报价按新的投入点数重算
      openSkillPick(stage, state, hero, onDone);
    });
    cards.appendChild(card);
  }
  if (!offers.length) {
    const p = document.createElement('p');
    p.textContent = '六条副技能都到专家级了，没有可再升的项。';
    body.push(p);
  } else {
    body.push(cards);
  }

  if (learned.length) {
    const list = document.createElement('p');
    list.className = 'sk-owned';
    list.textContent = `已学：${learned
      .map((s) => `${SKILLS[s.id as keyof typeof SKILLS]?.name ?? s.id} ${LEVEL_NAME[s.level - 1]}`)
      .join(' · ')}`;
    body.push(list);
  }

  showModal(stage, {
    title: '副技能',
    body,
    // 「稍后再说」不是取消升级 —— 点还在（`skillPicks` 不减），面板里随时能再点开。
    actions: [{ label: '稍后再说', onClick: (c) => { c(); onDone?.(); } }],
  });
}
