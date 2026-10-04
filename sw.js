const CACHE_NAME = 'notoj-app-v2.4.18';
const BASE = self.registration.scope;
const urlsToCache = [
  './',
  'index.html',
  'app/index.html',
  'app/settings.html',

  // CSS
  'app/src/css/app.css',
  'app/src/css/md3e-app.css',
  'app/src/css/nthng.css',
  'app/src/css/settings.css',

  // JS
  'app/src/js/app.js',
  'app/src/js/settings.js',
  'app/src/js/md3e-enhance.js',
  'app/src/js/cache-update.js',
  'app/src/js/offline-sync.js',

  // Fonts
  'app/src/assets/fonts/SFR.ttf',
  'app/src/assets/fonts/Ndot-57-Aligned.otf',
  'app/src/assets/fonts/NType82-Headline.otf',
  'app/src/assets/fonts/NType82-Regular.otf',
  'app/src/assets/fonts/UbuntuMono[wght].ttf',

  // Icons
  'app/src/assets/icons/logo.png',
  'src/assets/icons/logo.png',
  'src/assets/icons/logo.svg',

  // Wallpapers
  // iOS wallpapers
  'app/src/assets/wallpaper/imd/imd1.jpg',
  'app/src/assets/wallpaper/imd/imd2.jpg',
  'app/src/assets/wallpaper/imd/imd3.jpg',
  'app/src/assets/wallpaper/imd/imd4.jpg',
  // Nothing wallpapers
  'app/src/assets/wallpaper/n/nos1.jpg',
  'app/src/assets/wallpaper/n/nos2.jpg',
  'app/src/assets/wallpaper/n/nos3.jpg',
  'app/src/assets/wallpaper/n/nos4.jpg'

].map(p => new URL(p, BASE).toString());

// ============================================================================
// INSTALL: Pre-cache all assets
// ============================================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching all assets');
      return cache.addAll(urlsToCache).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
        return Promise.all(
          urlsToCache.map(url =>
            cache.add(url).catch(e => {
              console.warn(`[SW] Failed to cache ${url}:`, e.message);
            })
          )
        );
      });
    })
  );
});

// ============================================================================
// ACTIVATE: Clean up old caches
// ============================================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activated - cleaning up old caches');
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name.startsWith('notoj-app-') && name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
  );
});

// ============================================================================
// FETCH: Cache-First with URL normalization
// ============================================================================
self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith(self.location.origin)) return;

  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate') {
    url.search = '';
  }
  const normalizedRequest = new Request(url.toString(), { headers: event.request.headers });

  event.respondWith(
    caches.match(normalizedRequest).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(normalizedRequest, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match(new URL('app/index.html', BASE).toString())
            || caches.match(new URL('index.html', BASE).toString());
        }
      });
    })
  );
});

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
self.addEventListener('message', event => {
  if (event.origin !== self.location.origin || !event.source) return;
  if (!event.data || !event.data.type) return;
  console.log('[SW] Message received:', event.data.type);

  switch (event.data.type) {

    case 'UNREGISTER_AND_CLEAR_ALL': {
      const port = event.ports[0];

      (async () => {
        try {
          console.log('[SW] Executing total self-destruct...');

          // 1. Delete all CacheStorage instances
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));

          // 2. Clear IndexedDB databases
          if ('indexedDB' in self && indexedDB.databases) {
            const dbs = await indexedDB.databases();
            await Promise.all(dbs.map(db => indexedDB.deleteDatabase(db.name)));
          }

          // 3. Notify main thread cleanup completed
          port?.postMessage({ status: 'SUCCESS' });

          // 4. Unregister Service Worker
          await self.registration.unregister();
          console.log('[SW] Successfully unregistered');

        } catch (err) {
          console.error('[SW] Cleanup error:', err);
          port?.postMessage({ status: 'ERROR', error: err.message });
        }
      })();
      break;
    }

    case 'SKIP_WAITING':
      console.log('[SW] User requested update - activating new service worker');
      self.skipWaiting();
      break;

    case 'CLAIM_CLIENTS':
      console.log('[SW] Claiming clients for new version');
      self.clients.claim();
      break;

    case 'CLEAR_CACHE':
      caches.keys().then(cacheNames => {
        Promise.all(
          cacheNames.map(cacheName => {
            console.log('[SW] Clearing cache:', cacheName);
            return caches.delete(cacheName);
          })
        );
      });
      break;

    case 'CACHE_URLS': {
      const urls = (event.data.urls && event.data.urls.length) ? event.data.urls : urlsToCache;
      const port = event.ports[0];
      let downloadedFiles = 0, downloadedBytes = 0;

      (async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          for (const path of urls) {
            const url = new URL(path, BASE).toString();
            port?.postMessage({ type: 'UPDATE_PROGRESS', phase: 'downloading', url, downloadedFiles, totalFiles: urls.length, downloadedBytes });
            const res = await fetch(url);
            if (res && res.ok) {
              const blob = await res.clone().blob();
              downloadedBytes += blob.size;
              await cache.put(url, res);
            }
            downloadedFiles++;
          }
          port?.postMessage({ type: 'UPDATE_PROGRESS', phase: 'installing', downloadedFiles, totalFiles: urls.length, downloadedBytes });
          port?.postMessage({ type: 'UPDATE_DONE', downloadedFiles, totalFiles: urls.length, downloadedBytes });
        } catch (err) {
          port?.postMessage({ type: 'UPDATE_ERROR', error: err.message });
        }
      })();
      break;
    }

    case 'GET_UPDATE_SIZE': {
      const urls = (event.data.urls && event.data.urls.length) ? event.data.urls : urlsToCache;
      const port = event.ports[0];

      (async () => {
        let totalBytes = 0;
        await Promise.all(urls.map(async path => {
          try {
            const url = new URL(path, BASE).toString();
            const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            const len = res.headers.get('content-length');
            if (len) totalBytes += parseInt(len, 10);
          } catch (e) {}
        }));
        port?.postMessage({ type: 'UPDATE_SIZE', totalBytes, totalFiles: urls.length });
      })();
      break;
    }

    case 'GET_CACHE_SIZE':
      caches.keys().then(cacheNames => {
        Promise.all(
          cacheNames.map(cacheName =>
            caches.open(cacheName).then(cache =>
              cache.keys().then(requests =>
                Promise.all(
                  requests.map(request =>
                    cache.match(request).then(response =>
                      response ? response.blob().then(b => b.size) : 0
                    )
                  )
                )
              )
            ).then(sizes => sizes.reduce((a, b) => a + b, 0))
          )
        ).then(cacheSizes => {
          const totalSize = cacheSizes.reduce((a, b) => a + b, 0);
          event.ports[0]?.postMessage({
            cacheSize: totalSize,
            cacheSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
          });
        });
      });
      break;
  }
});