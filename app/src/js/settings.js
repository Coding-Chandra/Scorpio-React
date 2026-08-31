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
const animate = (element, animationName, duration = 300, onComplete = null) => {
    if (!element) return;
    element.style.animation = `${animationName} ${duration}ms ease-out forwards`;
    
    const handleAnimationEnd = () => {
        element.removeEventListener('animationend', handleAnimationEnd);
        element.style.animation = '';
        if (onComplete) onComplete();
    };
    
    element.addEventListener('animationend', handleAnimationEnd);
};

// --- Core UI & Theme ---
const applyThemeUI = (theme) => {
    if (!theme) return;
    const displayTheme = theme === 'system' ? 'System' : theme.charAt(0).toUpperCase() + theme.slice(1);
    document.getElementById('currentThemeDisplay').textContent = displayTheme;
    const frame = document.getElementById('portal-frame');
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'INIT_THEME', theme }, '*');
};

// --- Portal Control ---
window.openPortal = (url) => {
    const frame = document.getElementById('portal-frame');
    const layer = document.getElementById('portal-layer');
    
    if (!frame || !layer) {
        console.error('[Portal] Missing portal elements:', { frame: !!frame, layer: !!layer });
        return;
    }
    
    // Clear previous state
    frame.style.opacity = '0';
    frame.style.display = 'block';
    
    // Set up load handler BEFORE changing src
    const handleLoad = () => {
        console.log('[Portal] Frame loaded:', url);
        frame.style.opacity = '1';
        frame.style.transition = 'opacity 0.4s ease-out';
        applyThemeUI(localStorage.getItem('notozApp_theme') || 'system');
    };
    
    const handleError = () => {
        console.error('[Portal] Frame failed to load:', url);
        frame.style.opacity = '1';
    };
    
    frame.onload = handleLoad;
    frame.onerror = handleError;
    
    // Now set src
    frame.src = url;
    
    // Show portal layer
    layer.classList.add('active');
    
    // Animate portal entry
    const nav = layer.querySelector('.portal-nav');
    if (nav) {
        animate(nav, 'drawerSlideIn', 300);
    }
};

window.closePortal = () => {
    const frame = document.getElementById('portal-frame');
    const layer = document.getElementById('portal-layer');
    
    if (!layer) return;
    
    const nav = layer.querySelector('.portal-nav');
    
    // Animate portal exit
    if (nav) {
        animate(nav, 'drawerSlideOut', 300, () => {
            layer.classList.remove('active');
            frame.style.opacity = '0';
            setTimeout(() => { 
                frame.src = "about:blank";
                frame.style.opacity = '0';
            }, 200);
        });
    } else {
        layer.classList.remove('active');
        frame.style.opacity = '0';
        setTimeout(() => { 
            frame.src = "about:blank";
            frame.style.opacity = '0';
        }, 400);
    }
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
        const { error } = await supabase.auth.signOut();
        
        if (error) {
            console.error('Logout failed:', error);
            alert('Logout failed. Check console for details.');
            return;
        }
        window.location.href = '../index.html';
    }, SettingsDialog.lastSourceEl);
};

// Triple Step Delete with animations
window.showDeleteModal = () => {
    openModal("Step 1 of 3", "Are you sure you want to delete your account?", "Continue", "var(--text-dim)", async () => {
        openModal("Step 2 of 3", "WARNING: All encrypted notes will be lost forever. Proceed?", "I Understand", "var(--accent1)", async () => {
            showPasswordGate();
        }, SettingsDialog.lastSourceEl);
    }, SettingsDialog.lastSourceEl);
};

const showPasswordGate = () => {
    // Update UI directly
    document.getElementById('modal-title').innerText = "Final Step";
    document.getElementById('modal-message').innerText = "Enter your password to confirm deletion.";
    inputContainer.innerHTML = `<input type="password" id="final-pass" placeholder="Password" style="width: 85%; padding: 12px; margin-bottom: 20px; border-radius: 10px; border: 1px solid var(--sep); background: rgba(128,128,128,0.1); color: var(--text-main); outline: none; animation: inputFocus 0.3s ease-out;">`;
    confirmBtn.innerText = "Delete Permanently";
    confirmBtn.style.background = "var(--accent1)";
    confirmBtn.disabled = false;

    // Focus password input
    setTimeout(() => {
        const passInput = document.getElementById('final-pass');
        if (passInput) passInput.focus();
    }, 100);

    confirmBtn.onclick = async () => {
        const pass = document.getElementById('final-pass').value;
        if(!pass) return alert("Password required");
        
        confirmBtn.disabled = true;
        confirmBtn.innerText = "Verifying...";
        const { error: authError } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: pass });

        if (authError) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Delete Permanently";
            alert("Incorrect password. Deletion cancelled.");
            closeCustomModal();
            return;
        }

        try {
            const { error } = await supabase.from('delete_requests').insert([{ id: currentUser.id }]);
            if (error) throw error;
            
            confirmBtn.innerText = "✓ Deleted!";
            confirmBtn.style.background = "var(--accent)";
            confirmBtn.disabled = true;
            
            // Success animation then cleanup
            setTimeout(async () => {
                await supabase.auth.signOut();
                localStorage.clear();
                window.location.href = './index.html';
            }, 1500);
        } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Delete Permanently";
            alert(err.message);
            closeCustomModal();
        }
    };
};

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

    const notification = document.createElement('div');
    let bgColor = 'var(--bg-card)', textColor = 'var(--text-main)';
    
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
        pointer-events: auto; cursor: pointer; transition: all 0.3s ease-out;
        animation: toastSlideIn 0.3s ease-out forwards;
    `;

    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
            ${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}
            <span>${title}</span>
        </div>
        <div style="opacity: 0.9; font-size: 13px; margin-left: 24px;">${message}</div>
    `;

    container.appendChild(notification);

    const timeout = setTimeout(() => {
        notification.style.animation = 'toastSlideOut 0.3s ease-out forwards';
        setTimeout(() => notification.remove(), 300);
    }, 4000);

    notification.addEventListener('click', () => {
        clearTimeout(timeout);
        notification.style.animation = 'toastSlideOut 0.3s ease-out forwards';
        setTimeout(() => notification.remove(), 300);
    });
}

async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return window.location.href = './index.html';
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
    
    applyThemeUI(localStorage.getItem('notozApp_theme') || 'light');
    applyWallpaperUI();
    updateSettingsNotificationUI();
}

load();

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

function applyTheme(mode) {
    const actualTheme = mode === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;

    document.documentElement.setAttribute("data-theme", actualTheme);
    localStorage.setItem("notozApp_theme", mode);

    // Keep portal pages in sync too
    const frame = document.getElementById("portal-frame");
    if (frame?.contentWindow) {
        frame.contentWindow.postMessage({ type: 'INIT_THEME', theme: mode }, '*');
    }
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
    const theme = localStorage.getItem("notozApp_theme") || "light";
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
    if (!event.data || !event.data.type) return;

    switch (event.data.type) {
        case "SET_UI_THEME": {
            applyUI(event.data.theme);
            const frame = document.getElementById("portal-frame");
            if (frame?.contentWindow) {
                frame.contentWindow.postMessage({ type: "INIT_THEME", theme: event.data.theme }, "*");
            }
            const uiLabels = { ios: "iOS", md3e: "Material You", nothing: "Nothing OS" };
            showNotification(
                "Appearance Updated",
                `${uiLabels[event.data.theme] || event.data.theme} theme applied.`,
                "success"
            );
            break;
        }

        case "SET_THEME": {
            applyTheme(event.data.theme);
            const frame2 = document.getElementById("portal-frame");
            if (frame2?.contentWindow) {
                frame2.contentWindow.postMessage({ type: "INIT_THEME", theme: event.data.theme }, "*");
            }
            showNotification(
                "Theme Updated",
                `Switched to ${event.data.theme} mode.`,
                "success"
            );
            break;
        }

        case "SET_MD3E_COLOR": {
            applyMD3EAccent(event.data.color);
            const frame3 = document.getElementById("portal-frame");
            if (frame3?.contentWindow) {
                frame3.contentWindow.postMessage({ type: "INIT_THEME", theme: localStorage.getItem("notozApp_theme") }, "*");
            }
            showNotification(
                "Accent Color Updated",
                `Color set to ${event.data.color}.`,
                "success"
            );
            break;
        }

        case "WALLPAPER_CHANGED": {
            applyWallpaperUI();
            showNotification(
                "Wallpaper Setting Saved",
                event.data.label === "Nothing OS"
                    ? "Nothing OS wallpaper selected."
                    : "iOS wallpaper selected.",
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