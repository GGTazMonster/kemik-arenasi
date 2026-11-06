// =====================================================
//  SÜPER YETENEKLER — her kahramanın kendine özgü büyük hamlesi
//  Şövalye: Kalkan Hücumu · Barbar: Kasırga · Büyücü: Meteor Yağmuru · Okçu: Ok Yağmuru · Haydut: Gölge Dansı
//  Dolum: öldürme / hasar alma / hasar verme ile dolan çubuk (≈25 öldürme). Kullanım: E ya da Q, mobilde ⚡ butonu.
//  Sv.20 (talents.js S.t.master) Süper'i güçlendirir. game.js, initSuper() ile gereken arayüzü verir.
// =====================================================
import * as THREE from 'three';

let A = null;
export function initSuper(api) { A = api; }

const MAX = 100;
const S = { charge: 0, cur: null, list: [], flash: 0 };   // cur: çalışan süper, list: ek efektler (meteor/ok/halka)

const COL = {
  gold: new THREE.Color(0xffd23f), fire: new THREE.Color(0xff7a2a), steel: new THREE.Color(0xcfe8ff),
  purple: new THREE.Color(0xa05cff), dark: new THREE.Color(0x35204f), bone: new THREE.Color(0xeee6d6), green: new THREE.Color(0x9bff7a),
};
const add = (m) => { A.scene.add(m); return m; };
const rm = (m) => { if (m.parent) m.parent.remove(m); };
const flatRing = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
const flatDisc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const additive = (c, o = 0.6) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

const master = () => !!(A.run && A.run.s && A.run.s.t && A.run.s.t.master);
const P = () => A.player;
const pos = () => A.player.obj.position;
const arenaClamp = (p, r = 17) => { const d = Math.hypot(p.x, p.z); if (d > r) { p.x *= r / d; p.z *= r / d; } };

// ---------- Durum / dolum ----------
export const superCharge = () => S.charge / MAX;
export const superReady = () => S.charge >= MAX && !S.cur && !!A.run && !P().dead;
export const superBusy = () => !!S.cur;                 // çalışırken yeni Süper başlamaz
export const superFreeze = () => !!(S.cur && S.cur.freeze);   // true: oyuncu girdisiyle hareket edemez (Gölge Dansı)
export const superCharging = () => !!(S.cur && S.cur.kind === 'knight');   // Kalkan Hücumu: atılma hızı
export function superFill() { S.charge = MAX; }
export function superReset() {
  if (S.cur && S.cur.cleanup) S.cur.cleanup();
  S.cur = null;
  for (const f of S.list) { f.cleanup && f.cleanup(); if (f.m) rm(f.m); }
  S.list.length = 0;
  S.charge = 0; S.flash = 0;
}
function gain(v) {
  if (!A.run || S.cur || S.list.length) return;   // Süper çalışırken dolmaz
  const was = S.charge < MAX;
  S.charge = Math.min(MAX, S.charge + v * (master() ? 1.25 : 1));
  if (was && S.charge >= MAX) { A.sfx.superReady && A.sfx.superReady(); A.floatText(pos(), `${A.hero().super.icon} SÜPER HAZIR!`, 'crit', 3.2); S.flash = 1; }
}
export function superOnKill(e) {
  const d = e.def;
  gain(d.boss ? 25 : e.elite ? 12 : 2.8 + d.xp * 0.4);
}
export const superOnHurt = dmg => gain(Math.min(12, dmg * 0.1));
export const superOnDealt = dmg => gain(Math.min(60, dmg) * 0.012);

// ---------- Yardımcılar ----------
// En kalabalık düşman kümesi: [{x,z}, ...] (n adet, birbirinden uzak)
function crowdSpots(n, radius, around, maxFrom = 30) {
  const act = A.enemies.filter(e => A.isActive(e) && Math.hypot(e.obj.position.x - around.x, e.obj.position.z - around.z) < maxFrom);
  const out = [];
  const w = e => (e.def.boss ? 3 : e.elite ? 1.6 : 1);
  for (let k = 0; k < n && act.length; k++) {
    let best = null, bs = -1;
    for (const c of act) {
      let s = 0;
      for (const o of act) if (!o.covered && Math.hypot(o.obj.position.x - c.obj.position.x, o.obj.position.z - c.obj.position.z) < radius * 1.2) s += w(o);
      if (!c.covered) s += 0.01;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) break;
    out.push({ x: best.obj.position.x, z: best.obj.position.z });
    for (const o of act) if (Math.hypot(o.obj.position.x - best.obj.position.x, o.obj.position.z - best.obj.position.z) < radius * 1.05) o.covered = true;
    if (act.every(o => o.covered)) { for (const o of act) o.covered = false; }   // hepsi kapsandıysa tekrar dolaş
  }
  for (const e of act) e.covered = false;
  return out;
}
const nearestDir = (from, maxD = 14) => {
  const [e] = A.nearestEnemies(from, 1, maxD);
  return e ? new THREE.Vector3(e.obj.position.x - from.x, 0, e.obj.position.z - from.z).normalize() : null;
};
function dmgIn(c, R, dmg, knock, canCrit = true) {
  for (const e of A.enemies) {
    if (!A.isActive(e)) continue;
    const v = new THREE.Vector3(e.obj.position.x - c.x, 0, e.obj.position.z - c.z);
    if (v.length() - e.def.radius < R) A.damageEnemy(e, dmg, v.lengthSq() > 0.0001 ? v.normalize() : new THREE.Vector3(1, 0, 0), canCrit, knock);
  }
}

// ---------- Kullanım ----------
// move: oyuncu hareket yönü (null: otomatik hedef). Başarılıysa true.
export function superUse(move) {
  if (!superReady()) return false;
  const hero = A.run.hero, p = P();
  const starter = { knight: startKnight, barbarian: startBarb, mage: startMage, ranger: startRanger, rogue: startRogue }[hero];
  if (!starter) return false;
  if (!starter(move)) { A.floatText(pos(), 'Hedef yok!', '', 2.6); return false; }
  S.charge = 0; S.flash = 0;
  p.invuln = Math.max(p.invuln || 0, 0.7);   // Süper anı güvenli: kısa dokunulmazlık (animasyon sırasında ölmesin)
  A.sfx.superUse && A.sfx.superUse();
  A.spawnRingFx(pos(), 3.5, 0xffd23f);
  A.banner(`${A.hero().super.icon} ${A.hero().super.name.toUpperCase()}!`, 1.2);
  A.shake(0.25);
  return true;
}

// ---------- Her karede ----------
export function superTick(dt) {
  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
  const c = S.cur;
  if (c) { c.t += dt; if (c.update(dt, c)) { c.end && c.end(c); c.cleanup && c.cleanup(); S.cur = null; } }
  for (let i = S.list.length - 1; i >= 0; i--) {
    const f = S.list[i];
    f.t += dt;
    if (f.update(dt, f)) { f.cleanup && f.cleanup(); if (f.m) rm(f.m); S.list.splice(i, 1); }
  }
}
export const superFlash = () => S.flash;

// =====================================================
//  ŞÖVALYE — Kalkan Hücumu
// =====================================================
function startKnight(move) {
  const p = P(), o = p.obj, m = master();
  let dir = move && move.lengthSq() > 0.05 ? move.clone().normalize() : nearestDir(o.position, 16);
  if (!dir) dir = new THREE.Vector3(Math.sin(o.rotation.y), 0, Math.cos(o.rotation.y));
  const dur = m ? 0.95 : 0.7, R = m ? 2.5 : 2.0, dmg = A.run.s.atkDmg * (m ? 3.4 : 2.4);
  // Kalkan görseli: önde parlayan yarım daire
  const shield = add(new THREE.Mesh(new THREE.CircleGeometry(1, 24, -Math.PI / 2, Math.PI), additive(0xffe066, 0.5)));
  shield.rotation.x = -Math.PI / 2; shield.scale.setScalar(R);
  S.cur = {
    kind: 'knight', t: 0, hit: new Set(), dir, trail: 0, shield,
    update(dt, c) {
      const o = p.obj;
      p.dashT = Math.max(p.dashT, 0.06); p.dashDir.copy(c.dir); p.invuln = Math.max(p.invuln, 0.2);
      p.swingA = Math.atan2(c.dir.x, c.dir.z); o.rotation.y = p.swingA;
      shield.position.set(o.position.x + c.dir.x * 0.9, 0.9, o.position.z + c.dir.z * 0.9);
      shield.rotation.z = -p.swingA + Math.PI / 2;
      shield.material.opacity = 0.35 + Math.sin(c.t * 40) * 0.12;
      for (const e of A.enemies) {
        if (!A.isActive(e) || c.hit.has(e)) continue;
        const rel = new THREE.Vector3(e.obj.position.x - o.position.x, 0, e.obj.position.z - o.position.z);
        if (rel.length() - e.def.radius < R) {
          c.hit.add(e);
          const side = new THREE.Vector3(-c.dir.z, 0, c.dir.x); side.multiplyScalar(Math.sign(rel.dot(side)) || 1);
          const push = c.dir.clone().multiplyScalar(0.8).add(side.multiplyScalar(0.6)).normalize();
          A.damageEnemy(e, dmg, push, true, 18);
          A.burst(e.obj.position, 6, COL.gold, 5);
        }
      }
      c.trail -= dt;
      if (c.trail <= 0) { c.trail = 0.07; A.spawnRingFx(o.position, 1.6, 0xffe066); A.burst(o.position, 3, COL.gold, 3); }
      A.sfx.charge && A.sfx.charge();
      return c.t >= dur;
    },
    end(c) {
      p.dashT = 0; p.invuln = Math.max(p.invuln, 0.4);
      if (m) {   // ustalık: bitişte şok dalgası
        const R2 = 5.5;
        dmgIn(pos(), R2, A.run.s.atkDmg * 2.5, 16);
        A.spawnRingFx(pos(), R2, 0xffe066); A.spawnRingFx(pos(), R2 * 0.6, 0xffffff);
        A.sfx.slam && A.sfx.slam(); A.shake(0.45);
      } else A.sfx.slam && A.sfx.slam();
    },
    cleanup() { rm(shield); shield.material.dispose(); shield.geometry.dispose(); },
  };
  return true;
}

// =====================================================
//  BARBAR — Kasırga
// =====================================================
function startBarb() {
  const p = P(), m = master();
  const dur = m ? 4.5 : 3.0, R = (m ? 4.2 : 3.4) * Math.max(1, A.run.s.range / 2.8), dmg = A.run.s.atkDmg * (m ? 1.25 : 0.9);
  const g = add(new THREE.Group());
  const arcs = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28, 1, 0, 2.4), additive(i % 2 ? 0xffffff : 0xffb36b, 0.45));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.25 + i * 0.55; mesh.scale.setScalar(0.45 + i * 0.2);
    g.add(mesh); arcs.push(mesh);
  }
  const floor = new THREE.Mesh(flatRing, additive(0xff8a3d, 0.5)); floor.position.y = 0.1; floor.scale.setScalar(R); g.add(floor);
  S.cur = {
    kind: 'barbarian', t: 0, tick: 0, spin: 0, snd: 0,
    update(dt, c) {
      const o = p.obj;
      g.position.set(o.position.x, 0, o.position.z);
      arcs.forEach((a, i) => { a.rotation.z += dt * (14 + i * 4) * (i % 2 ? -1 : 1); a.scale.setScalar((0.5 + i * 0.22) * R * 0.85 * (1 + Math.sin(c.t * 5 + i) * 0.05)); });
      // Oyuncu dönerken hareket edebilir; saldırı animasyonu kasırgayı gösterir
      c.spin += dt * 16; p.swingA = c.spin; p.lock = 0.1; p.atkTimer = Math.max(p.atkTimer, 0.2); p.hitAt = -1;
      A.play(p, 'Melee_2H_Attack_Spin', false, 0.05, 2.2);
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick = 0.2;
        dmgIn(o.position, R, dmg, 8);
        A.burst(o.position, 5, COL.fire, 5);
      }
      c.snd -= dt; if (c.snd <= 0) { c.snd = 0.35; A.sfx.whirl && A.sfx.whirl(); }
      return c.t >= dur;
    },
    cleanup() { rm(g); g.traverse(o => { if (o.isMesh) { o.material.dispose(); if (o.geometry !== flatRing) o.geometry.dispose(); } }); },
    end() { A.spawnRingFx(pos(), R * 1.1, 0xff8a3d); p.lock = 0; },
  };
  return true;
}

// =====================================================
//  BÜYÜCÜ — Meteor Yağmuru (önce yerde uyarı)
// =====================================================
function startMage() {
  const p = P(), m = master();
  const n = m ? 10 : 6, R = m ? 3.4 : 2.8, dmg = A.run.s.atkDmg * (m ? 7 : 5);
  let spots = crowdSpots(n, R, pos(), 22);
  // Düşman azsa kalanı oyuncunun çevresine rastgele serpiştir
  while (spots.length < n) {
    const a = Math.random() * 6.283, d = 4 + Math.random() * 8;
    spots.push({ x: pos().x + Math.cos(a) * d, z: pos().z + Math.sin(a) * d });
  }
  p.lock = 0.5; p.swingA = Math.atan2(spots[0].x - pos().x, spots[0].z - pos().z);
  A.play(p, 'Ranged_Magic_Raise', true, 0.1, 1.4);
  spots.forEach((s, i) => {
    arenaClampPt(s);
    const warn = add(new THREE.Group());
    const ring = new THREE.Mesh(flatRing, additive(0xff3a2a, 0.9)), disc = new THREE.Mesh(flatDisc, additive(0xff3a2a, 0.18));
    ring.position.y = disc.position.y = 0.08; warn.add(ring, disc);
    warn.position.set(s.x, 0, s.z); warn.scale.setScalar(R);
    const rock = add(new THREE.Group());
    rock.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshBasicMaterial({ color: 0xff6a1a })));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 10), additive(0xffa347, 0.35)); rock.add(glow);
    rock.visible = false;
    const delay = 1.0 + i * 0.17, FALL = 0.5;
    S.list.push({
      t: 0, done: false,
      update(dt, f) {
        const k = f.t / delay;
        warn.scale.setScalar(R * (0.55 + 0.45 * Math.min(1, k)));
        ring.material.opacity = 0.5 + Math.sin(f.t * 22) * 0.35;
        const fall = (f.t - (delay - FALL)) / FALL;
        if (fall > 0 && f.t < delay) {
          rock.visible = true;
          const q = Math.min(1, fall);
          rock.position.set(s.x - (1 - q) * 5, 0.8 + (1 - q * q) * 16, s.z - (1 - q) * 5);
          rock.rotation.x += dt * 8; rock.rotation.z += dt * 6;
        }
        if (f.t >= delay) {
          dmgIn(s, R, dmg, 14);
          A.spawnRingFx(s, R, 0xff7a2a); A.spawnRingFx(s, R * 0.55, 0xffe066);
          A.burst({ x: s.x, y: 0.6, z: s.z }, 16, COL.fire, 7);
          A.sfx.meteorHit && A.sfx.meteorHit(); A.shake(0.22);
          return true;
        }
        return false;
      },
      cleanup() { rm(warn); rm(rock); warn.traverse(o => o.isMesh && o.material.dispose()); rock.traverse(o => { if (o.isMesh) { o.material.dispose(); o.geometry.dispose(); } }); },
    });
  });
  A.sfx.meteor && A.sfx.meteor();
  S.cur = { kind: 'mage', t: 0, update: (dt, c) => c.t >= 0.4 };   // kısa süre meşgul (başka Süper başlamaz)
  return true;
}
function arenaClampPt(s) { const d = Math.hypot(s.x, s.z); if (d > 15.5) { s.x *= 15.5 / d; s.z *= 15.5 / d; } }

// =====================================================
//  OKÇU — Ok Yağmuru
// =====================================================
let arrowGeo = null;
function startRanger() {
  const p = P(), m = master();
  const spots = crowdSpots(1, 6, pos(), 18);
  const dirN = nearestDir(pos(), 20) || new THREE.Vector3(Math.sin(p.obj.rotation.y), 0, Math.cos(p.obj.rotation.y));
  const c0 = spots[0] || { x: pos().x + dirN.x * 6, z: pos().z + dirN.z * 6 };
  arenaClampPt(c0);
  const AR = m ? 9.5 : 7.5, total = m ? 90 : 50, dur = m ? 3.0 : 2.4, dmg = A.run.s.atkDmg * (m ? 2.0 : 1.5), hitR = 1.7;
  p.lock = 0.4; p.swingA = Math.atan2(c0.x - pos().x, c0.z - pos().z);
  A.play(p, 'Ranged_Bow_Release', true, 0.08, 1.6);
  // Alan işareti
  const area = add(new THREE.Group());
  const ring = new THREE.Mesh(flatRing, additive(0x9bff7a, 0.7)), disc = new THREE.Mesh(flatDisc, additive(0x9bff7a, 0.08));
  ring.position.y = disc.position.y = 0.07; area.add(ring, disc); area.position.set(c0.x, 0, c0.z); area.scale.setScalar(AR);
  S.list.push({ t: 0, update: (dt, f) => { ring.material.opacity = 0.35 + Math.sin(f.t * 10) * 0.2; area.scale.setScalar(AR * (1 + Math.max(0, 0.15 - f.t) * 3)); return f.t >= dur + 0.6; },
    cleanup() { rm(area); area.traverse(o => o.isMesh && o.material.dispose()); } });
  S.cur = {
    kind: 'ranger', t: 0, fired: 0,
    update(dt, c) {
      const want = Math.min(total, Math.floor(c.t / dur * total));
      while (c.fired < want) { c.fired++; dropArrow(c0, AR, dmg, hitR); }
      return c.t >= dur;
    },
  };
  A.sfx.arrowRain && A.sfx.arrowRain();
  return true;
}
function dropArrow(c0, AR, dmg, hitR) {
  const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * AR;
  const x = c0.x + Math.cos(a) * r, z = c0.z + Math.sin(a) * r;
  const model = A.G.arrow.scene.clone();
  model.scale.setScalar(1.8); model.rotation.x = Math.PI / 2;   // ok modeli +Z'ye bakar → aşağı
  const g = add(new THREE.Group()); g.add(model);
  const FALL = 0.32 + Math.random() * 0.1;
  g.position.set(x - 2, 14, z - 2);
  S.list.push({
    t: 0, landed: false,
    update(dt, f) {
      if (!f.landed) {
        const q = Math.min(1, f.t / FALL);
        g.position.set(x - 2 * (1 - q), 0.2 + 14 * (1 - q), z - 2 * (1 - q));
        if (q >= 1) {
          f.landed = true; f.t = 0;
          dmgIn({ x, z }, hitR, dmg, 6);
          A.burst({ x, y: 0.3, z }, 3, COL.green, 3);
          A.sfx.arrowHit && A.sfx.arrowHit();
        }
        return false;
      }
      return f.t > 0.7;   // saplanmış ok biraz kalır
    },
    cleanup() { rm(g); },
  });
}

// =====================================================
//  HAYDUT — Gölge Dansı
// =====================================================
function startRogue() {
  const p = P(), m = master();
  const strikes = m ? 9 : 6;
  const near = A.nearestEnemies(pos(), strikes, 16);
  if (!near.length) return false;
  const dmgK = m ? 3.0 : 2.2;
  const seq = [];
  for (let i = 0; i < strikes; i++) seq.push(near[i % near.length]);   // az düşman varsa aynı hedefe tekrar
  p.invuln = Math.max(p.invuln, 0.6);
  S.cur = {
    kind: 'rogue', t: 0, i: 0, step: 0.12, wait: 0.05, freeze: true,
    update(dt, c) {
      p.invuln = Math.max(p.invuln, 0.6); p.dashT = 0; p.atkTimer = Math.max(p.atkTimer, 0.3);
      c.wait -= dt;
      if (c.wait > 0) return false;
      if (c.i >= seq.length) return true;
      let e = seq[c.i++];
      if (!A.isActive(e)) { e = A.nearestEnemies(pos(), 1, 16)[0]; if (!e) return true; }
      const from = { x: pos().x, z: pos().z }, tp = e.obj.position;
      const back = new THREE.Vector3(from.x - tp.x, 0, from.z - tp.z); if (back.lengthSq() < 0.01) back.set(1, 0, 0); back.normalize();
      const off = e.def.radius + 0.7;
      p.obj.position.set(tp.x + back.x * off, 0, tp.z + back.z * off); arenaClamp(p.obj.position);
      const face = new THREE.Vector3(-back.x, 0, -back.z);
      p.swingA = Math.atan2(face.x, face.z); p.obj.rotation.y = p.swingA; p.lock = 0.2;
      A.play(p, c.i % 2 ? 'Melee_Dualwield_Attack_Slice' : 'Melee_Dualwield_Attack_Stab', true, 0.02, 3.2);
      // Kritik vuruş (şansı 1'e çek)
      const Sx = A.run.s, c0 = Sx.crit; Sx.crit = 1;
      A.damageEnemy(e, Sx.atkDmg * dmgK, face, true, 5);
      Sx.crit = c0;
      A.burst({ x: from.x, y: 0.8, z: from.z }, 6, COL.purple, 4);
      A.burst({ x: tp.x, y: 0.9, z: tp.z }, 8, COL.dark, 5);
      A.spawnRingFx(from, 1.4, 0xa05cff); A.spawnRingFx(tp, 2.0, 0xe8d6ff);
      A.sfx.shadow && A.sfx.shadow();
      c.wait = c.step;
      return false;
    },
    end() {
      p.invuln = Math.max(0, 0.7); p.lock = 0;
      dmgIn(pos(), 3.2, A.run.s.atkDmg * 1.6, 9);
      A.spawnRingFx(pos(), 3.2, 0xa05cff); A.shake(0.3);
    },
  };
  return true;
}
