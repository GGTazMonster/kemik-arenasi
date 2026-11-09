// =====================================================
//  2. Arena: KIZIL DÖKÜMHANE sahnesi (sadece görünüm; sınır mantığı arena.js'te)
//  Köşeleri yuvarlatılmış dikdörtgen zemin (çatlaklarında kor), duvar + sütun + mangal,
//  iki uzun kenarda lav kanalı, dışarıda fırın/örs/zincir dekoru, yükselen kıvılcımlar.
//  Çizim çağrısı az (telefon): taş tek birleşik mesh, parlayan parçalar tek mesh, lav 1, zemin 2, kıvılcım 1.
//  İlk kez 2. arena açılınca kurulur (createForge); 1. arenada gizlenir.
// =====================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FORGE = { hw: 13, hd: 20, rc: 6, wallOff: 2.2 };   // arena.js'teki 2. arena ölçüsüyle aynı olmalı

// Köşeleri yuvarlatılmış dikdörtgen çevresi: yoğun nokta listesi + toplam uzunluk (saat yönünün tersi, +x kenarından başlar)
function roundRectPath(A, B, r, step = 0.05) {
  const pts = [], push = (x, z) => pts.push(new THREE.Vector2(x, z));
  const line = (x0, z0, x1, z1) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step)); for (let i = 0; i < n; i++) push(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n); };
  const arc = (cx, cz, a0) => { const n = Math.ceil(r * Math.PI / 2 / step); for (let i = 0; i < n; i++) { const a = a0 + Math.PI / 2 * i / n; push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); } };
  line(A, 0, A, B - r); arc(A - r, B - r, 0);
  line(A - r, B, -(A - r), B); arc(-(A - r), B - r, Math.PI / 2);
  line(-A, B - r, -A, -(B - r)); arc(-(A - r), -(B - r), Math.PI);
  line(-(A - r), -B, A - r, -B); arc(A - r, -(B - r), Math.PI * 1.5);
  line(A, -(B - r), A, 0);
  pts.push(pts[0].clone());
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, L: cum[cum.length - 1] };
}
function pathAt(path, s) {   // s uzunluğundaki nokta + teğet
  const { pts, cum } = path;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  return { x: a.x + (b.x - a.x) * f, z: a.y + (b.y - a.y) * f, tx: b.x - a.x, tz: b.y - a.y };
}
function roundRectShape(A, B, r) {
  const s = new THREE.Shape();
  s.moveTo(-A + r, -B); s.lineTo(A - r, -B); s.absarc(A - r, -B + r, r, -Math.PI / 2, 0);
  s.lineTo(A, B - r); s.absarc(A - r, B - r, r, 0, Math.PI / 2);
  s.lineTo(-A + r, B); s.absarc(-A + r, B - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-A, -B + r); s.absarc(-A + r, -B + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

// Zemin dokusu: koyu mor-kömür taş levhalar + kor çatlakları (ayrı ışıma dokusu)
function floorTextures() {
  const S = 512, c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = c.height = e.width = e.height = S;
  const g = c.getContext('2d'), h = e.getContext('2d');
  g.fillStyle = '#1e1622'; g.fillRect(0, 0, S, S);
  h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
  const n = 4, s = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const off = (y % 2) * s / 2, v = 52 + Math.random() * 18;
    g.fillStyle = `rgb(${v + 8},${v - 6},${v + 14})`;
    for (const dx of [0, -S]) g.fillRect(x * s + off + 4 + dx, y * s + 4, s - 8, s - 8);
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  // Kor çatlakları: kırık çizgiler (doku sarılabilsin diye kenarlardan uzak)
  for (let k = 0; k < 4; k++) {
    let x = 60 + Math.random() * (S - 120), y = 60 + Math.random() * (S - 120), a = Math.random() * Math.PI * 2;
    const len = 3 + (Math.random() * 5 | 0);
    for (const [ctx, col, w] of [[g, '#5a2a20', 2], [h, '#c84a10', 2.4]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y);
      let px = x, py = y, pa = a;
      for (let i = 0; i < len; i++) { pa += (Math.random() - 0.5) * 1.2; px += Math.cos(pa) * 14; py += Math.sin(pa) * 14; ctx.lineTo(px, py); }
      ctx.stroke();
    }
  }
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 11, 1 / 11); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: mk(c), emissiveMap: mk(e) };
}
function lavaTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ff4a08'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 4 + Math.random() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const hot = Math.random() < 0.5;
    gr.addColorStop(0, hot ? '#ffd860' : '#7a1400'); gr.addColorStop(1, 'rgba(255,74,8,0)');
    g.fillStyle = gr;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createForge(scene, gateOpenings) {
  const { hw, hd, rc, wallOff } = FORGE;
  const group = new THREE.Group(); group.name = 'dokumhane'; group.visible = false; scene.add(group);
  const UP = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), col = new THREE.Color();
  const stone = [], glow = [];   // birleştirilecek parçalar (köşe renkli)
  function part(list, geo, x, y, z, rotY, hex, hex2 = null) {
    m4.makeRotationY(rotY).setPosition(x, y, z); geo.applyMatrix4(m4);
    const pos = geo.attributes.position, arr = new Float32Array(pos.count * 3);
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < pos.count; k++) { ymin = Math.min(ymin, pos.getY(k)); ymax = Math.max(ymax, pos.getY(k)); }
    for (let k = 0; k < pos.count; k++) {
      col.setHex(hex);
      if (hex2 !== null) col.lerp(new THREE.Color(hex2), (pos.getY(k) - ymin) / Math.max(1e-6, ymax - ymin));   // alttan üste renk geçişi
      arr.set([col.r, col.g, col.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (geo.index) geo = geo.toNonIndexed();
    geo.deleteAttribute('uv');
    list.push(geo);
  }
  const box = (list, w, h, d, x, y, z, rot, c1, c2) => part(list, new THREE.BoxGeometry(w, h, d), x, y, z, rot, c1, c2);
  const STONE = 0x4a3850, STONE_L = 0x6a5070, STONE_D = 0x2a1e30, IRON = 0x2a2428, GOLD = 0xc8902a, LAVA = 0xff6a1a, HOT = 0xffc040;

  // ---------- Zemin + dış karanlık ----------
  const tex = floorTextures();
  const floorGeo = new THREE.ShapeGeometry(roundRectShape(hw + 2, hd + 2, rc + 2), 16);
  const floorMat = new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xff5a10, emissiveIntensity: 1.1, color: 0xc0a8d0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ color: 0x120a12 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; group.add(outer);

  // ---------- Duvar hattı: parçalar + sütunlar + mangallar (kapı ağızları boş) ----------
  const W = roundRectPath(hw + wallOff, hd + wallOff, rc + wallOff);
  const N = Math.round(W.L / 1.7), segL = W.L / N;
  const inGate = (x, z, extra = 0) => gateOpenings.some(o => {
    const along = (x - o.x) * o.tx + (z - o.z) * o.tz, across = (x - o.x) * o.ux + (z - o.z) * o.uz;
    return Math.abs(across) < 2 && Math.abs(along) < o.half + extra;
  });
  const braziers = [];
  for (let i = 0; i < N; i++) {
    const p = pathAt(W, (i + 0.5) * segL), rot = -Math.atan2(p.tz, p.tx);
    if (inGate(p.x, p.z, segL * 0.3)) continue;
    // Kameraya bakan (+x/+z) duvarlar alçak: arkasındaki lav kanalını ve oyuncuyu kapatmasın
    const near = (p.x + p.z) / Math.hypot(p.x, p.z) > 0.35, wh = near ? 0.55 : 1.3;
    box(stone, segL + 0.06, wh, 0.85, p.x, wh / 2, p.z, rot, STONE_D, STONE);           // duvar gövdesi
    box(stone, segL + 0.1, 0.18, 1.0, p.x, wh + 0.08, p.z, rot, STONE_L);               // üst taş
    if (i % 4 === 0 && !inGate(p.x, p.z, 1.6)) {
      box(stone, 1.25, 2.9, 1.25, p.x, 1.45, p.z, rot, STONE_D, STONE);                // sütun
      box(stone, 1.5, 0.3, 1.5, p.x, 2.95, p.z, rot, STONE_L);                          // sütun başlığı
      box(stone, 0.9, 0.35, 0.9, p.x, 3.25, p.z, rot, IRON);                            // mangal kasesi
      box(glow, 0.62, 0.42, 0.62, p.x, 3.55, p.z, rot + 0.785, LAVA, HOT);              // mangal közü
      braziers.push(p);
      // Sancak: arena tarafında, sütunun önünde (her ikinci sütunda)
      if ((i / 4) % 2 === 0) {
        const l = Math.hypot(p.tx, p.tz) || 1; let nx = -p.tz / l, nz = p.tx / l;   // duvara dik
        if (nx * p.x + nz * p.z > 0) { nx = -nx; nz = -nz; }                        // içeri (merkeze) baksın
        const sx = p.x + nx * 0.7, sz = p.z + nz * 0.7;
        box(stone, 0.9, 1.6, 0.06, sx, 2.0, sz, rot, 0x6a1020, 0x9a1a2a);
        box(stone, 1.0, 0.1, 0.1, sx, 2.85, sz, rot, GOLD);
      }
    }
  }

  // ---------- Lav kanalları: iki uzun kenarda (x = ±), kapı ağzında kesilir ----------
  const lavaTex = lavaTexture(); lavaTex.repeat.set(1, 6);
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex, color: 0xffffff, fog: false });
  const lavaParts = [];
  const lx = hw + 1.15, lw = 1.25, zEnd = hd - rc + 0.5, gap = 3.2;
  for (const sx of [-1, 1]) for (const [z0, z1] of [[-zEnd, -gap], [gap, zEnd]]) {
    const len = z1 - z0, g = new THREE.PlaneGeometry(lw, len); g.rotateX(-Math.PI / 2); g.translate(sx * lx, 0.02, (z0 + z1) / 2);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * len / 6);
    lavaParts.push(g);
    box(stone, 0.22, 0.2, len, sx * (lx - lw / 2 - 0.11), 0.1, (z0 + z1) / 2, 0, STONE_L);   // kanal kenar taşı (iç)
    box(glow, 0.06, 0.05, len, sx * (lx - lw / 2 + 0.03), 0.04, (z0 + z1) / 2, 0, LAVA);      // kenarda kor çizgisi
  }
  const lava = new THREE.Mesh(mergeGeometries(lavaParts), lavaMat); group.add(lava);
  lavaParts.forEach(g => g.dispose());

  // ---------- Dış dekor: fırınlar, örsler, zincirli vinç (duvarın dışında) ----------
  const out = hw + wallOff + 3.2;
  for (const [x, z] of [[out, -9], [out, 9], [-out, -9], [-out, 9], [out, 17], [-out, -17]]) {
    const rot = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    box(stone, 3.2, 2.6, 2.4, x, 1.3, z, rot, STONE_D, STONE);         // fırın gövdesi
    box(stone, 3.6, 0.4, 2.8, x, 2.8, z, rot, STONE_L);                 // fırın üstü
    box(stone, 0.9, 2.4, 0.9, x + Math.sign(x) * 0.6, 4.2, z, 0, STONE_D, IRON);   // baca
    box(glow, 1.5, 1.0, 0.2, x - Math.sign(x) * 1.25, 0.9, z, rot + Math.PI / 2, LAVA, HOT);   // fırın ağzı (arenaya bakar)
  }
  for (const [x, z] of [[hw + wallOff + 1.6, -15], [-(hw + wallOff + 1.6), 14], [5, hd + wallOff + 2.2], [-6, -(hd + wallOff + 2.2)]]) {
    box(stone, 1.4, 0.35, 0.6, x, 0.85, z, 0.4, IRON);                  // örs tepesi
    box(stone, 0.5, 0.5, 0.4, x, 0.45, z, 0.4, IRON);                   // örs gövdesi
    box(stone, 0.9, 0.25, 0.7, x, 0.12, z, 0.4, STONE_D);               // kütük
  }
  for (const [x, z] of [[-(hw + wallOff + 2.5), 3.5], [hw + wallOff + 2.5, -3.5]]) {   // zincirli vinç direği + zincir
    box(stone, 0.5, 6, 0.5, x, 3, z, 0, IRON);
    box(stone, 3, 0.4, 0.4, x - Math.sign(x) * 1.3, 5.9, z, 0, IRON);
    for (let k = 0; k < 8; k++) box(stone, 0.18, 0.32, 0.18, x - Math.sign(x) * 2.6, 5.5 - k * 0.36, z, k % 2 ? 0.785 : 0, 0x5a5058);
    box(glow, 0.8, 0.5, 0.8, x - Math.sign(x) * 2.6, 2.4, z, 0.3, LAVA, HOT);   // asılı kor kazanı
  }

  const stoneMesh = new THREE.Mesh(mergeGeometries(stone), new THREE.MeshLambertMaterial({ vertexColors: true }));
  stoneMesh.castShadow = stoneMesh.receiveShadow = true;
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const glowMesh = new THREE.Mesh(mergeGeometries(glow), glowMat);
  stone.forEach(g => g.dispose()); glow.forEach(g => g.dispose());
  group.add(stoneMesh, glowMesh);

  // ---------- Kıvılcımlar: lav kanallarından ve mangallardan yükselen kor noktaları ----------
  const NS = 140, sp = new Float32Array(NS * 3), sv = new Float32Array(NS);
  const seed = i => {
    const fromLava = Math.random() < 0.75;
    if (fromLava) { sp[i * 3] = (Math.random() < 0.5 ? -1 : 1) * (lx + (Math.random() - 0.5) * lw); sp[i * 3 + 2] = (Math.random() * 2 - 1) * zEnd; sp[i * 3 + 1] = Math.random() * 0.3; }
    else { const b = braziers[(Math.random() * braziers.length) | 0] || { x: 0, z: 0 }; sp[i * 3] = b.x + (Math.random() - 0.5) * 0.5; sp[i * 3 + 2] = b.z + (Math.random() - 0.5) * 0.5; sp[i * 3 + 1] = 3.6; }
    sv[i] = 0.6 + Math.random() * 1.4;
  };
  for (let i = 0; i < NS; i++) { seed(i); sp[i * 3 + 1] += Math.random() * 4; }
  const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffa040, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sparks.frustumCulled = false; group.add(sparks);

  // ---------- Ortam ışığı/renkleri (2. arenada sıcak; 1. arenaya dönünce eski haline) ----------
  const LOOK = { bg: 0x1a0c12, fog: 0x2a1018, hemiSky: 0xffc8a8, hemiGround: 0x3a1828, hemiI: 1.25, sun: 0xffc890, sunI: 2.0 };
  let saved = null;
  function setLook(on, env) {
    const { hemi, sun, bg, fog } = env;
    if (on && !saved) saved = { bg: bg.getHex(), fog: fog.color.getHex(), hs: hemi.color.getHex(), hg: hemi.groundColor.getHex(), hi: hemi.intensity, sc: sun.color.getHex(), si: sun.intensity };
    if (on) { bg.setHex(LOOK.bg); fog.color.setHex(LOOK.fog); hemi.color.setHex(LOOK.hemiSky); hemi.groundColor.setHex(LOOK.hemiGround); hemi.intensity = LOOK.hemiI; sun.color.setHex(LOOK.sun); sun.intensity = LOOK.sunI; }
    else if (saved) { bg.setHex(saved.bg); fog.color.setHex(saved.fog); hemi.color.setHex(saved.hs); hemi.groundColor.setHex(saved.hg); hemi.intensity = saved.hi; sun.color.setHex(saved.sc); sun.intensity = saved.si; saved = null; }
  }

  return {
    group,
    show(on, env) { group.visible = on; setLook(on, env); },
    update(dt, time) {
      if (!group.visible) return;
      lavaTex.offset.y = (lavaTex.offset.y + dt * 0.05) % 1;
      lavaTex.offset.x = Math.sin(time * 0.3) * 0.04;
      const f = 0.85 + Math.sin(time * 7.3) * 0.08 + Math.sin(time * 13.1) * 0.05;
      glowMat.color.setScalar(f);
      floorMat.emissiveIntensity = 0.8 + Math.sin(time * 1.7) * 0.3;
      for (let i = 0; i < NS; i++) {
        sp[i * 3 + 1] += sv[i] * dt; sp[i * 3] += Math.sin(time * 2 + i) * dt * 0.2;
        if (sp[i * 3 + 1] > 5.5) seed(i);
      }
      sparkGeo.attributes.position.needsUpdate = true;
    },
  };
}
