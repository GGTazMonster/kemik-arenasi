// Ses efektleri — CC0 ses dosyaları (sounds/) varsa onlar, yoksa WebAudio sentezi çalar.
// Müzik: sounds/music + sounds/menu içindeki döngülü parçalar (playMusic ile).
import { SFX_FILES, SFX_VOL, MUSIC_FILES } from './sounds/sounds.js';
let ctx = null, master = null, musicBus = null, enabled = true, volume = 0.6, noiseBuf = null;
const last = {};
const bufs = {};          // ad -> AudioBuffer (efekt ve müzik)
let musicNow = null, musicName = null, wantMusic = 'menu';   // oyun menüde açılır

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    apply();
    loadAll();
  } catch { ctx = null; }
}
export function setAudio(on, vol) { enabled = on; volume = vol; apply(); }
function apply() { if (master) master.gain.value = enabled ? volume * 0.5 : 0; }

async function loadOne(name, url) {
  try {
    const r = await fetch(url); if (!r.ok) return;
    const ab = await r.arrayBuffer();
    bufs[name] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    if (wantMusic === name && musicName !== name) playMusic(name);
  } catch { /* dosya yoksa sentez kalır */ }
}
function loadAll() {
  for (const [n, f] of Object.entries(SFX_FILES)) loadOne(n, 'sounds/' + f);
  for (const [n, f] of Object.entries(MUSIC_FILES)) loadOne(n, 'sounds/' + f);
}

// Dosyadan efekt çal (küçük perde oynamasıyla tekrar hissi azalır). Bulunamazsa false.
function playBuf(name, vol = 1, rate = 1) {
  const b = bufs[name]; if (!b) return false;
  const s = ctx.createBufferSource(); s.buffer = b;
  s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(g); g.connect(master); s.start();
  return true;
}

// Müzik: 'menu', 'savas', 'boss' döngülü; 'zafer', 'yenilgi' tek sefer. null = sustur.
export function playMusic(name) {
  wantMusic = name;
  if (!ctx || musicName === name) return;
  const t = ctx.currentTime;
  if (musicNow) { const o = musicNow; o.g.gain.setTargetAtTime(0.0001, t, 0.4); o.s.stop(t + 2); musicNow = null; musicName = null; }
  if (!name || !bufs[name]) return;  // henüz yüklenmediyse yüklenince başlar
  const s = ctx.createBufferSource(); s.buffer = bufs[name];
  s.loop = !(name === 'zafer' || name === 'yenilgi');
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.setTargetAtTime(1, t, 0.5);
  s.connect(g); g.connect(musicBus); s.start();
  musicNow = { s, g }; musicName = name;
}

// Aynı ses çok sık çalmasın
function ok(name, gapMs) {
  if (!ctx || !enabled || volume <= 0) return false;
  const now = performance.now();
  if (last[name] && now - last[name] < gapMs) return false;
  last[name] = now;
  return true;
}

function tone(f, dur, type = 'square', vol = 0.2, f2 = null, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq, q = 1, type = 'bandpass') {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur);
}

// Kalabalık sesi: döngülü gürültü + iki bant geçiren filtre (insan sesi bölgesi) + yavaş yükselip sönen zarf
function crowdNoise(dur, vol, freq, ooh) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime, end = t + dur;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = 0.9 + Math.random() * 0.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (ooh ? 0.12 : 0.25));
  g.gain.setValueAtTime(vol, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.001, end);
  for (const [mul, q] of [[1, ooh ? 4 : 1.2], [ooh ? 1.8 : 2.3, ooh ? 5 : 1.5]]) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freq * mul * (ooh ? 1.25 : 1), t);
    f.frequency.exponentialRampToValueAtTime(freq * mul * (ooh ? 0.7 : 1.15), end);
    s.connect(f); f.connect(g);
  }
  // Tezahüratta genliği titret (çok kişi bağırıyor hissi)
  let lfo = null;
  if (!ooh) {
    lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random() * 3;
    const lg = ctx.createGain(); lg.gain.value = vol * 0.3;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(end + 0.05);
  }
  g.connect(master);
  s.start(t); s.stop(end + 0.05);
}

export const sfx = {
  swing()  { if (ok('swing', 60)) noise(0.14, 0.22, 1400, 0.8); },
  hit()    { if (ok('hit', 35)) tone(220, 0.09, 'square', 0.1, 90); },
  kill()   { if (ok('kill', 50)) { noise(0.18, 0.18, 700, 1, 'lowpass'); tone(160, 0.15, 'triangle', 0.12, 60); } },
  // Art arda toplanan taşlarda ses inceldikçe incelir (tatmin hissi)
  gem(step = 0) { if (ok('gem', 40)) { const f = 700 * Math.pow(2, Math.min(step, 14) / 12); tone(f, 0.06, 'sine', 0.07, f * 1.5); } },
  chest()  { if (ok('chest', 300)) [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.12, null, i * 0.07)); },
  evo()    { if (ok('evo', 500)) { [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.06, null, i * 0.06)); noise(0.6, 0.15, 1200, 0.5); } },
  victory(){ if (ok('victory', 1000)) [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'triangle', 0.14, null, i * 0.16)); },
  quest()  { if (ok('quest', 300)) [784, 988, 1175].forEach((f, i) => tone(f, 0.16, 'square', 0.06, null, i * 0.09)); },
  coin()   { if (ok('coin', 60)) { tone(1300, 0.07, 'triangle', 0.08); tone(1750, 0.1, 'triangle', 0.08, null, 0.06); } },
  hurt()   { if (ok('hurt', 120)) tone(140, 0.22, 'sawtooth', 0.16, 60); },
  level()  { if (ok('level', 200)) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, null, i * 0.08)); },
  buff()   { if (ok('buff', 100)) [660, 880, 1320].forEach((f, i) => tone(f, 0.14, 'sine', 0.11, null, i * 0.06)); },
  nova()   { if (ok('nova', 100)) { noise(0.35, 0.18, 500, 0.7, 'lowpass'); tone(300, 0.3, 'sine', 0.1, 120); } },
  dagger() { if (ok('dagger', 70)) noise(0.08, 0.1, 3000, 2); },
  boss()   { if (ok('boss', 500)) { tone(80, 0.9, 'sawtooth', 0.18, 40); tone(120, 0.9, 'square', 0.06, 50); } },
  slam()   { if (ok('slam', 200)) { noise(0.4, 0.32, 200, 0.7, 'lowpass'); tone(70, 0.4, 'sine', 0.28, 35); } },
  click()  { if (ok('click', 40)) tone(600, 0.05, 'square', 0.05); },
  dash()   { if (ok('dash', 100)) noise(0.12, 0.14, 2400, 0.6, 'highpass'); },
  die()    { if (ok('die', 500)) [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, null, i * 0.15)); },
  // Boss saldırıları: uyarı bipi, hücum, kükreme (faz), büyü mermisi, ışınlanma, bıçak, şok dalgası, diken
  warn()     { if (ok('warn', 150)) { tone(520, 0.1, 'square', 0.05, 780); tone(780, 0.1, 'square', 0.04, 1040, 0.1); } },
  charge()   { if (ok('charge', 300)) { noise(0.5, 0.25, 300, 0.6, 'lowpass'); tone(90, 0.6, 'sawtooth', 0.14, 200); } },
  roar()     { if (ok('roar', 800)) { tone(110, 1.1, 'sawtooth', 0.18, 45); tone(165, 0.9, 'square', 0.07, 60); noise(0.5, 0.2, 400, 0.5, 'lowpass'); } },
  zap()      { if (ok('zap', 90)) tone(900, 0.08, 'sine', 0.035, 480); },
  teleport() { if (ok('teleport', 200)) { tone(300, 0.3, 'sine', 0.11, 1400); noise(0.25, 0.08, 2000, 1, 'highpass'); } },
  blade()    { if (ok('blade', 70)) { noise(0.1, 0.15, 4200, 3); tone(1800, 0.08, 'triangle', 0.04, 1200); } },
  shock()    { if (ok('shock', 250)) { noise(0.5, 0.26, 160, 0.6, 'lowpass'); tone(55, 0.6, 'sine', 0.28, 30); } },
  spike()    { if (ok('spike', 90)) { noise(0.2, 0.2, 900, 1.5); tone(240, 0.12, 'square', 0.05, 120); } },
  // Süper yetenekler: hazır, kullanım, kasırga, meteor (+çarpma), ok yağmuru, gölge dansı
  superReady() { if (ok('superReady', 400)) [523, 784, 1047, 1568].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.07)); },
  superUse()   { if (ok('superUse', 200)) { tone(110, 0.7, 'sawtooth', 0.16, 330); noise(0.5, 0.2, 900, 0.6, 'bandpass'); tone(660, 0.4, 'triangle', 0.08, 1320, 0.1); } },
  whirl()      { if (ok('whirl', 120)) { noise(0.35, 0.16, 700, 1.2); tone(180, 0.3, 'sine', 0.06, 320); } },
  meteor()     { if (ok('meteor', 400)) { tone(900, 1.0, 'sine', 0.05, 200); noise(0.9, 0.08, 400, 0.6, 'lowpass'); } },
  meteorHit()  { if (ok('meteorHit', 70)) { noise(0.5, 0.3, 220, 0.7, 'lowpass'); tone(80, 0.45, 'sine', 0.3, 32); tone(500, 0.12, 'square', 0.05, 120); } },
  arrowRain()  { if (ok('arrowRain', 400)) { noise(0.8, 0.14, 3200, 1.5, 'highpass'); tone(520, 0.5, 'triangle', 0.06, 1040); } },
  arrowHit()   { if (ok('arrowHit', 45)) { tone(1500, 0.05, 'triangle', 0.05, 700); noise(0.05, 0.06, 2500, 2); } },
  shadow()     { if (ok('shadow', 60)) { noise(0.12, 0.16, 2600, 3, 'highpass'); tone(700, 0.1, 'sine', 0.08, 140); } },
  // Seyirciler: tezahürat (parlak uğultu, titreşimli) ve "ooh" (alçalan boğuk uğultu)
  crowdCheer(s = 1) { if (ok('crowdCheer', 900)) crowdNoise(0.9 + s * 1.0, 0.07 + s * 0.06, 1050, false); },
  crowdOoh(s = 1)   { if (ok('crowdOoh', 1600)) crowdNoise(0.8 + s * 0.5, 0.08 + s * 0.06, 520, true); },
  // Kapılar: zincir tıkırtısıyla kalkan parmaklık, gümleyerek inen parmaklık, boss kapısı borusu
  gateOpen()  { if (ok('gateOpen', 400)) { noise(1.0, 0.12, 260, 0.6, 'lowpass'); for (let i = 0; i < 9; i++) tone(95 + (i % 2) * 30, 0.05, 'square', 0.05, null, i * 0.1); } },
  gateClose() { if (ok('gateClose', 400)) { noise(0.35, 0.22, 180, 0.7, 'lowpass'); tone(60, 0.35, 'sine', 0.2, 30, 0.05); } },
  bossGate()  { if (ok('bossGate', 1500)) [[147, 0], [147, 0.25], [220, 0.5], [196, 0.95]].forEach(([f, d]) => { tone(f, 0.55, 'sawtooth', 0.07, null, d); tone(f / 2, 0.6, 'triangle', 0.1, null, d); }); },
};

// Dosyası olan efektleri dosyadan çal; dosya yüklenmediyse eski sentez devam eder.
const GAP = { hit: 35, gem: 40, coin: 60, arrowHit: 45, swing: 60, kill: 50, crowdCheer: 900, crowdOoh: 1600 };
for (const name of Object.keys(SFX_FILES)) {
  const synth = sfx[name];
  const vol = SFX_VOL[name] ?? 0.8;
  sfx[name] = function (arg) {
    if (!bufs[name]) return synth ? synth.call(sfx, arg) : undefined;
    if (!ok(name, GAP[name] ?? 90)) return;
    const rate = name === 'gem' ? Math.pow(2, Math.min(arg || 0, 14) / 24) : 1;
    playBuf(name, name.startsWith('crowd') ? vol * (0.6 + (arg ?? 1) * 0.4) : vol, rate);
  };
}
