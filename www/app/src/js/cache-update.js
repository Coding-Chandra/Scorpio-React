/**
 * PWA Cache Update Manager - SW ONLY VERSION
 *
 * ✅ Uses ONLY sw.js + cache names
 * ✅ No version.json
 * ✅ No localStorage dependency
 * ✅ No auto updates
 * ✅ User-triggered updates only
 * ✅ Cleans old caches safely
 * ✅ Total automatic cleanup & self-destruct support
 */

let BUILD_NUMBER = 'Unknown';
let updateAvailable = false;
let ACTIVE_CACHE_NAME = null;
let LATEST_CACHE_NAME = null;
let userTriggeredUpdate = false;
let pendingUpdateSize = null;
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
    name.startsWith('notoj-app-')
  );
}

/**
 * Parse version from cache name
 * Example: notoj-app-v1.99.27
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
 * Ask the SW for the total download size of pending update files
 */
async function fetchUpdateSize() {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sw = registration?.active;
    if (!sw) return null;

    return await new Promise(resolve => {
      const channel = new MessageChannel();

      channel.port1.onmessage = event => {
        if (event.data?.type === 'UPDATE_SIZE') {
          resolve(event.data);
        } else {
          resolve(null);
        }
      };

      sw.postMessage({ type: 'GET_UPDATE_SIZE' }, [channel.port2]);

      setTimeout(() => resolve(null), 8000);
    });
  } catch {
    return null;
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
      pendingUpdateSize = await fetchUpdateSize();

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

  const sourceEl = document.getElementById('updateCacheBtn');

  if (updateAvailable) {
    const sizeText = pendingUpdateSize?.totalBytes
      ? ` (${formatBytes(pendingUpdateSize.totalBytes)})`
      : '';

    window.openModal(
      'App Update Available',
      `A new version is ready${sizeText}.`,
      'Update Now',
      'var(--accent)',
      async () => {
        await performUpdate();
      },
      sourceEl
    );

  } else {
    window.openModal(
      'Check for Updates',
      'Check for latest version?',
      'Check Now',
      'var(--accent)',
      async () => {
        await manualUpdateCheck();
      },
      sourceEl
    );
  }
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function updateProgressUI(phase, message = '', extra = {}) {
  updateProgressState = {
    phase,
    downloadedFiles: extra.downloadedFiles ?? updateProgressState.downloadedFiles,
    totalFiles: extra.totalFiles ?? updateProgressState.totalFiles,
    downloadedBytes: extra.downloadedBytes ?? updateProgressState.downloadedBytes,
    message
  };

  const titleEl = document.getElementById('modal-title');
  const messageEl = document.getElementById('modal-message');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  if (!titleEl || !messageEl || !confirmBtn) return;

  const totalFiles = updateProgressState.totalFiles || 1;
  const percent = updateProgressState.totalFiles
    ? Math.round((updateProgressState.downloadedFiles / totalFiles) * 100)
    : 0;
  const sizeLabel = formatBytes(updateProgressState.downloadedBytes);

  if (phase === 'downloading') {
    titleEl.innerText = 'Downloading update';
    messageEl.innerHTML = `
      <span class="update-progress-label">Fetching new app files</span>
      <span class="update-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span class="update-progress-fill" style="width: ${percent}%"></span>
      </span>
      <span class="update-progress-stats"><strong>${percent}%</strong><span>${updateProgressState.downloadedFiles}/${totalFiles} files · ${sizeLabel}</span></span>`;
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Downloading...';
  } else if (phase === 'installing') {
    titleEl.innerText = 'Installing update';
    messageEl.innerHTML = `
      <span class="update-progress-label">${message || 'Preparing app files'}</span>
      <span class="update-progress-track update-progress-track-indeterminate" role="progressbar" aria-label="Installing update">
        <span class="update-progress-fill"></span>
      </span>
      <span class="update-progress-stats"><strong>Almost done</strong><span>${updateProgressState.downloadedFiles}/${totalFiles} files · ${sizeLabel} ready</span></span>`;
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Installing...';
  } else if (phase === 'error') {
    titleEl.innerText = 'Update failed';
    messageEl.innerText = message || 'The update could not be completed.';
    confirmBtn.disabled = false;
    confirmBtn.innerText = 'Try again';
    confirmBtn.onclick = async () => {
      await performUpdate();
    };
  } else if (phase === 'complete') {
    titleEl.innerText = 'Update ready';
    messageEl.innerText = `${message || 'The update is ready to apply.'} (${sizeLabel})`;
    confirmBtn.disabled = false;
    confirmBtn.innerText = 'Reload app';
    confirmBtn.onclick = () => window.location.reload();
  }
}

/**
 * Manual check
 */
async function manualUpdateCheck() {
  try {
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Checking...';

    await checkForUpdates();

    if (updateAvailable) {
      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Update Now';

      confirmBtn.onclick = async () => {
        await performUpdate();
      };

      const sizeText = pendingUpdateSize?.totalBytes
        ? ` (${formatBytes(pendingUpdateSize.totalBytes)})`
        : '';

      document.getElementById('modal-title').innerText = 'Update Ready';
      document.getElementById('modal-message').innerText = `A new version is available${sizeText}.`;

    } else {
      document.getElementById('modal-title').innerText = 'No Updates';
      document.getElementById('modal-message').innerText = 'Your app is already up to date.';

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

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      throw new Error('No SW registration');
    }

    const confirmBtn = document.getElementById('modal-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerText = 'Preparing...';
    }

    updateProgressUI('downloading', 'Fetching update assets from the service worker');

    const sw = registration.waiting || registration.installing || registration.active;
    if (!sw) {
      throw new Error('No SW found');
    }

    const downloadPromise = new Promise((resolve, reject) => {
      const channel = new MessageChannel();

      channel.port1.onmessage = event => {
        const data = event.data || {};

        if (data.type === 'UPDATE_PROGRESS') {
          if (data.phase === 'downloading') {
            updateProgressUI('downloading', data.url ? `Downloading ${data.url}` : 'Fetching update assets', data);
          } else if (data.phase === 'installing') {
            updateProgressUI('installing', 'Installing downloaded files into cache', data);
          } else if (data.phase === 'error') {
            reject(new Error(data.error || 'Update download failed'));
          }
          return;
        }

        if (data.type === 'UPDATE_DONE') {
          resolve(data);
          return;
        }

        if (data.type === 'UPDATE_ERROR') {
          reject(new Error(data.error || 'Update download failed'));
        }
      };

      sw.postMessage({
        type: 'CACHE_URLS',
        urls: []
      }, [channel.port2]);
    });

    const result = await downloadPromise;

    updateProgressUI('installing', 'Finalizing update', {
      downloadedFiles: result.downloadedFiles || 0,
      totalFiles: result.totalFiles || 0,
      downloadedBytes: result.downloadedBytes || 0
    });

    console.log('[Cache Update] Sending SKIP_WAITING');
    sw.postMessage({ type: 'SKIP_WAITING' });

    await wait(500);

    if (registration.active) {
      registration.active.postMessage({ type: 'CLAIM_CLIENTS' });
    }

    let updated = false;

    const listener = () => {
      if (!userTriggeredUpdate) return;
      updated = true;
      navigator.serviceWorker.removeEventListener('controllerchange', listener);
    };

    navigator.serviceWorker.addEventListener('controllerchange', listener);

    await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(), 3000);
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

    updateProgressUI('complete', 'Update installed successfully', {
      downloadedFiles: result.downloadedFiles || 0,
      totalFiles: result.totalFiles || 0,
      downloadedBytes: result.downloadedBytes || 0
    });

    console.log('[Cache Update] Update complete');

    setTimeout(() => {
      window.location.reload();
    }, 1200);

  } catch (err) {
    console.error('[Cache Update] Install failed:', err);

    updateProgressUI('error', err.message || 'The update could not be completed.');
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
 * Perform a total application reset & service worker self-destruct
 */
window.performTotalSelfDestruct = async () => {
  if (!('serviceWorker' in navigator)) {
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sw = registration?.active || registration?.waiting || registration?.installing;

    if (!sw) {
      localStorage.clear();
      sessionStorage.clear();
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      window.location.reload();
      return;
    }

    const channel = new MessageChannel();

    channel.port1.onmessage = (event) => {
      if (event.data?.status === 'SUCCESS') {
        localStorage.clear();
        sessionStorage.clear();
        console.log('[Cache Update] Total cleanup finished. Reloading...');
        window.location.reload(true);
      }
    };

    sw.postMessage(
      { type: 'UNREGISTER_AND_CLEAR_ALL' },
      [channel.port2]
    );

    setTimeout(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    }, 3000);

  } catch (err) {
    console.error('[Cache Update] Self-destruct failed:', err);
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  }
};

/**
 * Notification
 */
function showNotification(title, message, type = 'info') {
  if (!shouldShowNotifications()) return;

  let container = document.getElementById('notification-container');

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