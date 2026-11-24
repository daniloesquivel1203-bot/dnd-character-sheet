/* D&D 5e character sheet — plain JS, no build step. Data lives in localStorage. */
'use strict';

// ---------- constants ----------
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dex'], ['animal-handling', 'Animal Handling', 'wis'], ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'], ['deception', 'Deception', 'cha'], ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'], ['intimidation', 'Intimidation', 'cha'], ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'], ['nature', 'Nature', 'int'], ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'], ['persuasion', 'Persuasion', 'cha'], ['religion', 'Religion', 'int'],
  ['sleight-of-hand', 'Sleight of Hand', 'dex'], ['stealth', 'Stealth', 'dex'], ['survival', 'Survival', 'wis'],
];
const TABS = [['info', 'Info'], ['stats', 'Stats'], ['hp', 'HP'], ['rolls', 'Rolls'], ['items', 'Items'], ['spells', 'Spells'], ['story', 'Story']];
const STORE_KEY = 'dnd-sheet-v1';
const SRD = window.SRD || { classes: {}, spells: [] };
const SPELL_BY_NAME = Object.fromEntries(SRD.spells.map(s => [s.n, s]));

// ---------- storage ----------
let db = load();
let view = { screen: 'list', id: null, tab: 'info', rollMode: 'normal', openSpell: null, spellSearch: '', spellClassOnly: true };

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.characters)) return d;
  } catch (e) { /* ignore */ }
  return { characters: [] };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Could not save: ' + e.message); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function newCharacter() {
  return {
    id: uid(), name: 'New character', race: '', background: '', alignment: '', cls: 'fighter', clsName: '', subclass: '',
    level: 1, xp: 0, ac: 10, speed: 30, initMisc: 0, inspiration: false,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProf: {}, skills: {}, // skills: 0 none, 1 proficient, 2 expertise
    hp: { max: 10, cur: 10, temp: 0 }, hitDiceUsed: 0, deathSaves: { s: 0, f: 0 },
    attacks: [], items: [], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    spell: { ability: '', override: false, slotsMax: [0, 0, 0, 0, 0, 0, 0, 0, 0], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], list: [] },
    backstory: '', personality: '', proficiencies: '', features: '', notes: '',
    log: [],
  };
}
// Fill any fields missing from older saves
function normalize(c) {
  const d = newCharacter();
  for (const k in d) if (c[k] === undefined) c[k] = d[k];
  for (const k of ['abilities', 'hp', 'deathSaves', 'coins', 'spell']) c[k] = Object.assign({}, d[k], c[k]);
  return c;
}
db.characters.forEach(normalize);

function cur() { return db.characters.find(c => c.id === view.id); }

// ---------- rules math ----------
const mod = score => Math.floor((Number(score) - 10) / 2);
const fmt = n => (n >= 0 ? '+' : '') + n;
const prof = c => Math.ceil(clampLevel(c.level) / 4) + 1;
const clampLevel = l => Math.min(20, Math.max(1, Number(l) || 1));
const classData = c => SRD.classes[c.cls];
const className = c => (classData(c) ? classData(c).name : (c.clsName || 'Custom'));
const saveBonus = (c, a) => mod(c.abilities[a]) + (c.saveProf[a] ? prof(c) : 0);
const skillBonus = (c, key) => {
  const sk = SKILLS.find(s => s[0] === key);
  return mod(c.abilities[sk[2]]) + (c.skills[key] || 0) * prof(c);
};
const initiative = c => mod(c.abilities.dex) + (Number(c.initMisc) || 0);
const castAbility = c => c.spell.ability || (classData(c) && classData(c).castAbility) || '';
const spellDC = c => castAbility(c) ? 8 + prof(c) + mod(c.abilities[castAbility(c)]) : null;
const spellAtk = c => castAbility(c) ? prof(c) + mod(c.abilities[castAbility(c)]) : null;
function slotsMax(c) {
  if (c.spell.override) return c.spell.slotsMax.map(n => Number(n) || 0);
  const cd = classData(c);
  return (cd && cd.slots[clampLevel(c.level)]) || [0, 0, 0, 0, 0, 0, 0, 0, 0];
}
function attackHit(c, a) {
  const abil = a.ability ? mod(c.abilities[a.ability]) : 0;
  return abil + (a.prof ? prof(c) : 0) + (Number(a.bonus) || 0);
}
function attackDmg(c, a) {
  const abil = a.ability && a.addMod !== false ? mod(c.abilities[a.ability]) : 0;
  const base = (a.dmg || '').trim() || '0';
  return abil ? `${base}${abil >= 0 ? '+' : ''}${abil}` : base;
}

// Live-updating computed values (used so typing never forces a full re-render)
const CALC = {
  mod: (c, a) => fmt(mod(c.abilities[a])),
  save: (c, a) => fmt(saveBonus(c, a)),
  skill: (c, k) => fmt(skillBonus(c, k)),
  prof: c => fmt(prof(c)),
  init: c => fmt(initiative(c)),
  pp: c => 10 + skillBonus(c, 'perception'),
  dc: c => spellDC(c) ?? '—',
  satk: c => spellAtk(c) === null ? '—' : fmt(spellAtk(c)),
  hit: (c, i) => c.attacks[i] ? fmt(attackHit(c, c.attacks[i])) : '',
  dmg: (c, i) => c.attacks[i] ? attackDmg(c, c.attacks[i]) : '',
  hd: c => `${clampLevel(c.level) - c.hitDiceUsed}/${clampLevel(c.level)} d${hitDie(c)}`,
  weight: c => c.items.reduce((t, it) => t + (Number(it.weight) || 0) * (Number(it.qty) || 0), 0).toFixed(1).replace(/\.0$/, ''),
};
function updateCalcs() {
  const c = cur(); if (!c) return;
  document.querySelectorAll('[data-calc]').forEach(el => {
    const [k, arg] = el.dataset.calc.split(':');
    el.textContent = CALC[k](c, arg);
  });
}
const hitDie = c => (classData(c) ? classData(c).hitDie : (Number(c.hitDieCustom) || 8));

// ---------- dice ----------
// Supports expressions like "d20", "2d6+3", "1d8+1d6-1", "4d6kh3" (keep highest)
function rollExpr(expr) {
  const clean = String(expr).replace(/\s+/g, '').toLowerCase();
  if (!clean) throw new Error('Empty roll');
  const terms = clean.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== clean) throw new Error('Bad roll: ' + expr);
  let total = 0; const parts = []; let d20 = null;
  for (const t of terms) {
    const sign = t[0] === '-' ? -1 : 1;
    const body = t.replace(/^[+-]/, '');
    let m;
    if ((m = body.match(/^(\d*)d(\d+)(?:k([hl])(\d+))?$/))) {
      const n = Math.min(Number(m[1] || 1), 100), sides = Number(m[2]);
      if (!sides) throw new Error('Bad die: ' + t);
      let rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      let kept = rolls;
      if (m[3]) {
        const k = Number(m[4]);
        kept = [...rolls].sort((a, b) => m[3] === 'h' ? b - a : a - b).slice(0, k);
      }
      const sum = kept.reduce((a, b) => a + b, 0);
      total += sign * sum;
      if (sides === 20 && n === 1 && !m[3]) d20 = rolls[0];
      parts.push(`${sign < 0 ? '-' : (parts.length ? '+' : '')}${n}d${sides}${m[3] ? 'k' + m[3] + m[4] : ''}[${rolls.join(',')}]`);
    } else if (/^\d+$/.test(body)) {
      total += sign * Number(body);
      parts.push(`${sign < 0 ? '-' : (parts.length ? '+' : '')}${body}`);
    } else throw new Error('Bad roll: ' + t);
  }
  return { total, detail: parts.join(' '), d20 };
}

// d20 check respecting the advantage/disadvantage toggle
function rollD20(label, bonus) {
  const mode = view.rollMode;
  const a = 1 + Math.floor(Math.random() * 20);
  const b = 1 + Math.floor(Math.random() * 20);
  const pick = mode === 'adv' ? Math.max(a, b) : mode === 'dis' ? Math.min(a, b) : a;
  const total = pick + bonus;
  const dice = mode === 'normal' ? `d20[${a}]` : `2d20${mode === 'adv' ? 'kh' : 'kl'}[${a},${b}]`;
  let note = pick === 20 ? ' — NAT 20!' : pick === 1 ? ' — nat 1' : '';
  record(`${label}${mode !== 'normal' ? ` (${mode === 'adv' ? 'adv' : 'dis'})` : ''}`, total, `${dice} ${fmt(bonus)}${note}`);
  if (mode !== 'normal') { view.rollMode = 'normal'; syncRollMode(); }
  return { total, nat: pick };
}
function rollFree(label, expr) {
  try {
    const r = rollExpr(expr);
    record(label || expr, r.total, r.detail);
    return r;
  } catch (e) { toast(e.message); return null; }
}
function record(label, total, detail) {
  const c = cur();
  const entry = { label, total, detail, t: Date.now() };
  if (c) { c.log.unshift(entry); c.log.length = Math.min(c.log.length, 50); save(); }
  showRoll(entry);
  const logEl = document.getElementById('roll-log');
  if (logEl) logEl.innerHTML = renderLog(c);
}

// ---------- UI helpers ----------
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show';
  clearTimeout(toast.t); toast.t = setTimeout(() => el.className = 'toast', 2500);
}
function showRoll(e) {
  const el = document.getElementById('roll-result');
  el.innerHTML = `<div class="rr-label">${esc(e.label)}</div><div class="rr-total">${e.total}</div><div class="rr-detail">${esc(e.detail)}</div>`;
  el.className = 'roll-result show';
  clearTimeout(showRoll.t); showRoll.t = setTimeout(() => el.className = 'roll-result', 4500);
}
function syncRollMode() {
  document.querySelectorAll('[data-rollmode]').forEach(b => b.classList.toggle('on', b.dataset.rollmode === view.rollMode));
}
// Input bound to a dotted path on the current character, e.g. data-bind="abilities.str"
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, val) {
  const ks = path.split('.'); const last = ks.pop();
  const tgt = ks.reduce((o, k) => o[k], obj); tgt[last] = val;
}
function inp(path, opts = {}) {
  const c = cur(); const v = getPath(c, path);
  const type = opts.type || (typeof v === 'number' ? 'number' : 'text');
  const extra = type === 'number' ? ' inputmode="numeric"' : '';
  return `<input type="${type}"${extra} data-bind="${path}" value="${esc(v)}" ${opts.attrs || ''} placeholder="${esc(opts.ph || '')}">`;
}
function area(path, rows = 6, ph = '') {
  return `<textarea data-bind="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(getPath(cur(), path))}</textarea>`;
}
function check(path, label) {
  return `<label class="chk"><input type="checkbox" data-bind="${path}" ${getPath(cur(), path) ? 'checked' : ''}> ${label}</label>`;
}

// ---------- rendering ----------
function render() {
  if (view.screen === 'list' || !cur()) { view.screen = 'list'; $app.innerHTML = renderList(); return; }
  const c = cur();
  $app.innerHTML = `
    <header class="top">
      <button data-act="back" class="icon" aria-label="Back">‹</button>
      <div class="title"><b>${esc(c.name)}</b><small>Lv ${clampLevel(c.level)} ${esc(className(c))}${c.subclass ? ' · ' + esc(c.subclass) : ''}</small></div>
      <div class="hpchip">${c.hp.cur}/${c.hp.max}${c.hp.temp ? ` +${c.hp.temp}` : ''} HP</div>
    </header>
    <nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${view.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <main class="tab">${TAB_RENDER[view.tab](c)}</main>`;
}

function renderList() {
  const list = db.characters.map(c => `
    <li><button class="charbtn" data-open="${c.id}">
      <b>${esc(c.name)}</b>
      <span>Level ${clampLevel(c.level)} ${esc(c.race)} ${esc(className(c))}${c.subclass ? ' (' + esc(c.subclass) + ')' : ''}</span>
      <span>HP ${c.hp.cur}/${c.hp.max} · AC ${esc(c.ac)}</span>
    </button></li>`).join('');
  return `
    <header class="top"><div class="title"><b>Characters</b></div></header>
    <main class="tab">
      ${db.characters.length ? `<ul class="charlist">${list}</ul>` : '<p class="muted">No characters yet. Create one to get started.</p>'}
      <button class="primary wide" data-act="new">+ New character</button>
      <section class="card">
        <h3>Backup</h3>
        <p class="muted">Characters are saved on this device only. Export a backup file to move them to another device (phone ⇄ tablet) or keep them safe.</p>
        <div class="row">
          <button data-act="export-all">Export all</button>
          <label class="btn">Import file<input type="file" accept=".json,application/json" data-act="import" hidden></label>
        </div>
      </section>
      <p class="muted small">Rules data: D&amp;D 5e System Reference Document 5.1 (CC-BY-4.0).</p>
    </main>`;
}

const TAB_RENDER = {
  info(c) {
    const classOpts = Object.entries(SRD.classes).map(([k, v]) => `<option value="${k}" ${c.cls === k ? 'selected' : ''}>${v.name}</option>`).join('')
      + `<option value="custom" ${!classData(c) ? 'selected' : ''}>Other / homebrew…</option>`;
    const subs = classData(c) ? classData(c).subclasses : [];
    return `
      <section class="card grid2">
        <label class="span2">Name ${inp('name')}</label>
        <label>Class <select data-bind="cls" data-rerender>${classOpts}</select></label>
        <label>Level <input type="number" inputmode="numeric" min="1" max="20" data-bind="level" value="${esc(c.level)}" data-rerender></label>
        ${!classData(c) ? `<label>Class name ${inp('clsName', { ph: 'e.g. Artificer' })}</label><label>Hit die (d#) ${inp('hitDieCustom', { type: 'number', ph: '8' })}</label>` : ''}
        <label class="span2">Subclass ${inp('subclass', { attrs: 'list="subclass-list"', ph: subs.length ? 'SRD: ' + subs.join(', ') + ' — or type any' : 'Type your subclass' })}</label>
        <datalist id="subclass-list">${subs.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <label>Race / species ${inp('race')}</label>
        <label>Background ${inp('background')}</label>
        <label>Alignment ${inp('alignment')}</label>
        <label>XP ${inp('xp', { type: 'number' })}</label>
      </section>
      <section class="card grid3">
        <label>AC ${inp('ac', { type: 'number' })}</label>
        <label>Speed ${inp('speed', { type: 'number' })}</label>
        <div class="stat"><span>Proficiency</span><b data-calc="prof">${fmt(prof(c))}</b></div>
        <div class="stat"><span>Initiative</span><b data-calc="init">${fmt(initiative(c))}</b></div>
        <label>Init. misc bonus ${inp('initMisc', { type: 'number' })}</label>
        <div class="stat"><span>Passive Perc.</span><b data-calc="pp">${CALC.pp(c)}</b></div>
        <div class="span3">${check('inspiration', 'Inspiration')}</div>
      </section>
      <section class="card">
        <h3>Proficiencies &amp; languages</h3>${area('proficiencies', 3, 'Armor, weapons, tools, languages…')}
        <h3>Features &amp; traits</h3>${area('features', 6, 'Class features, racial traits, feats…')}
      </section>
      <section class="card row">
        <button data-act="export-one">Export this character</button>
        <button data-act="duplicate">Duplicate</button>
        <button class="danger" data-act="delete">Delete</button>
      </section>`;
  },

  stats(c) {
    const abil = ABILITIES.map(a => `
      <div class="abil">
        <button class="rollable" data-roll-check="${a}"><span>${ABILITY_NAMES[a]}</span><b data-calc="mod:${a}">${fmt(mod(c.abilities[a]))}</b></button>
        <input type="number" inputmode="numeric" data-bind="abilities.${a}" value="${esc(c.abilities[a])}" aria-label="${ABILITY_NAMES[a]} score">
      </div>`).join('');
    const saves = ABILITIES.map(a => `
      <li><input type="checkbox" data-bind="saveProf.${a}" ${c.saveProf[a] ? 'checked' : ''} aria-label="Proficient">
        <button class="rollable line" data-roll-save="${a}"><span>${ABILITY_NAMES[a]}</span><b data-calc="save:${a}">${fmt(saveBonus(c, a))}</b></button></li>`).join('');
    const skills = SKILLS.map(([k, n, a]) => `
      <li><button class="prof p${c.skills[k] || 0}" data-cycle-skill="${k}" title="Tap: none → proficient → expertise">${['○', '●', '◆'][c.skills[k] || 0]}</button>
        <button class="rollable line" data-roll-skill="${k}"><span>${n} <small>(${a.toUpperCase()})</small></span><b data-calc="skill:${k}">${fmt(skillBonus(c, k))}</b></button></li>`).join('');
    return `
      ${rollModeBar()}
      <p class="muted small">Tap any modifier to roll it. Edit the score in the box.</p>
      <section class="card abilgrid">${abil}</section>
      <section class="card"><h3>Saving throws</h3>
        ${classData(c) ? `<button class="small" data-act="class-saves">Use ${esc(className(c))} saves (${classData(c).saves.map(s => s.toUpperCase()).join(', ')})</button>` : ''}
        <ul class="plist">${saves}</ul></section>
      <section class="card"><h3>Skills</h3><p class="muted small">○ none · ● proficient · ◆ expertise</p><ul class="plist">${skills}</ul></section>`;
  },

  hp(c) {
    const ds = (k, n) => Array.from({ length: 3 }, (_, i) => `<button class="pip ${c.deathSaves[k] > i ? 'on' : ''}" data-death="${k}:${i + 1}" aria-label="${n} ${i + 1}"></button>`).join('');
    return `
      <section class="card hpbox">
        <div class="hpbig"><b>${c.hp.cur}</b><span>/ ${c.hp.max}</span>${c.hp.temp ? `<em>+${c.hp.temp} temp</em>` : ''}</div>
        <input type="number" inputmode="numeric" id="hp-amt" placeholder="Amount">
        <div class="row">
          <button class="danger" data-hp="dmg">Damage</button>
          <button class="primary" data-hp="heal">Heal</button>
          <button data-hp="temp">Set temp</button>
        </div>
      </section>
      <section class="card grid3">
        <label>Max HP <input type="number" inputmode="numeric" data-bind="hp.max" value="${esc(c.hp.max)}" data-rerender></label>
        <label>Current <input type="number" inputmode="numeric" data-bind="hp.cur" value="${esc(c.hp.cur)}" data-rerender></label>
        <label>Temp <input type="number" inputmode="numeric" data-bind="hp.temp" value="${esc(c.hp.temp)}" data-rerender></label>
      </section>
      <section class="card">
        <h3>Hit dice <small data-calc="hd">${CALC.hd(c)}</small></h3>
        <div class="row">
          <button data-act="spend-hd" ${c.hitDiceUsed >= clampLevel(c.level) ? 'disabled' : ''}>Spend hit die (d${hitDie(c)} ${fmt(mod(c.abilities.con))})</button>
        </div>
        <p class="muted small">Suggested max HP at this level (average): ${avgHp(c)}</p>
      </section>
      <section class="card">
        <h3>Death saves</h3>
        <div class="deaths"><span>Successes</span>${ds('s', 'Success')}</div>
        <div class="deaths"><span>Failures</span>${ds('f', 'Failure')}</div>
        <div class="row"><button data-act="death-roll">Roll death save</button><button data-act="death-reset">Reset</button></div>
      </section>
      <section class="card row">
        <button data-act="short-rest">Short rest</button>
        <button class="primary" data-act="long-rest">Long rest</button>
      </section>
      <p class="muted small">Long rest: full HP, temp HP cleared, all spell slots back, regain half your hit dice. Short rest: Warlock pact slots back; spend hit dice above to heal.</p>`;
  },

  rolls(c) {
    const dice = [4, 6, 8, 10, 12, 20, 100].map(d => `<button data-quick="1d${d}">d${d}</button>`).join('');
    const atks = c.attacks.map((a, i) => `
      <div class="card attack">
        <div class="grid2">
          <label class="span2">Name <input data-bind="attacks.${i}.name" value="${esc(a.name)}" placeholder="Longsword"></label>
          <label>Ability <select data-bind="attacks.${i}.ability">${['', ...ABILITIES].map(x => `<option value="${x}" ${a.ability === x ? 'selected' : ''}>${x ? x.toUpperCase() : '—'}</option>`).join('')}</select></label>
          <label>Extra to-hit <input type="number" inputmode="numeric" data-bind="attacks.${i}.bonus" value="${esc(a.bonus)}"></label>
          <label>Damage dice <input data-bind="attacks.${i}.dmg" value="${esc(a.dmg)}" placeholder="1d8"></label>
          <label>Damage type <input data-bind="attacks.${i}.type" value="${esc(a.type)}" placeholder="slashing"></label>
          <div class="span2">${check(`attacks.${i}.prof`, 'Proficient')} ${check(`attacks.${i}.addMod`, 'Add ability mod to damage')}</div>
        </div>
        <div class="row">
          <button class="primary" data-attack-hit="${i}">To hit <b data-calc="hit:${i}">${fmt(attackHit(c, a))}</b></button>
          <button class="primary" data-attack-dmg="${i}">Damage <b data-calc="dmg:${i}">${esc(attackDmg(c, a))}</b></button>
          <button class="danger small" data-del-attack="${i}">✕</button>
        </div>
      </div>`).join('');
    return `
      ${rollModeBar()}
      <section class="card"><h3>Dice</h3><div class="dice">${dice}</div>
        <div class="row"><input id="roll-expr" placeholder="e.g. 2d6+3, 4d6kh3" autocomplete="off"><button class="primary" data-act="roll-expr">Roll</button></div>
      </section>
      <section class="card"><h3>Quick checks</h3>
        <div class="dice">
          <button data-roll-init>Initiative <b data-calc="init">${fmt(initiative(c))}</b></button>
          ${ABILITIES.map(a => `<button data-roll-check="${a}">${a.toUpperCase()} <b data-calc="mod:${a}">${fmt(mod(c.abilities[a]))}</b></button>`).join('')}
        </div>
        <p class="muted small">Skills and saves roll from the Stats tab.</p>
      </section>
      <h3 class="sect">Attacks &amp; weapons</h3>
      ${atks || '<p class="muted">No attacks yet.</p>'}
      <button class="wide" data-act="add-attack">+ Add attack</button>
      <section class="card"><h3>Roll history</h3><ul class="log" id="roll-log">${renderLog(c)}</ul>
        <button class="small" data-act="clear-log">Clear history</button></section>`;
  },

  items(c) {
    const items = c.items.map((it, i) => `
      <li class="item">
        <div class="grid-item">
          <input data-bind="items.${i}.name" value="${esc(it.name)}" placeholder="Item name" class="iname">
          <label>Qty <input type="number" inputmode="numeric" data-bind="items.${i}.qty" value="${esc(it.qty)}"></label>
          <label>Wt <input type="number" inputmode="decimal" step="0.1" data-bind="items.${i}.weight" value="${esc(it.weight)}"></label>
        </div>
        <textarea data-bind="items.${i}.notes" rows="1" placeholder="Notes (effects, charges…)">${esc(it.notes)}</textarea>
        <div class="row">${check(`items.${i}.equipped`, 'Equipped')}<button class="danger small" data-del-item="${i}">Remove</button></div>
      </li>`).join('');
    return `
      <section class="card grid5">
        ${['cp', 'sp', 'ep', 'gp', 'pp'].map(k => `<label>${k.toUpperCase()} ${inp('coins.' + k, { type: 'number' })}</label>`).join('')}
      </section>
      <p class="muted small">Total weight: <b data-calc="weight">${CALC.weight(c)}</b> lb · Carry capacity: ${(Number(c.abilities.str) || 0) * 15} lb</p>
      <ul class="items">${items || '<p class="muted">No items yet.</p>'}</ul>
      <button class="primary wide" data-act="add-item">+ Add item</button>`;
  },

  spells(c) {
    const cd = classData(c); const L = clampLevel(c.level);
    const max = slotsMax(c);
    const abilOpts = `<option value="">${cd && cd.castAbility ? 'Class default (' + cd.castAbility.toUpperCase() + ')' : '—'}</option>`
      + ABILITIES.map(a => `<option value="${a}" ${c.spell.ability === a ? 'selected' : ''}>${a.toUpperCase()}</option>`).join('');
    const slotRows = max.map((m, i) => {
      if (!c.spell.override && !m) return '';
      const used = Math.min(c.spell.slotsUsed[i] || 0, m);
      const pips = Array.from({ length: m }, (_, j) => `<button class="pip ${j < m - used ? 'on' : ''}" data-slot="${i}:${j}" aria-label="slot"></button>`).join('');
      return `<div class="slotrow"><span>Lv ${i + 1}</span>
        ${c.spell.override ? `<input type="number" inputmode="numeric" min="0" max="9" data-bind="spell.slotsMax.${i}" value="${esc(c.spell.slotsMax[i])}" data-rerender class="tiny">` : ''}
        <div class="pips">${pips}</div><small>${m - used}/${m}</small></div>`;
    }).join('');
    const hints = [];
    if (cd && cd.cantrips[L] != null) hints.push(`Cantrips known: ${cd.cantrips[L]}`);
    if (cd && cd.known[L] != null) hints.push(`Spells known: ${cd.known[L]}`);
    if (cd && ['cleric', 'druid', 'wizard', 'paladin'].includes(c.cls) && castAbility(c)) {
      const half = c.cls === 'paladin';
      const n = Math.max(1, mod(c.abilities[castAbility(c)]) + (half ? Math.floor(L / 2) : L));
      hints.push(`Prepared spells: ${n}`);
    }

    const byLevel = {};
    c.spell.list.forEach((s, i) => { const d = spellData(s); (byLevel[d.l] = byLevel[d.l] || []).push([s, d, i]); });
    const lists = Object.keys(byLevel).sort((a, b) => a - b).map(l => `
      <h3 class="sect">${l == 0 ? 'Cantrips' : 'Level ' + l}</h3>
      <ul class="spells">${byLevel[l].map(([s, d, i]) => renderSpell(c, s, d, i, max)).join('')}</ul>`).join('');

    return `
      <section class="card grid3">
        <label>Casting ability <select data-bind="spell.ability" data-rerender>${abilOpts}</select></label>
        <div class="stat"><span>Spell save DC</span><b data-calc="dc">${CALC.dc(c)}</b></div>
        <div class="stat"><span>Spell attack</span><b data-calc="satk">${CALC.satk(c)}</b></div>
        ${hints.length ? `<p class="span3 muted small">${hints.join(' · ')}</p>` : ''}
      </section>
      <section class="card">
        <h3>Spell slots</h3>
        ${slotRows || `<p class="muted small">${cd && !cd.castAbility ? esc(className(c)) + ' has no spell slots. ' : ''}No slots at this level.</p>`}
        <div class="row">${check('spell.override', 'Set slots manually (multiclass, homebrew…)')}</div>
        <div class="row"><button class="small" data-act="reset-slots">Restore all slots</button>
          ${spellAtk(c) !== null ? `<button class="small" data-act="spell-attack">Roll spell attack</button>` : ''}</div>
      </section>
      ${lists || '<p class="muted">No spells added yet.</p>'}
      ${renderSpellAdd(c)}`;
  },

  story(c) {
    return `
      <section class="card"><h3>Backstory</h3>${area('backstory', 10, 'Where they come from, what drives them…')}</section>
      <section class="card"><h3>Personality, ideals, bonds, flaws</h3>${area('personality', 5)}</section>
      <section class="card"><h3>Notes</h3>${area('notes', 8, 'Session notes, NPCs, quests…')}</section>`;
  },
};

function avgHp(c) {
  const hd = hitDie(c), con = mod(c.abilities.con), L = clampLevel(c.level);
  return Math.max(1, hd + con + (L - 1) * (Math.floor(hd / 2) + 1 + con));
}
function rollModeBar() {
  return `<div class="rollmode">${[['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']]
    .map(([k, l]) => `<button data-rollmode="${k}" class="${view.rollMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function renderLog(c) {
  if (!c || !c.log.length) return '<li class="muted">No rolls yet.</li>';
  return c.log.map(e => `<li><b>${e.total}</b> ${esc(e.label)} <small>${esc(e.detail)}</small></li>`).join('');
}

// Spells: an entry is either {n, prep} referencing the SRD, or a custom spell {custom:true, n, l, ...}
function spellData(s) {
  if (!s.custom && SPELL_BY_NAME[s.n]) return SPELL_BY_NAME[s.n];
  return { n: s.n, l: Number(s.l) || 0, s: s.s || '', t: s.t || '', r: s.r || '', c: s.c || '', d: s.d || '', desc: s.desc || '', hl: '', conc: !!s.conc, rit: false, cl: [] };
}
function renderSpell(c, s, d, i, max) {
  const open = view.openSpell === i;
  const tags = [d.s, d.conc ? 'Concentration' : '', d.rit ? 'Ritual' : ''].filter(Boolean).join(' · ');
  let cast = '';
  if (open && d.l > 0) {
    const opts = max.map((m, li) => ({ li, left: m - Math.min(c.spell.slotsUsed[li] || 0, m) }))
      .filter(o => o.li + 1 >= d.l && o.left > 0);
    cast = opts.length
      ? `<div class="row">${opts.map(o => `<button class="primary small" data-cast="${i}:${o.li}">Cast at Lv ${o.li + 1} (${o.left} left)</button>`).join('')}</div>`
      : '<p class="muted small">No slots left for this spell.</p>';
  }
  return `
    <li class="spell ${s.prep ? 'prep' : ''}">
      <div class="spellhead">
        ${d.l > 0 ? `<label class="chk" title="Prepared"><input type="checkbox" data-bind="spell.list.${i}.prep" ${s.prep ? 'checked' : ''}> Prep</label>` : ''}
        <button class="spellname" data-toggle-spell="${i}"><b>${esc(d.n)}</b><small>${esc(tags)}</small></button>
      </div>
      ${open ? `<div class="spellbody">
        <p class="small"><b>Casting time:</b> ${esc(d.t)} · <b>Range:</b> ${esc(d.r)} · <b>Duration:</b> ${esc(d.d)}<br><b>Components:</b> ${esc(d.c)}</p>
        ${s.custom ? `<textarea data-bind="spell.list.${i}.desc" rows="4" placeholder="Description">${esc(s.desc)}</textarea>` : `<div class="desc">${esc(d.desc)}${d.hl ? `\n\n<b>At higher levels.</b> ${esc(d.hl)}` : ''}</div>`}
        ${cast}
        <div class="row"><button class="danger small" data-del-spell="${i}">Remove spell</button></div>
      </div>` : ''}
    </li>`;
}
function renderSpellAdd(c) {
  const q = view.spellSearch.trim().toLowerCase();
  const cls = c.cls;
  const have = new Set(c.spell.list.map(s => s.n));
  let results = [];
  if (q || view.spellClassOnly) {
    results = SRD.spells.filter(s => (!q || s.n.toLowerCase().includes(q)) && (!view.spellClassOnly || !classData(c) || s.cl.includes(cls)));
  }
  const shown = results.slice(0, 60);
  return `
    <section class="card">
      <h3>Add spells</h3>
      <input id="spell-search" placeholder="Search SRD spells…" value="${esc(view.spellSearch)}" autocomplete="off">
      ${classData(c) ? `<label class="chk"><input type="checkbox" id="spell-classonly" ${view.spellClassOnly ? 'checked' : ''}> Only ${esc(className(c))} spells</label>` : ''}
      <ul class="results" id="spell-results">${shown.map(s => `
        <li><button data-add-spell="${esc(s.n)}" ${have.has(s.n) ? 'disabled' : ''}>${have.has(s.n) ? '✓' : '+'}</button>
          <span>${esc(s.n)} <small>${s.l ? 'Lv ' + s.l : 'Cantrip'} · ${esc(s.s)}</small></span></li>`).join('')}
        ${results.length > shown.length ? `<li class="muted small">…${results.length - shown.length} more, type to narrow down</li>` : ''}
      </ul>
      <details><summary>Add a custom / non-SRD spell</summary>
        <div class="grid2">
          <label class="span2">Name <input id="cs-name"></label>
          <label>Level (0 = cantrip) <input id="cs-level" type="number" inputmode="numeric" min="0" max="9" value="1"></label>
          <label>School <input id="cs-school"></label>
          <label>Casting time <input id="cs-time" placeholder="1 action"></label>
          <label>Range <input id="cs-range"></label>
          <label>Components <input id="cs-comp" placeholder="V, S, M"></label>
          <label>Duration <input id="cs-dur"></label>
          <label class="span2">Description <textarea id="cs-desc" rows="3"></textarea></label>
          <div class="span2">${'<label class="chk"><input type="checkbox" id="cs-conc"> Concentration</label>'}</div>
        </div>
        <button class="primary" data-act="add-custom-spell">Add spell</button>
      </details>
    </section>`;
}
function refreshSpellResults() {
  // Re-render only the results list so the search box keeps focus while typing
  const c = cur(); const tmp = document.createElement('div');
  tmp.innerHTML = renderSpellAdd(c);
  const fresh = tmp.querySelector('#spell-results'); const old = document.getElementById('spell-results');
  if (fresh && old) old.replaceWith(fresh);
}

// ---------- events ----------
$app.addEventListener('input', e => {
  const t = e.target; const c = cur();
  if (t.id === 'spell-search') { view.spellSearch = t.value; refreshSpellResults(); return; }
  if (!c || !t.dataset.bind) return;
  const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value;
  setPath(c, t.dataset.bind, v);
  save();
  if (t.dataset.bind === 'name') document.querySelector('.top .title b').textContent = c.name;
  updateCalcs();
});
$app.addEventListener('change', e => {
  const t = e.target; const c = cur();
  if (t.id === 'spell-classonly') { view.spellClassOnly = t.checked; refreshSpellResults(); return; }
  if (t.dataset.act === 'import') return importFile(t.files[0]);
  if (!c) return;
  if (t.dataset.bind === 'cls' && t.value === 'custom' && !c.clsName) c.clsName = '';
  if (t.dataset.bind === 'level') c.level = clampLevel(t.value);
  if (t.dataset.bind === 'spell.override' && t.checked) c.spell.slotsMax = [...slotsMax({ ...c, spell: { ...c.spell, override: false } })];
  if (t.dataset.bind && t.dataset.bind.startsWith('hp.')) { c.hp.cur = Math.min(c.hp.cur, c.hp.max); save(); }
  if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.hasAttribute('data-rerender')) { save(); render(); }
});
$app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'roll-expr') { e.preventDefault(); doExprRoll(); }
});
function doExprRoll() {
  const el = document.getElementById('roll-expr');
  if (el.value.trim()) rollFree(el.value.trim(), el.value.trim());
}

$app.addEventListener('click', e => {
  const b = e.target.closest('button, [data-act]'); if (!b || b.disabled) return;
  const c = cur(); const d = b.dataset;

  if (d.open) { view = { ...view, screen: 'char', id: d.open, tab: 'info', openSpell: null, spellSearch: '' }; render(); window.scrollTo(0, 0); return; }
  if (d.tab) { view.tab = d.tab; view.openSpell = null; render(); window.scrollTo(0, 0); return; }
  if (d.rollmode) { view.rollMode = d.rollmode; syncRollMode(); return; }
  if (d.quick) { rollFree(d.quick, d.quick); return; }
  if (d.rollCheck) { rollD20(`${ABILITY_NAMES[d.rollCheck]} check`, mod(c.abilities[d.rollCheck])); return; }
  if (d.rollSave) { rollD20(`${ABILITY_NAMES[d.rollSave]} save`, saveBonus(c, d.rollSave)); return; }
  if (d.rollSkill) { rollD20(SKILLS.find(s => s[0] === d.rollSkill)[1], skillBonus(c, d.rollSkill)); return; }
  if ('rollInit' in d) { rollD20('Initiative', initiative(c)); return; }
  if (d.cycleSkill) { c.skills[d.cycleSkill] = ((c.skills[d.cycleSkill] || 0) + 1) % 3; save(); render(); return; }
  if (d.attackHit) { const a = c.attacks[d.attackHit]; rollD20(`${a.name || 'Attack'} to hit`, attackHit(c, a)); return; }
  if (d.attackDmg) { const a = c.attacks[d.attackDmg]; rollFree(`${a.name || 'Attack'} damage${a.type ? ' (' + a.type + ')' : ''}`, attackDmg(c, a)); return; }
  if (d.delAttack) { if (confirm('Remove this attack?')) { c.attacks.splice(d.delAttack, 1); save(); render(); } return; }
  if (d.delItem) { c.items.splice(d.delItem, 1); save(); render(); return; }
  if (d.hp) return hpAction(c, d.hp);
  if (d.death) { const [k, n] = d.death.split(':'); c.deathSaves[k] = c.deathSaves[k] === Number(n) ? Number(n) - 1 : Number(n); save(); render(); return; }
  if (d.slot) {
    const [li, j] = d.slot.split(':').map(Number); const m = slotsMax(c)[li];
    const left = m - (c.spell.slotsUsed[li] || 0);
    c.spell.slotsUsed[li] = j < left ? m - j : m - j - 1; // tap a filled pip to use, an empty one to restore
    c.spell.slotsUsed[li] = Math.max(0, Math.min(m, c.spell.slotsUsed[li]));
    save(); render(); return;
  }
  if (d.toggleSpell) { const i = Number(d.toggleSpell); view.openSpell = view.openSpell === i ? null : i; render(); return; }
  if (d.cast) {
    const [i, li] = d.cast.split(':').map(Number);
    c.spell.slotsUsed[li] = (c.spell.slotsUsed[li] || 0) + 1; save();
    toast(`Cast ${spellData(c.spell.list[i]).n} using a level ${li + 1} slot`); render(); return;
  }
  if (d.delSpell) { c.spell.list.splice(d.delSpell, 1); view.openSpell = null; save(); render(); return; }
  if (d.addSpell) { c.spell.list.push({ n: d.addSpell, prep: false }); save(); render(); return; }

  switch (d.act) {
    case 'back': view.screen = 'list'; render(); break;
    case 'new': { const n = newCharacter(); db.characters.push(n); save(); view = { ...view, screen: 'char', id: n.id, tab: 'info' }; render(); break; }
    case 'delete': if (confirm(`Delete ${c.name}? This cannot be undone (export a backup first if unsure).`)) { db.characters = db.characters.filter(x => x.id !== c.id); save(); view.screen = 'list'; render(); } break;
    case 'duplicate': { const n = normalize(JSON.parse(JSON.stringify(c))); n.id = uid(); n.name += ' (copy)'; db.characters.push(n); save(); view.id = n.id; render(); toast('Duplicated'); break; }
    case 'export-all': download(`dnd-characters-${new Date().toISOString().slice(0, 10)}.json`, { characters: db.characters }); break;
    case 'export-one': download(`${c.name.replace(/[^\w-]+/g, '_')}.json`, { characters: [c] }); break;
    case 'class-saves': ABILITIES.forEach(a => c.saveProf[a] = classData(c).saves.includes(a)); save(); render(); break;
    case 'add-attack': c.attacks.push({ name: '', ability: 'str', prof: true, bonus: 0, dmg: '1d8', type: '', addMod: true }); save(); render(); break;
    case 'add-item': c.items.push({ name: '', qty: 1, weight: 0, notes: '', equipped: false }); save(); render();
      { const all = document.querySelectorAll('.iname'); if (all.length) all[all.length - 1].focus(); } break;
    case 'roll-expr': doExprRoll(); break;
    case 'clear-log': c.log = []; save(); render(); break;
    case 'spend-hd': {
      const r = rollFree(`Hit die (d${hitDie(c)})`, `1d${hitDie(c)}${fmt(mod(c.abilities.con))}`);
      if (r) { const heal = Math.max(0, r.total); c.hitDiceUsed++; c.hp.cur = Math.min(c.hp.max, c.hp.cur + heal); save(); render(); }
      break;
    }
    case 'death-roll': {
      const r = rollD20('Death save', 0);
      if (r.nat === 20) { c.hp.cur = 1; c.deathSaves = { s: 0, f: 0 }; toast('Nat 20: back up with 1 HP!'); }
      else if (r.nat === 1) c.deathSaves.f = Math.min(3, c.deathSaves.f + 2);
      else if (r.total >= 10) c.deathSaves.s = Math.min(3, c.deathSaves.s + 1);
      else c.deathSaves.f = Math.min(3, c.deathSaves.f + 1);
      if (c.deathSaves.s >= 3) toast('Stable!'); if (c.deathSaves.f >= 3) toast('Three failures…');
      save(); render(); break;
    }
    case 'death-reset': c.deathSaves = { s: 0, f: 0 }; save(); render(); break;
    case 'short-rest':
      if (c.cls === 'warlock' && !c.spell.override) c.spell.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      save(); render(); toast('Short rest taken' + (c.cls === 'warlock' ? ' — pact slots restored' : '')); break;
    case 'long-rest': {
      const L = clampLevel(c.level);
      c.hp.cur = c.hp.max; c.hp.temp = 0; c.deathSaves = { s: 0, f: 0 };
      c.spell.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      c.hitDiceUsed = Math.max(0, c.hitDiceUsed - Math.max(1, Math.floor(L / 2)));
      save(); render(); toast('Long rest: HP, slots and hit dice restored'); break;
    }
    case 'reset-slots': c.spell.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0]; save(); render(); break;
    case 'spell-attack': rollD20('Spell attack', spellAtk(c)); break;
    case 'add-custom-spell': {
      const g = id => document.getElementById(id);
      const name = g('cs-name').value.trim(); if (!name) { toast('Give the spell a name'); return; }
      c.spell.list.push({ custom: true, n: name, l: Math.min(9, Math.max(0, Number(g('cs-level').value) || 0)), s: g('cs-school').value, t: g('cs-time').value,
        r: g('cs-range').value, c: g('cs-comp').value, d: g('cs-dur').value, desc: g('cs-desc').value, conc: g('cs-conc').checked, prep: false });
      save(); render(); toast('Spell added'); break;
    }
  }
});

function hpAction(c, kind) {
  const amt = Math.max(0, Number(document.getElementById('hp-amt').value) || 0);
  if (!amt) { toast('Enter an amount first'); return; }
  if (kind === 'dmg') {
    const fromTemp = Math.min(c.hp.temp, amt);
    c.hp.temp -= fromTemp; c.hp.cur = Math.max(0, c.hp.cur - (amt - fromTemp));
    if (c.hp.cur === 0) toast('Down to 0 HP — death saves!');
  } else if (kind === 'heal') {
    if (c.hp.cur === 0) c.deathSaves = { s: 0, f: 0 };
    c.hp.cur = Math.min(c.hp.max, c.hp.cur + amt);
  } else c.hp.temp = amt; // temp HP doesn't stack: replace
  save(); render();
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importFile(file) {
  if (!file) return;
  file.text().then(txt => {
    const d = JSON.parse(txt);
    const list = Array.isArray(d) ? d : d.characters;
    if (!Array.isArray(list)) throw new Error('No characters in file');
    let added = 0, replaced = 0;
    list.forEach(ch => {
      if (!ch || typeof ch !== 'object') return;
      normalize(ch); if (!ch.id) ch.id = uid();
      const i = db.characters.findIndex(x => x.id === ch.id);
      if (i >= 0) { db.characters[i] = ch; replaced++; } else { db.characters.push(ch); added++; }
    });
    save(); render(); toast(`Imported: ${added} new, ${replaced} updated`);
  }).catch(err => toast('Import failed: ' + err.message));
}

// Expose for tests
window.__dnd = { rollExpr, mod, prof, slotsMax };

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
