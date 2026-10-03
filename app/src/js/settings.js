const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev/';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';

const supabase = (() => {
    if (window.supabase) {
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return {
        auth: {
            getUser: async () => ({ data: { user: null } }),
            signOut: async () => ({ error: null })
        }
    };
})();

let currentUser = null;

// Animation helper
// Completion is guaranteed by a fallback timer: `animationend` never fires if the keyframes
// are missing, reduced-motion is on, or the element is hidden. It also bubbles up from
// child elements, so only the element's own animation counts.
const animate = (element, animationName, duration = 300, onComplete = null) => {
    if (!element) return;

    let done = false;
    let fallbackTimer = null;

    const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(fallbackTimer);
        element.removeEventListener('animationend', handleAnimationEnd);
        element.style.animation = '';
        if (onComplete) onComplete();
    };

    const handleAnimationEnd = (event) => {
        if (event.target === element) finish();
    };

    element.addEventListener('animationend', handleAnimationEnd);
    fallbackTimer = setTimeout(finish, duration + 120);
    element.style.animation = `${animationName} ${duration}ms ease-out forwards`;
};

// --- Core UI & Theme ---
// One default everywhere. This matches the first-paint script in settings.html
// (it used to be 'dark' there, 'light' in load()/restoreThemeState, and 'system' for the portal).
const DEFAULT_THEME_MODE = 'dark';
const getThemeMode = () => localStorage.getItem('notozApp_theme') || DEFAULT_THEME_MODE;

// Every iframe that can host a settings page: the mobile portal AND the desktop detail pane.
// Previously only #portal-frame was ever messaged or trusted, so on desktop (General,
// Appearance, Wallpaper & Colors) every message from the iframe was silently dropped.
const getSettingsFrames = () => ['portal-frame', 'desktop-settings-frame']
    .map((id) => document.getElementById(id))
    .filter((frame) => frame && frame.contentWindow);

const isSettingsFrameSource = (source) =>
    !!source && getSettingsFrames().some((frame) => frame.contentWindow === source);

function postToSettingsFrames(message) {
    getSettingsFrames().forEach((frame) => {
        try {
            frame.contentWindow.postMessage(message, window.location.origin);
        } catch (err) {
            // Frame is mid-navigation; it gets another sync when it finishes loading.
        }
    });
}

// `theme` is always the light/dark/system MODE (what INIT_THEME has always meant).
// `ui` and `seed` ride along so a page can pick up the full appearance in one message.
function syncThemeToFrames() {
    postToSettingsFrames({
        type: 'INIT_THEME',
        theme: getThemeMode(),
        ui: localStorage.getItem('ui-theme') || 'ios',
        seed: localStorage.getItem('md3e-seed') || '#6750A4'
    });
}
window.syncThemeToFrames = syncThemeToFrames;

const applyThemeUI = (theme) => {
    if (!theme) return;
    const displayTheme = theme === 'system' ? 'System' : theme.charAt(0).toUpperCase() + theme.slice(1);
    const display = document.getElementById('currentThemeDisplay');
    if (display) display.textContent = displayTheme;
    syncThemeToFrames();
};

// --- Portal Control ---
let portalCloseTimer = null;
let portalOpenId = 0;

window.openPortal = (url) => {
    const frame = document.getElementById('portal-frame');
    const layer = document.getElementById('portal-layer');

    if (!frame || !layer) {
        console.error('[Portal] Missing portal elements:', { frame: !!frame, layer: !!layer });
        return;
    }

    // closePortal() leaves timers pending (remove layer, then blank the frame).
    // If one fires after this open, it wipes the page that was just opened.
    clearTimeout(portalCloseTimer);
    portalCloseTimer = null;
    const openId = ++portalOpenId;

    frame.style.transition = 'none';
    frame.style.opacity = '0';
    frame.style.display = 'block';

    const reveal = () => {
        if (openId !== portalOpenId) return;
        frame.style.transition = 'opacity 0.4s ease-out';
        frame.style.opacity = '1';
    };

    // Set up load handler BEFORE changing src
    frame.onload = () => {
        if (openId !== portalOpenId) return;
        if ((frame.getAttribute('src') || 'about:blank') === 'about:blank') return;
        console.log('[Portal] Frame loaded:', url);
        reveal();
        applyThemeUI(getThemeMode());
        // Some pages only attach their message listener after async init, so send once more.
        setTimeout(() => { if (openId === portalOpenId) syncThemeToFrames(); }, 350);
    };

    frame.src = url;
    layer.classList.add('active');

    // Iframes don't reliably fire `error`. Never leave the frame invisible if load never fires.
    setTimeout(reveal, 4000);

    const nav = layer.querySelector('.portal-nav');
    if (nav) animate(nav, 'drawerSlideIn', 300);
};

window.closePortal = () => {
    const frame = document.getElementById('portal-frame');
    const layer = document.getElementById('portal-layer');

    if (!layer) return;

    portalOpenId++; // invalidate any pending reveal/sync from the last open
    const nav = layer.querySelector('.portal-nav');
    if (nav) animate(nav, 'drawerSlideOut', 300);

    // Timer-driven on purpose. This used to wait for `animationend`, which can fail to
    // fire and leave the portal stuck open.
    clearTimeout(portalCloseTimer);
    portalCloseTimer = setTimeout(() => {
        layer.classList.remove('active');
        if (frame) frame.style.opacity = '0';
        // Blank the page only after the layer's 0.4s slide-out has finished.
        portalCloseTimer = setTimeout(() => {
            portalCloseTimer = null;
            if (frame) frame.src = 'about:blank';
        }, 450);
    }, nav ? 300 : 0);
};

// --- Modal Control with Dialog Ripple Animation ---
const overlay = document.getElementById('custom-modal-overlay');
const confirmBtn = document.getElementById('modal-confirm-btn');
const inputContainer = document.getElementById('modal-input-container');

// Enhanced Dialog Controller (Similar to AppDialog in app.js)
const SettingsDialog = {
    overlay: overlay,
    get modalBox() {
        return this.overlay ? this.overlay.querySelector('.modal-box') : null;
    },
    lastSourceEl: null,
    activeAnimation: null,

    resolveSource(trigger) {
        const element = trigger && typeof trigger === 'object' && 'getBoundingClientRect' in trigger
            ? trigger
            : null;

        const sourceEl = element || this.lastSourceEl;
        if (sourceEl && typeof sourceEl.getBoundingClientRect === 'function') {
            const rect = sourceEl.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                width: rect.width,
                height: rect.height,
                element: sourceEl
            };
        }

        if (this.modalBox) {
            const rect = this.modalBox.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                width: rect.width,
                height: rect.height,
                element: null
            };
        }

        return {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            width: 0,
            height: 0,
            element: null
        };
    },

    setSource(trigger) {
        const source = this.resolveSource(trigger);
        if (trigger && typeof trigger.getBoundingClientRect === 'function') {
            this.lastSourceEl = trigger;
        }
        return source;
    },

    getTransformFromSource(source, rect) {
        if (!rect && this.modalBox) {
            rect = this.modalBox.getBoundingClientRect();
        }
        if (!rect) return { originX: 50, originY: 50, start: 'translate(0px, 0px) scale(0.08, 0.06)' };

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = source.x - centerX;
        const deltaY = source.y - centerY;
        const originX = ((source.x - rect.left) / Math.max(rect.width, 1)) * 100;
        const originY = ((source.y - rect.top) / Math.max(rect.height, 1)) * 100;

        return {
            originX: Math.max(0, Math.min(100, originX)),
            originY: Math.max(0, Math.min(100, originY)),
            start: `translate(${deltaX}px, ${deltaY}px) scale(0.08, 0.06)`,
            end: 'translate(0px, 0px) scale(1, 1)',
            mid1: `translate(${deltaX * 0.18}px, ${deltaY * 0.18}px) scale(0.45, 0.30)`,
            mid2: `translate(${deltaX * 0.05}px, ${deltaY * 0.05}px) scale(0.92, 0.96)`,
            mid3: `translate(${deltaX * 0.02}px, ${deltaY * 0.02}px) scale(1.02, 1.01)`
        };
    },

    cancelActiveAnimation() {
        if (!this.modalBox) return;
        const animations = this.modalBox.getAnimations ? this.modalBox.getAnimations() : [];
        animations.forEach((animation) => {
            try {
                animation.cancel();
            } catch (error) {
                // Ignore cancel errors from older browsers.
            }
        });
        this.activeAnimation = null;
    },

    playAnimation(keyframes, duration, easing) {
        if (!this.modalBox) return;

        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finalDuration = reducedMotion ? Math.min(duration, 120) : duration;
        const finalEasing = reducedMotion ? 'ease-out' : easing;

        this.cancelActiveAnimation();
        this.modalBox.style.willChange = 'transform';
        this.modalBox.style.transformOrigin = 'center center';

        const animation = this.modalBox.animate(keyframes, {
            duration: finalDuration,
            easing: finalEasing,
            fill: 'forwards'
        });

        this.activeAnimation = animation;

        animation.onfinish = () => {
            this.modalBox.style.willChange = 'auto';
            this.activeAnimation = null;
        };
        animation.oncancel = () => {
            this.modalBox.style.willChange = 'auto';
            this.activeAnimation = null;
        };
    },

    openWithAnimation(source) {
        if (!this.overlay || !this.modalBox) return;

        const sourceObj = this.setSource(source);
        const rect = this.modalBox.getBoundingClientRect();
        const motion = this.getTransformFromSource(sourceObj, rect);

        this.modalBox.style.transformOrigin = `${motion.originX}% ${motion.originY}%`;
        this.modalBox.style.transform = motion.start;

        this.overlay.classList.add('show');

        requestAnimationFrame(() => {
            const rectAfterShow = this.modalBox.getBoundingClientRect();
            const motionAfterShow = this.getTransformFromSource(sourceObj, rectAfterShow);
            this.modalBox.style.transformOrigin = `${motionAfterShow.originX}% ${motionAfterShow.originY}%`;
            
            this.playAnimation([
                { transform: motionAfterShow.start },
                { transform: motionAfterShow.mid1 },
                { transform: motionAfterShow.mid2 },
                { transform: motionAfterShow.mid3 },
                { transform: motionAfterShow.end }
            ], 620, 'cubic-bezier(.22, 1.12, .28, 1)');
        });
    },

    closeWithAnimation() {
        if (!this.overlay || !this.overlay.classList.contains('show') || !this.modalBox) return;

        const sourceObj = this.setSource(this.lastSourceEl);
        const rect = this.modalBox.getBoundingClientRect();
        const motion = this.getTransformFromSource(sourceObj, rect);

        this.modalBox.style.transformOrigin = `${motion.originX}% ${motion.originY}%`;
        this.modalBox.style.transform = motion.end;

        this.playAnimation([
            { transform: motion.end },
            { transform: motion.mid3 },
            { transform: motion.mid2 },
            { transform: motion.mid1 },
            { transform: `translate(${(sourceObj.x - (rect ? rect.left + rect.width / 2 : 0))}px, ${(sourceObj.y - (rect ? rect.top + rect.height / 2 : 0))}px) scale(0.08, 0.06)` }
        ], 520, 'cubic-bezier(.22, 1.12, .28, 1)');

        setTimeout(() => {
            this.overlay.classList.remove('show');
            this.overlay.style.display = 'none';
            if (this.modalBox) {
                this.modalBox.style.transform = '';
                this.modalBox.style.transformOrigin = 'center center';
            }
            inputContainer.innerHTML = '';
            confirmBtn.disabled = false;
            confirmBtn.innerText = 'Confirm';
            confirmBtn.style.background = '';
        }, 520);
    }
};

window.closeCustomModal = () => {
    SettingsDialog.closeWithAnimation();
};

window.openModal = (title, message, btnText, btnColor, actionFn, sourceEl) => {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    confirmBtn.innerText = btnText;
    confirmBtn.style.background = btnColor;
    confirmBtn.style.color = "white";
    confirmBtn.disabled = false;
    overlay.style.display = 'flex'; // Ensure display is set before animation
    
    // Use ripple animation from source element
    SettingsDialog.openWithAnimation(sourceEl || SettingsDialog.lastSourceEl);
    
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerText = "Processing...";
        await actionFn();
    };
};

// Track which button triggered the modal
document.addEventListener('click', (e) => {
    const button = e.target.closest('[onclick*="Modal"], .clickable, .settings-action-btn, button');
    if (button) {
        SettingsDialog.lastSourceEl = button;
    }
});

// --- Actions ---
window.showSignOutModal = () => {
    openModal("Sign Out?", "End your current session?", "Sign Out", "var(--accent)", async () => {
        await performFullSignOut();
        window.location.href = '../index.html';
    }, SettingsDialog.lastSourceEl);
};

// --- Local crypto helpers (mirrors profile.js) so we can offer a backup mid-deletion ---
function _bufFromB64Local(b64) {
    const bin = atob(b64 || '');
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function getLocalMasterKeyBytes() {
    const stored = localStorage.getItem('notes_master_key');
    return stored ? _bufFromB64Local(stored) : null;
}

async function decryptWithMasterKeyLocal(stored) {
    if (!stored) return '';
    if (!stored.startsWith('enc:')) return stored;
    const mk = getLocalMasterKeyBytes();
    if (!mk) return stored;
    const [, ivB64, ctB64] = stored.split(':');
    const iv = _bufFromB64Local(ivB64);
    const ct = _bufFromB64Local(ctB64);
    const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(decrypted);
}

// Downloads a JSON backup of all notes. Returns the note count. Throws on failure.
async function exportDataBeforeDeletion() {
    const { data: notes, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', currentUser.id);
    if (error) throw error;

    const decryptedNotes = [];
    for (const note of notes || []) {
        decryptedNotes.push({
            title: await decryptWithMasterKeyLocal(note.title),
            content: await decryptWithMasterKeyLocal(note.content),
            paper_style: note.paper_style || 'blank',
            folder_id: note.folder_id || null,
            pinned: note.pinned || false,
            created_at: note.created_at,
            updated_at: note.updated_at
        });
    }

    const exportData = {
        exportDate: new Date().toISOString(),
        userEmail: currentUser.email,
        totalNotes: decryptedNotes.length,
        notes: decryptedNotes
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `notes-backup-before-deletion-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return decryptedNotes.length;
}

// Five Step Delete with animations: confirm -> warning -> export -> password -> type-to-confirm
window.showDeleteModal = () => {
    openModal("Step 1 of 5", "Are you sure you want to delete your account?", "Continue", "var(--text-dim)", async () => {
        showDeleteStep2();
    }, SettingsDialog.lastSourceEl);
};

function showDeleteStep2() {
    document.getElementById('modal-title').innerText = "Step 2 of 5";
    document.getElementById('modal-message').innerText = "WARNING: All encrypted notes will be lost forever. Proceed?";
    inputContainer.innerHTML = '';
    confirmBtn.innerText = "I Understand";
    confirmBtn.style.background = "var(--accent1)";
    confirmBtn.disabled = false;
    confirmBtn.onclick = () => showDeleteStep3();
}

function showDeleteStep3() {
    document.getElementById('modal-title').innerText = "Step 3 of 5";
    document.getElementById('modal-message').innerText = "Want a backup first? Export your notes before your account is deleted.";
    inputContainer.innerHTML = `
        <p id="delete-export-status" style="font-size: 13px; color: var(--text-dim); margin: 0 0 14px 0; min-height: 16px;"></p>
        <div style="text-align:center;"><span id="skip-export-link" style="font-size:13px; color:var(--text-dim); text-decoration:underline; cursor:pointer;">Skip, I don't need a backup</span></div>
    `;
    confirmBtn.innerText = "Export Data";
    confirmBtn.style.background = "var(--accent)";
    confirmBtn.disabled = false;

    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerText = "Exporting...";
        const statusEl = document.getElementById('delete-export-status');

        try {
            const count = await exportDataBeforeDeletion();
            if (statusEl) {
                statusEl.textContent = `✓ Exported ${count} ${count === 1 ? 'note' : 'notes'}`;
                statusEl.style.color = 'var(--accent)';
            }
            showNotification('Backup saved', `Exported ${count} ${count === 1 ? 'note' : 'notes'} before deletion.`, 'success');
            confirmBtn.innerText = "Continue";
            confirmBtn.disabled = false;
            confirmBtn.onclick = () => showPasswordGate();
        } catch (err) {
            console.error('[Delete] Export failed:', err);
            if (statusEl) {
                statusEl.textContent = '✕ Export failed — you can still continue';
                statusEl.style.color = 'var(--accent1)';
            }
            showNotification('Export failed', err.message || 'Could not export notes.', 'error');
            confirmBtn.innerText = "Continue Anyway";
            confirmBtn.disabled = false;
            confirmBtn.onclick = () => showPasswordGate();
        }
    };

    setTimeout(() => {
        const skipLink = document.getElementById('skip-export-link');
        if (skipLink) skipLink.addEventListener('click', () => showPasswordGate());
    }, 0);
}

const showPasswordGate = () => {
    document.getElementById('modal-title').innerText = "Step 4 of 5";
    document.getElementById('modal-message').innerText = "Enter your password to confirm deletion.";
    inputContainer.innerHTML = `<input type="password" id="final-pass" placeholder="Password" style="width: 85%; padding: 12px; margin-bottom: 20px; border-radius: 10px; border: 1px solid var(--sep); background: rgba(128,128,128,0.1); color: var(--text-main); outline: none; animation: inputFocus 0.3s ease-out;">`;
    confirmBtn.innerText = "Verify";
    confirmBtn.style.background = "var(--accent1)";
    confirmBtn.disabled = false;

    // Focus password input
    setTimeout(() => {
        const passInput = document.getElementById('final-pass');
        if (passInput) passInput.focus();
    }, 100);

    confirmBtn.onclick = async () => {
        const pass = document.getElementById('final-pass').value;
        if (!pass) {
            showNotification('Password required', 'Enter your password to continue.', 'error');
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.innerText = "Verifying...";
        const { error: authError } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: pass });

        if (authError) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Verify";
            showNotification('Incorrect password', 'Deletion cancelled.', 'error');
            closeCustomModal();
            return;
        }

        showDeleteStep5();
    };
};

function showDeleteStep5() {
    document.getElementById('modal-title').innerText = "Step 5 of 5";
    document.getElementById('modal-message').innerText = 'This is permanent and cannot be undone. Type "DELETE" below to confirm.';
    inputContainer.innerHTML = `<input type="text" id="final-delete-confirm" placeholder="Type DELETE" style="width: 85%; padding: 12px; margin-bottom: 20px; border-radius: 10px; border: 1px solid var(--sep); background: rgba(128,128,128,0.1); color: var(--text-main); outline: none; animation: inputFocus 0.3s ease-out;">`;
    confirmBtn.innerText = "Delete Permanently";
    confirmBtn.style.background = "var(--accent1)";
    confirmBtn.disabled = false;

    setTimeout(() => {
        const input = document.getElementById('final-delete-confirm');
        if (input) input.focus();
    }, 100);

    confirmBtn.onclick = async () => {
        const typed = (document.getElementById('final-delete-confirm').value || '').trim().toUpperCase();
        if (typed !== 'DELETE') {
            showNotification('Confirmation required', 'Type DELETE exactly to proceed.', 'error');
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.innerText = "Deleting...";

        try {
            const { error } = await supabase.from('delete_requests').insert([{ id: currentUser.id }]);
            if (error) throw error;

            confirmBtn.innerText = "Deleted!";
            confirmBtn.style.background = "var(--accent)";
            confirmBtn.disabled = true;
            showNotification('Account deleted', 'Your account has been scheduled for deletion.', 'success');

            // Success animation then cleanup
            setTimeout(async () => {
                await performFullSignOut();
                window.location.href = './index.html';
            }, 1500);
        } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Delete Permanently";
            showNotification('Deletion failed', err.message || 'Something went wrong.', 'error');
            closeCustomModal();
        }
    };
}

function shouldShowNotifications() {
    return localStorage.getItem('app_notifications_disabled') !== 'true';
}

function showNotification(title, message, type = 'info') {
    if (!shouldShowNotifications()) return;
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

    const MAX_NOTIFICATIONS = 3;
    const existing = container.children;
    if (existing.length >= MAX_NOTIFICATIONS) {
        const oldest = existing[0];
        if (oldest._timeout) clearTimeout(oldest._timeout);
        oldest.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'notif'; 

    let bgColor = 'var(--transparent)';
    let textColor = 'var(--text-main)';

    if (type === 'success') {
        bgColor = 'var(--notification-bg)';
        textColor = 'var(--text-main)';
    } else if (type === 'error') {
        bgColor = 'var(--accent1)';
        textColor = 'var(--text-main)';
    }
    
    notification.style.cssText = `
    background: ${bgColor};
    color: ${textColor};
    `;

    notification.innerHTML = `
        <button class="notif-close" type="button" aria-label="Dismiss notification">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
            </svg>

        </button>
        <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
            ${type === 'success' ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2a4 4 0 0 0-4 4c0 2.38-1.19 4.39-2.3 6.09C4.65 13.7 3.5 15.28 3.5 17.5a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5c0-2.22-1.15-3.8-2.2-5.41C17.19 10.39 16 8.38 16 6a4 4 0 0 0-4-4zm-3 19a3 3 0 0 0 6 0z"/>
                </svg>` : 
            type === 'error' ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2a4 4 0 0 0-4 4c0 2.38-1.19 4.39-2.3 6.09C4.65 13.7 3.5 15.28 3.5 17.5a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5c0-2.22-1.15-3.8-2.2-5.41C17.19 10.39 16 8.38 16 6a4 4 0 0 0-4-4zm-3 19a3 3 0 0 0 6 0z"/>
                </svg>` 
            : 'ℹ'}
            <span></span>
        </div>
        <div style="opacity: 0.9; font-size: 13px; margin-left: 24px;"></div>
    `;
    notification.querySelector('div[style*="font-weight"] span').textContent = String(title ?? '');
    notification.querySelector('div[style*="opacity"]').textContent = String(message ?? '');

    container.appendChild(notification);

    AnimationUtils.toast(notification, 'in');

    // Shared dismiss helper function (used by timeout, tap, and the X button)
    const dismiss = () => {
        if (notification._timeout) clearTimeout(notification._timeout);
        // Trigger exit animation with library helper, then safely delete node
        AnimationUtils.toast(notification, 'out', () => notification.remove());
    };

    // Store timeout reference on the element so MAX_NOTIFICATIONS check can clear it
    notification._timeout = setTimeout(dismiss, 1600); // adjusted timeout to 1.6 seconds

    // Tap/click anywhere on the toast dismisses it (skipped if the tap ended a drag)
    notification.addEventListener('click', () => {
        if (notification.dataset.suppressClick === 'true') {
            delete notification.dataset.suppressClick;
            return;
        }
        dismiss();
    });

    // X button always dismisses with the default (top-to-bottom) animation
    const closeBtn = notification.querySelector('.notif-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });
        // Don't let a tap on the X get picked up as the start of a swipe
        closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // --- Swipe-to-dismiss (touch and mouse drag, via Pointer Events) ---
    const SWIPE_THRESHOLD = 80;       // px before a drag counts as a dismiss
    const SWIPE_VELOCITY_THRESHOLD = 0.5; // px/ms — lets a fast flick dismiss even under the distance threshold
    let drag = null;

    notification.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.notif-close')) return;
        drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startTime: Date.now(),
            currentX: 0,
            axis: null // becomes 'x' or 'y' once the gesture direction is clear
        };
        notification.setPointerCapture?.(e.pointerId);
    });

    notification.addEventListener('pointermove', (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const deltaX = e.clientX - drag.startX;
        const deltaY = e.clientY - drag.startY;

        if (drag.axis === null) {
            if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
            drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
            if (drag.axis === 'x') notification.classList.add('dragging');
        }

        if (drag.axis !== 'x') return; // vertical gesture — leave it to page scroll

        drag.currentX = deltaX;
        notification.style.transform = `translateX(${deltaX}px)`;
        notification.style.opacity = String(Math.max(1 - Math.abs(deltaX) / 250, 0.3));
    });

    const endDrag = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const { currentX, startTime, axis } = drag;
        const velocity = Math.abs(currentX) / Math.max(Date.now() - startTime, 1);
        drag = null;
        notification.classList.remove('dragging');

        if (axis !== 'x') return;
        if (Math.abs(currentX) > 6) notification.dataset.suppressClick = 'true';

        if (Math.abs(currentX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD) {
            // Committed swipe — hand off to the matching keyframe animation,
            // picking up smoothly from wherever the drag left the element.
            if (notification._timeout) clearTimeout(notification._timeout);
            notification.style.transform = '';
            notification.style.setProperty('--drag-x', `${currentX}px`);
            const swipeOut = currentX > 0 ? AnimationUtils.swipeOutRight : AnimationUtils.swipeOutLeft;
            swipeOut(notification, 250, () => notification.remove());
        } else {
            // Under the threshold — spring back to place
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        }
    };

    notification.addEventListener('pointerup', endDrag);
    notification.addEventListener('pointercancel', endDrag);
}

// Shared, complete sign-out: clears the IndexedDB session key + in-memory
// caches (same cleanup app.js's handleLogout does) before ending the
// Supabase session. Used by both the Sign Out button and account deletion.
async function performFullSignOut() {
    try {
        if (window.clearSessionMasterKey) {
            await window.clearSessionMasterKey();
        }
    } catch (err) {
        console.warn('Could not clear session master key:', err);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Logout failed:', error);
        showNotification('Logout failed', 'Check console for details.', 'error');
        throw error;
    }
}

async function load() {
    // Local-only UI first. None of this needs the network, so it must not be held up
    // (or skipped entirely) when the auth call below is slow or throws.
    applyThemeUI(getThemeMode());
    applyWallpaperUI();
    updateSettingsNotificationUI();

    let user = null;
    let authFailed = false;
    try {
        const { data } = await supabase.auth.getUser();
        user = data?.user || null;
    } catch (err) {
        authFailed = true;
        console.warn('[Settings] getUser failed:', err);
    }
    if (!user) {
        // Only bounce to the login page when we positively know there is no user.
        if (!authFailed) window.location.href = './index.html';
        return;
    }
    currentUser = user;

    const emailEl = document.getElementById('accEmail');
    const nameEl = document.getElementById('accountDisplayName');
    const avatarEl = document.getElementById('accountAvatar');

    animate(emailEl, 'textFadeIn', 300, () => {
        emailEl.textContent = user.email;
    });

    animate(nameEl, 'textFadeIn', 300, () => {
        nameEl.textContent = user.user_metadata?.display_name || user.email.split('@')[0];
    });

    // ✅ LOAD AVATAR WITH PREFERENCES FROM DATABASE
    if (avatarEl && window.AdvancedAvatarGenerator) {
        try {
            const displayName = user.user_metadata?.display_name || user.email.split('@')[0];
            const initials = window.AdvancedAvatarGenerator.getInitials(displayName);
            
            // Load avatar preferences from database
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('avatar_mode, avatar_emoji, avatar_gradient_index')
                .eq('id', user.id)
                .single();

            if (!error && profile) {
                const mode = profile.avatar_mode || 'initials';
                const emoji = profile.avatar_emoji;
                const gradientIndex = profile.avatar_gradient_index;

                // Get custom gradient if saved
                let customGradient = null;
                if (gradientIndex !== null && gradientIndex !== undefined) {
                    customGradient = window.AdvancedAvatarGenerator.colorPalettes[gradientIndex];
                }

                // Update avatar with full customization
                if (mode === 'emoji' && emoji) {
                    window.AdvancedAvatarGenerator.updateAvatarElement(
                        avatarEl, 
                        initials, 
                        user.id, 
                        emoji,
                        customGradient
                    );
                } else {
                    window.AdvancedAvatarGenerator.updateAvatarElement(
                        avatarEl, 
                        initials, 
                        user.id,
                        null,
                        customGradient
                    );
                }
            } else {
                // Fallback if no preferences found
                window.AdvancedAvatarGenerator.updateAvatarElement(avatarEl, initials, user.id);
            }
        } catch (err) {
            console.warn('Could not load avatar preferences:', err);
            // Fallback to basic avatar
            const displayName = user.user_metadata?.display_name || user.email.split('@')[0];
            const initials = window.AdvancedAvatarGenerator.getInitials(displayName);
            window.AdvancedAvatarGenerator.updateAvatarElement(avatarEl, initials, user.id);
        }
    }
    
}

load().catch((err) => console.error('[Settings] load failed:', err));

/* =====================================================
   LIVE THEME + UI + MD3E ACCENT SYNC (WITH PORTAL) 
   (Added in 9.5 Utilities, but applies globally across the app and portal for seamless theme syncing)
===================================================== */

function applyUI(ui) {
    const body = document.body;
    body.classList.remove("ui-ios", "ui-md3e", "ui-nothing");
    body.classList.add(`ui-${ui}`);
    document.documentElement.setAttribute("data-ui", ui);
    localStorage.setItem("ui-theme", ui);
}

function updateSettingsThemeColor(ui, theme) {
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) return;

    let color = theme === 'light' ? '#F2F2F7' : '#000000';
    if (ui === 'nothing') {
        color = theme === 'light' ? '#F3F3F3' : '#000000';
    } else if (ui === 'md3e') {
        const seed = (localStorage.getItem('md3e-seed') || '#6750A4').replace('#', '');
        const channels = [0, 2, 4].map((offset) => parseInt(seed.slice(offset, offset + 2), 16));
        const base = theme === 'dark' ? [28, 27, 31] : [255, 255, 255];
        const weight = theme === 'dark' ? 0.12 : 0.06;
        color = '#' + channels.map((channel, index) =>
            Math.round(base[index] * (1 - weight) + channel * weight).toString(16).padStart(2, '0')
        ).join('');
    }

    themeColor.setAttribute('content', color);
    document.documentElement.style.setProperty('--md-browser-bg', color);
}

function applyTheme(mode) {
    const actualTheme = mode === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;

    document.documentElement.setAttribute("data-theme", actualTheme);
    localStorage.setItem("notozApp_theme", mode);
    window.updateThemeColor?.(document.documentElement.getAttribute('data-ui'), actualTheme);
    updateSettingsThemeColor(document.documentElement.getAttribute('data-ui'), actualTheme);

    // Keep every settings iframe (mobile portal + desktop pane) in sync too
    syncThemeToFrames();
}

// --- Live system theme updates (when mode === system) ---
(function syncSystemTheme() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = () => {
        if (localStorage.getItem('notozApp_theme') !== 'system') return;
        applyTheme('system');
    };

    // Safari fallback uses addListener
    if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
    } else if (typeof mq.addListener === 'function') {
        mq.addListener(onChange);
    }
})();

function isNotificationsEnabled() {
    return localStorage.getItem('app_notifications_disabled') !== 'true';
}

window.toggleAppNotifications = function () {
    const enabled = !isNotificationsEnabled();
    localStorage.setItem('app_notifications_disabled', enabled ? 'false' : 'true');
    updateSettingsNotificationUI();
};

function applyMD3EAccent(hex) {
    if (!hex || hex.length !== 7) return;
    const v = hex.replace("#", "");
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    document.documentElement.style.setProperty("--md-seed", `${r},${g},${b}`);
    localStorage.setItem("md3e-seed", hex);
    updateSettingsThemeColor(
        document.documentElement.getAttribute('data-ui'),
        document.documentElement.getAttribute('data-theme')
    );
}

function applyWallpaperUI() {
    const ui = localStorage.getItem('ui-theme') || 'ios';

    if (ui === 'md3e') {
        const seed = localStorage.getItem('md3e-seed') || '#6750A4';
        const wallpaperDisplay = document.getElementById('currentWallpaperDisplay');
        if (wallpaperDisplay) {
            wallpaperDisplay.textContent = `Material You`;
        }
        return;
    }

    const wallpaperValue = localStorage.getItem('notozApp_wallpaper') || 'w1';
    let wallpaperLabel;
    if (wallpaperValue.startsWith('http://') || wallpaperValue.startsWith('https://')) {
        wallpaperLabel = 'Custom wallpaper';
    } else if (wallpaperValue.startsWith('n')) {
        wallpaperLabel = `Nothing OS (${wallpaperValue.slice(1)})`;
    } else {
        wallpaperLabel = `iOS (${wallpaperValue.slice(1)})`;
    }
    const wallpaperDisplay = document.getElementById('currentWallpaperDisplay');
    if (wallpaperDisplay) {
        wallpaperDisplay.textContent = wallpaperLabel;
    }
}

(function restoreThemeState() {
    const ui = localStorage.getItem("ui-theme") || "ios";
    const theme = getThemeMode();
    const accent = localStorage.getItem("md3e-seed");
    applyUI(ui);
    applyTheme(theme);
    if (accent) applyMD3EAccent(accent);
})();

function updateSettingsNotificationUI() {
    const enabled = isNotificationsEnabled();
    const statusEl = document.getElementById('notificationRowStatus');
    const thumb = document.getElementById('notificationRowThumb');
    const toggle = document.getElementById('notificationRowToggle');

    if (!statusEl || !thumb || !toggle) return;

    statusEl.textContent = enabled ? 'Enabled' : 'Disabled';
    // Theme-aware toggle background/thumb colors (use CSS variables)
    toggle.setAttribute('data-checked', enabled ? 'true' : 'false');
}

window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    // Accept messages from EITHER settings iframe (mobile portal or desktop pane).
    if (!isSettingsFrameSource(event.source)) return;
    if (!event.data || !event.data.type) return;

    switch (event.data.type) {
        case "SET_UI_THEME": {
            if (!['ios', 'md3e', 'nothing'].includes(event.data.theme)) break;
            applyUI(event.data.theme);
            updateSettingsThemeColor(event.data.theme, document.documentElement.getAttribute('data-theme'));
            applyWallpaperUI();
            // Was: INIT_THEME with the UI name ('md3e') in the `theme` slot, which expects light/dark/system.
            syncThemeToFrames();
            const uiLabels = { ios: "iOS", md3e: "Material You", nothing: "Nothing OS" };
            showNotification(
                "Appearance Updated",
                `${uiLabels[event.data.theme] || event.data.theme} theme applied.`,
                "success"
            );
            break;
        }

        case "SET_THEME": {
            if (!['light', 'dark', 'system'].includes(event.data.theme)) break;
            applyTheme(event.data.theme); // also syncs the iframes
            showNotification(
                "Theme Updated",
                `Switched to ${event.data.theme} mode.`,
                "success"
            );
            break;
        }

        case "SET_MD3E_COLOR": {
            // The inline handler in settings.html reads `seed || color`; accept both here too.
            let color = String(event.data.color || event.data.seed || '');
            if (color && !color.startsWith('#')) color = '#' + color;
            if (!/^#[0-9a-f]{6}$/i.test(color)) break;
            applyMD3EAccent(color);
            syncThemeToFrames();
            showNotification(
                "Accent Color Updated",
                `Color set to ${color}.`,
                "success"
            );
            break;
        }

        case "WALLPAPER_CHANGED": {
            applyWallpaperUI();
            const label = event.data.label;
            showNotification(
                "Wallpaper Setting Saved",
                label ? `${label} wallpaper selected.` : "Wallpaper selected.",
                "success"
            );
            break;
        }
    }
});

// ========================================
// EXPORT FUNCTIONS GLOBALLY FOR PWA SYSTEM ACCESS (LIKE PORTAL & SETTINGS)
// ========================================
window.openModal = openModal;
window.closeCustomModal = closeCustomModal;
window.showSignOutModal = showSignOutModal;
window.showDeleteModal = showDeleteModal;

// ========================================
// KEYBOARD DETECTION FOR PORTAL LAYER
// ========================================
(function () {
    let lastKeyboardHeight = 0;
    
    function checkKeyboard() {
        const keyboardHeight = Math.max(0, window.outerHeight - window.innerHeight);
        const portalLayer = document.getElementById('portal-layer');
        
        if (!portalLayer) return;
        
        // Only update if keyboard height actually changed
        if (keyboardHeight !== lastKeyboardHeight) {
            lastKeyboardHeight = keyboardHeight;
            
            if (keyboardHeight > 0) {
                // Keyboard is visible
                portalLayer.classList.add('keyboard-visible');
            } else {
                // Keyboard is hidden
                portalLayer.classList.remove('keyboard-visible');
            }
        }
    }
    
    // Check on resize events (keyboard show/hide triggers resize)
    window.addEventListener('resize', checkKeyboard);
    // Also check on focus/blur of input elements
    document.addEventListener('focusin', () => setTimeout(checkKeyboard, 50));
    document.addEventListener('focusout', () => setTimeout(checkKeyboard, 50));
    
    // Initial check
    checkKeyboard();
})();

/* ===== Locked Folder ===== */
LockedFolder.configure({ client: supabase });

async function refreshLF() {
  await LockedFolder.init();
  const c = LockedFolder.getConfig();
  const on = !!c?.enabled;
  const bioOk = await LockedFolder.biometricAvailable();
  document.querySelectorAll('[data-lf="status"]').forEach(e => e.textContent = on ? 'On' : 'Off');
  document.querySelectorAll('[data-lf="bio"]').forEach(e => e.textContent = c?.biometric ? 'On' : 'Off');
  document.querySelectorAll('[data-lf-when="on"]').forEach(e => {
    const needsBio = e.hasAttribute('data-lf-bio');
    e.style.display = on && (!needsBio || bioOk) ? '' : 'none';
  });
}

function lockedFolderNotificationsEnabled() {
    return localStorage.getItem('locked_folder_notifications_disabled') !== 'true';
}

function syncLockedFolderNotificationToggles() {
    const enabled = lockedFolderNotificationsEnabled();

    document.querySelectorAll('[data-locked-folder-notifications]').forEach(toggle => {
        toggle.dataset.checked = String(enabled);
        toggle.setAttribute('aria-checked', String(enabled));
    });
}

function toggleLockedFolderNotifications() {
    localStorage.setItem(
        'locked_folder_notifications_disabled',
        String(lockedFolderNotificationsEnabled())
    );
    syncLockedFolderNotificationToggles();
}

async function lfToggle() {
    if (LockedFolder.isEnabled()) {
        inputContainer.innerHTML = '';

        openModal(
            'Disable Locked Folder?',
            'Your current PIN will be required. Its notes will move to your last used folder or Unlocked Notes.',
            'Disable',
            'var(--accent1)',
            async () => {
                const disabled = await LockedFolder.ui.disable();

                if (disabled) {
                    closeCustomModal();
                    await refreshLF();
                    return;
                }

                confirmBtn.disabled = false;
                confirmBtn.innerText = 'Disable';
            },
            SettingsDialog.lastSourceEl
        );

        return;
    }

    const biometricAvailable = await LockedFolder.biometricAvailable();
    let pinLength = 4;
    let biometric = false;
    let setupStep = 'pin';

    function renderPinLengthStep() {
        inputContainer.innerHTML = `
            <div class="lf-setup-options">
                <fieldset class="lf-setup-pin-section">
                    <legend>PIN length</legend>
                    <div class="lf-setup-pin-options" role="radiogroup" aria-label="PIN length">
                        <button type="button" class="lf-setup-pin-option${pinLength === 4 ? ' selected' : ''}" data-create-pin-length="4" role="radio" aria-checked="${pinLength === 4}">
                            <strong>4</strong><span>digits</span>
                        </button>
                        <button type="button" class="lf-setup-pin-option${pinLength === 6 ? ' selected' : ''}" data-create-pin-length="6" role="radio" aria-checked="${pinLength === 6}">
                            <strong>6</strong><span>digits</span>
                        </button>
                    </div>
                </fieldset>
            </div>
        `;

        inputContainer.querySelectorAll('[data-create-pin-length]').forEach(button => {
            button.addEventListener('click', () => {
                pinLength = Number(button.dataset.createPinLength) === 6 ? 6 : 4;

                inputContainer.querySelectorAll('[data-create-pin-length]').forEach(option => {
                    const selected = Number(option.dataset.createPinLength) === pinLength;
                    option.classList.toggle('selected', selected);
                    option.setAttribute('aria-checked', String(selected));
                });
            });
        });
    }

    function renderBiometricsStep() {
        inputContainer.innerHTML = `
            <div class="lf-setup-options">
                <button type="button" class="lf-setup-back" aria-label="Back to PIN length">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
                    <span>PIN length</span>
                </button>
                <button type="button" class="lf-setup-biometrics" role="switch" aria-label="Enable biometrics" aria-checked="${biometric}" data-checked="${biometric}" ${biometricAvailable ? '' : 'disabled'}>
                    <span class="lf-setup-biometrics-copy">
                        <strong>Biometrics</strong>
                        <span>${biometricAvailable ? 'Use fingerprint or face recognition to unlock' : 'Not available on this device'}</span>
                    </span>
                    <span class="notifToggle" data-checked="${biometric}" aria-hidden="true"><span class="notifThumb"></span></span>
                </button>
            </div>
        `;

        inputContainer.querySelector('.lf-setup-back').addEventListener('click', () => {
            setupStep = 'pin';
            renderPinLengthStep();
            document.getElementById('modal-title').innerText = 'Create Locked Folder';
            document.getElementById('modal-message').innerText =
                'Step 1 of 2 · Choose a PIN length.';
            confirmBtn.innerText = 'Next';
        });

        const biometricToggle = inputContainer.querySelector('.lf-setup-biometrics');
        biometricToggle.addEventListener('click', () => {
            biometric = !biometric;
            biometricToggle.setAttribute('aria-checked', String(biometric));
            biometricToggle.dataset.checked = String(biometric);
            biometricToggle.querySelector('.notifToggle').dataset.checked = String(biometric);
        });
    }

    renderPinLengthStep();

    openModal(
        'Create Locked Folder',
        'Step 1 of 2 · Choose a PIN length.',
        'Next',
        'var(--accent)',
        async () => {
            if (setupStep === 'pin') {
                setupStep = 'biometrics';
                renderBiometricsStep();
                document.getElementById('modal-title').innerText = 'Biometrics';
                document.getElementById('modal-message').innerText =
                    'Step 2 of 2 · Biometrics are optional.';
                confirmBtn.disabled = false;
                confirmBtn.innerText = 'Create';
                return;
            }

            const enabled = await LockedFolder.ui.enable({
                length: pinLength,
                biometric
            });

            if (enabled) {
                closeCustomModal();
                await refreshLF();
                return;
            }

            confirmBtn.disabled = false;
            confirmBtn.innerText = 'Create';
        },
        SettingsDialog.lastSourceEl
    );
}
async function lfChangePin() {
    const config = LockedFolder.getConfig();
    const length = await window.LockedFolderUI?.choosePinLength?.({
        current: config?.pinLength === 6 ? 6 : 4
    });
    if (!length) return;
  await LockedFolder.ui.changePin({ length });
}
async function lfToggleBio() {
  await LockedFolder.ui.setBiometric(!LockedFolder.getConfig()?.biometric);
  refreshLF();
}

window.addEventListener('lockedfolder:changed', refreshLF);
document.addEventListener('DOMContentLoaded', refreshLF);
document.addEventListener('DOMContentLoaded', syncLockedFolderNotificationToggles, { once: true });