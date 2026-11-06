// =====================================================
//  "📲 Telefona Yükle" butonu
//  - Android/Chrome: tarayıcının yükleme penceresini tek dokunuşla açar
//  - iPhone/iPad (Safari): "Paylaş → Ana Ekrana Ekle" adımlarını gösterir
//  - Oyun zaten uygulama olarak açıldıysa buton görünmez
// =====================================================
(() => {
  const wrap = document.getElementById('installWrap');
  const btn = document.getElementById('installBtn');
  if (!wrap || !btn) return;

  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  if (standalone) return;   // zaten yüklü uygulama olarak açık

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android/i.test(ua);
  let deferred = null;

  const show = () => wrap.classList.remove('hidden');
  const hide = () => wrap.classList.add('hidden');

  // Android/Chrome: tarayıcı yüklenebilir olduğunu bildirince butonu göster
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { deferred = null; hide(); });

  // iPhone'da bu olay hiç gelmez → butonu her zaman göster, talimat açsın
  if (isIOS) show();
  // Bazı Android tarayıcılarda olay gecikir/gelmez → mobilde yine göster, talimat açsın
  else if (isMobile) setTimeout(() => { if (!deferred) show(); }, 2500);

  function guide(html) {
    const box = document.createElement('div');
    box.className = 'overlay installGuide';
    box.style.zIndex = 60;
    box.innerHTML = `<div class="card"><h2>📲 Telefona Yükle</h2><div class="installSteps">${html}</div>
      <button class="primary" type="button">Tamam</button></div>`;
    box.querySelector('button').onclick = () => box.remove();
    box.addEventListener('click', e => { if (e.target === box) box.remove(); });
    document.body.appendChild(box);
  }

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const res = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (res && res.outcome === 'accepted') hide();
      return;
    }
    if (isIOS) {
      guide(`<p>1. Alttaki <b>Paylaş</b> düğmesine dokun <span class="ic">⎋</span> (kare ve yukarı ok).</p>
             <p>2. Listede aşağı kaydır, <b>"Ana Ekrana Ekle"</b>yi seç.</p>
             <p>3. Sağ üstte <b>"Ekle"</b>ye dokun. Ana ekranda 💀 simgesi çıkar.</p>
             <p class="note">Not: Bu adım <b>Safari</b>'de çalışır.</p>`);
    } else {
      guide(`<p>1. Tarayıcının sağ üstündeki <b>⋮</b> menüsüne dokun.</p>
             <p>2. <b>"Uygulamayı yükle"</b> ya da <b>"Ana ekrana ekle"</b>yi seç.</p>
             <p>3. <b>"Yükle"</b>ye dokun. Ana ekranda 💀 simgesi çıkar; oyun tam ekran ve internetsiz açılır.</p>`);
    }
  });
})();
