// =====================================================
//  Arena kapıları
//  4 kapı (doğu/güney/batı + kuzeyde büyük BOSS KAPISI), arkalarında karanlık koridorlar,
//  inip kalkan parmaklıklar ve dalga başında parlayan kapı ağızları.
//  Normal düşmanlar aktif kapıların dışında doğup içeri yürür; boss'lar büyük kapıdan çıkar.
//  Çizim çağrısı (mobil için az): çerçeve+koridor tek birleşik mesh (1) + parmaklık çubukları (1, instanced)
//  + parıltı düzlemleri (1, instanced). Işık kaynağı eklenmez.
// =====================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inside, extentAlong } from './arena.js';

// Kapı yönleri (derece). Kamera (+x,+z) tarafında durduğu için 180 ve 270 derece kameraya bakar;
// 270 derece (-z, "kuzey") boss kapısı → ekranda sağ üstte, iyi görünür.
const DEFS = [
  { deg: 0,   name: 'Doğu' },
  { deg: 90,  name: 'Güney' },
  { deg: 180, name: 'Batı' },
  { deg: 270, name: 'Kuzey', boss: true },
];

export let gatesApi = null;   // geliştirme/test için: (await import('./gates.js')).gatesApi

// wallDist(g): merkezden o kapının duvar hattına uzaklık (daire: WALL_R; dikdörtgen: kenar + pay). pal: renkler (2. arena dökümhane).
export function createGates({ scene, ARENA_R, WALL_R, SEG, sfx, wallDist = null, pal = {} }) {
  const group = new THREE.Group(); group.name = 'kapilar'; scene.add(group);
  const UP = new THREE.Vector3(0, 1, 0);
  const CORR_LEN = 9;                                   // koridor uzunluğu (duvarın dışına doğru)
  const gates = DEFS.map((d, i) => {
    const a = d.deg * Math.PI / 180, boss = !!d.boss;
    return {
      i, name: d.name, boss, a, deg: d.deg,
      seg: Math.round(d.deg / 360 * SEG) % SEG,
      u: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),     // dışarı (radyal)
      tn: new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)),   // yan (duvar boyunca)
      hw: boss ? 3.2 : 1.4,                                  // açıklığın yarı genişliği
      H: boss ? 5.2 : 3.0,                                   // açıklık yüksekliği
      skip: boss ? 1 : 0,                                    // merkez parçanın iki yanından kaldırılan duvar parçası
      pw: boss ? 1.9 : 1.0, pd: boss ? 1.8 : 1.3,            // çerçeve sütunu genişlik/derinlik
      open: 0, target: 0, glow: 0, active: false, hold: 0, occupied: false,
    };
  });
  const bossGate = gates.find(g => g.boss);
  for (const g of gates) g.wr = wallDist ? wallDist(g) : WALL_R;

  // ---------- Statik geometri: çerçeve + koridor (köşe renkli tek mesh) ----------
  const parts = [], col = new THREE.Color(), col2 = new THREE.Color(), m4 = new THREE.Matrix4();
  // lx: yan kayma, ly: yükseklik (merkez), lz: merkezden radyal uzaklık. c2 verilirse koridor dibine doğru karanlığa kayar.
  function box(g, w, h, d, lx, ly, lz, c1, c2 = null) {
    const geo = new THREE.BoxGeometry(w, h, d);
    m4.makeBasis(g.tn, UP, g.u).setPosition(g.tn.x * lx + g.u.x * lz, ly, g.tn.z * lx + g.u.z * lz);
    geo.applyMatrix4(m4);
    const pos = geo.attributes.position, arr = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      col.setHex(c1);
      if (c2 !== null) {
        const r = pos.getX(k) * g.u.x + pos.getZ(k) * g.u.z;
        const f = Math.min(1, Math.max(0, (r - g.wr - 0.5) / (CORR_LEN - 1.5)));
        col.lerp(col2.setHex(c2), Math.pow(f, 0.7));
      }
      arr[k * 3] = col.r; arr[k * 3 + 1] = col.g; arr[k * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(geo);
  }
  const STONE = pal.stone ?? 0x8a7e70, STONE_D = pal.stoneD ?? 0x6f6458, BONE = pal.bone ?? 0xd8cfb8, VOID = pal.void ?? 0x1c1624, CFLOOR = pal.floor ?? 0x4a4048;
  for (const g of gates) {
    const { hw, H, pw, pd } = g, ph = H + 0.4, lz = g.wr - (g.boss ? 0.15 : 0);
    for (const s of [-1, 1]) {
      box(g, pw, ph, pd, s * (hw + pw / 2), ph / 2, lz, STONE);                                   // kalın sütun
      box(g, pw + 0.3, 0.35, pd + 0.3, s * (hw + pw / 2), 0.175, lz, STONE_D);                   // sütun kaidesi
      // koridor yan duvarları
      box(g, 0.8, g.boss ? 3.2 : 2.2, CORR_LEN, s * (hw + 0.4), (g.boss ? 3.2 : 2.2) / 2, g.wr + pd / 2 + CORR_LEN / 2 - 0.05, STONE_D, VOID);
    }
    const lh = g.boss ? 1.1 : 0.75, lw = 2 * (hw + pw) + 0.4;
    box(g, lw, lh, pd + 0.15, 0, ph + lh / 2, lz, STONE_D);                                      // üst kiriş
    box(g, g.boss ? 1.4 : 0.7, g.boss ? 1.3 : 0.8, 0.5, 0, ph + lh / 2 + (g.boss ? 0.2 : 0.1), lz - pd / 2 - 0.1, BONE); // kilit taşı (kemik rengi)
    if (g.boss) {
      // boss kapısı: mazgallar + sütun başlıkları → daha heybetli
      for (let k = -2; k <= 2; k++) box(g, 0.9, 0.7, pd, k * 2.3, ph + lh + 0.35, lz, STONE);
      for (const s of [-1, 1]) box(g, pw + 0.5, 0.5, pd + 0.4, s * (hw + pw / 2), ph - 0.25, lz, STONE_D);
    }
    // koridor zemini (arena zemininin hemen altında; boşlukları doldurur, dibe doğru kararır)
    box(g, 2 * hw + 1.6, 0.04, CORR_LEN + 1.2, 0, -0.025, g.wr - 0.6 + (CORR_LEN + 1.2) / 2, CFLOOR, VOID);
  }
  const frameMesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  parts.forEach(p => p.dispose());
  frameMesh.castShadow = frameMesh.receiveShadow = true;
  group.add(frameMesh);

  // ---------- Parmaklık (portcullis): instanced ince çubuklar ----------
  const bars = [];   // { g, v: dikey mi, lx, w, y0 (yatay için) }
  for (const g of gates) {
    const nv = g.boss ? 11 : 6, th = g.boss ? 0.2 : 0.13;
    for (let k = 0; k < nv; k++) bars.push({ g, v: true, lx: -g.hw + (k + 0.5) * (2 * g.hw / nv), w: th });
    for (const f of g.boss ? [0.22, 0.5, 0.78] : [0.3, 0.68]) bars.push({ g, v: false, lx: 0, w: 2 * g.hw, y0: g.H * f });
  }
  const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: pal.bars ?? 0x2e2824 }), bars.length);
  barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  barMesh.castShadow = true;
  group.add(barMesh);
  const vS = new THREE.Vector3(), vP = new THREE.Vector3(), qR = new THREE.Quaternion();
  function syncBars() {
    bars.forEach((b, k) => {
      const g = b.g, o = g.open * g.open * (3 - 2 * g.open);   // yumuşak geçiş
      const lift = o * (g.H - 0.3), lz = g.wr + 0.05, top = g.H + 0.15;
      qR.setFromAxisAngle(UP, Math.PI / 2 - g.a);
      let y, sy;
      if (b.v) { y = (lift + top) / 2; sy = Math.max(0.001, top - lift); vS.set(b.w, sy, b.w); }
      else { y = b.y0 + lift; if (y > g.H) vS.set(0, 0, 0); else vS.set(b.w, 0.11, 0.1); }   // kirişin içine girince gizlenir
      vP.set(g.tn.x * b.lx + g.u.x * lz, y, g.tn.z * b.lx + g.u.z * lz);
      m4.compose(vP, qR, vS);
      barMesh.setMatrixAt(k, m4);
    });
    barMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- Parıltı: kapı ağzında dikey + arena zemininde yatay ışık düzlemleri ----------
  const gc = document.createElement('canvas'); gc.width = 4; gc.height = 64;
  const gx = gc.getContext('2d'), grad = gx.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#7a7a7a'); grad.addColorStop(1, '#000000');
  gx.fillStyle = grad; gx.fillRect(0, 0, 4, 64);
  const glowTex = new THREE.CanvasTexture(gc); glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    gates.length * 2);
  glowMesh.frustumCulled = false;
  const black = new THREE.Color(0, 0, 0);
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  gates.forEach((g, i) => {
    // dikey: parmaklığın arkasında, açıklığı doldurur (altı parlak)
    ax.copy(g.tn).multiplyScalar(2 * g.hw); ay.set(0, g.H, 0); az.copy(g.u);
    m4.makeBasis(ax, ay, az).setPosition(g.u.x * (g.wr + 0.45), g.H / 2, g.u.z * (g.wr + 0.45));
    glowMesh.setMatrixAt(i * 2, m4);
    // yatay: kapının önünde arena zemininde (kapı tarafı parlak, içeri doğru söner)
    const len = g.boss ? 6 : 4.2, rc = g.wr + 0.4 - len / 2;
    ax.copy(g.tn).multiplyScalar(2 * g.hw + 1.2); ay.copy(g.u).multiplyScalar(-len); az.set(0, 1, 0);
    m4.makeBasis(ax, ay, az).setPosition(g.u.x * rc, 0.03, g.u.z * rc);
    glowMesh.setMatrixAt(i * 2 + 1, m4);
    glowMesh.setColorAt(i * 2, black); glowMesh.setColorAt(i * 2 + 1, black);
  });
  group.add(glowMesh);
  const COL_N = new THREE.Color(0xff8a2a), COL_B = new THREE.Color(0xff3020), tmpC = new THREE.Color();

  syncBars();

  // ---------- Yardımcılar ----------
  const mouthDist = (g, p) => { const R = extentAlong(g.u.x, g.u.z); return Math.hypot(p.x - g.u.x * R, p.z - g.u.z * R); };
  const segDist = (a, b) => { const d = Math.abs(a - b) % SEG; return Math.min(d, SEG - d); };
  function weightedPick(list, weights) {
    let r = Math.random() * weights.reduce((s, w) => s + w, 0);
    for (let k = 0; k < list.length; k++) { r -= weights[k]; if (r <= 0) return k; }
    return list.length - 1;
  }

  const api = {
    gates, bossGate, CORR_LEN, group,
    // Kapı ağzına denk gelen duvar parçası mı? (duvar/sütun/meşale buraya konmaz)
    isGateSeg(i) { return gates.some(g => segDist(i, g.seg) <= g.skip); },
    // Dalga başında aktif kapıları seç: oyuncuya en yakın kapı hariç; 1-3. dalga 1 kapı, sonra 2 kapı.
    // Boss/final dalgasında boss kapısı + 1 normal kapı.
    // Her dalgada 4 kapının HEPSİ açılır (düşmanlar dönüşümlü dağıtılır).
    pickWave(wave, bossWave, pp) {
      for (const g of gates) g.active = true;
    },
    // Bu düşman hangi kapıdan çıksın? Dönüşümlü; oyuncunun dibindeki kapı çoğunlukla atlanır
    // (yine de seçilirse waitFor() ile gecikmeli çıkar).
    pick(boss, pp) {
      if (boss) { bossGate.hold = Math.max(bossGate.hold, 4); return bossGate.i; }
      this._rr = ((this._rr | 0) + 1) % gates.length;
      let gi = this._rr;
      if (mouthDist(gates[gi], pp) <= 7 && Math.random() < 0.6) gi = (gi + 1) % gates.length;
      gates[gi].hold = Math.max(gates[gi].hold, 3);   // takviye gibi kuyruk dışı çıkışlarda da açık kalsın
      return gi;
    },
    // Oyuncu kapının dibindeyse çıkış gecikmeli (kapıdan çıkar çıkmaz ölüm olmasın)
    waitFor(gi, pp, boss) {
      return !boss && mouthDist(gates[gi], pp) <= 7 ? 2 + Math.random() : 0;
    },
    // Koridorun içinde doğuş noktası (kapının dışında)
    spawnPos(gi, boss) {
      const g = gates[gi];
      const r = g.wr + (boss ? 3.4 : 1.5 + Math.random() * 2.5);   // kapı ağzına yakın doğsun (bekleme kısalsın)
      const lat = (Math.random() * 2 - 1) * Math.max(0, g.hw - (boss ? 1.6 : 0.6));
      return { x: g.u.x * r + g.tn.x * lat, z: g.u.z * r + g.tn.z * lat, rot: Math.atan2(-g.u.x, -g.u.z) };
    },
    // Kapıdan içeri yürüyüş adımı. Arena içine girince true döner (→ normal kovalamaca).
    enterStep(e, dt) {
      const g = gates[e.gate], p = e.obj.position;
      if (e.gateWait > 0) { e.gateWait -= dt; return false; }   // kapının dibinde bekletilen çıkış
      const sp = (e.def.boss ? Math.max(2.4, e.def.speed) : e.def.speed) * 1.5;   // koridorda hızlı giriş
      p.x -= g.u.x * sp * dt; p.z -= g.u.z * sp * dt;
      e.obj.rotation.y = Math.atan2(-g.u.x, -g.u.z);
      const rad = p.x * g.u.x + p.z * g.u.z;
      if (rad > extentAlong(g.u.x, g.u.z) + 0.3) {   // koridor/kapı içindeyken yan duvarlara çarpmasın
        const lat = p.x * g.tn.x + p.z * g.tn.z, lim = Math.max(0, g.hw - e.def.radius * (e.baseScale || 1) * 0.7);
        const c = Math.max(-lim, Math.min(lim, lat));
        if (c !== lat) { p.x += g.tn.x * (c - lat); p.z += g.tn.z * (c - lat); }
        // geriye itilip koridordan taşmasın
        const maxR = g.wr + CORR_LEN - 0.5;
        if (rad > maxR) { p.x -= g.u.x * (rad - maxR); p.z -= g.u.z * (rad - maxR); }
      }
      return inside(p.x, p.z, -0.4);
    },
    // Dalga kuyruğu bitti: artık gelen yok → parmaklıklar iner (içeride yürüyen varsa o geçince)
    closeAll() { for (const g of gates) g.active = false; },
    reset() {
      this._rr = 0;
      for (const g of gates) { g.active = false; g.hold = 0; g.open = 0; g.target = 0; g.glow = 0; g.occupied = false; }
      for (let k = 0; k < gates.length * 2; k++) glowMesh.setColorAt(k, black);
      glowMesh.instanceColor.needsUpdate = true;
      syncBars();
    },
    update(dt, time, enemies) {
      for (const g of gates) g.occupied = false;
      for (const e of enemies) if (e.state === 'enter' && e.gate >= 0) gates[e.gate].occupied = true;
      let moved = false, glowing = false;
      for (const g of gates) {
        g.hold = Math.max(0, g.hold - dt);
        const want = g.active || g.occupied || g.hold > 0 ? 1 : 0;
        if (want !== g.target) { g.target = want; if (want && sfx) sfx.gateOpen(); }
        const prev = g.open;
        g.open = want ? Math.min(1, g.open + dt / (g.boss ? 1.5 : 1.0)) : Math.max(0, g.open - dt / 0.45);
        if (prev !== g.open) moved = true;
        if (prev > 0 && g.open === 0 && sfx) sfx.gateClose();
        g.glow += (want - g.glow) * Math.min(1, dt * 2.5);
        if (g.glow > 0.003) glowing = true;
      }
      if (moved) syncBars();
      if (glowing || this._glowOn) {
        gates.forEach((g, i) => {
          const k = g.glow * (0.8 + 0.2 * Math.sin(time * 5 + i * 1.7));
          tmpC.copy(g.boss ? COL_B : COL_N).multiplyScalar(k);
          glowMesh.setColorAt(i * 2, tmpC);
          glowMesh.setColorAt(i * 2 + 1, tmpC.multiplyScalar(0.55));
        });
        glowMesh.instanceColor.needsUpdate = true;
      }
      this._glowOn = glowing;
    },
  };
  if (!wallDist) gatesApi = api;   // 1. arena kapıları
  return api;
}
