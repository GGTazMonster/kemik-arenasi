// Arayüz efektleri (oyun mantığına dokunmaz): tıklama dalgası + kıvılcım, altın sayacı, seviye kartı seçimi, sandık nadirliği.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);

  // --- Efekt katmanı ---
  const layer = document.createElement('div'); layer.id = 'fxLayer';
  document.body.appendChild(layer);

  // --- Tıklama: buton içinde dalga (ripple); menü/panellerde dokunma halkası + kıvılcımlar ---
  addEventListener('pointerdown', e => {
    if (reduce) return;
    const btn = e.target.closest && e.target.closest('button');
    if (btn && !btn.disabled) {
      const r = btn.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
      const d = document.createElement('span'); d.className = 'rip';
      d.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${s}px;height:${s}px`;
      btn.appendChild(d); setTimeout(() => d.remove(), 650);
    }
    if (e.target.closest && e.target.closest('.overlay:not(.hidden)')) {
      const ring = document.createElement('div'); ring.className = 'tapRing';
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      layer.appendChild(ring); setTimeout(() => ring.remove(), 550);
      const n = btn ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, dist = 28 + Math.random() * 38;
        const p = document.createElement('div'); p.className = 'spark';
        p.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist}px`;
        layer.appendChild(p); setTimeout(() => p.remove(), 600);
      }
    }
  }, { passive: true, capture: true });

  // --- Altın sayacı: değer değişince sayarak artar/azalır ---
  const num = el => parseInt((el.textContent || '').replace(/[^\d-]/g, ''), 10);
  function countTo(el, to) {
    const from = el._shown ?? to;
    cancelAnimationFrame(el._raf);
    if (reduce || from === to) { el._shown = to; return; }
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    const t0 = performance.now(), dur = Math.min(900, 300 + Math.abs(to - from) * 6);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el._busy = true; el.textContent = v; el._shown = v;
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  const goldObs = new MutationObserver(list => {
    for (const m of list) {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!el || !el.classList.contains('goldAmt')) continue;
      if (el._busy) { el._busy = false; continue; }          // kendi yazdığımız değer
      const to = num(el); if (isNaN(to)) continue;
      if (el._shown === undefined) { el._shown = to; continue; }
      if (el.offsetParent === null) { el._shown = to; continue; }   // görünmüyorsa animasyon yok
      el.textContent = el._shown; el._busy = true;           // eski değerden başla
      countTo(el, to);
    }
  });
  for (const el of document.querySelectorAll('.goldAmt')) { el._shown = num(el); goldObs.observe(el, { childList: true, characterData: true, subtree: true }); }

  // HUD altın göstergesi: artınca küçük zıplama
  const goldTxt = $('goldTxt');
  if (goldTxt && !reduce) {
    let last = goldTxt.textContent;
    new MutationObserver(() => {
      const v = goldTxt.textContent; if (v === last) return;
      const up = parseInt(v, 10) > parseInt(last, 10); last = v;
      if (up) { goldTxt.classList.remove('bump'); void goldTxt.offsetWidth; goldTxt.classList.add('bump'); }
    }).observe(goldTxt, { childList: true, characterData: true, subtree: true });
  }

  // --- Seviye atlama: seçilen kart parlasın, sonra seçim uygulansın ---
  const choices = $('choices');
  if (choices && !reduce) {
    choices.addEventListener('click', e => {
      const b = e.target.closest('.choice');
      if (!b || b._go) return;
      if (choices.querySelector('.picked')) { e.stopImmediatePropagation(); return; }
      e.stopImmediatePropagation();
      b.classList.add('picked');
      setTimeout(() => { b._go = true; if (b.isConnected) b.click(); }, 260);
    }, true);
  }

  // --- Sandık: ödüle göre nadirlik rengi + ışık patlaması ---
  const chest = $('chest'), reel = $('chestReel'), rewards = $('chestRewards');
  if (chest && reel && rewards) {
    const rank = { common: 0, rare: 1, epic: 2, legend: 3 };
    const rarOf = row => {
      const t = (row.lastElementChild ? row.lastElementChild.textContent : '').trim();
      if (/EVR/i.test(t)) return 'legend';
      if (/YENİ/i.test(t)) return 'rare';
      const m = t.match(/Sv\.\s*(\d+)/); if (m && +m[1] >= 4) return 'epic';
      return t ? 'common' : null;
    };
    const boom = () => { chest.classList.remove('burst'); void chest.offsetWidth; chest.classList.add('burst'); };
    let wasHidden = chest.classList.contains('hidden');
    new MutationObserver(() => {
      const h = chest.classList.contains('hidden');
      if (h === wasHidden) return;
      wasHidden = h;
      if (!h) { chest.removeAttribute('data-rar'); chest.classList.remove('burst'); }   // yeni açılış: sıfırla
    }).observe(chest, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => {
      if (reel.classList.contains('spin')) return;
      let best = 'common';
      for (const row of rewards.children) { const r = rarOf(row); if (r) { row.classList.add('rar-' + r); if (rank[r] > rank[best]) best = r; } }
      chest.dataset.rar = best; boom();
    }).observe(rewards, { childList: true });
  }
})();
