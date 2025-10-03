/* PKGO Web - V1.11: PWA auto-update on launch (home-screen) */
(function(){
  async function ensureSWUpdateOnLaunch(){
    if (!('serviceWorker' in navigator)) return;
    try {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        const base = location.pathname.replace(/[^/]+$/, '');
        reg = await navigator.serviceWorker.register(base + 'sw.js');
      }
      await reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000);
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller){
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window.__reloadedAfterSWUpdate) return;
        window.__reloadedAfterSWUpdate = true;
        location.reload();
      });
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'SW_ACTIVATED') {
          if (!window.__reloadedAfterSWUpdate) {
            window.__reloadedAfterSWUpdate = true;
            location.reload();
          }
        }
      });
    } catch (err){
      console.warn('[V1.11] ensureSWUpdateOnLaunch error:', err);
    }
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureSWUpdateOnLaunch);
  } else {
    ensureSWUpdateOnLaunch();
  }
})();



/* V1.11.1 runtime guard: detect CSV fetch returning HTML or 503 and warn */
window.__csvGuard = function(text){
  if (!text) return text;
  const head = text.slice(0, 32).toLowerCase();
  if (head.includes('<!doctype') || head.includes('<html')){
    alert('資料抓取被檔住了（收到 HTML）。請重新開啟一次或更新 PWA。');
  }
  return text;
};

