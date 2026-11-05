/**
 * ============================================================================
 * NOTOZ – Capacitor Native Bridge (Production Hardened for Android)
 * ============================================================================
 * Handles native Android lifecycle, hardware navigation, status bar,
 * keyboard adjustments, haptic feedback, external browser links, and safe areas.
 * ============================================================================
 */

(function () {
  'use strict';

  // Guard: only execute inside Capacitor native runtime
  const isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform();
  if (!isCapacitor) {
    console.log('[CapBridge] Web environment detected – native bridge idle.');
    return;
  }

  console.log('[CapBridge] Initialising Android native bridge…');

  // Plugins
  const { App }          = window.Capacitor.Plugins;
  const { StatusBar }    = window.Capacitor.Plugins;
  const { SplashScreen } = window.Capacitor.Plugins;
  const { Keyboard }     = window.Capacitor.Plugins;
  const { Network }      = window.Capacitor.Plugins;
  const { Browser }      = window.Capacitor.Plugins;
  const { Haptics }      = window.Capacitor.Plugins;

  // ── 1. HAPTIC FEEDBACK HELPER ─────────────────────────────────────────────
  const haptics = {
    impact: (style = 'LIGHT') => {
      try {
        if (Haptics && Haptics.impact) {
          Haptics.impact({ style });
        }
      } catch (_) {}
    },
    notification: (type = 'SUCCESS') => {
      try {
        if (Haptics && Haptics.notification) {
          Haptics.notification({ type });
        }
      } catch (_) {}
    },
    selectionChanged: () => {
      try {
        if (Haptics && Haptics.selectionChanged) {
          Haptics.selectionChanged();
        }
      } catch (_) {}
    }
  };
  window.__NOTOZ_HAPTICS = haptics;

  // ── 2. STATUS BAR & SAFE AREA ─────────────────────────────────────────────
  async function setupStatusBar() {
    try {
      if (StatusBar) {
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: 'DARK' });
        await StatusBar.setBackgroundColor({ color: '#00000000' });
        console.log('[CapBridge] StatusBar configured.');
      }
    } catch (e) {
      console.warn('[CapBridge] StatusBar error:', e);
    }
  }

  function setupSafeArea() {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-top', 'env(safe-area-inset-top, 0px)');
    root.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom, 0px)');
    root.style.setProperty('--safe-area-left', 'env(safe-area-inset-left, 0px)');
    root.style.setProperty('--safe-area-right', 'env(safe-area-inset-right, 0px)');
    root.style.setProperty('--keyboard-height', '0px');
    root.classList.add('capacitor-native');
  }

  // ── 3. SPLASH SCREEN ──────────────────────────────────────────────────────
  async function hideSplash() {
    try {
      if (SplashScreen) {
        await SplashScreen.hide({ fadeOutDuration: 350 });
        console.log('[CapBridge] Splash hidden.');
      }
    } catch (e) {
      console.warn('[CapBridge] Splash error:', e);
    }
  }

  // ── 4. KEYBOARD BEHAVIOR ──────────────────────────────────────────────────
  function setupKeyboard() {
    try {
      if (!Keyboard) return;

      Keyboard.addListener('keyboardWillShow', (info) => {
        document.documentElement.style.setProperty('--keyboard-height', info.keyboardHeight + 'px');
        document.body.classList.add('keyboard-visible');
      });

      Keyboard.addListener('keyboardWillHide', () => {
        document.documentElement.style.setProperty('--keyboard-height', '0px');
        document.body.classList.remove('keyboard-visible');
      });
    } catch (e) {
      console.warn('[CapBridge] Keyboard error:', e);
    }
  }

  // ── 5. HARDWARE BACK BUTTON (ANDROID SPECIFIC STABILITY) ───────────────────
  function setupBackButton() {
    if (!App) return;

    App.addListener('backButton', () => {
      haptics.impact('LIGHT');

      // 1. App Dialog Overlay (app.js AppDialog)
      const dialogOverlay = document.getElementById('appDialogOverlay');
      if (dialogOverlay && dialogOverlay.classList.contains('show')) {
        const cancelBtn = document.getElementById('dialogCancelBtn');
        if (cancelBtn) {
          cancelBtn.click();
          console.log('[CapBridge] Back → closed AppDialog.');
          return;
        }
        dialogOverlay.classList.remove('show');
        return;
      }

      // 1b. Image Source Action Sheet
      const imageSheet = document.getElementById('imageSourceActionSheet');
      if (imageSheet && imageSheet.classList.contains('show')) {
        if (window.app?.closeImageSourceSheet) {
          window.app.closeImageSourceSheet();
        } else {
          imageSheet.classList.remove('show');
        }
        console.log('[CapBridge] Back → closed ImageSourceActionSheet.');
        return;
      }

      // 2. Settings Portal Layer (settings.html / settings.js)
      const portalLayer = document.getElementById('portal-layer');
      if (portalLayer && portalLayer.classList.contains('active')) {
        if (typeof window.closePortal === 'function') {
          window.closePortal();
        } else {
          portalLayer.classList.remove('active');
        }
        console.log('[CapBridge] Back → closed Settings Portal.');
        return;
      }

      // 3. Primary: Delegate to Notoz's native BackHandler
      // This correctly handles dropdowns, toolbars, multi-select, and triggers mtrans container transitions
      // between editor -> notes -> folders, plus double-back to exit!
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
          console.log('[CapBridge] Back → handled by BackHandler.');
          return;
        }
      }

      // 4. Fallback for mobile view navigation stack
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
          console.log('[CapBridge] Back → editor to notes.');
          return;
        }
        if (currentApp.ui.mobileView === 'notes') {
          currentApp.goToMobileView('folders');
          console.log('[CapBridge] Back → notes to folders.');
          return;
        }
      }

      // 5. Settings Page -> Return to main app
      const path = window.location.pathname;
      if (path.includes('settings.html') || path.includes('/pages/')) {
        window.location.href = './index.html';
        console.log('[CapBridge] Back → settings to app index.');
        return;
      }

      // 6. Root level reached (folders view and double-back confirmed) -> Minimise instead of killing process
      console.log('[CapBridge] Back → minimise app.');
      App.minimizeApp();
    });
  }

  // ── 6. NETWORK MONITORING ─────────────────────────────────────────────────
  function setupNetworkMonitor() {
    try {
      if (!Network) return;

      Network.addListener('networkStatusChange', (status) => {
        document.body.classList.toggle('offline', !status.connected);
        document.body.classList.toggle('online', status.connected);

        window.dispatchEvent(new CustomEvent('capacitor-network-change', {
          detail: { connected: status.connected, connectionType: status.connectionType }
        }));
      });

      Network.getStatus().then((status) => {
        document.body.classList.toggle('offline', !status.connected);
        document.body.classList.toggle('online', status.connected);
      });
    } catch (e) {
      console.warn('[CapBridge] Network error:', e);
    }
  }

  // ── 7. EXTERNAL LINK INTERCEPTOR ──────────────────────────────────────────
  function setupExternalLinks() {
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        return; // Let system handle dialer / mail
      }

      if (href.startsWith('http://') || href.startsWith('https://')) {
        const url = new URL(href);
        const host = window.location.hostname;

        // If outside local app origin, open in in-app browser sheet
        if (url.hostname !== host && url.hostname !== 'localhost') {
          e.preventDefault();
          if (Browser) {
            Browser.open({ url: href, toolbarColor: '#000000' });
          } else {
            window.open(href, '_system');
          }
        }
      }
    }, true);
  }

  // ── 8. APP LIFECYCLE ──────────────────────────────────────────────────────
  function setupLifecycle() {
    if (!App) return;

    App.addListener('appStateChange', ({ isActive }) => {
      window.dispatchEvent(new CustomEvent('capacitor-app-state', {
        detail: { isActive }
      }));
    });

    App.addListener('pause', () => {
      document.dispatchEvent(new Event('pause'));
    });

    App.addListener('resume', () => {
      document.dispatchEvent(new Event('resume'));
    });
  }

  // ── INITIALIZATION ────────────────────────────────────────────────────────
  async function init() {
    setupSafeArea();
    setupBackButton();
    setupNetworkMonitor();
    setupExternalLinks();
    setupLifecycle();
    setupKeyboard();
    await setupStatusBar();

    // Dismiss splash once the WebView has rendered initial paint
    setTimeout(hideSplash, 300);
    console.log('[CapBridge] ✓ Bridge active and listeners registered.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Global APIs for app usage
  window.__NOTOZ_NATIVE = true;
  window.__NOTOZ_CAPACITOR = {
    isNative: true,
    platform: window.Capacitor.getPlatform(),
    haptics: haptics,
    openInBrowser: (url) => Browser ? Browser.open({ url, toolbarColor: '#000000' }) : window.open(url, '_system'),
    getNetworkStatus: () => Network ? Network.getStatus() : Promise.resolve({ connected: navigator.onLine }),
    minimizeApp: () => App ? App.minimizeApp() : undefined,
    exitApp: () => App ? App.exitApp() : undefined
  };

})();
