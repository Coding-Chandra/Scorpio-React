/*
 * PWA Cache Update Manager
 * 
 * Priority: DATE first, then beta/stable numbering
 * - Detects when new cache is available
 * - Shows "Update available" button
 * - Handles user-triggered updates
 * - Build number read from version.json (fast, no SW timing dependency)
 */

let BUILD_NUMBER = 'Loading...';
let updateAvailable = false;
let ACTIVE_CACHE_NAME = null;
let LATEST_CACHE_NAME = null;

// ✅ On page load: extract build number and wait for SW to be ready
window.addEventListener('load', async () => {
    await getActiveCacheName();
    await extractBuildNumber();
    displayBuildNumber();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => {
            console.log('[Cache Update] SW ready - checking for updates...');
            setTimeout(() => {
                checkForUpdatesSimple();
            }, 1500);
        });
    }
});

/**
 * Get the currently active cache from localStorage
 */
async function getActiveCacheName() {
    try {
        ACTIVE_CACHE_NAME = localStorage.getItem('activeCacheName');

        if (!ACTIVE_CACHE_NAME) {
            const cacheNames = await caches.keys();
            const appCaches = cacheNames.filter(name => name.startsWith('notoj-app-cache-v'));

            if (appCaches.length > 0) {
                // Get latest cache to set as initial active
                LATEST_CACHE_NAME = await getLatestCacheName(appCaches);
                ACTIVE_CACHE_NAME = LATEST_CACHE_NAME;
                localStorage.setItem('activeCacheName', ACTIVE_CACHE_NAME);
                console.log('[Version] Set initial active cache:', ACTIVE_CACHE_NAME);
            }
        } else {
            console.log('[Version] Active cache from storage:', ACTIVE_CACHE_NAME);
        }
    } catch (error) {
        console.error('[Version] Error getting active cache:', error);
    }
}

/**
 * Extract the latest available cache name based on versioning scheme
 */
async function getLatestCacheName(appCaches) {
    if (!appCaches || appCaches.length === 0) return null;

    const parseVersion = (cacheName) => {
        // Matches v2.27.31 or similar
        const match = cacheName.match(/v(\d+)\.(\d+)\.(\d+)/);

        if (!match) {
            console.warn('[Cache Update] Unrecognized format:', cacheName);
            return { major: 0, minor: 0, patch: 0 };
        }

        return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            patch: parseInt(match[3], 10),
            raw: cacheName
        };
    };

    const sorted = [...appCaches].sort((a, b) => {
        const vA = parseVersion(a);
        const vB = parseVersion(b);

        // Sort by Major -> Minor -> Patch
        if (vA.major !== vB.major) return vB.major - vA.major;
        if (vA.minor !== vB.minor) return vB.minor - vA.minor;
        return vB.patch - vA.patch;
    });

    const latest = sorted[0];
    console.log('[Version] Latest cache detected:', latest);
    return latest;
}

/**
 * Extract build number from version.json
 * Fast, reliable — no SW or cache timing dependency
 * Falls back to cache name parsing if version.json is unavailable
 */
async function extractBuildNumber() {
    try {
        const res = await fetch('../version.json?t=' + Date.now()); // cache-bust

        if (!res.ok) throw new Error(`version.json fetch failed: ${res.status}`);

        const data = await res.json();
        BUILD_NUMBER = data.version || data.build || 'Unknown';
        console.log('[Version] Build number from version.json:', BUILD_NUMBER);

    } catch (error) {
        console.error('[Version] Failed to read version.json, falling back to cache name:', error);

        // Fallback: parse version from cache name
        try {
            const cacheNames = await caches.keys();
            const appCaches = cacheNames.filter(n => n.startsWith('notoj-app-cache-v'));

            LATEST_CACHE_NAME = await getLatestCacheName(appCaches);
            const match = LATEST_CACHE_NAME?.match(/notoj-app-cache-v(.+)/);
            BUILD_NUMBER = match?.[1] || 'Unknown';
            console.log('[Version] Build number from cache fallback:', BUILD_NUMBER);
        } catch (e) {
            console.error('[Version] Cache fallback also failed:', e);
            BUILD_NUMBER = 'Unknown';
        }
    }
}

/**
 * Display build number on the page
 */
function displayBuildNumber() {
    const buildElement = document.getElementById('buildNumberDisplay');
    if (buildElement) {
        buildElement.textContent = `Build: ${BUILD_NUMBER}`;
    }
}

/**
 * Main update detection logic
 * Checks if latest cache !== active cache
 * Cleans up middle caches if 3+ exist
 */
/* async function checkForUpdatesSimple() {
  try {
    const cacheNames = await caches.keys();
    const appCaches = cacheNames.filter(name => name.startsWith('notoj-app-cache-v'));
    
    console.log('[Cache Update] Found app caches:', appCaches.length, '→', appCaches.map(c => c.split('-').pop()));
    console.log('[Cache Update] Active cache:', ACTIVE_CACHE_NAME?.split('-').pop());
    
    // Get the latest cache
    LATEST_CACHE_NAME = await getLatestCacheName(appCaches);
    console.log('[Cache Update] Latest cache:', LATEST_CACHE_NAME?.split('-').pop());

    // Cleanup middle caches if 3+ exist
    if (appCaches.length > 2) {
      console.log('[Cache Update] Cleaning up middle caches (have 3+)...');
      
      const cachesToKeep = new Set();
      if (ACTIVE_CACHE_NAME) cachesToKeep.add(ACTIVE_CACHE_NAME);
      if (LATEST_CACHE_NAME) cachesToKeep.add(LATEST_CACHE_NAME);
      
      const cachesToDelete = appCaches.filter(name => !cachesToKeep.has(name));
      
      await Promise.all(
        cachesToDelete.map(name => {
          console.log('[Cache Update] Deleting middle cache:', name.split('-').pop());
          return caches.delete(name);
        })
      );
    }

    // Check for update: if latest !== active
    if (LATEST_CACHE_NAME && LATEST_CACHE_NAME !== ACTIVE_CACHE_NAME) {
      console.log('[Cache Update] ✅ UPDATE DETECTED! Latest is different from active');
      updateAvailable = true;
      updateButtonUI(true);
    } else {
      console.log('[Cache Update] ✅ Up to date (latest = active)');
      updateAvailable = false;
      updateButtonUI(false);
    }
  } catch (error) {
    console.error('[Cache Update] Error checking caches:', error);
  }
}

/**
 * Update UI button to show current status
 */

/* function updateButtonUI(hasUpdate = false) {
  console.log('[Cache Update] updateButtonUI:', hasUpdate ? '🔴 UPDATE AVAILABLE' : '✅ Up to date');
  const updateCacheText = document.getElementById('updateCacheText');

  if (updateCacheText) {
    updateCacheText.textContent = hasUpdate ? 'Update available' : 'Check for updates';
    
    // ✅ Highlight with accent color when update is available
    if (hasUpdate) {
      updateCacheText.style.color = 'var(--accent)';
      updateCacheText.style.fontWeight = '600';
    } else {
      updateCacheText.style.color = '';
      updateCacheText.style.fontWeight = '';
    }
  }
}

/**
 * Show update modal - called when user clicks button
 */
/* window.showUpdateCacheModal = () => {
  console.log('[Cache Update] showUpdateCacheModal - updateAvailable:', updateAvailable);
  
  if (typeof window.openModal !== 'function') {
    alert('Update feature not ready. Please refresh the page.');
    return;
  }

  if (updateAvailable) {
    window.openModal(
      'App Update Available',
      'A new version of the app is ready. Update now to get the latest features and improvements.',
      'Update Now',
      'var(--accent)',
      async () => {
        await performUpdate();
      }
    );
  } else {
    window.openModal(
      'Check for Updates',
      'Checking for new app versions...',
      'Check Now',
      'var(--accent)',
      async () => {
        await manualCheckForUpdates();
      }
    );
  }
};

/**
 * Manual check for updates
 */
/*async function manualCheckForUpdates() {
  try {
    console.log('[Cache Update] Manual check started');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Checking...';

    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers not supported');
    }

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      throw new Error('No active service worker found');
    }

    console.log('[Cache Update] Calling registration.update()...');
    await registration.update();

    // Wait for pre-cache to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Re-fetch latest cache
    const cacheNames = await caches.keys();
    const appCaches = cacheNames.filter(name => name.startsWith('notoj-app-cache-v'));
    LATEST_CACHE_NAME = await getLatestCacheName(appCaches);
    
    console.log('[Cache Update] After update check, caches:', appCaches.length);
    console.log('[Cache Update] Latest:', LATEST_CACHE_NAME?.split('-').pop(), 'Active:', ACTIVE_CACHE_NAME?.split('-').pop());

    if (LATEST_CACHE_NAME && LATEST_CACHE_NAME !== ACTIVE_CACHE_NAME) {
      console.log('[Cache Update] ✅ UPDATE FOUND!');
      updateAvailable = true;
      
      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Update Now';
      confirmBtn.onclick = async () => {
        await performUpdate();
      };
      document.getElementById('modal-title').innerText = 'Update Ready!';
      document.getElementById('modal-message').innerText =
        'A new version is available. Tap "Update Now" to install it.';
    } else {
      console.log('[Cache Update] No update available');
      window.closeCustomModal();
      showNotification('Up to Date', "You're running the latest version", 'success');
    }
  } catch (error) {
    console.error('[Cache Update] Manual check failed:', error);
    window.closeCustomModal();
    showNotification('Update Check Failed', error.message, 'error');
  }
}

/**
 * Perform the actual update
 */
/*async function performUpdate() {
  try {
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');

    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Installing...';

    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers not supported');
    }

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      throw new Error('No service worker found');
    }

    const sw = registration.waiting || registration.active;
    
    if (!sw) {
      throw new Error('No service worker available');
    }

    console.log('[Cache Update] Sending SKIP_WAITING to SW');
    sw.postMessage({ type: 'SKIP_WAITING' });

    await new Promise(resolve => setTimeout(resolve, 500));

    if (registration.active) {
      console.log('[Cache Update] Sending CLAIM_CLIENTS to SW');
      registration.active.postMessage({ type: 'CLAIM_CLIENTS' });
    }

    // Progress animation
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 25;
      if (progress > 90) progress = 90;
      confirmBtn.innerText = `Installing... ${Math.floor(progress)}%`;
    }, 200);

    // Wait for controller change
    let hasUpdated = false;
    const listener = () => {
      hasUpdated = true;
      clearInterval(progressInterval);
      navigator.serviceWorker.removeEventListener('controllerchange', listener);
    };

    navigator.serviceWorker.addEventListener('controllerchange', listener);

    await new Promise(resolve => {
      setTimeout(() => {
        if (!hasUpdated) {
          clearInterval(progressInterval);
          navigator.serviceWorker.removeEventListener('controllerchange', listener);
          console.log('[Cache Update] Proceeding with update');
          resolve();
        }
      }, 3000);

      const checkInterval = setInterval(() => {
        if (hasUpdated) {
          clearInterval(checkInterval);
          clearInterval(progressInterval);
          resolve();
        }
      }, 100);
    });

    // Success!
    confirmBtn.innerText = '✓ Update Complete!';
    confirmBtn.style.background = 'var(--accent)';

    modalTitle.innerText = '🎉 App Updated!';
    modalMessage.innerText = 'The latest version is now active. Reloading...';
    modalMessage.style.color = 'var(--accent)';

    createUpdateAnimation();

    // Update active cache in storage
    console.log('[Cache Update] Updating active cache to:', LATEST_CACHE_NAME?.split('-').pop());
    if (LATEST_CACHE_NAME) {
      localStorage.setItem('activeCacheName', LATEST_CACHE_NAME);
      ACTIVE_CACHE_NAME = LATEST_CACHE_NAME;
    }

    // Clean up old caches
    const cacheNames = await caches.keys();
    const appCaches = cacheNames.filter(name => name.startsWith('notoj-app-cache-v'));
    
    console.log('[Cache Update] Cleaning up old caches...');
    
    await Promise.all(
      appCaches
        .filter(name => name !== ACTIVE_CACHE_NAME)
        .map(name => {
          console.log('[Cache Update] Deleting old cache:', name.split('-').pop());
          return caches.delete(name);
        })
    );

    console.log('[Cache Update] Update complete!');

    setTimeout(() => {
      window.location.reload();
    }, 1500);

    updateAvailable = false;
    updateButtonUI(false);
  } catch (error) {
    console.error('[Cache Update] Update failed:', error);
    window.closeCustomModal();
    showNotification('Update Failed', error.message, 'error');
  }
}

/**
 * Create confetti animation on update
 */
/*function createUpdateAnimation() {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none; z-index: 9998;
  `;

  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    const size = Math.random() * 10 + 5;
    const left = Math.random() * 100;
    const delay = Math.random() * 0.2;

    particle.style.cssText = `
      position: absolute; left: ${left}%; bottom: 0;
      width: ${size}px; height: ${size}px;
      background: var(--accent); border-radius: 50%;
      opacity: 0.6; animation: float 2s ease-out ${delay}s forwards;
    `;

    container.appendChild(particle);
  }

  const style = document.createElement('style');
  style.textContent = `
    @keyframes float {
      0% { transform: translateY(0) scale(1); opacity: 0.8; }
      100% { transform: translateY(-100vh) scale(0); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(container);

  setTimeout(() => container.remove(), 2500);
}

/**
 * Show notification toast
 */
/*function showNotification(title, message, type = 'info') {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.style.cssText = `
      position: fixed; top: 20px; left: 20px; right: 20px;
      z-index: 10000; pointer-events: none; display: flex;
      flex-direction: column; gap: 12px;
    `;
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  let bgColor = 'var(--bg-card)';
  let textColor = 'var(--text-main)';

  if (type === 'success') {
    bgColor = 'var(--accent)';
    textColor = 'white';
  } else if (type === 'error') {
    bgColor = 'var(--accent1)';
    textColor = 'white';
  }

  notification.style.cssText = `
    padding: 16px 20px; border-radius: 12px; background: ${bgColor};
    color: ${textColor}; font-size: 14px; z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideDown 0.3s ease-out;
    pointer-events: auto; cursor: pointer;
  `;

  notification.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 4px;">
      ${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'} ${title}
    </div>
    <div style="opacity: 0.9; font-size: 13px;">${message}</div>
  `;

  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      @keyframes slideDown {
        from { transform: translateY(-120%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes slideUp {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  container.appendChild(notification);

  const timeout = setTimeout(() => {
    notification.style.animation = 'slideUp 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 4000);

  notification.addEventListener('click', () => {
    clearTimeout(timeout);
    notification.remove();
  });
}

console.log('[Cache Update] Manager initialized');*/