import { Store } from '../core/store';
import { App } from './app';
import { h } from './dom';
import { toast } from './ui';

async function registerServiceWorker(app: App): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const offer = (worker: ServiceWorker) => app.offerUpdate(() => worker.postMessage({ type: 'SKIP_WAITING' }));
    if (registration.waiting && hadController) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  } catch (error) {
    console.error('service worker registration failed', error);
    toast('오프라인 기능을 켜지 못했어요.');
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  let store: Store;
  try {
    store = await Store.open();
  } catch (error) {
    root.replaceChildren(
      h('div', { class: 'boot' }, h('h1', null, '통화 검색'), h('p', null, '저장소를 열지 못했어요. 시크릿 창이라면 일반 창에서 열어 주세요.'), h('p', { class: 'muted' }, String(error))),
    );
    return;
  }
  const app = new App(store, root);
  await app.start();
  await registerServiceWorker(app);
}

void boot();
