// Yerel oyun verisi günlüğü (internete hiçbir şey göndermez). Anahtar: kemikArena.log (test modunda .test).
// game.js olay noktalarından çağırır. Her fonksiyon try/catch içinde: günlük hatası oyunu asla bozmaz.
// Bot/simülasyon koşuları (ctx.bot() dolu) kaydedilmez.
const MAX_RUNS = 50;
let ctx = null, KEY = 'kemikArena.log', data = null, cur = null, dirty = false;

const fresh = () => ({ v: 1, runs: [], heroes: {}, pw: {}, dev: { opens: 0, playSec: 0, screen: null, touch: false, ver: '' } });
const safe = fn => (...a) => { try { return fn(...a); } catch (e) { try { console.warn('[log]', e); } catch {} } };
const run = () => ctx.run();
const off = () => !ctx || ctx.bot() || !cur;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && typeof d === 'object') { const f = fresh(); return { ...f, ...d, dev: { ...f.dev, ...d.dev }, heroes: d.heroes || {}, pw: d.pw || {}, runs: Array.isArray(d.runs) ? d.runs : [] }; }
  } catch {}
  return fresh();
}
function flush() {
  if (!data) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); dirty = false; }
  catch { try { data.runs = data.runs.slice(-10); localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }
}

// ctx: { events, run(), player(), bot(), quality(), heroLevel(id), testMode, toast(text) }
export const initLog = safe(c => {
  ctx = c;
  KEY = c.testMode ? 'kemikArena.log.test' : 'kemikArena.log';
  data = load();
  const d = data.dev;
  d.opens++; d.screen = [innerWidth, innerHeight];
  d.touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  d.ver = new Date().toISOString().slice(0, 10);
  fetch('sw.js', { cache: 'no-store' }).then(r => r.text()).then(t => { const m = /VERSION\s*=\s*['"]([^'"]+)['"]/.exec(t); if (m) { d.ver = m[1]; dirty = true; } }).catch(() => {});
  flush();
  addEventListener('pagehide', () => { if (dirty) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) flush(); });
  // Olaylar: boss süresi + boss'tan alınan hasar
  c.events.addEventListener('bossSpawn', safe(e => { if (!off()) cur.boss = { n: e.detail.name, t0: run().time, d: 0 }; }));
  c.events.addEventListener('bossKill', safe(e => {
    if (off() || !cur.boss) return;
    cur.bosses.push({ n: cur.boss.n, t: Math.round(run().time - cur.boss.t0), d: Math.round(cur.boss.d) }); cur.boss = null;
  }));
  c.events.addEventListener('playerHurt', safe(e => { if (!off() && cur.boss) cur.boss.d += e.detail.dmg; }));
  bindUI();
});

export const logRunStart = safe(() => {
  cur = null;
  if (!ctx || ctx.bot()) return;
  const r = run();
  cur = { hero: r.hero, hl: ctx.heroLevel(r.hero), test: ctx.testMode ? 1 : 0, at: new Date().toISOString(), q: ctx.quality(), waves: [], bosses: [], ch: [],
          evo: [], chest: 0, rr: 0, dash: 0, sup: 0, fpsSum: 0, fpsN: 0, fpsMin: 0, qDrop: 0, boss: null, wT: 0 };
});

// Her dalga başında: bir önceki dalganın özetini kapatır (süre, can %, oyuncu seviyesi)
export const logWave = safe(() => {
  if (off()) return;
  const r = run(), p = ctx.player(), w = r.wave;
  if (w > 1 && cur.waves.length < 200) cur.waves.push({ w: w - 1, s: Math.round(r.time - cur.wT), h: Math.max(0, Math.round(p.hp / r.s.maxHp * 100)), l: r.level });
  cur.wT = r.time;
});

// Seviye atlamada sunulan 3 seçenek (yeniden seçimde son sunum değiştirilir ama sunulma sayısına her ikisi de girer)
export const logOffer = safe(list => {
  if (off()) return;
  const ids = list.map(u => u.id);
  for (const id of ids) (data.pw[id] ||= { s: 0, c: 0 }).s++;
  const last = cur.ch[cur.ch.length - 1];
  if (last && last.p == null) last.o = ids; else cur.ch.push({ o: ids, p: null, l: run().level });
  dirty = true;
});
export const logPick = safe(id => {
  if (off()) return;
  const last = cur.ch[cur.ch.length - 1];
  if (last && last.p == null) last.p = id;
  (data.pw[id] ||= { s: 0, c: 0 }).c++;
  dirty = true;
});
export const logReroll = safe(() => { if (!off()) cur.rr++; });
export const logEvo = safe(id => { if (!off()) cur.evo.push(id); });
export const logChest = safe(() => { if (!off()) cur.chest++; });
export const logDash = safe(() => { if (!off()) cur.dash++; });
export const logSuper = safe(() => { if (!off()) cur.sup++; });
export const logFps = safe(fps => {
  if (off()) return;
  cur.fpsSum += fps; cur.fpsN++; cur.fpsMin = cur.fpsMin ? Math.min(cur.fpsMin, fps) : fps;
});
export const logQualityDrop = safe(() => { if (!off() && !cur.qDrop) cur.qDrop = run().wave; });

export const logRunEnd = safe(() => {
  if (off()) { cur = null; return; }
  const r = run(), c = cur; cur = null;
  logWaveFinal(c, r);
  const dmgTaken = {}; for (const k in r.dmgBy) dmgTaken[k] = Math.round(r.dmgBy[k]);
  const rec = {
    hero: c.hero, hl: c.hl, test: c.test, at: c.at, sec: Math.round(r.time), wave: r.wave, won: r.won ? 1 : 0,
    endless: r.endless ? Math.max(0, r.wave - ctx.finalWave) : 0,
    death: r.won ? null : (r.lastHit ? { src: r.lastHit.src, dmg: Math.round(r.lastHit.dmg), wave: r.wave } : null),
    dmgBy: dmgTaken, waves: c.waves, bosses: c.bosses, ch: c.ch, evo: c.evo, chest: c.chest, rr: c.rr,
    kills: r.kills, dealt: Math.round(r.dmgDealt), combo: r.bestCombo, sup: c.sup, dash: c.dash, gold: r.gold, lvl: r.level,
    q: c.q, fpsAvg: c.fpsN ? Math.round(c.fpsSum / c.fpsN) : 0, fpsMin: Math.round(c.fpsMin), qDrop: c.qDrop,
  };
  data.runs.push(rec);
  if (data.runs.length > MAX_RUNS) data.runs.splice(0, data.runs.length - MAX_RUNS);
  const h = data.heroes[c.hero] ||= { n: 0, best: 0, sum: 0, avg: 0, wins: 0, dh: {} };
  h.n++; h.sum += r.wave; h.avg = Math.round(h.sum / h.n * 10) / 10; h.best = Math.max(h.best, r.wave);
  if (r.won) h.wins++; else h.dh[r.wave] = (h.dh[r.wave] || 0) + 1;
  data.dev.playSec += Math.round(r.time);
  flush();
});
function logWaveFinal(c, r) {
  if (r.wave >= 1 && !c.waves.some(x => x.w === r.wave)) {
    const p = ctx.player();
    c.waves.push({ w: r.wave, s: Math.round(r.time - c.wT), h: p ? Math.max(0, Math.round(p.hp / r.s.maxHp * 100)) : 0, l: r.level });
  }
}

// ---------- Paylaş / sıfırla ----------
function exportText() {
  const out = JSON.parse(JSON.stringify(data));
  out.dev.exportedAt = new Date().toISOString();
  return 'Kemik Arenası verisi\n' + JSON.stringify(out);
}
export const getLogText = () => { try { return exportText(); } catch { return 'Kemik Arenası verisi\n{}'; } };

async function share() {
  const text = getLogText();
  try {
    if (navigator.share) {
      try { await navigator.share({ text }); ctx.toast('Paylaşıldı'); return; }
      catch (e) { if (e && e.name === 'AbortError') { ctx.toast('Paylaşım iptal edildi'); return; } }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); ctx.toast('Panoya kopyalandı'); return; } catch {}
    }
  } catch {}
  const box = document.getElementById('logShare'), ta = document.getElementById('logShareText');
  if (box && ta) { ta.value = text; box.classList.remove('hidden'); ta.focus(); ta.select(); ctx.toast('Metni seçip kopyala'); }
}

function bindUI() {
  const $ = id => document.getElementById(id);
  const shareBtn = $('shareLogBtn'), resetBtn = $('resetLogBtn'), close = $('logShareClose');
  if (shareBtn) shareBtn.onclick = safe(() => { share(); });
  if (close) close.onclick = () => $('logShare').classList.add('hidden');
  if (resetBtn) {
    const label = resetBtn.textContent; let timer = 0, armed = false;
    const disarm = () => { armed = false; resetBtn.textContent = label; resetBtn.classList.remove('armed'); clearTimeout(timer); };
    resetBtn.onclick = safe(() => {
      if (!armed) { armed = true; resetBtn.textContent = 'Emin misin? Tekrar bas'; resetBtn.classList.add('armed'); timer = setTimeout(disarm, 4000); return; }
      disarm();
      const keep = data.dev; data = fresh(); data.dev = { ...keep, playSec: 0 }; cur = null; flush();
      ctx.toast('Oyun verileri sıfırlandı');
    });
  }
}
