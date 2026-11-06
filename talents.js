// =====================================================
//  Kahramana özel kalıcı yetenekler (yetenek ağacı)
//  Veri: data.js HERO_TALENTS · Kayıt: save.heroTalents[heroId][talentId] = seviye
//  game.js, initTalents() ile bu modüle gereken fonksiyonları/durumları verir.
// =====================================================
import * as THREE from 'three';
import { HERO_TALENTS, HEROES, HERO_PATHS, HERO_MAX_LV, HERO_WEAPONS, heroLevelCost, shopCost } from './data.js';

let A = null;   // game.js'ten gelen arayüz (getter'lar + fonksiyonlar)
export function initTalents(api) { A = api; }

// --- Kahraman seviyesi (save.heroLevels[hero] = 0..20) ---
// Aktif yetenek seviyeleri artık seviye yolundan türetilir (HERO_PATHS, kind:'talent')
export function heroLv(hero) {
  const l = A.save.heroLevels && A.save.heroLevels[hero];
  return Math.max(0, Math.min(HERO_MAX_LV, l | 0));
}
export function talentLv(hero, id) {
  const lv = heroLv(hero);
  let n = 0;
  for (const s of HERO_PATHS[hero] || []) if (s.lv <= lv && s.kind === 'talent' && s.talent === id) n += s.n;
  return n;
}
// Yoldaki ara stat + dönüm noktası bonuslarının toplamı
export function pathStats(hero, lv = heroLv(hero)) {
  const o = { hp: 0, armor: 0, dmg: 0, crit: 0, speed: 0, range: 0, area: 0 };
  for (const s of HERO_PATHS[hero] || []) if (s.lv <= lv && s.stat) for (const k in s.stat) o[k] = (o[k] || 0) + s.stat[k];
  return o;
}
export const hasMilestone = (hero, id, lv = heroLv(hero)) => (HERO_PATHS[hero] || []).some(s => s.kind === 'milestone' && s.id === id && s.lv <= lv);
export const talentCost = (t, lv) => shopCost(t, lv);

// Koşu içi yetenek durumu (sayaçlar, kalkan vb.)
function st() {
  const run = A.run;
  if (!run.tal) run.tal = { spins: 0, swings: 0, shield: 0, shieldCd: 0, shadowT: 0, twinQ: [] };
  return run.tal;
}

// recompute() sonunda çağrılır: run.s'e yetenek bonuslarını uygular. S.t = çalışma anı parametreleri
export function applyTalentStats(S, hero) {
  const L = id => talentLv(hero, id);
  const t = S.t = {};
  S.critMult = 2;
  let dmgK = 1;
  if (hero === 'knight') {
    t.block = 0.03 * L('block');
    dmgK *= 1 + 0.07 * L('heavy'); S.range *= 1 + 0.03 * L('heavy');
    t.knock = 7 * (1 + 0.6 * L('shove'));
    t.oath = L('oath');
    t.riposte = L('riposte');
  } else if (hero === 'barbarian') {
    t.bloodlust = 0.1 * L('bloodlust');
    S.range *= 1 + 0.05 * L('wideaxe');
    t.quake = L('quake') ? 5 - L('quake') : 0;
    S.maxHp += 15 * L('hide'); S.regen += 0.3 * L('hide');
    t.feast = 0.2 * L('feast');
  } else if (hero === 'mage') {
    t.chain = L('chain');
    S.area *= 1 + 0.12 * L('power');
    t.shieldMax = L('shield') ? 5 + 5 * L('shield') : 0;
    S.interval /= 1 + 0.06 * L('quick');
    dmgK *= 1 + 0.06 * L('focus'); S.crit += 0.025 * L('focus');
  } else if (hero === 'ranger') {
    t.multi = L('multi');
    S.crit += 0.04 * L('eye'); S.critMult += 0.08 * L('eye');
    t.pierce = L('pierce'); dmgK *= 1 + 0.04 * L('pierce');
    t.dashCd = 1 - 0.15 * L('feet'); S.speed *= 1 + 0.04 * L('feet');
    t.hunter = 0.12 * L('hunter');
  } else if (hero === 'rogue') {
    t.poison = 0.15 * L('poison');
    t.shadow = L('shadow') ? 0.3 + 0.5 * L('shadow') : 0;
    t.blades = L('blades');
    t.evade = 0.05 * L('evade');
    S.critMult += 0.15 * L('assassin');
  }
  // Seviye yolundan gelen ara stat + dönüm noktası bonusları
  const lvl = heroLv(hero), P = pathStats(hero, lvl);
  S.maxHp += P.hp; S.armor = Math.min(0.6, S.armor + P.armor);
  dmgK *= 1 + P.dmg; S.crit += P.crit; S.speed *= 1 + P.speed; S.range *= 1 + P.range; S.area *= 1 + P.area;
  // Sv.15 saldırı değişimi
  if (hasMilestone(hero, 'attack', lvl)) {
    if (hero === 'knight') t.wave = true;
    else if (hero === 'barbarian') t.shock = true;
    else if (hero === 'mage') { S.area *= 1.35; dmgK *= 1.15; }
    else if (hero === 'ranger') { t.multi = (t.multi || 0) + 1; t.pierce = (t.pierce || 0) + 1; }
    else if (hero === 'rogue') t.twin = 0.4;
  }
  t.master = hasMilestone(hero, 'super', lvl);   // Sv.20 Süper ustalığı (super.js okur)
  S.dmgMult *= dmgK; S.atkDmg *= dmgK;
  return S;
}

// --- Çalışma anı kancaları ---

// Her karede (updatePlayer içinde) çağrılır
export function talentTick(dt) {
  const run = A.run, S = run.s, t = S.t || {}, T = st(), p = A.player;
  if (T.shadowT > 0) T.shadowT -= dt;
  // Çifte Bıçak (Sv.15 Haydut): sıradaki ikinci vuruşlar
  if (T.twinQ.length) {
    for (let i = T.twinQ.length - 1; i >= 0; i--) {
      const q = T.twinQ[i];
      if ((q.t -= dt) > 0) continue;
      T.twinQ.splice(i, 1);
      if (!A.isActive(q.e)) continue;
      const v = new THREE.Vector3(q.e.obj.position.x - A.player.obj.position.x, 0, q.e.obj.position.z - A.player.obj.position.z).normalize();
      A.damageEnemy(q.e, S.atkDmg * 0.7, v, true, 3);
    }
  }
  if (t.oath && p.hp < S.maxHp * 0.35) A.heal(t.oath * dt, false);
  // Mana Kalkanı: boşaldıysa bir süre sonra tamamen dolar
  if (t.shieldMax) {
    if (T.shield < t.shieldMax) {
      T.shieldCd -= dt;
      if (T.shieldCd <= 0) { T.shield = t.shieldMax; T.shieldCd = 0; }
    }
    shieldFx(T.shield > 0);
  } else shieldFx(false);
  // Zehir
  if (t.poison) {
    for (const e of A.enemies) {
      if (!(e.poisonT > 0)) continue;
      if (!A.isActive(e)) { e.poisonT = 0; continue; }
      e.poisonT -= dt; e.poisonAcc = (e.poisonAcc || 0) + e.poisonDps * dt;
      e.poisonTick = (e.poisonTick || 0) - dt;
      if (e.poisonTick <= 0 || e.poisonT <= 0) {
        e.poisonTick = 0.5;
        const d = e.poisonAcc; e.poisonAcc = 0;
        if (d <= 0) continue;
        e.hp -= d; run.dmgDealt += d;
        if (d >= 1) A.floatText(e.obj.position, String(Math.round(d)), 'poison', e.def.boss ? 4.5 : 2.2);
        if (e.hp <= 0) A.killEnemy(e);
      }
    }
  }
}

// hurtPlayer'da zırhtan önce çağrılır; kalan hasarı döner (0 = tamamen engellendi)
export function talentHurt(dmg) {
  const run = A.run, S = run.s, t = S.t || {}, p = A.player, T = st();
  if (t.block && Math.random() < t.block) {
    p.invuln = 0.35;
    A.floatText(p.obj.position, '🛡️ BLOK', 'heal');
    A.sfx.hit && A.sfx.hit();
    if (t.riposte) {
      const R = 2.8, d = S.atkDmg * (0.5 + 0.5 * t.riposte), pp = p.obj.position;
      for (const e of A.enemies) {
        if (!A.isActive(e)) continue;
        const v = new THREE.Vector3(e.obj.position.x - pp.x, 0, e.obj.position.z - pp.z);
        if (v.length() - e.def.radius < R) A.damageEnemy(e, d, v.normalize(), true, 12);
      }
      A.spawnRingFx(pp, R, 0xffe066);
    }
    return 0;
  }
  if (t.evade && Math.random() < t.evade) {
    p.invuln = 0.25;
    A.floatText(p.obj.position, '💨 KAÇTI', 'heal');
    return 0;
  }
  if (t.oath && p.hp < S.maxHp * 0.35) dmg *= 1 - 0.09 * t.oath;
  if (t.shieldMax && T.shield > 0) {
    const a = Math.min(T.shield, dmg);
    T.shield -= a; dmg -= a;
    T.shieldCd = 6;   // son darbeden 6 sn sonra tamamen dolar
    if (dmg <= 0) { p.invuln = 0.3; A.floatText(p.obj.position, '🔷 -' + Math.round(a), 'heal'); return 0; }
  }
  return dmg;
}

// damageEnemy içinde: kesin kritik var mı (Gölge Adım)
export const talentForceCrit = () => !!(A.run && A.run.tal && A.run.tal.shadowT > 0);
// damageEnemy içinde: düşmana göre hasar çarpanı (Avcı İşareti)
export function talentDmgMult(e) {
  const t = A.run.s.t || {};
  return t.hunter && (e.elite || e.def.boss) ? 1 + t.hunter : 1;
}
// Saldırı aralığı çarpanı (Kan Hırsı: kayıp can oranında hızlanır)
export function talentIntervalMult() {
  const S = A.run.s, t = S.t || {};
  if (!t.bloodlust) return 1;
  const lost = 1 - Math.max(0, A.player.hp) / S.maxHp;
  return 1 / (1 + t.bloodlust * Math.min(1, Math.max(0, lost) / 0.7));   // %30 canda tam bonus
}
// Atılma
export function talentDashCd(base) { const t = A.run.s.t || {}; return base * (t.dashCd || 1); }
export function talentOnDash() { const t = A.run.s.t || {}; if (t.shadow) st().shadowT = t.shadow + 0.17; }
// Yakın dövüş vuruşu bir düşmana isabet etti
export function talentOnMeleeHit(e) {
  const S = A.run.s, t = S.t || {};
  if (t.poison && A.isActive(e)) {
    e.poisonDps = S.atkDmg * t.poison; e.poisonT = 3;
    if (!(e.poisonTick > 0)) e.poisonTick = 0.5;
  }
  if (t.twin && Math.random() < t.twin) st().twinQ.push({ e, t: 0.1 });
}
// Savurma bitti: hits = vurulan düşman sayısı
export function talentOnSwing(hits, all) {
  const run = A.run, S = run.s, t = S.t || {}, pp = A.player.obj.position;
  if (t.feast && hits) A.heal(Math.min(hits, 6) * t.feast, false);
  // Sv.15 Barbar: Parçalayıcı Dönüş — dışa doğru ek şok halkası
  if (all && t.shock) {
    const R = S.range * 1.6, d = S.atkDmg * 0.5;
    for (const e of A.enemies) {
      if (!A.isActive(e)) continue;
      const v = new THREE.Vector3(e.obj.position.x - pp.x, 0, e.obj.position.z - pp.z);
      const dist = v.length() - e.def.radius;
      if (dist > S.range && dist < R) A.damageEnemy(e, d, v.normalize(), true, 9);
    }
    A.spawnRingFx(pp, R, 0xff6a3d);
  }
  // Sv.15 Şövalye: Kalkan Dalgası — her 3. savurmada önde uzanan şok dalgası
  if (!all && t.wave && hits >= 0 && ++st().swings % 3 === 0) {
    const R = S.range * 1.9, d = S.atkDmg * 0.8, fx = Math.sin(A.player.swingA), fz = Math.cos(A.player.swingA);
    for (const e of A.enemies) {
      if (!A.isActive(e)) continue;
      const v = new THREE.Vector3(e.obj.position.x - pp.x, 0, e.obj.position.z - pp.z);
      const dist = v.length() - e.def.radius;
      if (dist > R) continue;
      v.normalize();
      if (v.x * fx + v.z * fz > 0.55) A.damageEnemy(e, d, v, true, 14);
    }
    const ang = A.player.swingA;
    for (let i = 1; i <= 3; i++) A.spawnRingFx(new THREE.Vector3(pp.x + Math.sin(ang) * i * R / 3.5, 0, pp.z + Math.cos(ang) * i * R / 3.5), 1.2 + i * 0.5, 0xffe066);
  }
  if (all && t.quake) {
    const T = st();
    if (++T.spins % t.quake === 0) {
      const R = S.range * 1.7, d = S.atkDmg * 0.8;
      for (const e of A.enemies) {
        if (!A.isActive(e)) continue;
        const v = new THREE.Vector3(e.obj.position.x - pp.x, 0, e.obj.position.z - pp.z);
        if (v.length() - e.def.radius < R) A.damageEnemy(e, d, v.normalize(), true, 12);
      }
      A.spawnRingFx(pp, R, 0xff8a3d); A.shake(0.18);
    }
  }
}
// Okçu: ok yelpazesi (ana ok dahil yönler)
export function talentArrowDirs(dir) {
  const t = A.run.s.t || {}, out = [{ dir, k: 1 }];
  for (let i = 1; i <= (t.multi || 0); i++) {
    const a = Math.atan2(dir.x, dir.z) + (i % 2 ? 1 : -1) * 0.2 * Math.ceil(i / 2);
    out.push({ dir: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), k: 0.6 });
  }
  return out;
}
// Büyücü: patlama sonrası sekme büyüleri
export function talentChain(c, s) {
  if (!s.chain) return;
  const targets = A.nearestEnemies(c, s.chain + 2, 6).filter(e => !s.hit.has(e) &&
    Math.hypot(e.obj.position.x - c.x, e.obj.position.z - c.z) > 1.0).slice(0, s.chain);
  for (const e of targets) {
    const dir = new THREE.Vector3(e.obj.position.x - c.x, 0, e.obj.position.z - c.z).normalize();
    A.fireShot({ kind: 'bolt', dir, speed: 15, dmg: s.dmg * 0.5, aoe: s.aoe * 0.6, life: 0.6, from: c, small: true });
  }
}

// Mana Kalkanı görseli
let bubble = null;
function shieldFx(on) {
  if (!bubble) {
    if (!on) return;
    bubble = new THREE.Mesh(new THREE.SphereGeometry(1.0, 18, 12), new THREE.MeshBasicMaterial({ color: 0x5fb8ff, transparent: true, opacity: 0.18, depthWrite: false }));
    A.scene.add(bubble);
  }
  bubble.visible = on && !A.player.dead;
  if (bubble.visible) {
    const p = A.player.obj.position;
    bubble.position.set(p.x, 1, p.z);
    bubble.material.opacity = 0.12 + Math.sin(performance.now() / 160) * 0.04;
  }
}
export function talentReset() { if (bubble) bubble.visible = false; }

// Duraklatma ekranı için aktif yetenekler
export function talentRows(hero) {
  const rows = [['⬆️ Kahraman seviyesi', `Sv. ${heroLv(hero)} / ${HERO_MAX_LV}`]];
  return rows.concat((HERO_TALENTS[hero] || []).filter(t => talentLv(hero, t.id)).map(t => [`${t.icon} ${t.name}`, `${talentLv(hero, t.id)} / ${t.max}`]));
}

// --- Menü kartı (mTalents) ---
// --- Kahraman Seviyesi ekranı (mTalents kartı; openHeroTalents(heroId) açar) ---
const RAR = { milestone: { weapon: 'epic', attack: 'epic', super: 'legend' } };
const rarOf = s => s.kind === 'milestone' ? RAR.milestone[s.id] : s.big ? 'rare' : '';
// Bir yol adımının görünümü
function stepInfo(hero, s) {
  if (s.kind === 'talent') {
    const t = (HERO_TALENTS[hero] || []).find(x => x.id === s.talent) || { icon: '⭐', name: s.talent, desc: '', max: 1 };
    const have = (HERO_PATHS[hero] || []).filter(x => x.kind === 'talent' && x.talent === s.talent && x.lv <= s.lv).reduce((a, x) => a + x.n, 0);
    return { icon: t.icon, name: s.big ? `İmza yetenek: ${t.name}` : t.name, desc: t.desc, tag: `Yetenek ${have - s.n + 1}${s.n > 1 ? '–' + have : ''} / ${t.max}` };
  }
  if (s.kind === 'milestone') return { icon: s.icon, name: s.name, desc: s.desc, tag: { weapon: 'Silah görünümü', attack: 'Saldırı değişimi', super: 'Süper ustalığı' }[s.id] };
  return { icon: s.icon, name: s.name, desc: s.desc, tag: 'Güçlenme' };
}
const selStep = {};   // kahraman → bakılan seviye (yoldaki düğüm)

export function renderTalents(heroId) {
  const save = A.save;
  heroId = HEROES[heroId] ? heroId : 'knight';
  const H = HEROES[heroId], path = HERO_PATHS[heroId] || [];
  const owned = !!save.heroes[heroId], lv = heroLv(heroId), maxed = lv >= HERO_MAX_LV;
  const cost = maxed ? 0 : heroLevelCost(lv), next = maxed ? null : path[lv];
  const sel = Math.max(1, Math.min(HERO_MAX_LV, selStep[heroId] || (maxed ? HERO_MAX_LV : lv + 1)));
  const $ = id => document.getElementById(id);
  $('talentTitle').innerHTML = `<span class="talentHeroIc">${H.icon}</span> ${H.name} · Seviye ${lv}`;
  $('talentTabs').innerHTML = Object.entries(HEROES).map(([id, h]) =>
    `<button data-thero="${id}" class="${id === heroId ? 'on' : ''}${save.heroes[id] ? '' : ' locked'}" title="${h.name} · Sv. ${heroLv(id)}">${h.icon}</button>`).join('');
  const warn = $('talentWarn');
  warn.classList.toggle('hidden', owned);
  warn.textContent = owned ? '' : `🔒 Önce kahramanı aç: ${H.name} kilitli. Yolu görebilirsin ama seviye atlatamazsın.`;

  // Üst şerit: seviye + ilerleme
  $('lvlHead').innerHTML = `<div class="lvBig"><b>Sv. ${lv}</b><span>/ ${HERO_MAX_LV}</span></div>
    <div class="bar"><i style="width:${lv / HERO_MAX_LV * 100}%"></i></div>
    <small>${H.super ? `${H.super.icon} Süper: <b>${H.super.name}</b>` : ''}</small>`;

  // 20 düğümlü yol
  $('lvlPath').innerHTML = path.map(s => {
    const info = stepInfo(heroId, s), r = rarOf(s);
    const state = s.lv <= lv ? 'done' : s.lv === lv + 1 ? 'next' : 'locked';
    return `<button class="lvNode ${state}${r ? ' r-' + r : ''}${s.lv === sel ? ' sel' : ''}${s.kind === 'milestone' || s.big ? ' big' : ''}" data-node="${s.lv}" title="Sv. ${s.lv}: ${info.name}">
      <i>${info.icon}</i><em>${s.lv}</em></button>`;
  }).join('');

  // Seçili düğümün ayrıntısı + seviye atla
  const ss = path[sel - 1], si = stepInfo(heroId, ss), sr = rarOf(ss);
  const st8 = ss.lv <= lv ? 'Açıldı ✔' : ss.lv === lv + 1 ? 'Sıradaki seviye' : `Sv. ${ss.lv - 1} sonrası`;
  $('lvlNext').innerHTML = `<div class="lvCard${sr ? ' r-' + sr : ''}"><div class="ic">${si.icon}</div>
      <div class="info"><span class="tag">Sv. ${ss.lv} · ${si.tag}</span><b>${si.name}</b><small>${si.desc}</small>
      ${ss.stat && ss.kind !== 'stat' ? `<small class="bonus">+ ${statText(ss.stat)}</small>` : ''}</div>
      <span class="stt">${st8}</span></div>
    <button class="primary lvBuy" id="lvBuyBtn" ${maxed || !owned || save.gold < cost ? 'disabled' : ''}>${maxed ? '🏆 Azami seviye' : `⬆️ Seviye atla · 🪙 ${cost}${save.gold < cost && owned ? ` (${cost - save.gold} eksik)` : ''}`}</button>`;

  // Mevcut kazanımlar
  const P = pathStats(heroId, lv), rows = [];
  const stTxt = statText(P);
  if (stTxt) rows.push(['📈', 'Güçlenme', stTxt]);
  for (const t of HERO_TALENTS[heroId] || []) { const n = talentLv(heroId, t.id); if (n) rows.push([t.icon, t.name, `${n} / ${t.max}`]); }
  if (hasMilestone(heroId, 'weapon', lv)) rows.push(['⚔️', 'Silah', HERO_WEAPONS[heroId].name, 'epic']);
  if (hasMilestone(heroId, 'attack', lv)) rows.push(['💥', 'Saldırı', path.find(x => x.id === 'attack').name, 'epic']);
  if (hasMilestone(heroId, 'super', lv)) rows.push(['👑', 'Süper', 'Ustalık', 'legend']);
  $('talentList').innerHTML = rows.length
    ? rows.map(([ic, n, v, r]) => `<div class="gainRow${r ? ' r-' + r : ''}"><span>${ic} ${n}</span><b>${v}</b></div>`).join('')
    : '<div class="gainRow"><span>Henüz kazanım yok</span><b>Sv. 1 için altın biriktir</b></div>';
  let spent = 0; for (let i = 0; i < lv; i++) spent += heroLevelCost(i);
  $('talentSpent').textContent = spent ? `Bu kahramana yatırılan: 🪙 ${spent}` : '';
  for (const g of document.querySelectorAll('.goldAmt')) g.textContent = save.gold;

  for (const b of $('talentTabs').querySelectorAll('[data-thero]')) b.onclick = () => { A.sfx.click(); renderTalents(b.dataset.thero); };
  for (const b of $('lvlPath').querySelectorAll('[data-node]')) b.onclick = () => { A.sfx.click(); selStep[heroId] = +b.dataset.node; renderTalents(heroId); };
  const buy = $('lvBuyBtn');
  if (buy) buy.onclick = () => {
    const cur = heroLv(heroId), c = heroLevelCost(cur);
    if (!save.heroes[heroId] || cur >= HERO_MAX_LV || save.gold < c) return;
    save.gold -= c;
    save.heroLevels = { ...save.heroLevels, [heroId]: cur + 1 };
    selStep[heroId] = Math.min(HERO_MAX_LV, cur + 2);
    A.persist();
    const s = path[cur];
    (s.kind === 'milestone' ? A.sfx.evo : A.sfx.buff)();
    if (A.onHeroLevel) A.onHeroLevel(heroId, cur + 1, s);
    renderTalents(heroId);
    const card = document.getElementById('mTalents');
    card.classList.remove('lvPop'); void card.offsetWidth; card.classList.add('lvPop');
  };
}
// {hp:12, armor:.03} → "+12 maks. can · -%3 alınan hasar"
function statText(o) {
  const out = [];
  if (o.hp) out.push(`+${Math.round(o.hp)} maks. can`);
  if (o.armor) out.push(`-%${Math.round(o.armor * 100)} alınan hasar`);
  if (o.dmg) out.push(`+%${Math.round(o.dmg * 100)} hasar`);
  if (o.crit) out.push(`+%${Math.round(o.crit * 100)} kritik`);
  if (o.speed) out.push(`+%${Math.round(o.speed * 100)} hız`);
  if (o.range) out.push(`+%${Math.round(o.range * 100)} menzil`);
  if (o.area) out.push(`+%${Math.round(o.area * 100)} alan`);
  return out.join(' · ');
}
