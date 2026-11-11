// =====================================================
//  Boss yapay zekâsı (bosses.js)
//  Her boss'un kendine özel saldırıları, yerde uyarı (telegraph) alanları, boss mermileri,
//  kemik/bıçak dikenleri ve Kemik Kral'ın fazları burada.
//  Görseller InstancedMesh ile toplu çiziliyor → mobilde az çizim çağrısı.
//  Kural: her hasarlı saldırının önce yerde kırmızı bir uyarısı olur; atılma (dash) ile kaçılabilir.
// =====================================================
import * as THREE from 'three';
import { sfx } from './audio.js';
import { ARENA, clampPt, inside, toWall as arenaToWall, maxExtent } from './arena.js';

let A = null;   // game.js'ten gelen bağlam (sahne, oyuncu, hasar, sarsıntı ...)
const hazards = [], bullets = [], spikes = [];
let discMesh, rectMesh, ringMesh, bulletMesh, spikeMesh;
const dummy = new THREE.Object3D(), tc = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
const RED_O = new THREE.Color(0.5, 0.05, 0.04), RED_I = new THREE.Color(1, 0.16, 0.08);
const PUR_O = new THREE.Color(0.3, 0.1, 0.55), PUR_I = new THREE.Color(0.7, 0.35, 1);
const DARK = new THREE.Color(0x3a1d5c), PURP = new THREE.Color(0xb46bff), STEEL = new THREE.Color(0xc8d0dc), BONE = new THREE.Color(0xeee6d6);
const TAU = Math.PI * 2;
const BUL_P = new THREE.Color(0xd070ff), FIRE = new THREE.Color(0xff7a1a), EMBER = new THREE.Color(0xffc040), ASH = new THREE.Color(0x5a4a50);

export function initBosses(api) {
  A = api;
  const tmat = (op = 0.5) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
  discMesh = inst(new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2), tmat(), 96);
  rectMesh = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), tmat(), 48);
  ringMesh = inst(new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2), tmat(0.8), 16);
  bulletMesh = inst(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 320);   // renk mermi başına (mor / ateş)
  spikeMesh = inst(new THREE.ConeGeometry(0.22, 1.3, 5).translate(0, 0.65, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 160);
}
function inst(geo, mat, cap) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
  for (let i = 0; i < cap; i++) m.setColorAt(i, WHITE);
  A.scene.add(m);
  return m;
}

// ---------- Uyarı alanları ----------
// Daire: delay sn sonra içindekine hasar verir (safe: sadece mor bilgi halkası)
function circle(owner, x, z, r, delay, dmg, opt) {
  const pt = { x, z }; clampPt(pt, -0.5); x = pt.x; z = pt.z;
  const h = { k: 'c', owner, x, z, r, delay, t: 0, dmg, ...opt };
  hazards.push(h); return h;
}
// Çizgi: hücum yolunu gösterir (hasarı boss'un kendisi verir). dead=true olunca silinir.
function line(owner, x, z, dx, dz, len, w, delay) {
  const h = { k: 'l', owner, x, z, dx, dz, len, w, delay, t: 0, dead: false };
  hazards.push(h); return h;
}
// Şok dalgası halkası: delay sonra merkezden genişler, kenarına değen yer (atılma ile içinden geçilir)
function ring(owner, x, z, delay, speed, dmg) {
  const h = { k: 'r', owner, x, z, r: 0.6, delay, t: 0, speed, rMax: 2 * maxExtent() + 4, dmg, hit: false };
  hazards.push(h); return h;
}
function bullet(owner, x, z, a, speed, dmg, life = 4.5, col = null) {
  if (bullets.length >= 300) return;
  bullets.push({ owner, x, z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, life, dmg, col });
}
// Lav birikintisi (2. arena): bir süre yerde kalır, içinde durana aralıklı hasar verir. delay: önce uyarı
function pool(owner, x, z, r, life, dmg, delay = 0.6) {
  const pt = { x, z }; clampPt(pt, -0.3);
  const h = { k: 'p', owner, x: pt.x, z: pt.z, r, life, delay, t: 0, dmg, tick: 0 };
  hazards.push(h); return h;
}
function spawnSpikes(x, z, r, col) {
  const n = Math.min(9, 2 + Math.round(r * 3));
  for (let i = 0; i < n; i++) {
    if (spikes.length >= 150) spikes.shift();
    const a = Math.random() * TAU, d = i === 0 ? 0 : Math.sqrt(Math.random()) * r * 0.85;
    spikes.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, t: 0, s: 0.8 + Math.random() * 0.6, rx: (Math.random() - 0.5) * 0.5, rz: (Math.random() - 0.5) * 0.5, col });
  }
}
function killHazardsOf(e) {
  for (let i = hazards.length - 1; i >= 0; i--) if (hazards[i].owner === e) hazards.splice(i, 1);
}

// Ateş Yağmuru (game.js updateFireRain): sahibi olmayan uyarılı daire; hasar kaynağı 'Ateş Yağmuru'
export function fireRain(x, z, r, delay, dmg) {
  return circle(null, x, z, r, delay, dmg, { env: 'Ateş Yağmuru', fx: 0xff7a1a });
}
// (Artık kullanılmıyor, 9 Kas) Kutsal Siper kalkanları eskiden yakındaki boss mermilerini yok ediyordu
export function destroyBulletsNear(x, z, r) {
  let n = 0;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (Math.abs(b.x - x) < r && Math.abs(b.z - z) < r && Math.hypot(b.x - x, b.z - z) < r) { bullets.splice(i, 1); n++; }
  }
  return n;
}

export function clearBossFx() {
  hazards.length = 0; bullets.length = 0; spikes.length = 0;
  if (discMesh) discMesh.count = rectMesh.count = ringMesh.count = bulletMesh.count = spikeMesh.count = 0;
}

// Her karede: uyarıları, mermileri ve dikenleri güncelle + çiz
export function updateBossFx(dt) {
  if (!A) return;
  const pl = A.player(), pp = pl.obj.position;
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    if (h.owner && h.owner.state === 'dead') { hazards.splice(i, 1); continue; }
    h.t += dt;
    if (h.k === 'c') {
      if (h.t < h.delay) continue;
      if (!h.safe) {
        if (!pl.dead && Math.hypot(pp.x - h.x, pp.z - h.z) < h.r + 0.25) {
          if (h.env) A.hurtEnv(h.dmg, h.env); else A.hurt(h.dmg, h.spikes ? 'Kemik Dikenleri' : 'Yer Darbesi');
        }
        A.ringFx(h, h.r, h.fx || 0xff5040);
      }
      if (h.spikes) spawnSpikes(h.x, h.z, h.r, h.spikes);
      if (h.snd) sfx[h.snd]();
      if (h.shake) A.shake(h.shake);
      hazards.splice(i, 1);
    } else if (h.k === 'l') {
      if (h.dead) hazards.splice(i, 1);
    } else if (h.k === 'r') {
      if (h.t < h.delay) continue;
      if (!h.launched) { h.launched = true; sfx.shock(); A.shake(0.3); }
      h.r += h.speed * dt;
      const d = Math.hypot(pp.x - h.x, pp.z - h.z);
      if (!h.hit && !pl.dead && d > h.r * 0.93 - 0.45 && d < h.r + 0.45) { h.hit = true; A.hurt(h.dmg, 'Şok Halkası'); }
      if (h.r > h.rMax) hazards.splice(i, 1);
    } else if (h.k === 'p') {
      if (h.t < h.delay) continue;
      h.tick -= dt;
      if (h.tick <= 0 && !pl.dead && Math.hypot(pp.x - h.x, pp.z - h.z) < h.r) { h.tick = 0.5; A.hurt(h.dmg, 'Lav Birikintisi'); }
      if (h.t > h.delay + h.life) hazards.splice(i, 1);
    }
  }
  const RX = ARENA.hw + 1.5, RZ = ARENA.hd + 1.5;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt; b.x += b.vx * dt; b.z += b.vz * dt;
    if (!pl.dead && Math.abs(pp.x - b.x) < 0.6 && Math.abs(pp.z - b.z) < 0.6 && Math.hypot(pp.x - b.x, pp.z - b.z) < 0.6) { A.hurt(b.dmg, 'Mermi'); b.life = 0; }
    if (b.life <= 0 || (b.owner && b.owner.state === 'dead') || Math.abs(b.x) > RX || Math.abs(b.z) > RZ) bullets.splice(i, 1);
  }
  for (let i = spikes.length - 1; i >= 0; i--) { spikes[i].t += dt; if (spikes[i].t > 0.75) spikes.splice(i, 1); }
  draw();
}

function setI(mesh, i, x, y, z, ry, sx, sy, sz, col) {
  dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, col);
}
function draw() {
  let nd = 0, nr = 0, ng = 0;
  const pulse = 0.85 + Math.sin(performance.now() * 0.02) * 0.15;
  for (const h of hazards) {
    const k = h.delay > 0 ? Math.min(1, h.t / h.delay) : 1;
    if (h.k === 'c' && nd < 94) {
      const o = h.safe ? PUR_O : RED_O, n = h.safe ? PUR_I : RED_I;
      setI(discMesh, nd++, h.x, 0.05, h.z, 0, h.r, 1, h.r, tc.copy(o).multiplyScalar(0.7 + 0.3 * k));
      setI(discMesh, nd++, h.x, 0.07, h.z, 0, h.r * k, 1, h.r * k, tc.copy(n).multiplyScalar(pulse));
    } else if (h.k === 'l' && nr < 46) {
      const ry = Math.atan2(h.dx, h.dz);
      setI(rectMesh, nr++, h.x, 0.055, h.z, ry, h.w, 1, h.len, tc.copy(RED_O).multiplyScalar(0.7 + 0.3 * k));
      setI(rectMesh, nr++, h.x, 0.075, h.z, ry, h.w * 0.92, 1, h.len * k, tc.copy(RED_I).multiplyScalar(pulse));
    } else if (h.k === 'p' && nd < 94) {
      // Lav: uyarıda koyu kırmızı büyür; sonra parlak turuncu, sönerken küçülür
      const live = h.t >= h.delay, fade = live ? Math.min(1, (h.delay + h.life - h.t) / 0.6) : k;
      setI(discMesh, nd++, h.x, live ? 0.06 : 0.05, h.z, 0, h.r * fade, 1, h.r * fade,
        live ? tc.setRGB(1, 0.42 + Math.sin(h.t * 6) * 0.08, 0.08) : tc.copy(RED_O).multiplyScalar(0.7 + 0.3 * k));
      if (live && nd < 94) setI(discMesh, nd++, h.x, 0.075, h.z, 0, h.r * fade * 0.55, 1, h.r * fade * 0.55, tc.setRGB(1, 0.85, 0.3));
    } else if (h.k === 'r') {
      if (h.t < h.delay) { if (nd < 94) setI(discMesh, nd++, h.x, 0.06, h.z, 0, 2.4 * k, 1, 2.4 * k, tc.copy(RED_I).multiplyScalar(pulse * 0.8)); }
      else if (ng < 16) setI(ringMesh, ng++, h.x, 0.09, h.z, 0, h.r, 1, h.r, tc.setRGB(1, 0.35, 0.2));
    }
  }
  discMesh.count = nd; rectMesh.count = nr; ringMesh.count = ng;
  let nb = 0;
  for (const b of bullets) {
    dummy.position.set(b.x, 1.1, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1 + Math.sin(b.life * 20) * 0.15); dummy.updateMatrix();
    bulletMesh.setColorAt(nb, b.col || BUL_P); bulletMesh.setMatrixAt(nb++, dummy.matrix);
  }
  bulletMesh.count = nb;
  let ns = 0;
  for (const s of spikes) {
    const y = s.t < 0.1 ? s.t / 0.1 : s.t > 0.5 ? Math.max(0, 1 - (s.t - 0.5) / 0.25) : 1;
    dummy.position.set(s.x, -0.1, s.z); dummy.rotation.set(s.rx, 0, s.rz); dummy.scale.set(s.s, s.s * y + 0.01, s.s); dummy.updateMatrix();
    spikeMesh.setMatrixAt(ns, dummy.matrix); spikeMesh.setColorAt(ns++, s.col);
  }
  spikeMesh.count = ns;
  for (const m of [discMesh, rectMesh, ringMesh, bulletMesh, spikeMesh]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

// Bot için: boss tehlikelerinden kaçma yönü ekler, tehlike puanı döner (>=2 → atıl)
export function bossDanger(p, out) {
  let danger = 0;
  for (const h of hazards) {
    if (h.k === 'c') {
      if (h.safe) continue;
      const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 0.01;
      if (d < h.r + 0.9) { out.x += dx / d * 6; out.z += dz / d * 6; if (h.delay - h.t < 0.22) danger += 2; }
    } else if (h.k === 'l') {
      const rx = p.x - h.x, rz = p.z - h.z, along = rx * h.dx + rz * h.dz;
      if (along < -1.5 || along > h.len + 1.5) continue;
      const side = rx * h.dz - rz * h.dx;   // çizgiye dik mesafe (işaretli)
      if (Math.abs(side) < h.w / 2 + 1) {
        const s = side >= 0 ? 1 : -1;
        out.x += h.dz * s * 7; out.z += -h.dx * s * 7;
        const o = h.owner && h.owner.obj.position;
        if (h.t >= h.delay - 0.15 && o && Math.hypot(p.x - o.x, p.z - o.z) < 5) danger += 2;
      }
    } else if (h.k === 'p') {
      const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 0.01;
      if (d < h.r + 0.8) { out.x += dx / d * 5; out.z += dz / d * 5; }
    } else if (h.k === 'r' && h.t >= h.delay) {
      const gap = Math.hypot(p.x - h.x, p.z - h.z) - h.r;
      if (!h.hit && gap > -0.3 && gap < 0.9) danger += 2;
    }
  }
  for (const b of bullets) {
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 0.01;
    if (d < 2.5) {
      const side = b.vx * dz - b.vz * dx > 0 ? 1 : -1;
      out.x += -b.vz * side * 0.12 / d; out.z += b.vx * side * 0.12 / d;
      if (d < 0.95 && dx * b.vx + dz * b.vz > 0) danger += 2;
    }
  }
  return danger;
}

// ---------- Yardımcılar ----------
const P = () => A.player().obj.position;
function toP(e) {
  const o = e.obj.position, p = P();
  const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz) || 0.01;
  return { dx: dx / d, dz: dz / d, d };
}
function* wait(b, s) { while (s > 0) { yield; s -= b.dt; } }
// Arenanın kenarına kadar olan mesafe (bir yönde)
function toWall(x, z, dx, dz) {
  return arenaToWall(x, z, dx, dz, 0.6);
}
function aim(e, t) { e.obj.rotation.y = Math.atan2(t.dx, t.dz); }
function walk(e, t, sign, dt) {
  const o = e.obj.position;
  o.x += t.dx * sign * e.def.speed * dt; o.z += t.dz * sign * e.def.speed * dt;
  A.play(e, e.def.walk, false, 0.2, e.def.walkAnim);
}
function idleAnim(e) { A.play(e, 'Skeletons_Idle', false, 0.2); }
// Boss bir çizgi boyunca hızla koşar; değerse bir kez vurur
function* rush(e, b, t, len, speed, hitR, dmg, trail) {
  const o = e.obj.position;
  let went = 0, hit = false, f = 0;
  while (went < len) {
    const s = Math.min(speed * b.dt, len - went);
    o.x += t.dx * s; o.z += t.dz * s; went += s;
    const p = P();
    if (!hit && Math.hypot(p.x - o.x, p.z - o.z) < hitR) { hit = true; A.hurt(dmg, 'Hücum'); A.shake(0.35); }
    if ((f++ & 1) === 0) A.burst(o, 2, trail, 2);
    yield;
  }
}
function pickFrom(b, list) {
  // Uygun saldırılardan rastgele biri (son yapılanı tekrar etmemeye çalış)
  const ok = list.filter(x => x.ok && (b.cds[x.id] || 0) <= 0);
  if (!ok.length) return null;
  const pool = ok.length > 1 ? ok.filter(x => x.id !== b.last) : ok;
  const c = pool[(Math.random() * pool.length) | 0];
  b.cds[c.id] = c.cd; b.last = c.id;
  return c.fn();
}

// ---------- Ortak saldırılar ----------
// Önüne yere vurma: kırmızı daire büyür, sonra patlar
function* slam(e, b, r, clip, speed, dmgMul = 1) {
  const t = toP(e); aim(e, t);
  const dur = A.play(e, clip, true, 0.1, speed) || 1;
  const o = e.obj.position, off = Math.min(2.2, t.d);
  circle(e, o.x + t.dx * off, o.z + t.dz * off, r, Math.max(0.5, dur * 0.55), e.dmg * dmgMul, { snd: 'slam', shake: 0.45 });
  sfx.warn();
  yield* wait(b, dur);
}
// Mor büyü halkası: önce boss'un altında mor uyarı, sonra her yöne mermi
function* volley(e, b, n, speed, waves = 1) {
  const o = e.obj.position;
  circle(e, o.x, o.z, 1.8, 0.55, 0, { safe: true });
  A.play(e, 'Ranged_Magic_Spellcasting', true, 0.1, 1.2); sfx.warn();
  yield* wait(b, 0.55);
  for (let w = 0; w < waves; w++) {
    const off = Math.random();
    for (let i = 0; i < n; i++) bullet(e, o.x, o.z, (i / n + off) * TAU, speed, e.dmg * 0.45);
    sfx.nova(); A.burst(o, 10, PURP, 4);
    if (w < waves - 1) { A.play(e, 'Ranged_Magic_Spellcasting', true, 0.1, 1.2); yield* wait(b, 0.55); }
  }
  yield* wait(b, 0.4);
}
// Dönen sarmal mermi yağmuru (kollar arasında boşluk var; atılma ile içinden geçilir)
function* spiral(e, b, arms, dur, speed, omega, every = 0.15, col = null) {
  const o = e.obj.position;
  circle(e, o.x, o.z, 1.8, 0.6, 0, { safe: true });
  A.play(e, 'Ranged_Magic_Raise', true, 0.1, 3); sfx.warn();
  yield* wait(b, 0.6);
  A.play(e, 'Ranged_Magic_Spellcasting_Long', true, 0.1, 2.53 / dur);
  const dir = Math.random() < 0.5 ? 1 : -1;
  let a = Math.random() * TAU, acc = every;
  for (let T = 0; T < dur; T += b.dt) {
    a += dir * omega * b.dt; acc += b.dt;
    while (acc >= every) {
      acc -= every;
      for (let k = 0; k < arms; k++) bullet(e, o.x, o.z, a + k * TAU / arms, speed, e.dmg * 0.4, 5, col);
      sfx.zap();
    }
    yield;
  }
  yield* wait(b, 0.35);
}
// İskelet çağırma: mor daireler belirir, sonra iskeletler çıkar
function* summon(e, b, n, types) {
  n = Math.min(n, A.cap() - A.alive());
  if (n <= 0) return;
  A.play(e, 'Ranged_Magic_Summon', true, 0.1, 2.2);
  const o = e.obj.position, spots = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + Math.random(), x = o.x + Math.cos(a) * 2.6, z = o.z + Math.sin(a) * 2.6;
    spots.push(circle(e, x, z, 0.9, 0.8, 0, { safe: true }));
  }
  yield* wait(b, 0.8);
  for (const s of spots) A.spawnEnemy(types[(Math.random() * types.length) | 0], { summoned: true, at: { x: s.x, z: s.z } });
  A.ringFx(o, 3, 0x9a6bff); A.burst(o, 20, PURP, 5); sfx.teleport();
  yield* wait(b, 1.1);
}
// Oyuncunun bulunduğu yere ve etrafına kemik/bıçak dikenleri
function* spikeField(e, b, n, spread, r, delay, col, snd, dmgMul) {
  const p = P();
  circle(e, p.x, p.z, r, delay, e.dmg * dmgMul, { spikes: col, snd });
  for (let i = 1; i < n; i++) {
    const a = Math.random() * TAU, d = 2 + Math.random() * spread;
    circle(e, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, r, delay + Math.random() * 0.45, e.dmg * dmgMul, { spikes: col, snd });
  }
  sfx.warn();
}

// =====================================================
//  Boss'lar
// =====================================================
const AI = {
  // ---- Dalga 5: Kemik Devi — yere vurma, hücum (şarj), faz 2'de yer yarığı ----
  giant: {
    idle(e, b, t, dt) { if (t.d > 2.4) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'slam', ok: t.d < 3.8, cd: 2.2, fn: () => slam(e, b, 2.8, 'Melee_1H_Attack_Jump_Chop', 0.75) },
        { id: 'charge', ok: t.d > 4.5, cd: b.phase > 1 ? 4 : 6, fn: () => this.charge(e, b) },
        { id: 'quake', ok: b.phase > 1 && t.d < 11, cd: 6, fn: () => this.quake(e, b) },
      ]);
    },
    *charge(e, b) {
      const o = e.obj.position, t = toP(e); aim(e, t);
      const len = Math.min(16, toWall(o.x, o.z, t.dx, t.dz));
      const wind = b.phase > 1 ? 0.8 : 1.0;
      const h = line(e, o.x, o.z, t.dx, t.dz, len, 3.2, wind);
      A.play(e, 'Skeletons_Taunt', true, 0.1, 1.03 / wind); sfx.warn();
      yield* wait(b, wind);
      sfx.charge(); A.play(e, 'Running_A', false, 0.05, 1.8);
      yield* rush(e, b, t, len, 17, 1.7, e.dmg * 1.1, BONE);
      h.dead = true;
      A.shake(0.5); sfx.slam(); A.ringFx(o, 2.5, 0xff5040); A.burst(o, 14, BONE, 5);
      // Kısa sersemleme: oyuncu için vurma fırsatı
      A.play(e, 'Hit_B', true, 0.1, 0.7);
      yield* wait(b, b.phase > 1 ? 0.8 : 1.2);
    },
    *quake(e, b) {
      const t = toP(e); aim(e, t);
      const dur = A.play(e, 'Melee_2H_Attack_Chop', true, 0.1, 0.8) || 1.5, o = e.obj.position;
      for (let i = 0; i < 6; i++) {
        const x = o.x + t.dx * (2.4 + i * 2.1), z = o.z + t.dz * (2.4 + i * 2.1);
        if (!inside(x, z)) break;
        circle(e, x, z, 1.5, dur * 0.5 + 0.3 + i * 0.12, e.dmg * 0.8, { spikes: BONE, snd: 'spike', shake: 0.15 });
      }
      sfx.warn();
      yield* wait(b, dur);
    },
  },

  // ---- Dalga 10: Kemik Nekromantı — ışınlanma, sarmal mermi, lanet dikenleri, iskelet çağırma ----
  necro: {
    idle(e, b, t, dt) {
      if (t.d > 9) walk(e, t, 1, dt); else if (t.d < 5) walk(e, t, -1, dt); else idleAnim(e);
      if (t.d < 3 && (b.cds.blink || 0) <= 0) b.next = 0;   // çok yaklaşınca hemen ışınlan
    },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'blink', ok: true, cd: 4, fn: () => this.blink(e, b) },
        { id: 'spiral', ok: t.d > 3, cd: 6, fn: () => spiral(e, b, b.phase > 1 ? 3 : 2, 2.4, 5, 1.6) },
        { id: 'curse', ok: true, cd: 4, fn: () => this.curse(e, b) },
        { id: 'summon', ok: A.alive() < A.cap() - 2, cd: 9, fn: () => summon(e, b, b.phase > 1 ? 4 : 3, ['minion', 'minion', 'warrior']) },
      ]);
    },
    *curse(e, b) {
      A.play(e, 'Ranged_Magic_Shoot', true, 0.1, 0.8);
      yield* spikeField(e, b, b.phase > 1 ? 7 : 5, 3.5, 1.6, 1.15, BONE, 'spike', 0.8);
      yield* wait(b, 1.0);
    },
    *blink(e, b) {
      const o = e.obj.position, p = P();
      let x = 0, z = 0;
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * TAU, r = 7 + Math.random() * 2;
        x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
        if (inside(x, z, 1.5)) break;
      }
      circle(e, x, z, 1.6, 0.75, 0, { safe: true });
      sfx.teleport(); A.burst(o, 16, PURP, 5);
      e.state = 'blink';   // görünmezken hasar almaz
      for (let T = 0; T < 0.3; T += b.dt) { b.scaleK = Math.max(0.05, 1 - T / 0.3); yield; }
      b.scaleK = 0.02;
      yield* wait(b, 0.45);
      o.x = x; o.z = z; A.burst(o, 16, PURP, 5); sfx.teleport();
      for (let T = 0; T < 0.25; T += b.dt) { b.scaleK = Math.min(1, T / 0.25); yield; }
      b.scaleK = 1; e.state = 'attack';
      aim(e, toP(e));
      const n = b.phase > 1 ? 14 : 10, off = Math.random();
      for (let i = 0; i < n; i++) bullet(e, o.x, o.z, (i / n + off) * TAU, 5, e.dmg * 0.4);
      sfx.nova();
      yield* wait(b, 0.4);
    },
  },

  // ---- Dalga 15: Gölge Haydut — art arda atılmalar, gölge kopyalar, bıçak yağmuru ----
  shade: {
    idle(e, b, t, dt) { if (t.d > 2.6) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'slash', ok: t.d < 3.2, cd: 1.6, fn: () => slam(e, b, 2.2, 'Melee_Dualwield_Attack_Slice', 1.0, 0.9) },
        { id: 'dashes', ok: t.d > 3.5, cd: 5, fn: () => this.dashes(e, b) },
        { id: 'clones', ok: true, cd: 10, fn: () => this.clones(e, b) },
        { id: 'rain', ok: true, cd: 6, fn: () => this.rain(e, b) },
      ]);
    },
    *dashes(e, b) {
      const n = b.phase > 1 ? 4 : 3, wind = b.phase > 1 ? 0.5 : 0.6;
      for (let i = 0; i < n; i++) {
        const o = e.obj.position, t = toP(e); aim(e, t);
        const len = Math.min(t.d + 3.5, 12, toWall(o.x, o.z, t.dx, t.dz));
        const h = line(e, o.x, o.z, t.dx, t.dz, len, 2.6, wind);
        A.play(e, 'Melee_Blocking', false, 0.08); sfx.warn();
        yield* wait(b, wind);
        A.play(e, 'Melee_Dualwield_Attack_Slice', true, 0.05, 2.5); sfx.blade();
        yield* rush(e, b, t, len, 24, 1.4, e.dmg * 0.8, DARK);
        h.dead = true;
        yield* wait(b, 0.2);
      }
      A.play(e, 'Skeletons_Taunt', true, 0.1, 1);
      yield* wait(b, 0.8);
    },
    *clones(e, b) {
      A.play(e, 'Skeletons_Taunt', true, 0.1, 1); sfx.teleport();
      const p = P(), n = b.phase > 1 ? 4 : 3, a0 = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + i * TAU / n;
        const pt = { x: p.x + Math.cos(a) * 7, z: p.z + Math.sin(a) * 7 }; clampPt(pt, 1);
        const x = pt.x, z = pt.z;
        A.spawnEnemy('shadeClone', { summoned: true, at: { x, z } });
        const c = A.enemies()[A.enemies().length - 1];
        if (c && c.type === 'shadeClone') {
          c.state = 'attack'; c.t = 99;
          c.b = { act: null, dt: 0, cds: {}, phase: 1, scaleK: 1, next: 99, knock: c.knock };
          c.b.act = this.cloneRun(c, c.b, 0.5 + i * 0.4);
          A.burst(c.obj.position, 14, DARK, 4);
        }
      }
      yield* wait(b, 2.4);
    },
    *cloneRun(c, b, delay) {
      A.play(c, 'Melee_Blocking', false, 0.1);
      for (let T = 0; T < delay; T += b.dt) { aim(c, toP(c)); yield; }
      const o = c.obj.position, t = toP(c); aim(c, t);
      const len = Math.min(t.d + 6, toWall(o.x, o.z, t.dx, t.dz));
      const h = line(c, o.x, o.z, t.dx, t.dz, len, 2.0, 0.8); sfx.warn();
      yield* wait(b, 0.8);
      A.play(c, 'Running_A', false, 0.05, 2); sfx.blade();
      yield* rush(c, b, t, len, 21, 1.1, c.dmg, DARK);
      h.dead = true;
    },
    *rain(e, b) {
      A.play(e, 'Throw', true, 0.1, 1);
      yield* spikeField(e, b, b.phase > 1 ? 12 : 9, 5, 1.3, 1.0, STEEL, 'blade', 0.7);
      yield* wait(b, 1.1);
    },
  },

  // Gölge kopya: tek bir atılma yapar ve kaybolur (bkz. shade.cloneRun)
  clone: { idle() {}, pick() { return null; } },

  // ---- Dalga 20: Kemik Kral — 3 faz ----
  king: {
    idle(e, b, t, dt) { if (t.d > 2.6) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      const ph = b.phase;
      return pickFrom(b, [
        { id: 'slam', ok: t.d < 4, cd: 2.4, fn: () => slam(e, b, 3.3, 'Melee_2H_Attack_Chop', 0.75) },
        { id: 'summon', ok: A.alive() < A.cap() - 2, cd: ph > 2 ? 10 : 7, fn: () => summon(e, b, 4, ['minion', 'minion', 'rogue']) },
        { id: 'volley', ok: true, cd: 5.5, fn: () => volley(e, b, 14, ph > 2 ? 7 : 6.5, ph > 1 ? 2 : 1) },
        { id: 'spiral', ok: ph > 1, cd: 8, fn: () => spiral(e, b, ph > 2 ? 4 : 3, 3, 4.5, 1.4) },
        { id: 'shock', ok: ph > 1, cd: 7, fn: () => this.shock(e, b) },
        { id: 'spikes', ok: ph > 2, cd: 6, fn: () => this.spikes(e, b) },
      ]);
    },
    // Genişleyen şok dalgası halkaları: kenarından atılarak geç
    *shock(e, b) {
      const dur = A.play(e, 'Melee_2H_Attack_Chop', true, 0.1, 0.75) || 2, hit = dur * 0.5, o = e.obj.position;
      const n = b.phase > 2 ? 3 : 2;
      for (let i = 0; i < n; i++) ring(e, o.x, o.z, hit + i * 0.9, 6, e.dmg * 0.8);
      sfx.warn();
      yield* wait(b, dur);
      yield* wait(b, 0.3);
    },
    // Yerden çıkan diken alanları: üç dalga halinde oyuncuyu takip eder
    *spikes(e, b) {
      A.play(e, 'Ranged_Magic_Shoot', true, 0.1, 0.7);
      for (let w = 0; w < 3; w++) {
        yield* spikeField(e, b, 5, 4, 1.6, 1.0, BONE, 'spike', 0.75);
        yield* wait(b, 0.7);
      }
      yield* wait(b, 0.5);
    },
  },
};
// =====================================================
//  2. Arena (Kızıl Dökümhane) boss'ları — ateş/lav saldırıları
//  Kural aynı: her hasarlı saldırının önce yerde uyarısı var. Lav birikintisi bir süre kalır (içinde durma).
// =====================================================
const fv = new THREE.Vector3();
// Ateş topu halkası (volley'in ateş renkli hali)
function* fireVolley(e, b, n, speed, waves = 1) {
  const o = e.obj.position;
  circle(e, o.x, o.z, 1.8, 0.55, 0, { safe: true });
  A.play(e, 'Ranged_Magic_Spellcasting', true, 0.1, 1.2); sfx.warn();
  yield* wait(b, 0.55);
  for (let w = 0; w < waves; w++) {
    const off = Math.random();
    for (let i = 0; i < n; i++) bullet(e, o.x, o.z, (i / n + off) * TAU, speed, e.dmg * 0.45, 4.5, FIRE);
    sfx.nova(); A.burst(o, 10, FIRE, 4);
    if (w < waves - 1) { A.play(e, 'Ranged_Magic_Spellcasting', true, 0.1, 1.2); yield* wait(b, 0.55); }
  }
  yield* wait(b, 0.4);
}
// Alevli hücum: kırmızı yol uyarısı, sonra hızla geçer, arkasında kor izi
function* fireCharge(e, b, maxLen, w, speed, dmgMul) {
  const o = e.obj.position, t = toP(e); aim(e, t);
  const len = Math.min(maxLen, toWall(o.x, o.z, t.dx, t.dz));
  const wind = b.phase > 1 ? 0.75 : 0.95;
  const h = line(e, o.x, o.z, t.dx, t.dz, len, w, wind);
  A.play(e, 'Skeletons_Taunt', true, 0.1, 1.1); sfx.warn();
  yield* wait(b, wind);
  sfx.charge(); A.play(e, 'Running_A', false, 0.05, 1.8);
  yield* rush(e, b, t, len, 16, 1.8, e.dmg * dmgMul, FIRE);
  h.dead = true;
  A.shake(0.4); A.ringFx(o, 2.4, 0xff6a1a); A.burst(o, 14, EMBER, 5);
  A.play(e, 'Hit_B', true, 0.1, 0.8);
  yield* wait(b, b.phase > 1 ? 0.7 : 1.0);
}
// Lav fışkırması dizisi: boss'tan oyuncuya doğru sırayla patlayan lav sütunları
function* eruption(e, b, n, step, r, dmgMul, leavePools = false) {
  const t = toP(e); aim(e, t);
  const dur = A.play(e, 'Melee_2H_Attack_Chop', true, 0.1, 0.8) || 1.4, o = e.obj.position;
  for (let i = 0; i < n; i++) {
    const x = o.x + t.dx * (2.4 + i * step), z = o.z + t.dz * (2.4 + i * step);
    if (!inside(x, z)) break;
    const d = dur * 0.5 + 0.3 + i * 0.14;
    circle(e, x, z, r, d, e.dmg * dmgMul, { spikes: FIRE, snd: 'spike', shake: 0.15, fx: 0xff6a1a });
    if (leavePools && i % 2 === 1) pool(e, x, z, 1.3, 4, e.dmg * 0.3, d);
  }
  sfx.warn();
  yield* wait(b, dur);
}
// Oyuncunun çevresine lav birikintileri yağar (uyarı → yanan alan)
function* lavaRain(e, b, n, life) {
  A.play(e, 'Ranged_Magic_Raise', true, 0.1, 1.2); sfx.warn();
  const p = P();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, d = i === 0 ? 0.5 : 2 + Math.random() * 4;
    pool(e, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 1.5 + Math.random() * 0.5, life, e.dmg * 0.3, 0.9 + i * 0.12);
  }
  yield* wait(b, 1.3);
}
// Ateş nefesi: önce önünde uzun kırmızı alan, sonra 1 sn alev (içinde kalan sürekli yanar)
function* breath(e, b, maxLen, w, dur, dmgMul) {
  const o = e.obj.position, t = toP(e); aim(e, t);
  const len = Math.min(maxLen, toWall(o.x, o.z, t.dx, t.dz) + 1);
  const wind = b.phase > 1 ? 0.8 : 1.0;
  const h = line(e, o.x, o.z, t.dx, t.dz, len, w, wind);
  A.play(e, 'Skeletons_Taunt', true, 0.1, 1); sfx.warn();
  yield* wait(b, wind);
  A.play(e, 'Melee_2H_Attack_Chop', true, 0.05, 1.1); sfx.roar();
  let tick = 0, f = 0;
  for (let T = 0; T < dur; T += b.dt) {
    tick -= b.dt;
    const p = P(), rx = p.x - o.x, rz = p.z - o.z, along = rx * t.dx + rz * t.dz, side = Math.abs(rx * t.dz - rz * t.dx);
    if (tick <= 0 && along > -0.5 && along < len && side < w / 2 + 0.2) { tick = 0.3; A.hurt(e.dmg * dmgMul, 'Ateş Nefesi'); }
    if ((f++ & 1) === 0) { const d = Math.random() * len, s = (Math.random() - 0.5) * w * 0.8; fv.set(o.x + t.dx * d + t.dz * s, 0.8, o.z + t.dz * d - t.dx * s); A.burst(fv, 3, Math.random() < 0.5 ? FIRE : EMBER, 3); }
    yield;
  }
  h.dead = true;
  yield* wait(b, 0.5);
}
// Havalanıp dalış: havada dokunulmaz; oyuncunun yerine kırmızı daire, iniş patlaması (+ lav birikintisi)
function* dive(e, b, R, pools) {
  const o = e.obj.position;
  A.play(e, 'Skeletons_Taunt', true, 0.1, 1.2); sfx.roar();
  e.state = 'blink';
  for (let T = 0; T < 0.6; T += b.dt) { o.y = 7 * (T / 0.6); yield; }
  const p = P(), tx = p.x, tz = p.z, sx = o.x, sz = o.z, fall = b.phase > 2 ? 1.0 : 1.25;
  circle(e, tx, tz, R, fall, e.dmg * 1.2, { snd: 'slam', shake: 0.8, fx: 0xff6a1a });
  sfx.warn();
  for (let T = 0; T < fall; T += b.dt) { const k = T / fall; o.x = sx + (tx - sx) * k; o.z = sz + (tz - sz) * k; o.y = 7 * (1 - k * k); yield; }
  o.x = tx; o.z = tz; o.y = 0; e.state = 'attack';
  A.burst(o, 30, FIRE, 7); A.burst(o, 16, EMBER, 5);
  if (pools) pool(e, tx, tz, 2.2, 6, e.dmg * 0.3, 0);
  A.play(e, 'Hit_B', true, 0.1, 0.8);
  yield* wait(b, 1.0);
}
// Göktaşı yağmuru: oyuncunun çevresine sırayla düşen kor sütunları
function* meteors(e, b, n) {
  A.play(e, 'Ranged_Magic_Raise', true, 0.1, 1);
  const p = P();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, d = i === 0 ? 0 : 1.5 + Math.random() * 6;
    circle(e, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 1.5, 1.0 + i * 0.16, e.dmg * 0.7, { spikes: FIRE, snd: 'slam', fx: 0xff6a1a, shake: 0.12 });
  }
  sfx.warn();
  yield* wait(b, 1.4);
}

Object.assign(AI, {
  // ---- 2. arena D5: Kül Kanat Kralı — alevli dalış hücumu, ateş tüyü halkası, faz 2'de Kor Maskesi çağırır ----
  ashking: {
    idle(e, b, t, dt) { if (t.d > 2.6) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'slam', ok: t.d < 3.6, cd: 2.2, fn: () => slam(e, b, 2.6, 'Melee_1H_Attack_Jump_Chop', 0.8) },
        { id: 'swoop', ok: t.d > 4, cd: b.phase > 1 ? 4 : 5.5, fn: () => fireCharge(e, b, 15, 3.0, 18, 1.0) },
        { id: 'gust', ok: true, cd: 5.5, fn: () => fireVolley(e, b, b.phase > 1 ? 14 : 10, 6, b.phase > 1 ? 2 : 1) },
        { id: 'summon', ok: b.phase > 1 && A.alive() < A.cap() - 2, cd: 9, fn: () => summon(e, b, 3, ['tribal', 'tribal', 'ember']) },
      ]);
    },
  },
  // ---- 2. arena D10: Cüruf Devi — dev yere vurma, lav fışkırması dizisi, lav yağmuru ----
  slaggiant: {
    idle(e, b, t, dt) { if (t.d > 2.8) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'slam', ok: t.d < 4, cd: 2.4, fn: () => slam(e, b, 3.2, 'Melee_2H_Attack_Chop', 0.75, 1.1) },
        { id: 'erupt', ok: t.d < 13, cd: b.phase > 1 ? 4.5 : 6, fn: () => eruption(e, b, 6, 2.1, 1.5, 0.8, b.phase > 1) },
        { id: 'rain', ok: true, cd: b.phase > 1 ? 6 : 8, fn: () => lavaRain(e, b, b.phase > 1 ? 4 : 3, 5) },
        { id: 'summon', ok: b.phase > 1 && A.alive() < A.cap() - 2, cd: 10, fn: () => summon(e, b, 3, ['slag', 'drop', 'drop']) },
      ]);
    },
  },
  // ---- 2. arena D15: İblis Lordu — ışınlanıp ateş halkası, ateş sarmalı, kor sütunları, kor iskelet çağırma ----
  implord: {
    idle(e, b, t, dt) {
      if (t.d > 8) walk(e, t, 1, dt); else if (t.d < 4) walk(e, t, -1, dt); else idleAnim(e);
      if (t.d < 2.6 && (b.cds.blink || 0) <= 0) b.next = 0;
    },
    pick(e, b, t) {
      return pickFrom(b, [
        { id: 'blink', ok: true, cd: 4, fn: () => this.blink(e, b) },
        { id: 'spiral', ok: t.d > 3, cd: 6.5, fn: () => spiral(e, b, b.phase > 1 ? 3 : 2, 2.4, 5, 1.6, 0.15, FIRE) },
        { id: 'pillars', ok: true, cd: 4.5, fn: () => this.pillars(e, b) },
        { id: 'summon', ok: A.alive() < A.cap() - 2, cd: 9, fn: () => summon(e, b, b.phase > 1 ? 4 : 3, ['ember', 'ember', 'drake']) },
      ]);
    },
    *pillars(e, b) {
      A.play(e, 'Ranged_Magic_Shoot', true, 0.1, 0.8);
      yield* spikeField(e, b, b.phase > 1 ? 7 : 5, 3.5, 1.6, 1.1, FIRE, 'spike', 0.8);
      yield* wait(b, 1.0);
    },
    *blink(e, b) {
      const o = e.obj.position, p = P();
      let x = 0, z = 0;
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * TAU, r = 6 + Math.random() * 2.5;
        x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
        if (inside(x, z, 1.5)) break;
      }
      circle(e, x, z, 1.6, 0.7, 0, { safe: true });
      sfx.teleport(); A.burst(o, 16, FIRE, 5);
      e.state = 'blink';
      for (let T = 0; T < 0.3; T += b.dt) { b.scaleK = Math.max(0.05, 1 - T / 0.3); yield; }
      b.scaleK = 0.02;
      yield* wait(b, 0.4);
      o.x = x; o.z = z; A.burst(o, 16, FIRE, 5); sfx.teleport();
      for (let T = 0; T < 0.25; T += b.dt) { b.scaleK = Math.min(1, T / 0.25); yield; }
      b.scaleK = 1; e.state = 'attack';
      aim(e, toP(e));
      const n = b.phase > 1 ? 14 : 10, off = Math.random();
      for (let i = 0; i < n; i++) bullet(e, o.x, o.z, (i / n + off) * TAU, 5, e.dmg * 0.4, 4.5, FIRE);
      sfx.nova();
      yield* wait(b, 0.4);
    },
  },
  // ---- 2. arena D20: Erimiş Ejder — 3 faz: nefes/kuyruk/ateş topu → dalış + lav → göktaşı + sarmal ----
  molten: {
    idle(e, b, t, dt) { if (t.d > 3.2) walk(e, t, 1, dt); else idleAnim(e); },
    pick(e, b, t) {
      const ph = b.phase;
      return pickFrom(b, [
        { id: 'tail', ok: t.d < 4.2, cd: 2.4, fn: () => slam(e, b, 3.4, 'Melee_2H_Attack_Chop', 0.75) },
        { id: 'breath', ok: t.d < 11, cd: ph > 1 ? 4.5 : 5.5, fn: () => breath(e, b, 11, 3.6, ph > 2 ? 1.4 : 1.1, 0.3) },
        { id: 'volley', ok: true, cd: 6, fn: () => fireVolley(e, b, 14, ph > 2 ? 7 : 6.5, ph > 1 ? 2 : 1) },
        { id: 'dive', ok: ph > 1, cd: ph > 2 ? 6 : 8, fn: () => dive(e, b, ph > 2 ? 3.6 : 3.1, true) },
        { id: 'rain', ok: ph > 1, cd: 8, fn: () => lavaRain(e, b, ph > 2 ? 5 : 3, 5) },
        { id: 'meteor', ok: ph > 2, cd: 7, fn: () => meteors(e, b, 9) },
        { id: 'spiral', ok: ph > 2, cd: 9, fn: () => spiral(e, b, 3, 2.6, 4.5, 1.4, 0.15, FIRE) },
      ]);
    },
  },
});

// Faz eşikleri (can oranı). Kral'da faz geçişinde kısa dokunulmazlık + banner.
const PHASES = {
  ashking: [{ at: 0.5, text: 'öfkelendi!' }],
  slaggiant: [{ at: 0.5, text: 'öfkelendi!' }],
  implord: [{ at: 0.5, text: 'öfkelendi!' }],
  molten: [{ at: 0.66, text: '🔥 Erimiş Ejder öfkeleniyor!' }, { at: 0.33, text: '🌋 Erimiş Ejder: SON ALEV!' }],
  giant: [{ at: 0.5, text: 'öfkelendi!' }],
  necro: [{ at: 0.5, text: 'öfkelendi!' }],
  shade: [{ at: 0.5, text: 'öfkelendi!' }],
  king: [{ at: 0.66, text: '👑 Kemik Kral öfkeleniyor!' }, { at: 0.33, text: '💀 Kemik Kral: SON DİRENİŞ!' }],
};
const REST = { giant: 0.9, necro: 0.9, shade: 0.7, king: 1.0, ashking: 0.9, slaggiant: 1.0, implord: 0.8, molten: 0.9 };

// updateEnemy'den çağrılır. true dönerse düşmanın davranışını bu modül yönetti.
export function updateBoss(e, dt) {
  // Doğuş/kapıdan giriş/ölüm gibi durumları game.js yönetir
  const s = e.state;
  if (s !== 'chase' && s !== 'attack' && s !== 'hit' && s !== 'phase' && s !== 'blink') return false;
  const ai = AI[e.def.ai]; if (!ai) return false;
  // Havuzdan yeniden gelen düşman: spawnEnemy her doğuşta yeni bir knock vektörü atar → durum sıfırlanır
  if (e.b && e.b.knock !== e.knock) e.b = null;
  const b = e.b || (e.b = { act: null, dt: 0, cds: {}, phase: 1, next: 1.0, scaleK: 1, last: null, knock: e.knock });
  b.dt = dt;
  for (const k in b.cds) b.cds[k] -= dt;

  if (e.state === 'phase') {          // faz geçişi: dokunulmaz
    b.phaseT -= dt;
    if (b.phaseT <= 0) { e.state = 'chase'; b.next = 0.3; }
  } else if (b.act) {
    if (b.act.next().done) {
      b.act = null; b.scaleK = 1;
      if (e.def.ai === 'clone') {       // kopya işini bitirdi → toz olur
        e.state = 'dead'; e.t = 0.7; A.play(e, 'Skeletons_Death', true, 0.05, 2); A.burst(e.obj.position, 12, DARK, 4);
        return true;
      }
      e.state = 'chase';
      b.next = REST[e.def.ai] * (b.phase > 1 ? 0.75 : 1) * (0.8 + Math.random() * 0.4);
    }
  } else if (A.player().dead) {
    A.play(e, 'Skeletons_Taunt', false, 0.3);
  } else {
    if (e.state !== 'chase') e.state = 'chase';
    const t = toP(e);
    A.turnTo(e.obj, Math.atan2(t.dx, t.dz), dt * 6);
    ai.idle(e, b, t, dt);
    b.next -= dt;
    if (b.next <= 0) {
      const g = ai.pick(e, b, t);
      if (g) { b.act = g; e.state = 'attack'; } else b.next = 0.25;
    }
  }

  // Faz kontrolü
  const ph = PHASES[e.def.ai];
  if (ph && b.phase <= ph.length && e.state !== 'phase' && e.state !== 'blink' && e.hp < e.hpMax * ph[b.phase - 1].at) {
    const info = ph[b.phase - 1];
    b.phase++;
    b.act = null; b.scaleK = 1; killHazardsOf(e);
    e.state = 'phase'; b.phaseT = e.def.king ? 2.2 : 1.0;
    A.play(e, e.def.king ? 'Skeletons_Taunt_Longer' : 'Skeletons_Taunt', true, 0.1, e.def.king ? 1.4 : 1);
    A.banner(e.def.king ? info.text : `${e.def.name} ${info.text}`, e.def.king ? 2.5 : 1.6);
    sfx.roar(); A.shake(0.6);
    if (A.reinforce && !e.def.ai?.startsWith?.('clone')) {   // faz geçişi: kapılardan takviye akını
      const w = A.wave ? A.wave() : 10;
      A.reinforce(Math.min(12, 5 + Math.round(w * 0.35)), w >= 10 ? (e.def.king ? 2 : 1) : 0);
    }
    A.ringFx(e.obj.position, 5, e.def.a2 ? 0xff6a1a : e.def.king ? 0xb46bff : 0xff5040);
    A.burst(e.obj.position, 24, e.def.a2 ? FIRE : e.def.king ? PURP : BONE, 6);
    for (const k in b.cds) b.cds[k] = Math.min(b.cds[k], 1.5);
  }

  if (!b.act && e.state !== 'blink' && e.obj.position.y > 0) e.obj.position.y = 0;   // dalış yarıda kesildiyse yere in
  if (b.scaleK !== 1) e.obj.scale.multiplyScalar(b.scaleK);
  clampPt(e.obj.position, -0.5);
  return true;
}
