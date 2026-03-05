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
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('currentThemeDisplay').textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
    const frame = document.getElementById('portal-frame');
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'INIT_THEME', theme }, '*');
};

// --- Portal Control ---
window.openPortal = (url) => {
    const frame = document.getElementById('portal-frame');
    const layer = document.getElementById('portal-layer');
    frame.src = url;
    layer.classList.add('active');
    
    // Animate portal entry
    const nav = layer.querySelector('.portal-nav');
    if (nav) {
        animate(nav, 'drawerSlideIn', 300);
    }
    
    frame.onload = () => applyThemeUI(localStorage.getItem('notesApp_theme') || 'dark');
};

window.closePortal = () => {
    const layer = document.getElementById('portal-layer');
    const nav = layer.querySelector('.portal-nav');
    
    // Animate portal exit
    if (nav) {
        animate(nav, 'drawerSlideOut', 300, () => {
            layer.classList.remove('active');
            setTimeout(() => { document.getElementById('portal-frame').src = "about:blank"; }, 200);
        });
    } else {
        layer.classList.remove('active');
        setTimeout(() => { document.getElementById('portal-frame').src = "about:blank"; }, 400);
    }
};

// --- Modal Control ---
const overlay = document.getElementById('custom-modal-overlay');
const confirmBtn = document.getElementById('modal-confirm-btn');
const inputContainer = document.getElementById('modal-input-container');

window.closeCustomModal = () => {
    const modalBox = overlay.querySelector('.modal-box');
    if (modalBox) {
        animate(modalBox, 'modalScaleIn', 200, () => {
            overlay.style.display = 'none';
            inputContainer.innerHTML = '';
        }, true); // reverse animation
    } else {
        overlay.style.display = 'none';
        inputContainer.innerHTML = '';
    }
};

window.openModal = (title, message, btnText, btnColor, actionFn) => {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    confirmBtn.innerText = btnText;
    confirmBtn.style.background = btnColor;
    confirmBtn.style.color = "white";
    confirmBtn.disabled = false;
    overlay.style.display = 'flex';
    
    // Animate modal entrance
    const modalBox = overlay.querySelector('.modal-box');
    if (modalBox) {
        animate(modalBox, 'modalScaleIn', 300);
    }
    
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerText = "Processing...";
        await actionFn();
    };
};

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
    });
};

// Triple Step Delete with animations
window.showDeleteModal = () => {
    openModal("Step 1 of 3", "Are you sure you want to delete your account?", "Continue", "var(--text-dim)", async () => {
        openModal("Step 2 of 3", "WARNING: All encrypted notes will be lost forever. Proceed?", "I Understand", "var(--accent1)", async () => {
            showPasswordGate();
        });
    });
};

const showPasswordGate = () => {
    document.getElementById('modal-title').innerText = "Final Step";
    document.getElementById('modal-message').innerText = "Enter your password to confirm deletion.";
    inputContainer.innerHTML = `<input type="password" id="final-pass" placeholder="Password" style="width: 85%; padding: 12px; margin-bottom: 20px; border-radius: 10px; border: 1px solid var(--sep); background: rgba(128,128,128,0.1); color: var(--text-main); outline: none; animation: inputFocus 0.3s ease-out;">`;
    confirmBtn.innerText = "Delete Permanently";
    confirmBtn.style.background = "var(--accent1)";
    confirmBtn.disabled = false;

    confirmBtn.onclick = async () => {
        const pass = document.getElementById('final-pass').value;
        if(!pass) return alert("Password required");
        
        confirmBtn.innerText = "Verifying...";
        const { error: authError } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: pass });

        if (authError) {
            alert("Incorrect password. Deletion cancelled.");
            closeCustomModal();
            return;
        }

        try {
            const { error } = await supabase.from('delete_requests').insert([{ id: currentUser.id }]);
            if (error) throw error;
            
            confirmBtn.innerText = "✓ Deleted!";
            confirmBtn.style.background = "var(--accent)";
            
            // Success animation
            const modalBox = document.querySelector('.modal-box');
            if (modalBox) {
                animate(modalBox, 'celebration', 400, () => {
                    setTimeout(async () => {
                        await supabase.auth.signOut();
                        localStorage.clear();
                        window.location.href = './index.html';
                    }, 500);
                });
            } else {
                setTimeout(async () => {
                    await supabase.auth.signOut();
                    localStorage.clear();
                    window.location.href = './index.html';
                }, 500);
            }
        } catch (err) {
            alert(err.message);
            closeCustomModal();
        }
    };
};

function showNotification(title, message, type = 'info') {
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
    
    applyThemeUI(localStorage.getItem('notesApp_theme') || 'dark');
}

load();

/* =====================================================
   LIVE THEME + UI + MD3E ACCENT SYNC
===================================================== */

function applyUI(ui) {
    const body = document.body;
    body.classList.remove("ui-ios", "ui-md3e", "ui-nothing");
    body.classList.add(`ui-${ui}`);
    document.documentElement.setAttribute("data-ui", ui);
    localStorage.setItem("ui-theme", ui);
}

function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("notesApp_theme", mode);
}

function applyMD3EAccent(hex) {
    if (!hex || hex.length !== 7) return;
    const v = hex.replace("#", "");
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    document.documentElement.style.setProperty("--md-seed", `${r},${g},${b}`);
    localStorage.setItem("md3e-seed", hex);
}

(function restoreThemeState() {
    const ui = localStorage.getItem("ui-theme") || "ios";
    const theme = localStorage.getItem("notesApp_theme") || "dark";
    const accent = localStorage.getItem("md3e-seed");
    applyUI(ui);
    applyTheme(theme);
    if (accent) applyMD3EAccent(accent);
})();

window.addEventListener("message", (event) => {
    if (!event.data || !event.data.type) return;

    switch (event.data.type) {
        case "SET_UI_THEME":
            applyUI(event.data.theme);
            const frame = document.getElementById("portal-frame");
            if (frame?.contentWindow) {
                frame.contentWindow.postMessage({ type: "INIT_THEME", theme: event.data.theme }, "*");
            }
            break;

        case "SET_THEME":
            applyTheme(event.data.theme);
            const frame2 = document.getElementById("portal-frame");
            if (frame2?.contentWindow) {
                frame2.contentWindow.postMessage({ type: "INIT_THEME", theme: event.data.theme }, "*");
            }
            break;

        case "SET_MD3E_COLOR":
            applyMD3EAccent(event.data.color);
            const frame3 = document.getElementById("portal-frame");
            if (frame3?.contentWindow) {
                frame3.contentWindow.postMessage({ type: "INIT_THEME", theme: localStorage.getItem("notesApp_theme") }, "*");
            }
            break;
    }
});

// ========================================
// EXPORT FUNCTIONS GLOBALLY FOR PWA SYSTEM
// ========================================
window.openModal = openModal;
window.closeCustomModal = closeCustomModal;
window.showSignOutModal = showSignOutModal;
window.showDeleteModal = showDeleteModal;