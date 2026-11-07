// =====================================================
//  Mobil dokunmatik kontroller
//  - Sol tarafa dokunulan yerde beliren analog joystick
//  - Sağ altta atılma butonu
//  Sadece dokunmatik cihazlarda görünür (#hud içinde; HUD gizliyse onlar da gizli).
// =====================================================

// Ana giriş parmaksa (telefon/tablet) baştan aç; dokunmatik ekranlı dizüstünde ilk gerçek dokunuşta açılır
export const isTouchDevice = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

export function initTouch(hud, { onFirstTouch, controls, onControls } = {}) {
  const state = { active: false, x: 0, y: 0, dash: false, sup: false };
  const api = {
    get active() { return state.active; }, get x() { return state.x; }, get y() { return state.y; },
    consumeDash() { const d = state.dash; state.dash = false; return d; },
    consumeSuper() { const d = state.sup; state.sup = false; return d; },
    // Süper butonu: dolum 0..1 (halka), hazır (parlar), ikon
    setSuper(frac, ready, icon) {
      superBtn.style.setProperty('--p', Math.round(frac * 100));
      superBtn.classList.toggle('ready', !!ready);
      if (icon && superBtn.dataset.ic !== icon) { superBtn.dataset.ic = icon; superBtn.textContent = icon; }
    },
    reset() { state.active = false; state.x = state.y = 0; state.dash = false; state.sup = false; base.classList.remove('on'); },
    enabled: false,
    edit: (on, onExit) => setEdit(on, onExit),
  };

  // Elemanlar
  const zone = document.createElement('div'); zone.id = 'touchZone';
  const base = document.createElement('div'); base.id = 'joyBase';
  const knob = document.createElement('div'); knob.id = 'joyKnob';
  base.appendChild(knob);
  const dashBtn = document.createElement('button'); dashBtn.id = 'dashBtn'; dashBtn.textContent = '💨'; dashBtn.setAttribute('aria-label', 'Atıl');
  // Süper butonu: dashBtn'in solunda, büyük; dolunca parlar (dolum halkası --p)
  const superBtn = document.createElement('button'); superBtn.id = 'superBtn'; superBtn.textContent = '⚡'; superBtn.setAttribute('aria-label', 'Süper');
  hud.append(zone, base, dashBtn, superBtn);

  let R = 60;             // joystick yarıçapı (px; kontrol ayarındaki boyuta göre değişir)
  let pid = null, cx = 0, cy = 0;

  // ---------- Kontrol yerleşimi (yüzde konumlar → ekran boyutundan bağımsız) ----------
  const $ = id => document.getElementById(id);
  const pauseBtn = $('pauseBtn'), speedBtn = $('speedBtn');
  const DRAG = { dash: dashBtn, super: superBtn, pause: pauseBtn, speed: speedBtn };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const norm = c => {
    c = c || {};
    const pos = {};
    for (const k in DRAG) { const p = c.pos && c.pos[k]; if (p && isFinite(p.x) && isFinite(p.y)) pos[k] = { x: clamp(+p.x, 3, 97), y: clamp(+p.y, 3, 97) }; }
    return { scale: clamp(+c.scale || 1, 0.7, 1.4), joySide: c.joySide === 'right' ? 'right' : 'left', joySize: clamp(+c.joySize || 1, 0.7, 1.5), pos };
  };
  let cfg = norm(controls);
  function applyControls() {
    document.body.classList.toggle('joyR', cfg.joySide === 'right');
    for (const k in DRAG) {
      const el = DRAG[k]; if (!el) continue;
      const p = cfg.pos[k];
      el.style.setProperty('--cs', cfg.scale);
      el.classList.toggle('cpos', !!p);
      el.style.left = p ? p.x + '%' : ''; el.style.top = p ? p.y + '%' : '';
      el.style.right = el.style.bottom = p ? 'auto' : '';
    }
    R = 60 * cfg.joySize;
    base.style.width = base.style.height = R * 2 + 'px';
    const kn = R * 0.83;
    knob.style.width = knob.style.height = kn + 'px';
    knob.style.left = knob.style.top = (R - kn / 2) + 'px';
    placeJoyPreview();
  }
  const saveCfg = () => { onControls && onControls(JSON.parse(JSON.stringify(cfg))); };

  // ---------- Düzenleme modu ----------
  let editing = false, editExit = null, forcedTouch = false, hudWasHidden = true;
  function placeJoyPreview() {
    if (!editing) return;
    const x = (cfg.joySide === 'right' ? 0.78 : 0.22) * innerWidth, y = 0.62 * innerHeight;
    base.style.transform = `translate(${x - R}px, ${y - R}px)`;
    knob.style.transform = 'translate(0px, 0px)';
  }
  function syncPanel() {
    $('ctrlScale').value = cfg.scale; $('ctrlJoy').value = cfg.joySize;
    for (const b of document.querySelectorAll('#ctrlSide button')) b.classList.toggle('on', b.dataset.side === cfg.joySide);
  }
  function setEdit(on, onExit) {
    if (on === editing) return;
    editing = on;
    const body = document.body;
    if (on) {
      editExit = onExit || null;
      hudWasHidden = hud.classList.contains('hidden');
      forcedTouch = !body.classList.contains('touch');
      body.classList.add('touch', 'ctrlEdit');   // dash/süper düğmeleri masaüstünde de görünsün
      hud.classList.remove('hidden');
      $('ctrlPanel').classList.remove('hidden');
      base.classList.add('on');
      syncPanel(); placeJoyPreview();
    } else {
      body.classList.remove('ctrlEdit');
      if (forcedTouch && !api.enabled) body.classList.remove('touch');
      if (hudWasHidden) hud.classList.add('hidden');
      $('ctrlPanel').classList.add('hidden');
      base.classList.remove('on');
      const f = editExit; editExit = null;
      f && f();
    }
  }
  // Sürükleme (düzenleme modunda; yakalama aşamasında oyun işleyicilerinden önce çalışır)
  for (const k in DRAG) {
    const el = DRAG[k]; if (!el) continue;
    let drag = null;
    el.addEventListener('pointerdown', e => {
      if (!editing) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const r = el.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('dragging');
    }, true);
    el.addEventListener('pointermove', e => {
      if (!editing || !drag || e.pointerId !== drag.id) return;
      cfg.pos[k] = { x: clamp((e.clientX - drag.dx) / innerWidth * 100, 3, 97), y: clamp((e.clientY - drag.dy) / innerHeight * 100, 3, 97) };
      applyControls();
    });
    const up = e => { if (!drag || e.pointerId !== drag.id) return; drag = null; el.classList.remove('dragging'); saveCfg(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('click', e => { if (editing) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }
  $('ctrlScale').oninput = e => { cfg.scale = clamp(+e.target.value, 0.7, 1.4); applyControls(); saveCfg(); };
  $('ctrlJoy').oninput = e => { cfg.joySize = clamp(+e.target.value, 0.7, 1.5); applyControls(); saveCfg(); };
  for (const b of document.querySelectorAll('#ctrlSide button')) b.onclick = () => { cfg.joySide = b.dataset.side; applyControls(); syncPanel(); saveCfg(); };
  $('ctrlReset').onclick = () => { cfg = norm(null); applyControls(); syncPanel(); saveCfg(); };
  $('ctrlDone').onclick = () => setEdit(false);
  addEventListener('resize', placeJoyPreview);
  applyControls();

  function enable() {
    if (api.enabled) return;
    api.enabled = true;
    document.body.classList.add('touch');
  }
  if (isTouchDevice()) enable();
  addEventListener('pointerdown', e => { if (e.pointerType === 'touch') enable(); }, { capture: true });

  // Joystick'e çift dokunma = atılma. Yön için ilk sürüklemeyi (ya da 110 ms) bekler.
  let lastTap = 0, lastX = 0, lastY = 0, dashPend = false, dashTimer = 0;
  const fireDash = () => { if (!dashPend) return; dashPend = false; clearTimeout(dashTimer); state.dash = true; };
  zone.addEventListener('pointerdown', e => {
    if (editing) return;
    if (e.pointerType === 'mouse' && !api.enabled) return;
    enable();
    onFirstTouch && onFirstTouch();
    if (pid !== null) return;
    pid = e.pointerId; cx = e.clientX; cy = e.clientY;
    try { zone.setPointerCapture(pid); } catch {}
    base.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.add('on');
    state.active = true; state.x = state.y = 0;
    const now = performance.now();
    if (now - lastTap < 300 && Math.hypot(cx - lastX, cy - lastY) < 70) { dashPend = true; dashTimer = setTimeout(fireDash, 110); lastTap = 0; }
    else { lastTap = now; lastX = cx; lastY = cy; }
    e.preventDefault();
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Yön × büyüklük: küçük ölü bölge (%6), yolun %60'ında tam hız (az itince de hemen yürür)
    const m = Math.min(1, d / R);
    const mag = m < 0.06 ? 0 : Math.min(1, (m - 0.06) / 0.54);
    state.x = d > 0 ? dx / Math.max(d, 0.001) * mag : 0;
    state.y = d > 0 ? dy / Math.max(d, 0.001) * mag : 0;
    if (dashPend && m > 0.25) fireDash();
    e.preventDefault();
  });
  const end = e => {
    if (e.pointerId !== pid) return;
    pid = null; state.active = false; state.x = state.y = 0;
    base.classList.remove('on');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  dashBtn.addEventListener('pointerdown', e => {
    enable();
    state.dash = true;
    dashBtn.classList.add('press'); setTimeout(() => dashBtn.classList.remove('press'), 120);
    e.preventDefault(); e.stopPropagation();
  });

  superBtn.addEventListener('pointerdown', e => {
    enable();
    state.sup = true;
    superBtn.classList.add('press'); setTimeout(() => superBtn.classList.remove('press'), 120);
    e.preventDefault(); e.stopPropagation();
  });

  // Sayfanın kayması / çift dokunma yakınlaştırması olmasın
  // (sadece oyun sırasında; menüler mobilde kaydırılabilmeli)
  document.addEventListener('touchmove', e => {
    if (hud.classList.contains('hidden')) return;
    // Paneller (duraklat, seviye, sandık, zafer, oyun sonu, ayarlar...) kaydırılabilsin
    if (e.target && e.target.closest && e.target.closest('.overlay, .card, #ctrlPanel')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault());

  return api;
}
