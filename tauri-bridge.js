/**
 * ============================================================================
 * NOTOZ – Tauri Native Android Bridge (Rust Native Runtime)
 * ============================================================================
 * Bridges the Notoz web application with Tauri v2's Rust native Android shell.
 * Provides hardware back navigation, safe-area adaptation, haptics,
 * external link routing, and full backwards compatibility with Notoz APIs.
 * ============================================================================
 */

(function () {
  'use strict';

  const isTauri = typeof window.__TAURI__ !== 'undefined' || typeof window.__TAURI_INTERNALS__ !== 'undefined';
  const isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform?.();

  // If neither native environment is present, exit
  if (!isTauri && !isCapacitor) {
    console.log('[TauriBridge] Standard web browser detected – native bridge in standby.');
    return;
  }

  console.log('[TauriBridge] Initialising Tauri Rust Native Android bridge…');

  // ── 1. HAPTIC FEEDBACK ──────────────────────────────────────────────────────
  const haptics = {
    impact: (style = 'LIGHT') => {
      try {
        if (window.__TAURI__?.haptics?.impact) {
          window.__TAURI__.haptics.impact(style);
        } else if (navigator.vibrate) {
          const duration = style === 'HEAVY' ? 30 : style === 'MEDIUM' ? 20 : 10;
          navigator.vibrate(duration);
        }
      } catch (_) {}
    },
    notification: (type = 'SUCCESS') => {
      try {
        if (window.__TAURI__?.haptics?.notification) {
          window.__TAURI__.haptics.notification(type);
        } else if (navigator.vibrate) {
          if (type === 'ERROR') {
            navigator.vibrate([30, 40, 30, 40, 50]);
          } else {
            navigator.vibrate([15, 30, 15]);
          }
        }
      } catch (_) {}
    },
    selectionChanged: () => {
      try {
        if (navigator.vibrate) {
          navigator.vibrate(6);
        }
      } catch (_) {}
    }
  };

  window.__NOTOZ_HAPTICS = haptics;

  // ── 2. SAFE AREA & SYSTEM BARS ──────────────────────────────────────────────
  function setupSafeArea() {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-top', 'env(safe-area-inset-top, 0px)');
    root.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom, 0px)');
    root.style.setProperty('--safe-area-left', 'env(safe-area-inset-left, 0px)');
    root.style.setProperty('--safe-area-right', 'env(safe-area-inset-right, 0px)');
    root.style.setProperty('--keyboard-height', '0px');

    root.classList.add('tauri-native');
    root.classList.add('capacitor-native'); // Apply edge-to-edge CSS rules
  }

  // ── 3. HARDWARE BACK BUTTON NAVIGATION ENGINE ─────────────────────────────
  function handleBackNavigation() {
    haptics.impact('LIGHT');

    // 1. App Dialog Overlay (app.js AppDialog)
    const dialogOverlay = document.getElementById('appDialogOverlay');
    if (dialogOverlay && dialogOverlay.classList.contains('show')) {
      const cancelBtn = document.getElementById('dialogCancelBtn');
      if (cancelBtn) {
        cancelBtn.click();
        console.log('[TauriBridge] Back → closed AppDialog.');
        return true;
      }
      dialogOverlay.classList.remove('show');
      return true;
    }

    // 1b. Image Source Action Sheet
    const imageSheet = document.getElementById('imageSourceActionSheet');
    if (imageSheet && imageSheet.classList.contains('show')) {
      if (window.app?.closeImageSourceSheet) {
        window.app.closeImageSourceSheet();
      } else {
        imageSheet.classList.remove('show');
      }
      console.log('[TauriBridge] Back → closed ImageSourceActionSheet.');
      return true;
    }

    // 2. Settings Portal Layer (settings.html / settings.js)
    const portalLayer = document.getElementById('portal-layer');
    if (portalLayer && portalLayer.classList.contains('active')) {
      if (typeof window.closePortal === 'function') {
        window.closePortal();
      } else {
        portalLayer.classList.remove('active');
      }
      console.log('[TauriBridge] Back → closed Settings Portal.');
      return true;
    }

    // 3. Primary: Delegate to Notoz native BackHandler
    let handler = null;
    try {
      if (typeof window.BackHandler !== 'undefined' && window.BackHandler.intercept) {
        handler = window.BackHandler;
      } else if (typeof BackHandler !== 'undefined' && BackHandler.intercept) {
        handler = BackHandler;
      }
    } catch (_) {}

    if (handler && typeof handler.intercept === 'function') {
      const intercepted = handler.intercept();
      if (intercepted) {
        console.log('[TauriBridge] Back → handled by BackHandler.');
        return true;
      }
    }

    // 4. Mobile View Stack (editor -> notes -> folders)
    let currentApp = null;
    try {
      if (typeof window.app !== 'undefined' && window.app.ui) {
        currentApp = window.app;
      } else if (typeof app !== 'undefined' && app.ui) {
        currentApp = app;
      }
    } catch (_) {}

    if (currentApp && currentApp.ui && currentApp.ui.isMobile) {
      if (currentApp.ui.mobileView === 'editor') {
        currentApp.goToMobileView('notes');
        console.log('[TauriBridge] Back → editor to notes.');
        return true;
      }
      if (currentApp.ui.mobileView === 'notes') {
        currentApp.goToMobileView('folders');
        console.log('[TauriBridge] Back → notes to folders.');
        return true;
      }
    }

    // 5. Settings Page -> Return to main app
    const path = window.location.pathname;
    if (path.includes('settings.html') || path.includes('/pages/')) {
      window.location.href = './index.html';
      console.log('[TauriBridge] Back → settings to app index.');
      return true;
    }

    // 6. Browser history if available
    if (window.history.length > 1) {
      window.history.back();
      return true;
    }

    // 7. Root reached: minimize or exit app gracefully
    console.log('[TauriBridge] Back → root reached.');
    if (window.__TAURI__?.app?.exit) {
      window.__TAURI__.app.exit(0);
    }
    return false;
  }

  function setupBackButton() {
    // 1. Tauri v2 Android Back Button Event
    if (window.__TAURI__?.event?.listen) {
      window.__TAURI__.event.listen('tauri://back-button', () => {
        handleBackNavigation();
      });
    }

    if (window.__TAURI__?.app?.onBackButtonPress) {
      window.__TAURI__.app.onBackButtonPress(() => {
        handleBackNavigation();
      });
    }

    // 2. Hardware Escape / Android Back Key Listener
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        handleBackNavigation();
      }
    });

    // 3. PopState fallback
    window.addEventListener('popstate', () => {
      // Allow internal state handlers to inspect
    });
  }

  // ── 4. EXTERNAL LINK ROUTING ──────────────────────────────────────────────
  function setupExternalLinks() {
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        return; // Handled by OS
      }

      if (href.startsWith('http://') || href.startsWith('https://')) {
        try {
          const url = new URL(href, window.location.href);
          const currentHost = window.location.hostname;

          // External URL
          if (url.hostname !== currentHost && url.hostname !== 'localhost') {
            e.preventDefault();
            if (window.__TAURI__?.opener?.openUrl) {
              window.__TAURI__.opener.openUrl(href);
            } else {
              window.open(href, '_blank');
            }
          }
        } catch (_) {}
      }
    }, true);
  }

  // ── 5. NETWORK STATUS ─────────────────────────────────────────────────────
  function setupNetworkMonitor() {
    window.addEventListener('online', () => {
      document.body.classList.remove('offline');
      document.body.classList.add('online');
    });

    window.addEventListener('offline', () => {
      document.body.classList.remove('online');
      document.body.classList.add('offline');
    });

    if (!navigator.onLine) {
      document.body.classList.add('offline');
    }
  }

  // ── 6. INITIALIZATION ─────────────────────────────────────────────────────
  function init() {
    setupSafeArea();
    setupBackButton();
    setupExternalLinks();
    setupNetworkMonitor();
    console.log('[TauriBridge] ✓ Tauri Rust Native bridge active.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Global APIs for compatibility with Notoz scripts
  window.__NOTOZ_NATIVE = true;
  window.__NOTOZ_TAURI = true;
  window.__NOTOZ_CAPACITOR = {
    isNative: true,
    platform: 'android',
    haptics: haptics,
    openInBrowser: (url) => {
      if (window.__TAURI__?.opener?.openUrl) {
        window.__TAURI__.opener.openUrl(url);
      } else {
        window.open(url, '_blank');
      }
    },
    getNetworkStatus: () => Promise.resolve({ connected: navigator.onLine }),
    minimizeApp: () => {
      if (window.__TAURI__?.app?.exit) {
        window.__TAURI__.app.exit(0);
      }
    },
    exitApp: () => {
      if (window.__TAURI__?.app?.exit) {
        window.__TAURI__.app.exit(0);
      }
    }
  };

})();
