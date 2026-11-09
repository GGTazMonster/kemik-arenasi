// Arena şekli: daire (1. arena, yarıçap 17) veya dikdörtgen (2. arena: Kızıl Dökümhane).
// Oyundaki tüm "sınır, rastgele nokta, kenara uzaklık" hesapları buradan geçer; daire formülleri eskisiyle birebir aynı.
// Dikdörtgen: x yönünde yarı-genişlik hw, z yönünde yarı-derinlik hd (uzun kenar z; telefonda ekranın boyu).
// rc: köşe yuvarlatma yarıçapı (0 = sivri köşe). Sivri köşeler kaçan oyuncuyu sıkıştırıyor (bot ölçümü), o yüzden yuvarlatılabilir.

export const ARENA = { shape: 'circle', R: 17, hw: 17, hd: 17, rc: 0 };

export function setArena(cfg) {
  Object.assign(ARENA, { shape: 'circle', R: 17, rc: 0 }, cfg);
  if (ARENA.shape === 'circle') { ARENA.hw = ARENA.hd = ARENA.R; ARENA.rc = 0; }
  else { ARENA.R = Math.min(ARENA.hw, ARENA.hd); ARENA.rc = Math.min(ARENA.rc || 0, ARENA.R); }
  return ARENA;
}

const isRect = () => ARENA.shape === 'rect';

// Kenara uzaklık (içerideyse pozitif, dışarıdaysa negatif)
export function edgeDist(x, z) {
  if (!isRect()) return ARENA.R - Math.hypot(x, z);
  const { hw, hd, rc } = ARENA, ax = Math.abs(x), az = Math.abs(z);
  if (rc > 0 && ax > hw - rc && az > hd - rc) return rc - Math.hypot(ax - (hw - rc), az - (hd - rc));
  return Math.min(hw - ax, hd - az);
}
export const inside = (x, z, margin = 0) => edgeDist(x, z) >= margin;

// Noktayı, kenardan en az `margin` içeride kalacak şekilde sınırla (margin negatifse sınırın dışına izin verir).
// p: {x, z} (Vector3 de olur) — yerinde değiştirir; değiştiyse true döner.
export function clampPt(p, margin = 0) {
  if (!isRect()) {
    const R = ARENA.R - margin, r = Math.hypot(p.x, p.z);
    if (r > R) { p.x *= R / r; p.z *= R / r; return true; }
    return false;
  }
  const { hw, hd, rc } = ARENA, mx = hw - margin, mz = hd - margin;
  let nx = Math.max(-mx, Math.min(mx, p.x)), nz = Math.max(-mz, Math.min(mz, p.z));
  if (rc > 0) {   // köşe bölgesinde: köşe merkezli çembere sınırla
    const cx = hw - rc, cz = hd - rc, ax = Math.abs(nx), az = Math.abs(nz), rr = rc - margin;
    if (ax > cx && az > cz) {
      const dx = ax - cx, dz = az - cz, d = Math.hypot(dx, dz);
      if (d > rr && d > 0) { nx = Math.sign(nx) * (cx + dx * rr / d); nz = Math.sign(nz) * (cz + dz * rr / d); }
    }
  }
  const ch = nx !== p.x || nz !== p.z; p.x = nx; p.z = nz; return ch;
}

// Kenara yakınken merkeze doğru itiş yönü (birim vektör, {x, z})
export function inwardDir(x, z) {
  const w = wallPush(x, z, 1e6), l = Math.hypot(w.x, w.z) || 1;
  return { x: w.x / l, z: w.z / l };
}

// Kenardan `range` içine girince merkeze doğru itiş (yakınlıkla büyür). Dikdörtgende köşede iki duvar birden iter.
export function wallPush(x, z, range) {
  if (!isRect()) {
    const r = Math.hypot(x, z) || 1, d = ARENA.R - r;
    return d < range ? { x: -x / r * (range - d), z: -z / r * (range - d) } : { x: 0, z: 0 };
  }
  const { hw, hd, rc } = ARENA, ax = Math.abs(x), az = Math.abs(z);
  if (rc > 0 && ax > hw - rc && az > hd - rc) {   // kavisli köşe: köşe merkezinden dışa doğru normal
    const dx = ax - (hw - rc), dz = az - (hd - rc), d = Math.hypot(dx, dz) || 1, e = rc - d;
    return e < range ? { x: -Math.sign(x) * dx / d * (range - e), z: -Math.sign(z) * dz / d * (range - e) } : { x: 0, z: 0 };
  }
  const dx = hw - ax, dz = hd - az;
  return { x: dx < range ? -Math.sign(x) * (range - dx) : 0, z: dz < range ? -Math.sign(z) * (range - dz) : 0 };
}

// (x,z)'den (dx,dz) birim yönünde kenara kadar olan mesafe (kenardan `margin` içeride durur)
export function toWall(x, z, dx, dz, margin = 0) {
  if (!isRect()) {
    const R = ARENA.R - margin, pd = x * dx + z * dz, c = x * x + z * z - R * R;
    return Math.max(0, -pd + Math.sqrt(Math.max(0, pd * pd - c)));
  }
  // Kavisli köşeler için basit adımlama (boss hücumları gibi seyrek çağrılar; ≤ 60 adım)
  const step = 0.5; let t = 0;
  while (t < 80 && edgeDist(x + dx * (t + step), z + dz * (t + step)) >= margin) t += step;
  return t;
}

// Arena içinde rastgele nokta (merkezden en az minR uzakta; daire için eskisiyle aynı dağılım)
export function randomPoint(minR = 3, margin = 0) {
  if (!isRect()) {
    const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (ARENA.R - margin - minR);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
  for (let i = 0; i < 30; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA.hw - margin), z = (Math.random() * 2 - 1) * (ARENA.hd - margin);
    if (Math.hypot(x, z) >= minR && inside(x, z, margin)) return { x, z };
  }
  return { x: 0, z: ARENA.hd - margin - 1 };
}

// Merkezden (ux,uz) birim yönünde kenara uzaklık (kapı ağızları için; kapılar kenar ortalarında). Daire: R.
export function extentAlong(ux, uz) {
  if (!isRect()) return ARENA.R;
  const ax = Math.abs(ux) > 1e-6 ? ARENA.hw / Math.abs(ux) : Infinity, az = Math.abs(uz) > 1e-6 ? ARENA.hd / Math.abs(uz) : Infinity;
  return Math.min(ax, az);
}

// Arenanın en uzak noktasına mesafe (genişleyen halkaların üst sınırı vb.)
export const maxExtent = () => isRect() ? Math.hypot(ARENA.hw, ARENA.hd) : ARENA.R;
