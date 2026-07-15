/**
 * PWA Cache Update Manager - SW ONLY VERSION
 *
 * ✅ Uses ONLY sw.js + cache names
 * ✅ No version.json
 * ✅ No localStorage dependency
 * ✅ No auto updates
 * ✅ User-triggered updates only
 * ✅ Cleans old caches safely
 */

let BUILD_NUMBER = 'Unknown';
let updateAvailable = false;
let ACTIVE_CACHE_NAME = null;
let LATEST_CACHE_NAME = null;
let userTriggeredUpdate = false;
let updateProgressState = {
  phase: 'idle',
  downloadedFiles: 0,
  totalFiles: 0,
  downloadedBytes: 0,
  message: ''
};

function shouldShowNotifications() {
  return localStorage.getItem('app_notifications_disabled') !== 'true';
}

/**
 * Init
 */
window.addEventListener('load', async () => {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Cache Update] Service Workers not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    console.log('[Cache Update] SW ready');

    await syncCacheState();
    displayBuildNumber();

    registration.addEventListener('updatefound', () => {
      const newSW = registration.installing;
      console.log('[Cache Update] updatefound', newSW);
      if (newSW) {
        newSW.addEventListener('statechange', () => {
          console.log('[Cache Update] SW state', newSW.state);
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            updateAvailable = true;
            updateButtonUI(true);
          }
        });
      }
    });

    setTimeout(() => {
      checkForUpdates();
    }, 1500);

  } catch (err) {
    console.error('[Cache Update] Init failed:', err);
  }
});

/**
 * Get all app caches
 */
async function getAppCaches() {
  const cacheNames = await caches.keys();

  return cacheNames.filter(name =>
    name.startsWith('notoj-app-cache-v')
  );
}

/**
 * Parse version from cache name
 * Example:
 * notoj-app-cache-v2.7.15
 */
function parseVersion(cacheName) {
  const match = cacheName.match(/v(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    return {
      major: 0,
      minor: 0,
      patch: 0
    };
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Sort and get latest cache
 */
async function getLatestCacheName(appCaches) {
  if (!appCaches.length) return null;

  const sorted = [...appCaches].sort((a, b) => {
    const A = parseVersion(a);
    const B = parseVersion(b);

    if (A.major !== B.major) {
      return B.major - A.major;
    }

    if (A.minor !== B.minor) {
      return B.minor - A.minor;
    }

    return B.patch - A.patch;
  });

  return sorted[0];
}

/**
 * Sync cache state
 */
async function syncCacheState() {
  const appCaches = await getAppCaches();

  if (!appCaches.length) {
    console.warn('[Cache Update] No app caches found');
    return;
  }

  LATEST_CACHE_NAME = await getLatestCacheName(appCaches);

  ACTIVE_CACHE_NAME = LATEST_CACHE_NAME;

  const versionMatch = ACTIVE_CACHE_NAME.match(/v(.+)/);

  BUILD_NUMBER = versionMatch?.[1] || 'Unknown';

  console.log('[Cache Update]');
  console.log('Active:', ACTIVE_CACHE_NAME);
  console.log('Build:', BUILD_NUMBER);
}

/**
 * Show build number
 */
function displayBuildNumber() {
  const buildElement = document.getElementById('buildNumberDisplay');

  if (buildElement) {
    buildElement.textContent = `Build: ${BUILD_NUMBER}`;
  }
}

/**
 * Check for updates
 */
async function checkForUpdates() {
  try {
    const registration = await navigator.serviceWorker.getRegistration();

    if (!registration) {
      console.warn('[Cache Update] No SW registration');
      return;
    }

    console.log('[Cache Update] Checking for updates...');

    await registration.update();

    await wait(2000);

    const appCaches = await getAppCaches();

    const newestCache = await getLatestCacheName(appCaches);

    console.log('[Cache Update]');
    console.log('Current:', ACTIVE_CACHE_NAME);
    console.log('Latest:', newestCache);

    // Cleanup middle caches
    await cleanupMiddleCaches(appCaches, newestCache);

    if (
      newestCache &&
      ACTIVE_CACHE_NAME &&
      newestCache !== ACTIVE_CACHE_NAME
    ) {
      console.log('[Cache Update] UPDATE AVAILABLE');

      LATEST_CACHE_NAME = newestCache;

      updateAvailable = true;

      updateButtonUI(true);

    } else {
      console.log('[Cache Update] Already latest');

      updateAvailable = false;

      updateButtonUI(false);
    }

  } catch (err) {
    console.error('[Cache Update] Check failed:', err);
  }
}

/**
 * Cleanup caches safely
 */
async function cleanupMiddleCaches(appCaches, newestCache) {
  if (appCaches.length <= 2) return;

  const keep = new Set([
    ACTIVE_CACHE_NAME,
    newestCache
  ]);

  const deletions = appCaches
    .filter(name => !keep.has(name))
    .map(name => {
      console.log('[Cache Update] Deleting old cache:', name);
      return caches.delete(name);
    });

  await Promise.all(deletions);
}

/**
 * Update button state
 */
function updateButtonUI(hasUpdate = false) {
  const updateText = document.getElementById('updateCacheText');

  if (!updateText) return;

  if (hasUpdate) {
    updateText.textContent = 'Update available';
    updateText.style.color = 'var(--accent)';
    updateText.style.fontWeight = '600';
  } else {
    updateText.textContent = 'Check for updates';
    updateText.style.color = '';
    updateText.style.fontWeight = '';
  }
}

/**
 * Open update modal
 */
window.showUpdateCacheModal = () => {

  if (typeof window.openModal !== 'function') {
    alert('Modal system not ready');
    return;
  }

  if (updateAvailable) {

    window.openModal(
      'App Update Available',
      'A new version is ready.',
      'Update Now',
      'var(--accent)',
      async () => {
        await performUpdate();
      }
    );

  } else {

    window.openModal(
      'Check for Updates',
      'Check for latest version?',
      'Check Now',
      'var(--accent)',
      async () => {
        await manualUpdateCheck();
      }
    );

  }
};

/**
 * Manual check
 */
async function manualUpdateCheck() {
  try {

    const confirmBtn =
      document.getElementById('modal-confirm-btn');

    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Checking...';

    await checkForUpdates();

    if (updateAvailable) {

      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Update Now';

      confirmBtn.onclick = async () => {
        await performUpdate();
      };

      document.getElementById('modal-title').innerText =
        'Update Ready';

      document.getElementById('modal-message').innerText =
        'A new version is available.';

    } else {

      document.getElementById('modal-title').innerText =
        'No Updates';

      document.getElementById('modal-message').innerText =
        'Your app is already up to date.';

      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Close';
      confirmBtn.onclick = () => {
        window.closeCustomModal();
      };

      if (shouldShowNotifications()) {
        showNotification(
          'Up to Date',
          'You already have latest version',
          'success'
        );
      }
    }

  } catch (err) {

    console.error(err);

    window.closeCustomModal();

    showNotification(
      'Update Failed',
      err.message,
      'error'
    );
  }
}

/**
 * Perform update
 */
async function performUpdate() {
  try {

    userTriggeredUpdate = true;

    const registration =
      await navigator.serviceWorker.getRegistration();

    if (!registration) {
      throw new Error('No SW registration');
    }

    await registration.update();

    const sw =
      registration.waiting || registration.installing || registration.active;

    if (!sw) {
      throw new Error('No SW found');
    }

    const confirmBtn =
      document.getElementById('modal-confirm-btn');

    confirmBtn.disabled = true;

    confirmBtn.innerText = 'Installing...';

    console.log('[Cache Update] Sending SKIP_WAITING');

    sw.postMessage({
      type: 'SKIP_WAITING'
    });

    await wait(500);

    if (registration.active) {
      registration.active.postMessage({
        type: 'CLAIM_CLIENTS'
      });
    }

    let updated = false;

    const listener = () => {

      if (!userTriggeredUpdate) return;

      updated = true;

      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        listener
      );
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      listener
    );

    await new Promise(resolve => {

      const timeout = setTimeout(() => {
        resolve();
      }, 3000);

      const interval = setInterval(() => {

        if (updated) {

          clearTimeout(timeout);
          clearInterval(interval);

          resolve();
        }

      }, 100);

    });

    ACTIVE_CACHE_NAME = LATEST_CACHE_NAME;

    updateAvailable = false;

    updateButtonUI(false);

    confirmBtn.innerText = '✓ Updated';

    console.log('[Cache Update] Update complete');

    setTimeout(() => {
      window.location.reload();
    }, 1200);

  } catch (err) {

    console.error('[Cache Update] Install failed:', err);

    showNotification(
      'Update Failed',
      err.message,
      'error'
    );

  } finally {

    userTriggeredUpdate = false;
  }
}

/**
 * Notification
 */
function showNotification(title, message, type = 'info') {
  if (!shouldShowNotifications()) return;

  let container =
    document.getElementById('notification-container');

  if (!container) {

    container = document.createElement('div');

    container.id = 'notification-container';

    container.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;

    document.body.appendChild(container);
  }

  const notification = document.createElement('div');

  let bg = 'var(--bg-card)';
  let color = 'var(--text-main)';

  if (type === 'success') {
    bg = 'var(--accent)';
    color = '#fff';
  }

  if (type === 'error') {
    bg = 'var(--accent1)';
    color = '#fff';
  }

  notification.style.cssText = `
    padding: 14px 18px;
    border-radius: 12px;
    background: ${bg};
    color: ${color};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-size: 14px;
  `;

  notification.innerHTML = `
    <div style="font-weight:600;">
      ${title}
    </div>

    <div style="opacity:0.9;font-size:13px;">
      ${message}
    </div>
  `;

  container.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 4000);
}

/**
 * Helper
 */
function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

console.log('[Cache Update] SW-only manager loaded');