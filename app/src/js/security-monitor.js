(function () {
    'use strict';

    const EVENT_KEY = 'security_monitor_events';
    const RESPONSE_KEY = 'security_monitor_response';
    const MAX_EVENTS = 50;
    const COOLDOWN_MS = 5000;
    const consoleThreshold = 160;
    const keyboardThreshold = 150; // slightly under consoleThreshold; viewport shrink below this is treated as UI chrome (URL bar collapse etc.), not keyboard
    const KEYBOARD_SETTLE_MS = 250; // Android keyboard slide animation is ~200-300ms; wait it out before evaluating
    const suspiciousKeys = ['notes_master_key'];

    let enabled = localStorage.getItem('security_monitor_disabled') !== 'true';
    let consoleDetected = false;
    let lastEventAt = {};
    let rotationInProgress = false;
    let rotationTimer = null;
    let keyboardSettleTimer = null;

    function getOrientationState() {
        const orientation = screen.orientation;
        return {
            angle: orientation?.angle ?? null,
            type: orientation?.type ?? null,
            media: window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape'
        };
    }

    function getViewportHeight() {
        return window.visualViewport ? window.visualViewport.height : window.innerHeight;
    }

    let lastOrientation = getOrientationState();
    // Tallest viewport height seen since the last orientation settle. Any large shrink
    // from this peak means something is covering part of the screen — almost always the
    // on-screen keyboard on Android, since there's no local devtools panel to dock on
    // a touch-only device. This is intentionally independent of document.activeElement,
    // because focus can briefly move to <body> while tabbing between fields with the
    // keyboard still fully open.
    let maxViewportHeight = getViewportHeight();

    function scheduleOrientationCheck() {
        rotationInProgress = true;
        clearTimeout(rotationTimer);
        rotationTimer = setTimeout(() => {
            lastOrientation = getOrientationState();
            maxViewportHeight = getViewportHeight(); // width/height swap on rotate, so the old peak is meaningless
            rotationInProgress = false;
            checkConsole();
        }, 700);
    }

    function scheduleKeyboardCheck() {
        clearTimeout(keyboardSettleTimer);
        keyboardSettleTimer = setTimeout(() => {
            const height = getViewportHeight();
            if (height > maxViewportHeight) maxViewportHeight = height;
            checkConsole();
        }, KEYBOARD_SETTLE_MS);
    }

    function readEvents() {
        try {
            const events = JSON.parse(localStorage.getItem(EVENT_KEY) || '[]');
            return Array.isArray(events) ? events : [];
        } catch (_) {
            return [];
        }
    }

    function recordEvent(title, detail, severity) {
        const now = Date.now();
        if (lastEventAt[title] && now - lastEventAt[title] < COOLDOWN_MS) return;
        lastEventAt[title] = now;

        const events = readEvents();
        events.unshift({ title, detail, severity, timestamp: new Date(now).toISOString() });
        try {
            localStorage.setItem(EVENT_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
        } catch (_) {
            // Monitoring must not interrupt the application if storage is unavailable.
        }
        window.dispatchEvent(new CustomEvent('securitymonitor:event', { detail: events[0] }));
    }

    function showStopMessage() {
        console.log('%cSTOP', 'color:#ff4d4f;font-size:42px;font-weight:bold;text-shadow:1px 1px 0 #000');
        console.log('%cThis is a browser feature meant for developers.\nIf someone told you to copy/paste something here to "unlock a feature", "get free stuff", or "fix your account" - it is a scam that gives them control of your account. Do not paste anything you don\'t fully understand.', 'color:#e6e6e6;font-size:15px;line-height:1.5');
    }

    function isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    function isKeyboardVisible() {
        if (!isTouchDevice()) return false;
        const height = getViewportHeight();
        return maxViewportHeight - height > keyboardThreshold;
    }

    function checkConsole() {
        if (!enabled) return;
        if (rotationInProgress) return;
        if (isKeyboardVisible()) {
            consoleDetected = false;
            return;
        }

        const orientation = getOrientationState();
        const orientationChanged = orientation.angle !== lastOrientation.angle ||
            orientation.type !== lastOrientation.type ||
            orientation.media !== lastOrientation.media;
        if (orientationChanged) {
            lastOrientation = orientation;
            scheduleOrientationCheck();
            return;
        }

        const widthGap = window.outerWidth - window.innerWidth;
        const heightGap = window.outerHeight - window.innerHeight;
        const detected = widthGap > consoleThreshold || heightGap > consoleThreshold;
        if (detected && !consoleDetected) {
            consoleDetected = true;
            showStopMessage();
            notify('Developer console detected', 'If you opened this yourself, ignore this. If someone asked you to open this and paste code in, stop and log out.', 'warning');
        }
        if (!detected) consoleDetected = false;
    }

    function notify(title, detail, severity) {
        recordEvent(title, detail, severity);
        const response = getResponseMode();

        if (response === 'logout') {
            scheduleAutoLogout();
            return;
        }

        if (typeof window.showNotification === 'function') {
            window.showNotification(title, detail + ' Tap here to log out now.', severity === 'error' ? 'error' : 'info');
            const container = document.getElementById('notification-container');
            const item = container && container.lastElementChild;
            if (item) {
                item.style.cursor = 'pointer';
                item.addEventListener('click', logout, { once: true });
            }
        } else {
            console.warn(`[SecurityMonitor] ${title}: ${detail}`);
        }
    }

    function scheduleAutoLogout() {
        const title = 'Suspicious activity detected';
        const message = 'Proceeding to auto log out in';
        let remaining = 3;
        let notification = null;

        if (typeof window.showNotification === 'function') {
            window.showNotification(title, `${message} ${remaining} seconds.`, 'error');
            const container = document.getElementById('notification-container');
            notification = container && container.lastElementChild;
        }

        const updateCountdown = () => {
            remaining -= 1;
            if (remaining <= 0) return;
            const messageEl = notification?.querySelector('.notif-message') ||
                notification?.querySelector('div[style*="margin-left"]');
            if (messageEl) messageEl.textContent = `${message} ${remaining} second${remaining === 1 ? '' : 's'}.`;
        };

        const countdown = setInterval(updateCountdown, 1000);
        setTimeout(() => {
            clearInterval(countdown);
            logout();
        }, 3000);
    }

    function scanStorage() {
        if (!enabled) return;
        for (const key of suspiciousKeys) {
            if (localStorage.getItem(key) !== null) {
                notify('Unexpected local data found', `A value was written to local storage ("${key}") that this app version shouldn't create. This can happen if a browser extension or injected script wrote it. Logging out is the safest move.`, 'error');
                try { localStorage.removeItem(key); } catch (_) { /* Ignore storage cleanup failures. */ }
            }
        }
    }

    async function logout() {
        try {
            if (typeof window.performFullSignOut === 'function') await window.performFullSignOut();
            else if (typeof window.clearSessionMasterKey === 'function') await window.clearSessionMasterKey();
        } catch (error) {
            console.warn('[SecurityMonitor] Logout cleanup failed:', error);
        } finally {
            window.location.href = '../index.html';
        }
    }

    function getResponseMode() {
        return localStorage.getItem(RESPONSE_KEY) === 'logout' ? 'logout' : 'notify';
    }

    window.toggleSecurityMonitor = function (value) {
        enabled = typeof value === 'boolean' ? value : !enabled;
        localStorage.setItem('security_monitor_disabled', enabled ? 'false' : 'true');
        if (typeof window.showNotification === 'function') window.showNotification('Security Monitor', enabled ? 'Security monitor enabled.' : 'Security monitor disabled.', enabled ? 'success' : 'error');
        else console.log(`[SecurityMonitor] ${enabled ? 'Enabled' : 'Disabled'}`);
        window.dispatchEvent(new CustomEvent('securitymonitor:status'));
        return enabled;
    };

    window.isSecurityMonitorEnabled = () => enabled;
    window.getSecurityMonitorStatus = () => ({ enabled, response: getResponseMode(), events: readEvents() });
    window.getSecurityMonitorReport = () => JSON.stringify({ generatedAt: new Date().toISOString(), enabled, response: getResponseMode(), events: readEvents() }, null, 2);
    window.copySecurityMonitorReport = async () => {
        const report = window.getSecurityMonitorReport();
        try {
            await navigator.clipboard.writeText(report);
            if (typeof window.showNotification === 'function') window.showNotification('Security Monitor', 'Diagnostic report copied without secrets.', 'success');
            return true;
        } catch (_) {
            if (typeof window.showNotification === 'function') window.showNotification('Security Monitor', 'Could not copy the diagnostic report.', 'error');
            return false;
        }
    };
    window.clearSecurityMonitorHistory = () => { localStorage.removeItem(EVENT_KEY); window.dispatchEvent(new CustomEvent('securitymonitor:status')); };
    window.setSecurityMonitorResponse = mode => {
        const response = mode === 'logout' ? 'logout' : 'notify';
        localStorage.setItem(RESPONSE_KEY, response);
        window.dispatchEvent(new CustomEvent('securitymonitor:status'));
        return response;
    };

    function refreshSettingsStatus() {
        const status = document.getElementById('securityMonitorStatus');
        const response = document.getElementById('securityMonitorResponse');
        const count = document.getElementById('securityMonitorEventCount');
        const events = readEvents();
        if (status) status.textContent = enabled ? 'Active' : 'Off';
        if (response) response.textContent = getResponseMode() === 'logout' ? 'Auto logout' : 'Notify only';
        if (count) count.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
    }

    window.addEventListener('securitymonitor:status', refreshSettingsStatus);
    window.addEventListener('securitymonitor:event', refreshSettingsStatus);

    window.addEventListener('resize', () => {
        const orientation = getOrientationState();
        const orientationChanged = orientation.angle !== lastOrientation.angle ||
            orientation.type !== lastOrientation.type ||
            orientation.media !== lastOrientation.media;
        if (orientationChanged) scheduleOrientationCheck();
        else scheduleKeyboardCheck();
    });
    window.addEventListener('orientationchange', scheduleOrientationCheck);
    screen.orientation?.addEventListener('change', scheduleOrientationCheck);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleKeyboardCheck);
    document.addEventListener('focusin', scheduleKeyboardCheck);
    document.addEventListener('focusout', scheduleKeyboardCheck);
    window.addEventListener('storage', scanStorage);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { checkConsole(); scanStorage(); }
    });

    setTimeout(() => {
        checkConsole();
        scanStorage();
        refreshSettingsStatus();
        if (enabled && typeof window.showNotification === 'function') window.showNotification('Security Monitor', 'Security monitor initialized.', 'success');
    }, 1500);
})();