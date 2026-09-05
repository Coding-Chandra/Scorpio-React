// ============================================================================
// PROJECT SCORPIO - NOTOZ (NOTES APP)
// Mobile Web Version 
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & INITIALIZATION
// ============================================================================

const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';

const NOTES_TABLE = 'notes';
const FOLDERS_TABLE = 'folders';

let CURRENT_USER_ID = null;

// ============================================================================
// NOTE CONTENT SANITIZATION
// Every place decrypted/synced note HTML is written into the DOM must go
// through this first. Requires DOMPurify to be loaded on the page BEFORE
// this script (e.g. <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>).
// ============================================================================
const NOTE_HTML_ALLOWED_TAGS = ['div', 'br', 'p', 'h1', 'h2', 'h3', 'span', 'b', 'strong', 'i', 'em', 'u', 'strike', 's', 'img'];
const NOTE_HTML_ALLOWED_ATTR = ['style', 'src', 'class', 'contenteditable'];

function sanitizeNoteHtml(html) {
    if (!html) return '';
    if (typeof DOMPurify === 'undefined') {
        // Fail safe: if the sanitizer didn't load, strip ALL markup rather
        // than risk rendering unsanitized HTML. Degraded formatting is far
        // better than an XSS hole.
        console.error('[Security] DOMPurify not loaded — rendering note content as plain text.');
        return Utils.escapeHtml(Utils.stripHtml(html));
    }
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: NOTE_HTML_ALLOWED_TAGS,
        ALLOWED_ATTR: NOTE_HTML_ALLOWED_ATTR
    });
}

// Supabase client (safe init)
const supabaseClient = (() => {
    if (window.supabase) {
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return {
        auth: {
            getSession: async () => ({ data: { session: null } }),
            signOut: async () => ({ error: null })
        }
    };
})();

// ============================================================================
// 2. UTILITY FUNCTIONS (general helpers, formatting, sanitization, etc.)
// ============================================================================

const Utils = {
    uuid: () => Date.now().toString(36) + Math.random().toString(36).substr(2),
    formatDateTime: (isoString) => {
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric'
        }) + ' at ' + date.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit'
        });
    },
    formatListDate: (isoString) => {
        const date = new Date(isoString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return date.toLocaleDateString();
    },
    stripHtml: (html) => {
        const tmp = document.createElement('DIV');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    },
    sanitizeFilename: (name) => name.replace(/[^a-z0-9]/gi, '_').toLowerCase(),
    escapeHtml: (str) => (str || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch] || ch))
};

// ============================================================================
// 3. CRYPTOGRAPHY & ENCRYPTION HELPERS (AES-GCM with password-derived key, plus session caching for performance)
// ============================================================================

function _b64Encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _b64Decode(str) {
    const bin = atob(str || '');
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

// ============================================================================
// CRYPTO UPGRADE — per-user salt + higher PBKDF2 iterations
// Drop this in app.js, replacing the old deriveKeyFromPassword (section 3),
// OR paste below it — these redefine the same names so order doesn't matter
// as long as this runs after the original declarations.
// ============================================================================

const OLD_STATIC_SALT = 'notesapp_v1_salt';
const OLD_ITERATIONS   = 200000;
const NEW_ITERATIONS   = 600000;

// Now requires an explicit salt — no silent default.
async function deriveKeyFromPassword(password, salt, iterations = NEW_ITERATIONS) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function _genSaltB64(len = 16) {
    return _b64Encode(crypto.getRandomValues(new Uint8Array(len)));
}

/** Fetch this user's salt row. Returns { salt, iterations } — salt null = not migrated yet. */
async function _getUserCryptoRow() {
    const { data, error } = await supabaseClient
        .from('user_keys')
        .select('salt, kdf_iterations')
        .eq('user_id', CURRENT_USER_ID)
        .single();
    if (error || !data) return { salt: null, iterations: OLD_ITERATIONS };
    return { salt: data.salt, iterations: data.kdf_iterations || OLD_ITERATIONS };
}

/**
 * Call once right after successful login (from your login page),
 * BEFORE relying on encryptWithMasterKey/decryptWithMasterKey.
 * - If user already has a personal salt: just derives + caches the key.
 * - If not: decrypts master key with the old static salt, generates a new
 *   random salt, re-encrypts with 600k iterations, saves to user_keys.
 * Returns true on success, false if it couldn't proceed (wrong password etc).
 */
async function migrateUserCrypto(password) {
    const { salt, iterations } = await _getUserCryptoRow();

    if (salt) {
        // Already migrated — just derive session keys with personal salt.
        const key = await deriveKeyFromPassword(password, salt, iterations);
        _cachedDecryptKey = key;
        _cachedEncryptKey = key;
        return true;
    }

    // Not migrated yet: decrypt existing master key with OLD static salt/iterations.
    const { data: row, error } = await supabaseClient
        .from('user_keys')
        .select('encrypted_master_key')
        .eq('user_id', CURRENT_USER_ID)
        .single();
    if (error || !row?.encrypted_master_key) return false;

    let masterKeyBytes;
    try {
        const oldDerived = await deriveKeyFromPassword(password, OLD_STATIC_SALT, OLD_ITERATIONS);
        const encObj = JSON.parse(row.encrypted_master_key);
        const iv = _b64Decode(encObj.iv);
        const ct = _b64Decode(encObj.data);
        masterKeyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, oldDerived, ct));
    } catch (e) {
        console.error('[Migrate] Wrong password or corrupt key:', e);
        return false;
    }

    // Generate new personal salt, re-encrypt master key under it.
    const newSalt = _genSaltB64();
    const newDerived = await deriveKeyFromPassword(password, newSalt, NEW_ITERATIONS);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, newDerived, masterKeyBytes);
    const newEncrypted = JSON.stringify({ iv: _b64Encode(iv), data: _b64Encode(ct) });

    const { error: updateErr } = await supabaseClient
        .from('user_keys')
        .update({
            encrypted_master_key: newEncrypted,
            salt: newSalt,
            kdf_iterations: NEW_ITERATIONS
        })
        .eq('user_id', CURRENT_USER_ID);

    if (updateErr) {
        console.error('[Migrate] Failed to save new salt:', updateErr);
        return false; // user still works off old salt next time; safe to retry later
    }

    _cachedDecryptKey = newDerived;
    _cachedEncryptKey = newDerived;
    console.log('[Migrate] User upgraded to personal salt + 600k iterations.');
    return true;
}

window.migrateUserCrypto = migrateUserCrypto;

async function encryptMasterKey(masterKeyBytes, password) {
    const derived = await deriveKeyFromPassword(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derived, masterKeyBytes);
    return { iv: _b64Encode(iv), data: _b64Encode(ct) };
}

async function decryptMasterKey(encObj, password) {
    const derived = await deriveKeyFromPassword(password);
    const iv = _b64Decode(encObj.iv);
    const ct = _b64Decode(encObj.data);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, derived, ct);
    return new Uint8Array(decrypted);
}

// ---------------------------------------------------------
// 🔒 Session key storage — IndexedDB, non-extractable CryptoKey
// (mirrors login.js — reads the key that login.js already imported)
// ---------------------------------------------------------
const KEY_DB_NAME = 'notoz_session';
const KEY_STORE = 'keys';

function _openKeyDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(KEY_DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(KEY_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getSessionMasterKey() {
    const db = await _openKeyDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, 'readonly');
        const req = tx.objectStore(KEY_STORE).get('masterKey');
        req.onsuccess = () => resolve(req.result || null); // CryptoKey object or null
        req.onerror = () => reject(req.error);
    });
}

async function clearSessionMasterKey() {
    const db = await _openKeyDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, 'readwrite');
        tx.objectStore(KEY_STORE).delete('masterKey');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

// Full sign-out: clears decrypt queue/cache, in-memory key cache, the
// IndexedDB-stored master key, AND ends the Supabase session. This is the
// one function anything on this page (including security-monitor.js)
// should call for a real, complete logout — mirrors settings.js's
// performFullSignOut() so the same global name works on every page.
async function performFullSignOut() {
    if (typeof DecryptQueue !== 'undefined') DecryptQueue.abort();
    if (typeof _decryptCache !== 'undefined') _decryptCache.clear();
    if (typeof clearCryptoKeyCache === 'function') clearCryptoKeyCache();
    await clearSessionMasterKey();

    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}
window.performFullSignOut = performFullSignOut;

async function encryptWithMasterKey(plaintext) {
    if (!plaintext) return '';
    const key = await getSessionMasterKey();
    if (!key) throw new Error('Master key not available locally.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return `enc:${_b64Encode(iv)}:${_b64Encode(ct)}`;
}

async function decryptWithMasterKey(stored) {
    if (!stored) return '';
    if (!stored.startsWith('enc:')) return stored;
    const key = await getSessionMasterKey();
    if (!key) return stored;
    const [, ivB64, ctB64] = stored.split(':');
    const iv = _b64Decode(ivB64);
    const ct = _b64Decode(ctB64);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
}

// ============================================================================
// A. SESSION CRYPTO CACHE
// Import the master CryptoKey once. Every decrypt call reuses it.
// ============================================================================

let _cachedDecryptKey = null;   // CryptoKey object, lives for the session
let _cachedEncryptKey = null;

/**
 * Get (or import) the session decrypt key.
 * Falls back gracefully if master key bytes aren't in localStorage yet.
 */
async function _getDecryptKey() {
    if (_cachedDecryptKey) return _cachedDecryptKey;
    const key = await getSessionMasterKey();
    if (!key) return null;
    _cachedDecryptKey = key;
    return _cachedDecryptKey;
}

async function _getEncryptKey() {
    if (_cachedEncryptKey) return _cachedEncryptKey;
    const key = await getSessionMasterKey();
    if (!key) return null;
    _cachedEncryptKey = key;
    return _cachedEncryptKey;
}

/**
 * Fast decrypt — reuses cached CryptoKey, no localStorage read per call.
 * Drop-in replacement for decryptWithMasterKey() for internal queue use.
 */
async function _fastDecrypt(stored) {
    if (!stored || !stored.startsWith('enc:')) return stored || '';
    const key = await _getDecryptKey();
    if (!key) return stored; // master key not available yet
    const [, ivB64, ctB64] = stored.split(':');
    const iv = _b64Decode(ivB64);
    const ct = _b64Decode(ctB64);
    try {
        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(dec);
    } catch (e) {
        return stored; // return raw if decrypt fails (wrong key, corrupted)
    }
}

/**
 * Fast encrypt — reuses cached CryptoKey.
 */
async function _fastEncrypt(plaintext) {
    if (!plaintext) return '';
    const key = await _getEncryptKey();
    if (!key) throw new Error('Master key not available');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
    );
    return `enc:${_b64Encode(iv)}:${_b64Encode(ct)}`;
}

/** Call this on logout to clear the session key cache */
function clearCryptoKeyCache() {
    _cachedDecryptKey = null;
    _cachedEncryptKey = null;
}


// ============================================================================
// B. SESSION DECRYPT CACHE
// Once a note is fully decrypted, store title+content here.
// Reopening the same note = instant, zero re-decrypt.
// ============================================================================

const _decryptCache = new Map(); // noteId → { title, content, preview }


// ============================================================================
// C. PRIORITY DECRYPT QUEUE
// Two-lane queue:
//   lane 0 = urgent   (note the user just opened)
//   lane 1 = normal   (full content, background, newest→oldest)
// Max 2 concurrent AES-GCM ops. Runs in requestIdleCallback when idle.
// ============================================================================

const DecryptQueue = (() => {
    const _urgent  = [];   // { noteId, resolve, reject, type: 'full' }
    const _normal  = [];   // same shape
    let _running   = 0;
    const MAX_CONCURRENT = 2;
    let _idleHandle = null;
    let _aborted = false;

    function _enqueue(lane, noteId, type) {
        // Deduplicate — don't add same note twice to same lane
        const list = lane === 0 ? _urgent : _normal;
        if (list.some(i => i.noteId === noteId && i.type === type)) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            list.push({ noteId, resolve, reject, type });
            _scheduleRun();
        });
    }

    function _scheduleRun() {
        if (_idleHandle) return;
        if (typeof requestIdleCallback !== 'undefined') {
            _idleHandle = requestIdleCallback(_run, { timeout: 800 });
        } else {
            _idleHandle = setTimeout(_run, 0);
        }
    }

    async function _run(deadline) {
        _idleHandle = null;
        if (_aborted) return;

        // Drain as many as we can within the idle window (or just run if setTimeout)
        const hasTime = () => deadline?.timeRemaining
            ? deadline.timeRemaining() > 5
            : true;

        while (_running < MAX_CONCURRENT && (_urgent.length || _normal.length) && hasTime()) {
            const item = _urgent.shift() || _normal.shift();
            if (!item) break;
            _running++;
            _processItem(item).finally(() => {
                _running--;
                _scheduleRun();
            });
        }

        // If there's still work and we're over the time budget, reschedule
        if (_urgent.length || _normal.length) {
            _scheduleRun();
        }
    }

    async function _processItem(item) {
        if (_aborted) { item.resolve(null); return; }

        // Check session cache first
        const cached = _decryptCache.get(item.noteId);
        if (cached && (item.type === 'preview' ? cached.preview !== undefined : cached.content !== undefined)) {
            item.resolve(cached);
            return;
        }

        // Find note in app.notes
        const note = app.notes.find(n => n.id === item.noteId);
        if (!note) { item.resolve(null); return; }

        try {
            let changed = false;

            if (item.type === 'preview') {
                // Decrypt title + first ~120 chars of content only
                let title = note.title;
                let preview = '';

                if (title?.startsWith('enc:')) {
                    title = await _fastDecrypt(title);
                    changed = true;
                }

                if (note.content?.startsWith('enc:')) {
                    // Decrypt just enough for a preview — we only need the first chunk.
                    // Full AES-GCM decrypts the whole ciphertext anyway, but we truncate
                    // the result so we're not holding the entire note in memory twice.
                    const full = await _fastDecrypt(note.content);
                    preview = full.substring(0, 120);
                    changed = true;
                } else {
                    preview = (note.content || '').substring(0, 120);
                }

                // Store preview separately, don't touch note.content yet
                note._preview = { title, preview };
                note._previewDecrypted = true;

                const entry = _decryptCache.get(item.noteId) || {};
                entry.title = title;
                entry.preview = preview;
                _decryptCache.set(item.noteId, entry);

                // Update the title on the note object (titles are always shown)
                if (changed) note.title = title;

                // Patch just the list item — no full re-render
                app.updateNoteItemInList(note.id);
                item.resolve({ title, preview });

            } else {
                // Full decrypt
                let title = note.title;
                let content = note.content;

                if (title?.startsWith('enc:'))   title   = await _fastDecrypt(title);
                if (content?.startsWith('enc:')) content = await _fastDecrypt(content);

                note.title   = title;
                note.content = content;
                note._decrypted = true;
                note._previewDecrypted = true;

                _decryptCache.set(item.noteId, {
                    title,
                    content,
                    preview: (content || '').substring(0, 120)
                });

                app.updateNoteItemInList(note.id);

                // If this note is currently open, refresh the editor content
                if (app.activeNoteId === note.id) {
                    const contentEl = document.getElementById('noteContentInput');
                    const titleEl   = document.getElementById('noteTitleInput');
                    if (contentEl && document.activeElement !== contentEl) {
                        contentEl.innerHTML = sanitizeNoteHtml(content);
                    }
                    if (titleEl && document.activeElement !== titleEl) {
                        titleEl.value = title;
                    }
                }

                item.resolve({ title, content });
            }
        } catch (e) {
            console.error('[DecryptQueue] Failed for note:', item.noteId, e);
            item.resolve(null);
        }
    }

    return {
        /**
         * Enqueue URGENT full decrypt (user opened the note).
         * Jumps to front of queue, awaitable.
         */
        priorityFull(noteId) {
            // Remove from normal queue if it's already there
            const idx = _normal.findIndex(i => i.noteId === noteId && i.type === 'full');
            if (idx !== -1) _normal.splice(idx, 1);
            return _enqueue(0, noteId, 'full');
        },

        /**
         * Enqueue background preview decrypt for list view.
         */
        queuePreview(noteId) {
            return _enqueue(1, noteId, 'preview');
        },

        /**
         * Enqueue background full decrypt (low priority).
         */
        queueFull(noteId) {
            return _enqueue(1, noteId, 'full');
        },

        /** Cancel all pending work (e.g. on logout) */
        abort() {
            _aborted = true;
            _urgent.length = 0;
            _normal.length = 0;
            if (_idleHandle) {
                if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(_idleHandle);
                else clearTimeout(_idleHandle);
                _idleHandle = null;
            }
        },

        /** Reset after abort (e.g. re-login) */
        reset() {
            _aborted = false;
        },

        /** Check if a note is fully decrypted in cache */
        isCached(noteId) {
            const c = _decryptCache.get(noteId);
            return !!(c && c.content !== undefined);
        }
    };
})();


// ============================================================================
// 3.1 UNDO/REDO HISTORY MANAGER (Per Note, In-Memory, Session-Only)
// ============================================================================

class UndoRedoManager {
    constructor(maxHistorySize = 50) {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = maxHistorySize;
        this.isApplyingHistory = false;
    }

    push(state) {
        if (this.isApplyingHistory) return;
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        this.history.push({
            title: state.title || '',
            content: state.content || '',
            timestamp: Date.now()
        });
        this.currentIndex++;
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex--;
        }
    }

    undo() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return this.history[this.currentIndex];
        }
        return null;
    }

    redo() {
        if (this.currentIndex < this.history.length - 1) {
            this.currentIndex++;
            return this.history[this.currentIndex];
        }
        return null;
    }

    canUndo() { return this.currentIndex > 0; }
    canRedo() { return this.currentIndex < this.history.length - 1; }

    clear() {
        this.history = [];
        this.currentIndex = -1;
    }

    getCurrentState() {
        if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
            return this.history[this.currentIndex];
        }
        return null;
    }
}

// ============================================================================
// 4. DIALOG CONTROLLER (Reusable, Promise-Based, Supports Input & Custom Callbacks)
// ============================================================================

const AppDialog = {
    overlay: document.getElementById('appDialogOverlay'),
    panel: document.querySelector('#appDialogOverlay .dialog-panel'),
    titleEl: document.getElementById('dialogTitle'),
    msgEl: document.getElementById('dialogMessage'),
    inputEl: document.getElementById('dialogInput'),
    cancelBtn: document.getElementById('dialogCancelBtn'),
    confirmBtn: document.getElementById('dialogConfirmBtn'),
    currentOptions: null,
    currentSource: null,
    lastSourceEl: null,
    lastPointerSource: null,
    activeAnimation: null,

    resolveSource(trigger) {
        const element = trigger && typeof trigger === 'object' && 'getBoundingClientRect' in trigger
            ? trigger
            : null;

        const sourceEl = element || this.lastPointerSource || this.lastSourceEl;
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

        if (this.panel) {
            const rect = this.panel.getBoundingClientRect();
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
        this.currentSource = source;
        if (source.element) {
            this.lastSourceEl = source.element;
        }
        return source;
    },

    getTransformFromSource(source, rect) {
        if (!rect) {
            rect = this.panel ? this.panel.getBoundingClientRect() : null;
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
        if (!this.panel) return;
        const animations = this.panel.getAnimations ? this.panel.getAnimations() : [];
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
        if (!this.panel) return;

        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finalDuration = reducedMotion ? Math.min(duration, 120) : duration;
        const finalEasing = reducedMotion ? 'ease-out' : easing;

        this.cancelActiveAnimation();
        this.panel.style.willChange = 'transform';
        this.panel.style.transformOrigin = 'center center';

        const animation = this.panel.animate(keyframes, {
            duration: finalDuration,
            easing: finalEasing,
            fill: 'forwards'
        });

        this.activeAnimation = animation;

        animation.onfinish = () => {
            this.panel.style.willChange = 'auto';
            this.activeAnimation = null;
        };
        animation.oncancel = () => {
            this.panel.style.willChange = 'auto';
            this.activeAnimation = null;
        };
    },

    open(opts = {}) {
        const options = opts || {};
        this.currentOptions = options;
        const trigger = options.trigger || options.sourceEl || this.lastPointerSource || null;
        const source = this.setSource(trigger);

        this.titleEl.textContent = options.title || '';

        if (options.message) {
            this.msgEl.textContent = options.message;
            this.msgEl.style.display = 'block';
        } else {
            this.msgEl.style.display = 'none';
        }

        if (options.showInput) {
            this.inputEl.style.display = 'block';
            this.inputEl.placeholder = options.placeholder || '';
            this.inputEl.value = options.defaultValue || '';
            setTimeout(() => this.inputEl.focus(), 10);
        } else {
            this.inputEl.style.display = 'none';
            this.inputEl.value = '';
        }

        this.confirmBtn.textContent = options.confirmLabel || 'OK';
        if (options.destructive) {
            this.confirmBtn.classList.add('destructive');
        } else {
            this.confirmBtn.classList.remove('destructive');
        }

        const rect = this.panel ? this.panel.getBoundingClientRect() : null;
        const motion = this.getTransformFromSource(source, rect);

        if (this.panel) {
            this.panel.style.transformOrigin = `${motion.originX}% ${motion.originY}%`;
            this.panel.style.transform = motion.start;
        }

        this.overlay.classList.add('show');

        requestAnimationFrame(() => {
            const rectAfterShow = this.panel ? this.panel.getBoundingClientRect() : null;
            const motionAfterShow = this.getTransformFromSource(source, rectAfterShow);
            if (this.panel) {
                this.panel.style.transformOrigin = `${motionAfterShow.originX}% ${motionAfterShow.originY}%`;
            }
            this.playAnimation([
                { transform: motionAfterShow.start },
                { transform: motionAfterShow.mid1 },
                { transform: motionAfterShow.mid2 },
                { transform: motionAfterShow.mid3 },
                { transform: motionAfterShow.end }
            ], 620, 'cubic-bezier(.22, 1.12, .28, 1)');
        });
    },

    close() {
        if (!this.overlay || !this.overlay.classList.contains('show')) return;

        const source = this.setSource(this.currentSource?.element || this.lastSourceEl || null);
        const rect = this.panel ? this.panel.getBoundingClientRect() : null;
        const motion = this.getTransformFromSource(source, rect);

        if (this.panel) {
            this.panel.style.transformOrigin = `${motion.originX}% ${motion.originY}%`;
            this.panel.style.transform = motion.end;
        }

        this.playAnimation([
            { transform: motion.end },
            { transform: motion.mid3 },
            { transform: motion.mid2 },
            { transform: motion.mid1 },
            { transform: `translate(${(source.x - (rect ? rect.left + rect.width / 2 : 0))}px, ${(source.y - (rect ? rect.top + rect.height / 2 : 0))}px) scale(0.08, 0.06)` }
        ], 520, 'cubic-bezier(.22, 1.12, .28, 1)');

        setTimeout(() => {
            this.overlay.classList.remove('show');
            this.currentOptions = null;
            this.currentSource = null;
            if (this.panel) {
                this.panel.style.transform = 'none';
                this.panel.style.transformOrigin = 'center center';
            }
        }, 520);
    },

    init() {
        if (!this.overlay) return;

        document.addEventListener('pointerdown', (event) => {
            const target = event.target;
            const sourceEl = target && typeof target.closest === 'function'
                ? target.closest('button, [role="button"], [data-dialog-trigger], .btn, .action-btn, .toolbar-button')
                : null;
            if (sourceEl) {
                this.lastPointerSource = sourceEl;
            }
        }, { passive: true });

        this.cancelBtn.addEventListener('click', () => {
            if (this.currentOptions?.onCancel) this.currentOptions.onCancel();
            this.close();
        });

        this.confirmBtn.addEventListener('click', () => {
            const value = this.inputEl.style.display === 'block' ? this.inputEl.value : null;
            if (this.currentOptions?.onConfirm) this.currentOptions.onConfirm(value);
            this.close();
        });

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                if (this.currentOptions?.onCancel) this.currentOptions.onCancel();
                this.close();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (!this.overlay.classList.contains('show')) return;
            if (e.key === 'Escape') {
                if (this.currentOptions?.onCancel) this.currentOptions.onCancel();
                this.close();
            }
            if (e.key === 'Enter' && (this.inputEl === document.activeElement || this.inputEl.style.display !== 'block')) {
                e.preventDefault();
                this.confirmBtn.click();
            }
        });
    }
};

AppDialog.init();

// ============================================================================
// 5. MAIN APP OBJECT - STATE & CORE (Initialization, Data Loading, CRUD Operations, UI Updates)
// ============================================================================

const app = {
    folders: [],
    notes: [],
    currentUser: { id: null, name: '', email: '' },

    activeFolderId: 'all',
    activeNoteId: null,
    searchQuery: '',
    pendingFolderId: null,
    ui: {
        isMobile: false,
        mobileView: 'folders',
        mobileViewDirection: 'right',
        theme: 'light',
        multiSelect: false,
        selectedNoteIds: new Set(),
        undoRedoManager: null,
        lastSavedState: null,
        debounceTimer: null,
        debounceDelay: 500
    },

    // ========================================================================
    // 5.1 INITIALIZATION & AUTHENTICATION (Session Check, Load User Data, Set Theme, Setup Event Listeners)
    // ========================================================================

    async init() {
        // Show loading state
        this.loading.show();
        this.loading.startProgress();

        // Reset decrypt queue on init (handles re-login in same tab)
        DecryptQueue.reset();
        _decryptCache.clear();

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session || !session.user) {
            console.warn('No active session found. Redirecting to login.');
            window.location.href = '../index.html';
            return;
        }

        CURRENT_USER_ID = session.user.id;
        console.log(`User ${CURRENT_USER_ID} authenticated. Loading app data...`);

        this.currentUser = {
            id: session.user.id,
            email: session.user.email || '',
            name: (session.user.user_metadata?.display_name || session.user.user_metadata?.name) ||
                (session.user.email ? session.user.email.split('@')[0] : '')
        };
        this.updateAccountUI();

        await this.loadFolders();
        await this.loadNotes();

        this.ui.isMobile = window.innerWidth <= 1024;
        const savedTheme = localStorage.getItem('notozApp_theme');
        const theme = savedTheme || 'light'; // Default to light
        this.applyTheme(theme);

        // Listen for system theme changes
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (this.ui.theme === 'system') {
                    this.applyTheme('system');
                }
            });
        }

        if (this.activeFolderId !== 'all' && !this.folders.some(f => f.id === this.activeFolderId)) {
            this.activeFolderId = 'all';
        }

        this.renderFolders();
        this.renderNotesList();
        this.renderEditor();
        this.updateNotesCount();
        this.updateLayout();
        this.ui.undoRedoManager = new UndoRedoManager();
        this.updateUndoRedoButtons();

        this._setupEventListeners();
        BackHandler.init();

        // Hide loading state with smooth transition
        setTimeout(() => {
            this.loading.stopProgress();
            this.loading.setProgress(100);
            setTimeout(() => {
                this.loading.hide();
                // Add fade-in animation to content
                document.getElementById('app').classList.add('content-fade-in');
            }, 200);
        }, 100);
    },

    async handleLogout() {
        try {
            await performFullSignOut();
        } catch (error) {
            console.error('Logout failed:', error);
            alert('Logout failed. Check console for details.');
            return;
        }
        window.location.href = '../index.html';
    },

    _setupEventListeners() {
        document.getElementById('noteContentInput')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('custom-checkbox')) {
                e.target.classList.toggle('checked');
                this.updateCurrentNote();
            }
        });

        // Intercept ALL paste paths (native Ctrl+V, right-click paste) so
        // clipboard HTML is sanitized before it ever enters the editor —
        // never trust content that came from outside the app.
        document.getElementById('noteContentInput')?.addEventListener('paste', (e) => {
            e.preventDefault();
            const clipboard = e.clipboardData || window.clipboardData;
            const html = clipboard?.getData('text/html');
            const text = clipboard?.getData('text/plain') || '';

            if (html) {
                const clean = sanitizeNoteHtml(html);
                document.execCommand('insertHTML', false, clean);
            } else {
                document.execCommand('insertText', false, text);
            }
            this.updateCurrentNote();
        });

        document.addEventListener('click', (e) => {
            this.handleDropdownClose('shareDropdown', 'shareBtn', e);
            this.handleDropdownClose('textStyleDropdown', 'textStyleBtn', e);
            this.handleMenuCloseOnly('noteActionsMenu', e);
            this.handleMenuCloseOnly('folderActionsMenu', e);
            this.handleDropdownClose('accountDropdown', 'accountBtn', e);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDropdown('shareDropdown');
                this.closeDropdown('textStyleDropdown');
                this.closeDropdown('noteActionsMenu');
                this.closeDropdown('folderActionsMenu');
                this.closeDropdown('accountDropdown');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (e.shiftKey) {
                    this.performRedo();
                } else {
                    this.performUndo();
                }
            }
            if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.performRedo();
            }
        });

        window.addEventListener('resize', () => this.handleResize());
    },

    // ========================================================================
    // 5.2 DATA LOADING (Folders & Notes with Offline Support, Caching, and Background Decryption)
    // (Offline Support: Only when app was previously opened online and data cached locally)
    // ========================================================================

    async loadFolders() {
        // Folders are small — cache them in localStorage for offline use
        if (!isOnline()) {
            try {
                const cached = localStorage.getItem('notozApp_folders_' + CURRENT_USER_ID);
                this.folders = cached ? JSON.parse(cached) : [];
                console.log('[Offline] Loaded folders from localStorage');
            } catch (e) {
                this.folders = [];
            }
            return;
        }

        const { data, error } = await supabaseClient
            .from(FOLDERS_TABLE)
            .select('*')
            .eq('user_id', CURRENT_USER_ID)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error loading folders:', error);
            // Fallback to localStorage cache
            try {
                const cached = localStorage.getItem('notozApp_folders_' + CURRENT_USER_ID);
                this.folders = cached ? JSON.parse(cached) : [];
            } catch (e) {
                this.folders = [];
            }
            return;
        }

        this.folders = data || [];
        // Mirror folders to localStorage for offline access
        try {
            localStorage.setItem('notozApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
        } catch (e) {
            console.warn('[Offline] Could not cache folders in localStorage:', e);
        }
    },

    async loadNotes() {
        // If offline, load straight from IndexedDB
        if (!isOnline()) {
            console.log('[Offline] Loading notes from IndexedDB...');
            try {
                this.notes = await getNotesOffline(CURRENT_USER_ID);
            } catch (e) {
                console.error('[Offline] Failed to load notes from IndexedDB:', e);
                this.notes = [];
            }
            // Render immediately — locally stored notes are already decrypted
            this.renderNotesList();
            this.renderEditor();
            return;
        }

        // Online: load from Supabase
        const { data, error } = await supabaseClient
            .from(NOTES_TABLE)
            .select('*')
            .eq('user_id', CURRENT_USER_ID)
            .order('updated_at', { ascending: false });

        if (error || !data) {
            console.error('Error loading notes from Supabase, falling back to IndexedDB:', error);
            try {
                this.notes = await getNotesOffline(CURRENT_USER_ID);
            } catch (e) {
                this.notes = [];
            }
            this.renderNotesList();
            this.renderEditor();
            return;
        }

        this.notes = data;

        // Render immediately with placeholder previews before decryption
        this.renderNotesList();
        this.renderEditor();

        // Decrypt in background batches
        await this.decryptNotesInBackground();

        // Mirror decrypted notes to IndexedDB for offline access
        // We store the raw (still-encrypted from server) versions so
        // decryption still works consistently offline
        this.mirrorNotesToIndexedDB(data);
    },

    // Mirror server notes to IndexedDB without adding to sync queue
    mirrorNotesToIndexedDB(notes) {
        if (!notes || !notes.length) return;
        // db and STORES come from offline-sync.js (loaded before app.js)
        try {
            if (typeof db === 'undefined' || !db) {
                // DB not ready yet — retry after a short delay
                setTimeout(() => this.mirrorNotesToIndexedDB(notes), 1000);
                return;
            }
            const transaction = db.transaction([STORES.notes], 'readwrite');
            const store = transaction.objectStore(STORES.notes);
            notes.forEach(note => {
                store.put({ ...note, synced: true, offline: false });
            });
            transaction.onerror = () => console.warn('[Offline] Failed to mirror some notes to IndexedDB');
        } catch (e) {
            console.warn('[Offline] mirrorNotesToIndexedDB error:', e);
        }
    },

    async decryptNotesInBackground(batchSize = 10) {
        const needsDecryption = this.notes.filter(n =>
            n.content?.startsWith('enc:') || n.title?.startsWith('enc:')
        );

        for (let i = 0; i < needsDecryption.length; i += batchSize) {
            const batch = needsDecryption.slice(i, i + batchSize);
            await Promise.all(batch.map(async (note) => {
                try {
                    if (note.title?.startsWith('enc:'))
                        note.title = await _fastDecrypt(note.title);
                    if (note.content?.startsWith('enc:'))
                        note.content = await _fastDecrypt(note.content);
                    note._decrypted = true;
                    this.updateNoteItemInList(note.id); // patch DOM
                } catch (e) {
                    console.error('[Decrypt] Failed for note:', note.id, e);
                }
            }));
            await new Promise(r => setTimeout(r, 0));
        }
    },

    // ========================================================================
    // 5.3 NOTES CRUD OPERATIONS (With Optimistic UI Updates, Background Sync, and Error Handling)
    // ========================================================================

    getActiveNote() {
        return this.activeNoteId ? this.notes.find(n => n.id === this.activeNoteId) : null;
    },

    getNotesToDisplay() {
        let notes = this.notes;

        if (this.activeFolderId !== 'all') {
            notes = notes.filter(n => n.folder_id === this.activeFolderId);
        }

        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            notes = notes.filter(n =>
                (n.title?.toLowerCase().includes(q)) ||
                (n.content && Utils.stripHtml(n.content).toLowerCase().includes(q))
            );
        }

        return notes.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
        });
    },

    async createNewNote() {
        let targetFolderId = this.activeFolderId === 'all'
            ? (this.folders[0]?.id || null)
            : this.activeFolderId;

        if (!targetFolderId && this.folders.length === 0) return;

        // Calculate next note number using only decrypted titles
        const noteNumberMatch = this.notes.map(n => {
            // Use decrypted title only; skip still-encrypted ones
            const titleToCheck = (!n.title?.startsWith('enc:')) ? (n.title || '') : '';
            const match = titleToCheck.match(/#(\d+)/);
            return match ? parseInt(match[1]) : 0;
        });
        const highestNumber = noteNumberMatch.length > 0 ? Math.max(...noteNumberMatch) : 0;
        const noteNumber = highestNumber + 1;
        const plainTitle = `New Note #${noteNumber}`;

        // Encrypt initial title before saving to Supabase
        let encryptedTitle = plainTitle;
        try {
            encryptedTitle = await encryptWithMasterKey(plainTitle);
        } catch (e) {
            console.warn('[Encrypt] Could not encrypt initial title, saving plain:', e);
        }

        const newNote = {
            title: encryptedTitle,
            content: '',
            paper_style: 'blank',
            user_id: CURRENT_USER_ID,
            folder_id: targetFolderId,
            pinned: false
        };

        // Offline: save locally and queue for sync
        if (!isOnline()) {
            try {
                const savedNote = await saveNoteOffline(newNote);
                // Store plain title locally so UI renders correctly
                savedNote.title = plainTitle;
                savedNote._decrypted = true;
                this.notes.unshift(savedNote);
                this.activeNoteId = savedNote.id;
                this.renderNotesList();
                this.renderEditor();
                if (this.ui.isMobile) {
                    this.goToMobileView('editor');
                }
                document.getElementById('noteContentInput')?.focus();
            } catch (e) {
                console.error('[Offline] Failed to create note offline:', e);
                alert('Failed to create note.');
            }
            return;
        }

        // Online: save to Supabase
        const { data, error } = await supabaseClient
            .from(NOTES_TABLE)
            .insert([newNote])
            .select()
            .single();

        if (error) {
            console.error('Error creating new note:', error);
            alert('Failed to create new note. See console.');
            return;
        }

        // Store plain title in memory so the UI renders correctly immediately
        data.title = plainTitle;
        data._decrypted = true;
        this.notes.unshift(data);
        this.activeNoteId = data.id;

        // Mirror the server-side record (with encrypted title) to IndexedDB
        this.mirrorNotesToIndexedDB([{ ...data, title: encryptedTitle }]);

        if (this.activeFolderId !== (data.folder_id || 'all')) {
            this.setActiveFolder(data.folder_id || 'all');
        } else {
            this.renderNotesList();
            this.renderEditor();

            setTimeout(() => {
                const newNoteElement = document.querySelector(`[data-note-id="${data.id}"]`);
                if (newNoteElement && window.AppAnimations) {
                    AppAnimations.animateNoteCreate(newNoteElement, true);
                }
            }, 50);
        }

        if (this.ui.isMobile) {
            this.goToMobileView('editor');
        }

        document.getElementById('noteContentInput')?.focus();
    },

    async updateCurrentNote() {
        const note = this.getActiveNote();
        if (!note) return;

        const titleInput = document.getElementById('noteTitleInput');
        const contentInput = document.getElementById('noteContentInput');
        const now = new Date().toISOString();

        // Always keep decrypted values in memory
        note.title = titleInput?.value || '';
        note.content = contentInput?.innerHTML || '';
        note.updated_at = now;
        note._decrypted = true;

        // Record history (debounced)
        this.debounceRecordHistory();

        // Update list preview immediately
        this.updateNoteItemInList(note.id);
        document.getElementById('editorDateDisplay').innerText = Utils.formatDateTime(note.updated_at);
        if (this.ui.isMobile) this.renderMobileNav();

        // Offline: save locally and queue for sync (store decrypted — IndexedDB is local)
        if (!isOnline()) {
            try {
                await saveNoteOffline({
                    ...note,
                    user_id: CURRENT_USER_ID
                });
            } catch (e) {
                console.error('[Offline] Failed to save note offline:', e);
            }
            return;
        }

        // Online: encrypt both title AND content before sending to Supabase
        let encryptedContent, encryptedTitle;
        try {
            encryptedContent = await encryptWithMasterKey(note.content);
            encryptedTitle = await encryptWithMasterKey(note.title);
        } catch (e) {
            console.error('Encryption failed (master key missing).', e);
            encryptedContent = note.content;
            encryptedTitle = note.title;
        }

        const { error } = await supabaseClient
            .from(NOTES_TABLE)
            .update({
                title: encryptedTitle,
                content: encryptedContent,
                updated_at: now
            })
            .eq('id', note.id)
            .eq('user_id', CURRENT_USER_ID);

        if (error) {
            console.error('Error updating note:', error);
            // Queue for retry with decrypted content (offline-sync.js will re-encrypt on push)
            try {
                await saveNoteOffline({ ...note, user_id: CURRENT_USER_ID });
            } catch (e2) {
                console.error('[Offline] Failed to queue failed update:', e2);
            }
            return;
        }

        // Mirror encrypted version to IndexedDB
        this.mirrorNotesToIndexedDB([{
            ...note,
            title: encryptedTitle,
            content: encryptedContent
        }]);
    },

    updateNoteItemInList(noteId) {
        const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
        if (!noteEl) return;

        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;

        const titleEl = noteEl.querySelector('.note-title');
        const previewEl = noteEl.querySelector('.note-preview');
        const dateEl = noteEl.querySelector('.note-meta span:first-child');

        if (titleEl) titleEl.textContent = note.title || 'New Note';

        if (previewEl) {
            const preview = note._decrypted
                ? Utils.stripHtml(note.content).substring(0, 50) || 'No text'
                : '...';
            previewEl.textContent = preview;
        }

        if (dateEl) dateEl.textContent = Utils.formatListDate(note.updated_at);
    },

    async togglePin() {
        const note = this.getActiveNote();
        if (!note) return;

        note.pinned = !note.pinned;

        if (!isOnline()) {
            try {
                await saveNoteOffline({ ...note, user_id: CURRENT_USER_ID });
            } catch (e) {
                console.error('[Offline] Failed to save pin state offline:', e);
            }
            this.renderNotesList();
            this.renderEditor();
            return;
        }

        const { error } = await supabaseClient
            .from(NOTES_TABLE)
            .update({ pinned: note.pinned, updated_at: new Date().toISOString() })
            .eq('id', note.id)
            .eq('user_id', CURRENT_USER_ID);

        if (error) {
            console.error('Error pinning note:', error);
            return;
        }

        this.mirrorNotesToIndexedDB([note]);
        this.renderNotesList();
        this.renderEditor();
    },

    async deleteNote(noteId) {
        if (!noteId) return;

        const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);

        // Offline: mark for deletion and remove locally
        if (!isOnline()) {
            try {
                await deleteNoteOffline(noteId);
            } catch (e) {
                console.error('[Offline] Failed to queue note deletion:', e);
            }

            this.notes = this.notes.filter(n => n.id !== noteId);
            if (this.activeNoteId === noteId) this.activeNoteId = null;

            if (noteElement && window.AppAnimations) {
                AppAnimations.animateNotesDelete(noteElement, () => {
                    this.renderNotesList();
                    this.renderEditor();
                });
            } else {
                this.renderNotesList();
                this.renderEditor();
            }
            return;
        }

        // Online: delete from Supabase
        const { error } = await supabaseClient
            .from(NOTES_TABLE)
            .delete()
            .eq('id', noteId)
            .eq('user_id', CURRENT_USER_ID);

        if (error) {
            console.error('Error deleting note:', error);
            if (noteElement && window.AppAnimations) {
                AppAnimations.animateError(noteElement);
            }
            alert('Failed to delete note. See console.');
            return;
        }

        // Also remove from IndexedDB
        try {
            await deleteNoteOffline(noteId);
            // Remove the just-added queue entry since it's already deleted server-side
            // The sync will find nothing to do, which is fine
        } catch (e) {
            console.warn('[Offline] Failed to remove deleted note from IndexedDB:', e);
        }

        if (noteElement && window.AppAnimations) {
            AppAnimations.animateNotesDelete(noteElement, () => {
                this.notes = this.notes.filter(n => n.id !== noteId);
                if (this.activeNoteId === noteId) this.activeNoteId = null;
                this.renderNotesList();
                this.renderEditor();
            });
        } else {
            this.notes = this.notes.filter(n => n.id !== noteId);
            if (this.activeNoteId === noteId) this.activeNoteId = null;
            this.renderNotesList();
            this.renderEditor();
        }
    },

    requestDeleteActiveNote() {
        const note = this.getActiveNote();
        if (!note) return;
        const title = note.title || 'this note';
        AppDialog.open({
            title: 'Delete Note',
            message: `Are you sure you want to delete "${title}"?`,
            showInput: false,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: () => this.deleteNote(note.id)
        });
    },

    async deleteSelectedNotes() {
        const ids = Array.from(this.ui.selectedNoteIds);
        if (!ids.length) return;

        AppDialog.open({
            title: 'Delete Notes',
            message: `Delete ${ids.length} selected note${ids.length > 1 ? 's' : ''}?`,
            showInput: false,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: async () => {
                ids.forEach((noteId, index) => {
                    const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);
                    if (noteElement && window.AppAnimations) {
                        setTimeout(() => {
                            AppAnimations.animateNotesDelete(noteElement);
                        }, index * 50);
                    }
                });

                if (!isOnline()) {
                    // Offline: queue each deletion
                    for (const noteId of ids) {
                        try {
                            await deleteNoteOffline(noteId);
                        } catch (e) {
                            console.error('[Offline] Failed to queue deletion for:', noteId, e);
                        }
                    }
                } else {
                    const { error } = await supabaseClient
                        .from(NOTES_TABLE)
                        .delete()
                        .in('id', ids)
                        .eq('user_id', CURRENT_USER_ID);

                    if (error) {
                        console.error('Error deleting notes:', error);
                        alert('Failed to delete notes. See console.');
                        return;
                    }
                }

                const selectedSet = new Set(ids);
                this.notes = this.notes.filter(n => !selectedSet.has(n.id));
                if (selectedSet.has(this.activeNoteId)) {
                    this.activeNoteId = null;
                }

                this.ui.selectedNoteIds = new Set();
                this.ui.multiSelect = false;

                if (window.AppAnimations) {
                    AppAnimations.animateMultiSelectExit();
                }

                this.renderNotesList();
                this.renderEditor();
                this.updateMultiSelectUI();
            }
        });
    },

    // ========================================================================
    // 5.4 FOLDER CRUD OPERATIONS (With Optimistic UI Updates, Background Sync, and Error Handling)
    // ========================================================================

    createNewFolder() {
        AppDialog.open({
            title: 'New Folder',
            message: '',
            showInput: true,
            placeholder: 'Folder name',
            defaultValue: '',
            confirmLabel: 'Create',
            destructive: false,
            onConfirm: async (value) => {
                if (value && value.trim()) {
                    if (!isOnline()) {
                        alert('You need to be online to create folders.');
                        return;
                    }

                    const newFolder = {
                        name: value.trim(),
                        user_id: CURRENT_USER_ID
                    };

                    const { data, error } = await supabaseClient
                        .from(FOLDERS_TABLE)
                        .insert([newFolder])
                        .select()
                        .single();

                    if (error) {
                        console.error('Error creating folder:', error);
                        alert('Failed to create folder.');
                        return;
                    }

                    this.folders.push(data);
                    // Update local cache
                    try {
                        localStorage.setItem('notozApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
                    } catch (e) { /* ignore */ }

                    this.renderFolders();
                    this.updateLayout();
                    this.setActiveFolder(data.id);

                    setTimeout(() => {
                        const newFolderElement = document.querySelector(`[data-folder-id="${data.id}"]`);
                        if (newFolderElement && window.AppAnimations) {
                            AppAnimations.animateFolderCreate(newFolderElement);
                        }
                    }, 50);
                }
            }
        });
    },

    async renameFolder(folderId) {
        if (folderId === 'all') return;
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        AppDialog.open({
            title: 'Rename Folder',
            message: '',
            showInput: true,
            placeholder: 'Folder name',
            defaultValue: folder.name,
            confirmLabel: 'Rename',
            destructive: false,
            onConfirm: async (value) => {
                if (value && value.trim()) {
                    if (!isOnline()) {
                        alert('You need to be online to rename folders.');
                        return;
                    }

                    const newName = value.trim();

                    const { error } = await supabaseClient
                        .from(FOLDERS_TABLE)
                        .update({ name: newName })
                        .eq('id', folderId)
                        .eq('user_id', CURRENT_USER_ID);

                    if (error) {
                        console.error('Error renaming folder:', error);
                        alert('Failed to rename folder. See console.');
                        return;
                    }

                    folder.name = newName;
                    if (this.activeFolderId === folderId) {
                        document.getElementById('activeFolderName').innerText = newName;
                    }

                    // Update local cache
                    try {
                        localStorage.setItem('notozApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
                    } catch (e) { /* ignore */ }

                    this.renderFolders();
                }
            }
        });
    },

    async deleteFolder(folderId) {
        if (folderId === 'all') return;
        const idx = this.folders.findIndex(f => f.id === folderId);
        if (idx === -1) return;

        if (!isOnline()) {
            alert('You need to be online to delete folders.');
            return;
        }

        const folder = this.folders[idx];
        const notesInFolder = this.notes.filter(n => n.folder_id === folderId).length;
        const message = notesInFolder > 0
            ? `Delete folder "${folder.name}" and all ${notesInFolder} note(s) inside? (This action cannot be undone.)`
            : `Delete empty folder "${folder.name}"?`;

        AppDialog.open({
            title: 'Delete Folder',
            message,
            showInput: false,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: async () => {
                await supabaseClient.from(NOTES_TABLE).delete().eq('folder_id', folderId).eq('user_id', CURRENT_USER_ID);

                const { error } = await supabaseClient
                    .from(FOLDERS_TABLE)
                    .delete()
                    .eq('id', folderId)
                    .eq('user_id', CURRENT_USER_ID);

                if (error) {
                    console.error('Error deleting folder:', error);
                    alert('Failed to delete folder. See console.');
                    return;
                }

                this.folders.splice(idx, 1);
                this.notes = this.notes.filter(n => n.folder_id !== folderId);

                // Update local cache
                try {
                    localStorage.setItem('notozApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
                } catch (e) { /* ignore */ }

                if (this.activeFolderId === folderId) {
                    this.activeFolderId = 'all';
                    this.activeNoteId = null;
                }

                this.renderFolders();
                this.renderNotesList();
                this.renderEditor();
            }
        });
    }
};

// ============================================================================
// 6. RENDERING FUNCTIONS (Notes List, Folders, Editor, Mobile Navigation, and UI State)
// ============================================================================

// ========================================================================
// 6.1 RENDER NOTES & FOLDERS (With Placeholders for Encrypted Content, Decryption Status Indicators, and Optimized Updates)
// ========================================================================

app.renderNotesList = function (animate = true) {
    const container = document.getElementById('notesListContainer');
    container.innerHTML = '';
    const notes = this.getNotesToDisplay();

    notes.forEach(note => {
        const el = document.createElement('div');
        const isSelected = this.ui.selectedNoteIds.has(note.id);
        el.className = `note-item ${note.pinned ? 'pinned' : ''} ${this.activeNoteId === note.id ? 'active' : ''}`;
        el.setAttribute('data-note-id', note.id);

        const preview = note._decrypted
            ? (Utils.stripHtml(note.content).substring(0, 50) || 'No text')
            : '...';
        const hasImage = /<img/i.test(note.content || '');

        // Show decrypted title or placeholder
        const displayTitle = note._decrypted
            ? (note.title || 'New Note')
            : (note.title?.startsWith('enc:') ? '...' : note.title || 'New Note');

        const selectIndicator = this.ui.multiSelect
            ? `<div class="note-select-indicator ${isSelected ? 'selected' : ''}"></div>`
            : '';

        const offlineBadge = (note.offline && !note.synced)
            ? '<span class="note-offline-dot" title="Not synced yet"></span>'
            : '';

        el.innerHTML = `
            ${selectIndicator}
            <div class="note-main">
                <div class="note-title">${Utils.escapeHtml(displayTitle)}</div>
                <div class="note-preview">${Utils.escapeHtml(preview)}</div>
                <div class="note-meta">
                    <span>${Utils.formatListDate(note.updated_at)}</span>
                    <span class="note-meta-right">
                        ${offlineBadge}
                        ${hasImage ? '<span class="note-thumbnail-dot"></span>' : ''}
                        <svg class="pin-icon" viewBox="0 0 24 24">
                            <path d="M16 9V4l1 0c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1l1 0v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
                        </svg>
                    </span>
                </div>
            </div>
            <button class="note-more-btn" type="button" title="Note actions">
                <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.3" />
                    <circle cx="12" cy="12" r="1.3" />
                    <circle cx="12" cy="19" r="1.3" />
                </svg>
            </button>
        `;

        if (this.ui.multiSelect) {
            el.onclick = () => this.toggleNoteSelection(note.id);
        } else {
            el.onclick = (ev) => {
                if (ev.target.closest('.note-more-btn')) return;
                this.activeNoteId = note.id;
                this.renderNotesList();
                this.renderEditor();

                const editorPane = document.getElementById('editor-pane');
                if (editorPane && window.AppAnimations) {
                    AppAnimations.animateEditorOpen(editorPane);
                }

                if (this.ui.isMobile) {
                    this.goToMobileView('editor');
                }
            };
        }

        el.oncontextmenu = (ev) => {
            ev.preventDefault();
            this.openNoteActionsMenu(ev, note.id);
        };

        const moreBtn = el.querySelector('.note-more-btn');
        if (moreBtn) {
            moreBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.openNoteActionsMenu(ev, note.id);
            });
        }

        container.appendChild(el);
    });

    if (animate && !AnimationUtils.prefersReducedMotion()) {
        const items = document.querySelectorAll('.note-item');
        AnimationUtils.staggerAnimate(items, 'listItemSlideIn', 0, 40);
    }
};

app.renderFolders = function () {
    const container = document.getElementById('folderListContainer');
    container.innerHTML = '';

    const allEl = document.createElement('div');
    allEl.className = `folder-item ${this.activeFolderId === 'all' ? 'active' : ''}`;
    allEl.onclick = () => this.setActiveFolder('all');
    allEl.innerHTML = `
        <div class="folder-main">
            <svg class="folder-icon" viewBox="0 0 24 24">
                <path d="M3.5 7.5h5.3c.5 0 .9.2 1.2.5l1 1c.3.3.7.5 1.2.5h7.3c.8 0 1.5.7 1.5 1.5v7.5c0 1.1-.9 2-2 2H4.5c-1.1 0-2-.9-2-2V9.5c0-1.1.9-2 2-2z"/>
                <path d="M4.5 4.5h5c.5 0 1 .2 1.3.5l1.2 1.2"></path>
            </svg>
            <span>All Notes</span>
        </div>
        <div class="folder-count">${this.notes.length}</div>
        <svg class="chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"></path></svg>
    `;
    container.appendChild(allEl);

    this.folders.forEach(folder => {
        const el = document.createElement('div');
        el.className = `folder-item ${this.activeFolderId === folder.id ? 'active' : ''}`;
        el.setAttribute('data-folder-id', folder.id);
        el.innerHTML = `
            <div class="folder-main">
                <svg class="folder-icon" viewBox="0 0 24 24">
                    <path d="M3.5 7.5h5.3c.5 0 .9.2 1.2.5l1 1c.3.3.7.5 1.2.5h7.3c.8 0 1.5.7 1.5 1.5v7.5c0 1.1-.9 2-2 2H4.5c-1.1 0-2-.9-2-2V9.5c0-1.1.9-2 2-2z"/>
                    <path d="M4.5 4.5h5c.5 0 1 .2 1.3.5l1.2 1.2"></path>
                </svg>
                <span>${Utils.escapeHtml(folder.name)}</span>
            </div>
            <div class="folder-count">${this.notes.filter(n => String(n.folder_id) === String(folder.id)).length}</div>
            <button class="folder-more-btn" type="button" title="Folder actions">
                <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.3" />
                    <circle cx="12" cy="12" r="1.3" />
                    <circle cx="12" cy="19" r="1.3" />
                </svg>
            </button>
        `;

        el.onclick = (ev) => {
            if (ev.target.closest('.folder-more-btn')) return;
            this.setActiveFolder(folder.id);
        };

        el.oncontextmenu = (ev) => {
            ev.preventDefault();
            this.openFolderActionsMenu(ev, folder.id);
        };

        const moreBtn = el.querySelector('.folder-more-btn');
        if (moreBtn) {
            moreBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.openFolderActionsMenu(ev, folder.id);
            });
        }

        container.appendChild(el);
    });

    if (!AnimationUtils.prefersReducedMotion()) {
        const items = document.querySelectorAll('.folder-item');
        AnimationUtils.staggerAnimate(items, 'listItemSlideIn', 0, 50);
    }

    this.updateNotesCount();
};

// ========================================================================
// 6.2 RENDER EDITOR & MOBILE NAV (With Decryption on Demand, Dynamic Mobile Navigation Titles, and UI State Management)
// ========================================================================

app.renderEditor = function () {
    const emptyState = document.getElementById('editorEmptyState');
    const container = document.getElementById('editorContainer');
    const titleInput = document.getElementById('noteTitleInput');
    const contentInput = document.getElementById('noteContentInput');
    const inputArea = document.getElementById('editorInputArea');
    const editorPinBtn = document.getElementById('editorPinBtn');

    const note = this.getActiveNote();

    if (!note) {
        this.activeNoteId = null;
        emptyState.style.display = 'flex';
        container.classList.remove('visible');
        return;
    }

    emptyState.style.display = 'none';
    container.classList.add('visible');

    if (document.activeElement !== titleInput) titleInput.value = note.title;

    // Handle encrypted content that hasn't been decrypted yet
    if (document.activeElement !== contentInput && !document.getElementById('imgUpload').value) {
        if (!note._decrypted && note.content?.startsWith('enc:')) {
            // Decrypt on demand, show blank while waiting
            contentInput.innerHTML = '';
            decryptWithMasterKey(note.content).then(decrypted => {
                note.content = decrypted;
                note._decrypted = true;
                contentInput.innerHTML = sanitizeNoteHtml(decrypted);
                this.updateNoteItemInList(note.id);
            }).catch(e => {
                console.error('[Decrypt] On-demand decryption failed:', e);
            });
        } else {
            contentInput.innerHTML = sanitizeNoteHtml(note.content || '');
        }
    }

    inputArea.className = 'editor-inputs';
    if (note.paper_style) inputArea.classList.add(`style-${note.paper_style}`);

    document.getElementById('editorDateDisplay').innerText = Utils.formatDateTime(note.updated_at);

    editorPinBtn.querySelector('svg').style.fill = note.pinned ? 'var(--accent-color)' : 'none';
    editorPinBtn.querySelector('svg').style.stroke = note.pinned ? 'var(--accent-color)' : '#666';

    this.animateEl(inputArea);

    if (this.ui.isMobile) {
        this.renderMobileNav();
    }
    this.initializeHistoryForNote();
};

app.renderMobileNav = function () {
    const bar = document.getElementById('mobileNavBar');
    if (!bar || !this.ui.isMobile) return;

    const folderName = this.activeFolderId === 'all'
        ? 'All Notes'
        : (this.folders.find(f => f.id === this.activeFolderId)?.name || 'Notes');

    if (this.ui.mobileView === 'folders') {
        bar.style.display = 'none';
        return;
    } else if (this.ui.mobileView === 'notes') {
        bar.innerHTML = `
            <div class="mobile-nav-left">
                <button class="mobile-nav-back" onclick="app.goToMobileView('folders')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14 16l-4-4 4-4"/></svg>
                </button>
            </div>
            <div class="mobile-nav-title">${Utils.escapeHtml(folderName)}</div>
            <div class="mobile-nav-right">
                <button id="editNotesBtn" class="edit-notes-btn" onclick="app.toggleMultiSelect()">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/>
                    <line x1="9" y1="6" x2="19" y2="6"/>
                    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                    <line x1="9" y1="12" x2="19" y2="12"/>
                    <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/>
                    <line x1="9" y1="18" x2="19" y2="18"/>
                </svg>
                </button>
            </div>
        `;
    } else if (this.ui.mobileView === 'editor') {
        const note = this.getActiveNote();
        const title = note?.title || 'New Note';
        bar.innerHTML = `
            <div class="mobile-nav-left">
                <button class="mobile-nav-back edit-notes-btn" onclick="app.goToMobileView('notes')">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14 16l-4-4 4-4"/></svg>
                </button>
            </div>
            <div class="mobile-nav-title">${Utils.escapeHtml(title)} <div class="editor-meta-info" id="mobileEditorDateDisplay">${note ? Utils.formatDateTime(note.updated_at) : ''}</div></div>
            <div class="mobile-nav-right">
                <button class="mobile-nav-undo" onclick="app.performUndo()" title="Undo (Ctrl+Z)" aria-label="Undo">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 19q-.425 0-.712-.288T7 18t.288-.712T8 17h6.1q1.575 0 2.738-1T18 13.5 16.838 11 14.1 10H7.8l1.9 1.9q.275.275.275.7t-.275.7-.7.275-.7-.275L4.7 9.7q-.15-.15-.213-.325T4.426 9t.063-.375T4.7 8.3l3.6-3.6q.275-.275.7-.275t.7.275.275.7-.275.7L7.8 8h6.3q2.425 0 4.163 1.575T20 13.5t-1.737 3.925T14.1 19z"/></svg>
                </button>
                <button class="mobile-nav-redo" onclick="app.performRedo()" title="Redo (Ctrl+Y)" aria-label="Redo">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.2 10H9.9q-1.575 0-2.738 1T6 13.5 7.163 16 9.9 17H16q.425 0 .713.288T17 18t-.288.713T16 19H9.9q-2.425 0-4.163-1.575T4 13.5t1.738-3.925T9.9 8h6.3l-1.9-1.9q-.275-.275-.275-.7t.275-.7.7-.275.7.275l3.6 3.6q.15.15.213.325t.062.375-.062.375-.213.325l-3.6 3.6q-.275.275-.7.275t-.7-.275-.275-.7.275-.7z"/></svg>
                </button>
            </div>
        `;
    }
};

// ============================================================================
// 7. EDITOR & FORMATTING FUNCTIONS 
// (With Custom Checkbox Insertion, Text Style Application, Paper Style Cycling, and Optimized Image Uploads with EXIF Stripping and WebP Conversion)
// ============================================================================

// ========================================================================
// 7.1 TEXT FORMATTING & CHECKBOXES 
// (With Custom Checkbox Insertion, Text Style Application, and Paper Style Cycling)
// ========================================================================

app.insertCheckbox = function () {
    const contentEl = document.getElementById('noteContentInput');
    if (!contentEl) return;

    const sel = window.getSelection();
    const checkboxHtml = '<span class="custom-checkbox" contenteditable="false"></span>&nbsp;';

    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        contentEl.focus();
        document.execCommand('insertHTML', false, checkboxHtml);
        this.updateCurrentNote();
        return;
    }

    const range = sel.getRangeAt(0);
    let common = range.commonAncestorContainer;
    if (common.nodeType === 3) common = common.parentNode;

    if (!contentEl.contains(common)) {
        contentEl.focus();
        document.execCommand('insertHTML', false, checkboxHtml);
        this.updateCurrentNote();
        return;
    }

    const selectedText = sel.toString();
    if (!selectedText.trim()) {
        contentEl.focus();
        document.execCommand('insertHTML', false, checkboxHtml);
        this.updateCurrentNote();
        return;
    }

    const lines = selectedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let html = '';
    for (const line of lines) {
        const safe = Utils.escapeHtml(line);
        html += `<div><span class="custom-checkbox" contenteditable="false"></span>&nbsp;${safe}</div>`;
    }

    contentEl.focus();
    document.execCommand('insertHTML', false, html);
    this.updateCurrentNote();
};

app.applyTextStyle = function (kind) {
    const contentEl = document.getElementById('noteContentInput');
    if (!contentEl) return;
    contentEl.focus();

    const blockTagMap = {
        'title': 'h1',
        'heading': 'h2',
        'subheading': 'h3',
        'body': 'p'
    };
    const blockTag = blockTagMap[kind] || 'p';

    document.execCommand('formatBlock', false, blockTag);
    if (kind === 'body') {
        document.execCommand('removeFormat', false, null);
    }
    this.closeDropdown('textStyleDropdown');
    this.updateCurrentNote();
};

app.toggleTextStyleDropdown = function (e) {
    this.toggleDropdown(e, 'textStyleDropdown', 'textStyleBtn');
};

async function cyclePaperStyle() {
    const note = app.getActiveNote();
    if (!note) return;

    const styles = ['blank', 'lined', 'grid'];
    const currentStyle = note.paper_style || 'blank';
    const currentIndex = styles.indexOf(currentStyle);
    const nextIndex = (currentIndex + 1) % styles.length;
    const newStyle = styles[nextIndex];

    note.paper_style = newStyle;

    if (!isOnline()) {
        try {
            await saveNoteOffline({ ...note, user_id: CURRENT_USER_ID });
        } catch (e) {
            console.error('[Offline] Failed to save paper style offline:', e);
        }
        app.renderEditor();
        return;
    }

    const { error } = await supabaseClient
        .from(NOTES_TABLE)
        .update({ paper_style: newStyle, updated_at: new Date().toISOString() })
        .eq('id', note.id)
        .eq('user_id', CURRENT_USER_ID);

    if (error) {
        console.error('Error cycling paper style:', error);
        return;
    }

    app.renderEditor();
}
app.cyclePaperStyle = cyclePaperStyle;

// ========================================================================
// 7.2 IMAGE UPLOAD — OPTIMIZED
// Supabase Storage + EXIF strip + WebP conversion + dimension cap
// (With Camera Permission Handling for Median.co Wrapper)
// ========================================================================

app.triggerImageUpload = async function () {
    if (window.median?.permissions?.request) {
        const granted = await requestCameraPermission();
        if (!granted) {
            alert('Camera permission was denied. Please enable it in your device settings to upload images.');
            return;
        }
    }
    document.getElementById('imgUpload').click();
};

// ── Permission (Median.co bridge) ────────────────────────────────────────
function requestCameraPermission() {
    return new Promise((resolve) => {
        if (window.median?.permissions?.request) {
            median.permissions.request({
                permissions: ['camera'],
                callback: (result) => {
                    resolve(result?.camera === 'authorized' || result?.camera === 'granted');
                }
            });
        } else {
            resolve(true); // not in Median wrapper — allow
        }
    });
}

// ── Step 1: Strip EXIF metadata from JPEG ───────────────────────────────
// Works by finding and removing the APP1 EXIF marker from raw bytes.
// No external library needed — pure ArrayBuffer manipulation.
function stripExif(arrayBuffer) {
    const data = new DataView(arrayBuffer);

    // Must start with JPEG SOI marker FF D8
    if (data.getUint16(0) !== 0xFFD8) return arrayBuffer;

    const result = [new Uint8Array([0xFF, 0xD8])];
    let offset = 2;

    while (offset < data.byteLength - 1) {
        if (data.getUint8(offset) !== 0xFF) break;

        const marker = data.getUint16(offset);
        const segmentLength = data.getUint16(offset + 2) + 2;

        // APP1 (0xFFE1) is where EXIF lives — skip it entirely
        if (marker === 0xFFE1) {
            offset += segmentLength;
            continue;
        }

        result.push(new Uint8Array(arrayBuffer, offset, segmentLength));
        offset += segmentLength;

        // SOS marker means image data starts — copy the rest raw
        if (marker === 0xFFDA) {
            result.push(new Uint8Array(arrayBuffer, offset));
            break;
        }
    }

    const totalLength = result.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of result) {
        merged.set(chunk, pos);
        pos += chunk.byteLength;
    }
    return merged.buffer;
}

// ── Steps 2 & 3: Resize (if > 2400px) + convert to WebP ────────────────
// quality: 1.0 = lossless-equivalent for WebP, visually identical to source
function processImageToWebP(blob, maxDimension = 2400, quality = 1.0) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image load failed'));
        };

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            // Only resize if either dimension exceeds the cap
            if (width > maxDimension || height > maxDimension) {
                if (width >= height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Check WebP support — fall back to PNG if not supported
            const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
            const mimeType = supportsWebP ? 'image/webp' : 'image/png';

            canvas.toBlob(
                (resultBlob) => {
                    if (!resultBlob) {
                        reject(new Error('Canvas toBlob failed'));
                        return;
                    }
                    resolve({ blob: resultBlob, mimeType });
                },
                mimeType,
                quality
            );
        };

        img.src = url;
    });
}

// ── Step 4: Upload to Supabase Storage ──────────────────────────────────
async function uploadImageToSupabase(blob, mimeType) {
    const ext = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'jpg';
    const filename = `${CURRENT_USER_ID}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const { data, error } = await supabaseClient.storage
        .from('notoz-images')
        .upload(filename, blob, {
            contentType: mimeType,
            cacheControl: '31536000',               // cache for 1 year
            upsert: false
        });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data: urlData } = supabaseClient.storage
        .from('notoz-images')
        .getPublicUrl(data.path);

    return urlData.publicUrl;
}

// ── Main handler ─────────────────────────────────────────────────────────
app.handleImageFile = async function (input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const MAX_RAW_SIZE = 5 * 1024 * 1024; // 5MB raw cap before any processing

    if (file.size > MAX_RAW_SIZE) {
        alert(`File is too large. Maximum allowed is 5MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`);
        input.value = '';
        return;
    }

    const contentEl = document.getElementById('noteContentInput');

    // Insert placeholder while processing
    contentEl.focus();
    const placeholderId = 'img-placeholder-' + Date.now();
    document.execCommand('insertHTML', false,
        `<span id="${placeholderId}" style="opacity:0.45;font-style:italic;font-size:13px;">⏳ Processing image…</span>`
    );

    try {
        // ── 1. Strip EXIF (JPEG only) ──
        let processedBlob = file;
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
            const buffer = await file.arrayBuffer();
            const stripped = stripExif(buffer);
            processedBlob = new Blob([stripped], { type: 'image/jpeg' });
        }

        // ── 2 & 3. Resize if huge + convert to WebP ──
        const { blob: finalBlob, mimeType } = await processImageToWebP(processedBlob);

        // ── 4. Upload to Supabase Storage and get URL ──
        let imageUrl;
        if (isOnline()) {
            imageUrl = await uploadImageToSupabase(finalBlob, mimeType);
        } else {
            // Offline fallback: base64 into note (will be large but functional)
            // Replaces itself with a URL when the note syncs — you can improve this later
            console.warn('[ImageUpload] Offline — falling back to base64');
            imageUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = reject;
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(finalBlob);
            });
        }

        // ── Insert image into note ──
        const placeholder = document.getElementById(placeholderId);
        const imgHtml = `<img src="${imageUrl}" style="max-width:95%;border-radius:12px;" /><div><br></div>`;

        if (placeholder) {
            placeholder.outerHTML = imgHtml;
        } else {
            contentEl.focus();
            document.execCommand('insertHTML', false, imgHtml);
        }

        this.updateCurrentNote();

    } catch (err) {
        console.error('[ImageUpload] Failed:', err);

        // Clean up placeholder
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) placeholder.remove();

        alert(`Image upload failed: ${err.message}`);
    }

    input.value = '';
};

// ========================================================================
// 7.3 UNDO/REDO FUNCTIONALITY 
// (With Debounced History Recording, State Comparison to Prevent Redundant Entries, and Dynamic Button State Management)
// ========================================================================

app.initializeHistoryForNote = function () {
    if (!this.activeNoteId) return;

    const note = this.getActiveNote();
    if (!note) return;

    const contentInput = document.getElementById('noteContentInput');

    this.ui.undoRedoManager.clear();
    this.ui.undoRedoManager.push({
        title: note.title || '',
        content: contentInput?.innerHTML || ''
    });

    this.ui.lastSavedState = {
        title: note.title || '',
        content: contentInput?.innerHTML || ''
    };

    this.updateUndoRedoButtons();
};

app.recordHistory = function () {
    if (!this.activeNoteId) return;

    const titleInput = document.getElementById('noteTitleInput');
    const contentInput = document.getElementById('noteContentInput');

    const currentState = {
        title: titleInput?.value || '',
        content: contentInput?.innerHTML || ''
    };

    const lastState = this.ui.undoRedoManager.getCurrentState();
    if (lastState &&
        lastState.title === currentState.title &&
        lastState.content === currentState.content) {
        return;
    }

    this.ui.undoRedoManager.push(currentState);
    this.updateUndoRedoButtons();
};

app.debounceRecordHistory = function () {
    clearTimeout(this.ui.debounceTimer);
    this.ui.debounceTimer = setTimeout(() => {
        this.recordHistory();
    }, this.ui.debounceDelay);
};

app.performUndo = function () {
    const previousState = this.ui.undoRedoManager.undo();
    if (!previousState) return;

    const titleInput = document.getElementById('noteTitleInput');
    const contentInput = document.getElementById('noteContentInput');

    this.ui.undoRedoManager.isApplyingHistory = true;
    if (titleInput) titleInput.value = previousState.title;
    if (contentInput) contentInput.innerHTML = sanitizeNoteHtml(previousState.content);
    this.ui.undoRedoManager.isApplyingHistory = false;

    this.updateCurrentNote();
    this.updateUndoRedoButtons();
};

app.performRedo = function () {
    const nextState = this.ui.undoRedoManager.redo();
    if (!nextState) return;

    const titleInput = document.getElementById('noteTitleInput');
    const contentInput = document.getElementById('noteContentInput');

    this.ui.undoRedoManager.isApplyingHistory = true;
    if (titleInput) titleInput.value = nextState.title;
    if (contentInput) contentInput.innerHTML = sanitizeNoteHtml(nextState.content);
    this.ui.undoRedoManager.isApplyingHistory = false;

    this.updateCurrentNote();
    this.updateUndoRedoButtons();
};

app.updateUndoRedoButtons = function () {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) {
        undoBtn.disabled = !this.ui.undoRedoManager.canUndo();
        undoBtn.style.opacity = this.ui.undoRedoManager.canUndo() ? '1' : '0.5';
        undoBtn.style.cursor = this.ui.undoRedoManager.canUndo() ? 'pointer' : 'not-allowed';
    }

    if (redoBtn) {
        redoBtn.disabled = !this.ui.undoRedoManager.canRedo();
        redoBtn.style.opacity = this.ui.undoRedoManager.canRedo() ? '1' : '0.5';
        redoBtn.style.cursor = this.ui.undoRedoManager.canRedo() ? 'pointer' : 'not-allowed';
    }
};

// ============================================================================
// 8. DROPDOWN & MENU FUNCTIONS (With Click Outside Handling, Dynamic Positioning, and Mobile Compatibility)
// ============================================================================

app.toggleDropdown = function (e, dropdownId, triggerId) {
    e.stopPropagation();
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    if (!dropdown || !trigger) return;

    const isOpen = dropdown.classList.contains('open') || dropdown.classList.contains('is-open');
    if (isOpen) {
        this.closeDropdown(dropdownId);
        trigger.setAttribute('aria-expanded', 'false');
        return;
    }

    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const menuWidth = dropdown.offsetWidth || 190;
    const menuHeight = dropdown.offsetHeight || 180;

    const left = Math.min(
        Math.max(rect.left - 40, 8),
        window.innerWidth - menuWidth - 8
    );

    const fitsBelow = rect.bottom + menuHeight + gap <= window.innerHeight;
    const fitsAbove = rect.top - menuHeight - gap >= 0;
    const openAbove = !fitsBelow && fitsAbove;

    dropdown.style.left = left + 'px';
    dropdown.style.top = 'auto';
    dropdown.style.bottom = 'auto';
    dropdown.classList.remove('direction-up', 'direction-down');
    dropdown.classList.add(openAbove ? 'direction-up' : 'direction-down');

    if (openAbove) {
        dropdown.style.bottom = (window.innerHeight - rect.top + gap) + 'px';
        dropdown.style.setProperty('--origin-x', '50%');
        dropdown.style.setProperty('--origin-y', '100%');
    } else {
        dropdown.style.top = (rect.bottom + gap) + 'px';
        dropdown.style.setProperty('--origin-x', '50%');
        dropdown.style.setProperty('--origin-y', '0%');
    }

    dropdown.classList.add('open', 'is-open');
    dropdown.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-expanded', 'true');
};

app.closeDropdown = function (dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        dropdown.classList.remove('open', 'is-open');
        dropdown.classList.remove('direction-up', 'direction-down');
        dropdown.setAttribute('aria-expanded', 'false');
    }
};

app.handleDropdownClose = function (dropdownId, triggerId, e) {
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    if (!dropdown || !trigger) return;
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
        dropdown.classList.remove('open', 'is-open');
        dropdown.classList.remove('direction-up', 'direction-down');
        dropdown.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-expanded', 'false');
    }
};

app.handleMenuCloseOnly = function (menuId, e) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    if (!menu.contains(e.target)) {
        menu.classList.remove('open', 'is-open');
        menu.classList.remove('direction-up', 'direction-down');
        menu.setAttribute('aria-expanded', 'false');
    }
};

app.toggleShareDropdown = function (e) {
    this.toggleDropdown(e, 'shareDropdown', 'shareBtn');
};

app.toggleAccountDropdown = function (e) {
    this.toggleDropdown(e, 'accountDropdown', 'accountBtn');
};

app.toggleShareDropdownFromMobile = function (e) {
    this.toggleDropdown(e, 'shareDropdown', 'mobileShareBtn');
};

// ========================================================================
// 8.1 NOTE ACTIONS MENU (With Dynamic Pin/Unpin Text and Icon, and Context Menu Support)
// ========================================================================

app.positionMenuByDirection = function (menu, x, y) {
    if (!menu) return;

    const margin = 8;
    const gap = 10;
    const menuWidth = menu.offsetWidth || 180;
    const menuHeight = menu.offsetHeight || 160;
    const canOpenBelow = y + menuHeight + gap <= window.innerHeight - margin;
    const canOpenAbove = y - menuHeight - gap >= margin;
    const openAbove = !canOpenBelow && canOpenAbove;

    menu.classList.remove('direction-up', 'direction-down');
    menu.classList.add(openAbove ? 'direction-up' : 'direction-down');

    let left = x - menuWidth / 2;
    if (left < margin) left = margin;
    if (left + menuWidth > window.innerWidth - margin) left = window.innerWidth - menuWidth - margin;

    if (openAbove) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - y + gap) + 'px';
    } else {
        menu.style.bottom = 'auto';
        menu.style.top = (y + gap) + 'px';
    }

    menu.style.left = left + 'px';
    menu.style.setProperty('--origin-x', '50%');
    menu.style.setProperty('--origin-y', openAbove ? '100%' : '0%');
};

app.openNoteActionsMenu = function (ev, noteId) {
    const menu = document.getElementById('noteActionsMenu');
    if (menu?.classList.contains('open') && menu.dataset.parentId === String(noteId)) {
        this.closeDropdown('noteActionsMenu');
        return;
    }

    this.activeNoteId = noteId;
    if (!menu) return;
    menu.dataset.parentId = String(noteId);

    const note = this.getActiveNote();
    const pinBtn = menu.querySelector('#pinBtn');
    if (note && pinBtn) {
        pinBtn.innerHTML = `${note.pinned ? 'Unpin Note' : 'Pin Note'}`;
    }

    const x = ev.clientX || (ev.touches?.[0]?.clientX) || 20;
    const y = ev.clientY || (ev.touches?.[0]?.clientY) || 20;

    this.positionMenuByDirection(menu, x, y);
    menu.classList.add('open', 'is-open');
    menu.setAttribute('aria-expanded', 'true');
};

app.requestDeleteActiveNoteFromMenu = function () {
    this.closeDropdown('noteActionsMenu');
    this.requestDeleteActiveNote();
};

// ========================================================================
// 8.2 FOLDER ACTIONS MENU (With Context Menu Support and Dynamic Option Availability Based on Folder State)
// ========================================================================

app.openFolderActionsMenu = function (ev, folderId) {
    if (folderId === 'all') return;
    const menu = document.getElementById('folderActionsMenu');
    if (menu?.classList.contains('open') && menu.dataset.parentId === String(folderId)) {
        this.closeDropdown('folderActionsMenu');
        return;
    }

    this.pendingFolderId = folderId;
    if (!menu) return;
    menu.dataset.parentId = String(folderId);

    const x = ev.clientX || (ev.touches?.[0]?.clientX) || 20;
    const y = ev.clientY || (ev.touches?.[0]?.clientY) || 20;

    this.positionMenuByDirection(menu, x, y);
    menu.classList.add('open', 'is-open');
    menu.setAttribute('aria-expanded', 'true');
};

app.createNewFolderAndCloseMenu = function () {
    this.closeDropdown('folderActionsMenu');
    this.createNewFolder();
};

app.promptRenamePendingFolder = function () {
    if (!this.pendingFolderId) return;
    this.renameFolder(this.pendingFolderId);
    this.closeDropdown('folderActionsMenu');
};

app.requestDeletePendingFolder = function () {
    if (!this.pendingFolderId) return;
    this.deleteFolder(this.pendingFolderId);
    this.closeDropdown('folderActionsMenu');
};

// ============================================================================
// 9. UI STATE & LAYOUT FUNCTIONS 
// (With Theme Persistence, Responsive Layout Handling, and Mobile View Navigation)
// ============================================================================

// ========================================================================
// 9.1 THEME & APPEARANCE 
// (With Theme Persistence, Dynamic Toggle Icon, and Smooth Transition Effects)
// ========================================================================

app.applyTheme = function (theme) {
    this.ui.theme = theme;
    const actualTheme = theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    document.documentElement.setAttribute('data-theme', actualTheme);
    localStorage.setItem('notozApp_theme', theme);
    this.updateThemeToggleIcon();
};

app.toggleTheme = function () {
    const btn = document.getElementById('themeToggleBtn');

    if (btn) {
        btn.classList.remove('theme-icon-animating');
        void btn.offsetWidth;
        btn.classList.add('theme-icon-animating');
        setTimeout(() => btn.classList.remove('theme-icon-animating'), 320);
    }

    let newTheme;
    if (this.ui.theme === 'light') {
        newTheme = 'dark';
    } else if (this.ui.theme === 'dark') {
        newTheme = 'light';
    } else {
        newTheme = 'dark';
    }
    this.applyTheme(newTheme);
};

app.updateThemeToggleIcon = function () {
    const icon = document.getElementById('themeToggleIcon');
    if (!icon) return;

    if (this.ui.theme === 'system') {
        // System icon - monitor with sun/moon
        icon.innerHTML = `
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
        `;
    } else if (this.ui.theme === 'dark') {
        icon.innerHTML = `
            <circle cx="12" cy="12" r="4.2"></circle>
            <line x1="12" y1="3.2" x2="12" y2="1.4"></line>
            <line x1="12" y1="22.6" x2="12" y2="20.8"></line>
            <line x1="4.4" y1="4.4" x2="3.1" y2="3.1"></line>
            <line x1="20.9" y1="20.9" x2="19.6" y2="19.6"></line>
            <line x1="3.2" y1="12" x2="1.4" y2="12"></line>
            <line x1="22.6" y1="12" x2="20.8" y2="12"></line>
            <line x1="4.4" y1="19.6" x2="3.1" y2="20.9"></line>
            <line x1="20.9" y1="3.1" x2="19.6" y2="4.4"></line>
        `;
    } else {
        icon.innerHTML = `
            <path d="
                M 17.5 13.2
                A 6 6 0 0 1 11.0 6.3
                A 6.2 6.2 0 1 0 17.5 13.2
                Z
            "></path>
        `;
    }
};

// ========================================================================
// 9.2 LAYOUT & RESPONSIVE 
// (With Responsive Layout Handling, Mobile View State Management, and Smooth Pane Transition Animations)
// ========================================================================

app.handleResize = function () {
    const nowMobile = window.innerWidth <= 1024;
    if (nowMobile !== this.ui.isMobile) {
        this.ui.isMobile = nowMobile;
        if (!nowMobile) this.ui.mobileView = 'notes';
        else this.ui.mobileView = 'folders';
    }
    this.updateLayout();
};

app.getMobileViewDirection = function (fromView, toView) {
    const map = {
        'folders->notes': 'right',
        'notes->folders': 'left',
        'notes->editor': 'up',
        'editor->notes': 'down',
        'folders->editor': 'up',
        'editor->folders': 'left'
    };

    return map[`${fromView}->${toView}`] || 'up';
};

app.updateLayout = function () {
    const sidebar = document.getElementById('sidebar');
    const notesPane = document.getElementById('notes-list-pane');
    const editorPane = document.getElementById('editor-pane');
    const mobileNav = document.getElementById('mobileNavBar');

    if (!this.ui.isMobile) {
        if (mobileNav) mobileNav.style.display = 'none';
        sidebar.style.display = 'flex';
        notesPane.style.display = 'flex';
        editorPane.style.display = 'flex';

        this.animateEl(sidebar, 'up');
        this.animateEl(notesPane, 'up');
        this.animateEl(editorPane, 'up');
    } else {
        if (mobileNav) mobileNav.style.display = 'flex';

        sidebar.style.display = (this.ui.mobileView === 'folders') ? 'flex' : 'none';
        notesPane.style.display = (this.ui.mobileView === 'notes') ? 'flex' : 'none';
        editorPane.style.display = (this.ui.mobileView === 'editor') ? 'flex' : 'none';

        if (this.ui.mobileView === 'folders') this.animateEl(sidebar, this.ui.mobileViewDirection);
        if (this.ui.mobileView === 'notes') this.animateEl(notesPane, this.ui.mobileViewDirection);
        if (this.ui.mobileView === 'editor') this.animateEl(editorPane, this.ui.mobileViewDirection);

        this.renderMobileNav();
    }

    this.updateMultiSelectUI();
};

app.animateEl = function (el, direction = 'up') {
    if (!el) return;
    el.classList.remove('pane-animated', 'pane-animate-from-top', 'pane-animate-from-bottom', 'pane-animate-from-left', 'pane-animate-from-right');
    void el.offsetWidth;
    el.classList.add('pane-animated', `pane-animate-from-${direction}`);
};

// ========================================================================
// 9.3 MOBILE & VIEW NAVIGATION 
// (With Mobile View State Management, Dynamic Mobile Navigation Rendering, and Smooth Transition Animations)
// ========================================================================

app.goToMobileView = function (view) {
    const previousView = this.ui.mobileView;
    if (previousView === view) return;

    this.ui.mobileViewDirection = this.getMobileViewDirection(previousView, view);
    this.ui.mobileView = view;
    this.updateLayout();
};

app.doneEditingMobile = function () {
    if (!this.ui.isMobile) return;
    if (document.activeElement?.blur) {
        document.activeElement.blur();
    }
    hideSelectionToolbar();
};

function setActiveFolder(id) {
    app.activeFolderId = id;
    app.activeNoteId = null;
    document.getElementById('activeFolderName').innerText =
        id === 'all' ? 'All Notes' : app.folders.find(f => f.id === id)?.name || 'Notes';
    app.renderFolders();
    app.renderNotesList();
    app.renderEditor();
    if (app.ui.isMobile) {
        app.goToMobileView('notes');
    }
}
app.setActiveFolder = setActiveFolder;

// ========================================================================
// 9.4 MULTI-SELECT 
// (With Dynamic UI Updates, Selection Count Display, and Batch Action Support)
// ========================================================================

app.toggleMultiSelect = function () {
    this.ui.multiSelect = !this.ui.multiSelect;
    this.ui.selectedNoteIds = new Set();
    document.getElementById('editNotesBtn').innerHTML = this.ui.multiSelect ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="19" y2="6"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="12" x2="19" y2="12"/><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="18" x2="19" y2="18"/></svg>`;
    this.updateMultiSelectUI();
    this.renderNotesList();

    if (window.AppAnimations) {
        if (this.ui.multiSelect) {
            AppAnimations.animateMultiSelectEnter();
        } else {
            AppAnimations.animateMultiSelectExit();
        }
    }
};

app.toggleNoteSelection = function (noteId) {
    if (this.ui.selectedNoteIds.has(noteId)) {
        this.ui.selectedNoteIds.delete(noteId);
    } else {
        this.ui.selectedNoteIds.add(noteId);
    }
    this.updateMultiSelectUI();
    this.renderNotesList();
};

app.updateMultiSelectUI = function () {
    const bar = document.getElementById('multiSelectBar');
    const label = document.getElementById('selectedCountLabel');
    if (!this.ui.multiSelect) {
        bar.classList.remove('show');
        label.innerText = '0 Selected';
        return;
    }
    const count = this.ui.selectedNoteIds.size;
    bar.classList.add('show');
    label.innerText = `${count} Selected`;
};

// ========================================================================
// 9.5 UTILITIES 
// (With Notes Count Display, Search Handling, and Account UI Updates)
// ========================================================================

app.updateNotesCount = function () {
    const countEl = document.getElementById('notesCountDisplay');
    let count = 0;
    if (this.activeFolderId === 'all') {
        count = this.notes.length;
    } else {
        count = this.notes.filter(n => n.folder_id === this.activeFolderId).length;
    }
    countEl.innerText = `${count} Note${count !== 1 ? 's' : ''}`;
};

app.handleSearch = function (val) {
    this.searchQuery = val;
    this.renderNotesList();

    const results = document.querySelectorAll('.note-item');
    if (results.length > 0) {
        results.forEach((el, index) => {
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = `listItemSlideIn 0.26s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${index * 18}ms both`;
        });
    }
};

async function updateAccountUI() {
    const user = app.currentUser;
    if (!user) return;

    const name = (user.name || '').trim() || (user.email || '');
    const email = (user.email || '').trim();

    const nameEl = document.getElementById('accountDisplayName');
    const emailEl = document.getElementById('accountEmail');
    const smallAvatarSpan = document.getElementById('accountAvatarInitials');
    const largeAvatarSpan = document.getElementById('accountInitialsLg');
    const smallAvatarDiv = document.querySelector('.account-avatar-pill');
    const largeAvatarDiv = document.querySelector('.account-avatar-lg');

    if (nameEl) nameEl.textContent = name || 'User';
    if (emailEl) emailEl.textContent = email || '';

    const baseForInitials = (name || email || '').trim();
    let initials = 'U';
    if (baseForInitials) {
        initials = baseForInitials
            .split('@')[0]
            .split(/[ ._-]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part.charAt(0).toUpperCase())
            .join('') || 'U';
    }

    try {
        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('avatar_mode, avatar_emoji, avatar_gradient_index')
            .eq('id', user.id)
            .single();

        if (!error && profile) {
            const mode = profile.avatar_mode || 'initials';
            const emoji = profile.avatar_emoji;
            const gradientIndex = profile.avatar_gradient_index;

            if (mode === 'emoji' && emoji) {
                if (smallAvatarSpan) smallAvatarSpan.textContent = emoji;
                if (largeAvatarSpan) largeAvatarSpan.textContent = emoji;
            } else {
                if (smallAvatarSpan) smallAvatarSpan.textContent = initials;
                if (largeAvatarSpan) largeAvatarSpan.textContent = initials;
            }

            if (gradientIndex !== null && gradientIndex !== undefined) {
                const gradient = window.AdvancedAvatarGenerator?.colorPalettes[gradientIndex];
                if (gradient) {
                    const gradientCSS = `linear-gradient(135deg, ${gradient.start}, ${gradient.end})`;
                    if (largeAvatarDiv) largeAvatarDiv.style.background = gradientCSS;
                }
            }
        } else {
            if (smallAvatarSpan) smallAvatarSpan.textContent = initials;
            if (largeAvatarSpan) largeAvatarSpan.textContent = initials;
        }
    } catch (err) {
        console.warn('Avatar update error:', err);
        if (smallAvatarSpan) smallAvatarSpan.textContent = initials;
        if (largeAvatarSpan) largeAvatarSpan.textContent = initials;
    }
}

app.updateAccountUI = updateAccountUI;

// ============================================================================
// 10. SHARE & EXPORT FUNCTIONS 
// (With HTML to Text Conversion, Clipboard Copying, System Sharing Integration, and PDF Generation with jsPDF)
// ============================================================================

// Shared helper — call instead of Utils.stripHtml for sharing/export
Utils.formatNoteAsText = function (content) {
    const withBreaks = (content || '')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n');

    const stripped = withBreaks.replace(/<[^>]+>/g, '');

    // Decode HTML entities (&times;, &amp;, etc.)
    const ta = document.createElement('textarea');
    ta.innerHTML = stripped;

    return ta.value
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n');
};

app.shareCopy = function () {
    const note = this.getActiveNote();
    if (!note) return;
    const text = (note.title || '') + '\n\n' + Utils.formatNoteAsText(note.content);
    navigator.clipboard.writeText(text)
        .then(() => { alert('Note copied to clipboard'); })
        .catch(() => { alert('Copy failed'); });
    this.closeDropdown('shareDropdown');
};

app.systemShare = function () {
    const note = this.getActiveNote();
    if (!note) return;
    const text = (note.title || '') + '\n\n' + Utils.formatNoteAsText(note.content);
    if (navigator.share) {
        navigator.share({ title: note.title || '', text }).catch(() => { });
    } else {
        this.shareCopy();
    }
    this.closeDropdown('shareDropdown');
};

app.exportTXT = function () {
    const note = this.getActiveNote();
    if (!note) return;
    const text = (note.title || '') + '\n\n' + Utils.formatNoteAsText(note.content);
    const filename = Utils.sanitizeFilename(note.title || 'note') + '.txt';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.closeDropdown('shareDropdown');
};

app.exportPDF = async function () {
    const note = this.getActiveNote();
    if (!note) return;

    const title = note.title || 'Note';
    const filename = Utils.sanitizeFilename(title) + '.pdf';

    if (!window.jspdf || !window.jspdf.jsPDF) {
        console.error('jsPDF is not loaded (window.jspdf missing)');
        alert('PDF export is unavailable: the jsPDF library failed to load.');
        this.closeDropdown('shareDropdown');
        return;
    }

    const fetchImageAsDataUrl = async (src) => {
        if (!src) return null;
        if (src.startsWith('data:')) return src;

        try {
            const response = await fetch(src, { mode: 'cors' });
            if (!response.ok) return null;
            const blob = await response.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.warn('[PDF Export] Unable to fetch image:', src, err);
            return null;
        }
    };

    // addImageToPdf will be declared inside the PDF generation `try` block
    // so it can access layout variables (`doc`, `maxWidth`, `pageHeight`, `margin`, `bottomEdge`, `y`).

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 60;
        const footerText = 'Created on <a href="https://notoz.netlify.app/">NOTOZ</a>';
        const footerHeight = 15;
        const footerY = pageHeight - 12;
        const maxWidth = pageWidth - margin * 2;
        const bottomEdge = pageHeight - margin - footerHeight;
        let y = margin;

        const arrayBufferToBase64 = (buffer) => {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            return window.btoa(binary);
        };

        const footerFontName = 'NDot57';
        const footerFontFile = 'Ndot-57-Aligned.otf';
        const footerFontUrl = new URL('./src/assets/fonts/Ndot-57-Aligned.otf', window.location.href).href;
        const notozLink = 'https://notoz.netlify.app';

        const renderFooter = () => {
            const fullText = 'Created on NOTOZ';
            
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            
            // Render full footer text centered
            const textWidth = doc.getTextWidth(fullText);
            const textX = (pageWidth - textWidth) / 2;
            
            doc.text(fullText, textX, footerY);
            
            // Add clickable link area around "NOTOZ" part
            // Calculate position of "NOTOZ" within the full text
            const prefixText = 'Created on ';
            const prefixWidth = doc.getTextWidth(prefixText);
            const notozWidth = doc.getTextWidth('NOTOZ');
            const notozX = textX + prefixWidth;
            
            // Create clickable area for NOTOZ
            const linkHeight = 2.5;
            doc.link(notozX, footerY - linkHeight, notozWidth, linkHeight * 2, { url: notozLink });
        };

        const checkPage = (lineHeight) => {
            if (y + lineHeight > bottomEdge) {
                renderFooter();
                doc.addPage();
                y = margin;
            }
        };

        const addImageToPdf = async (src) => {
            const dataUrl = await fetchImageAsDataUrl(src);
            if (!dataUrl) return false;

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = dataUrl;

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            const imgMaxWidth = maxWidth;
            const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
            let displayWidth = Math.min(img.naturalWidth || imgMaxWidth, imgMaxWidth);
            let displayHeight = displayWidth / ratio;

            if (displayHeight > pageHeight - margin - y) {
                displayHeight = pageHeight - margin - y;
                displayWidth = displayHeight * ratio;
            }

            if (y + displayHeight > bottomEdge) {
                doc.addPage();
                y = margin;
            }

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx2 = canvas.getContext('2d');
            ctx2.drawImage(img, 0, 0);
            const pngDataUrl = canvas.toDataURL('image/png');

            doc.addImage(pngDataUrl, 'PNG', margin, y, displayWidth, displayHeight);
            y += displayHeight + 8;
            return true;
        };

        const renderText = (text, { fontSize, bold, italic, indent = 0 }) => {
            const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
            doc.setFont('helvetica', style);
            doc.setFontSize(fontSize);
            const lineHeight = fontSize * 1.4;
            const lines = doc.splitTextToSize(text.trim(), maxWidth - indent);
            lines.forEach(line => {
                checkPage(lineHeight);
                doc.text(line, margin + indent, y);
                y += lineHeight;
            });
        };

        const walkNode = async (node, ctx) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.replace(/\s+/g, ' ');
                if (text.trim()) renderText(text, ctx);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName.toLowerCase();
            let newCtx = { ...ctx };

            switch (tag) {
                case 'h1': newCtx = { ...ctx, fontSize: 18, bold: true }; break;
                case 'h2': newCtx = { ...ctx, fontSize: 16, bold: true }; break;
                case 'h3': newCtx = { ...ctx, fontSize: 14, bold: true }; break;
                case 'h4':
                case 'h5':
                case 'h6': newCtx = { ...ctx, fontSize: 12, bold: true }; break;
                case 'strong':
                case 'b': newCtx = { ...ctx, bold: true }; break;
                case 'em':
                case 'i': newCtx = { ...ctx, italic: true }; break;
                case 'li': newCtx = { ...ctx, indent: (ctx.indent || 0) + 16 }; break;
            }

            if (tag === 'img') {
                const src = node.getAttribute('src');
                if (!(await addImageToPdf(src))) {
                    renderText('[Image could not be loaded]', newCtx);
                }
                return;
            }

            const blockTags = new Set(['p','div','h1','h2','h3','h4','h5','h6','li','ul','ol','blockquote','pre']);
            if (blockTags.has(tag)) y += 4;

            if (tag === 'li') {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(newCtx.fontSize);
                checkPage(newCtx.fontSize * 1.4);
                doc.text('•', margin + (ctx.indent || 0), y);
            }

            for (const child of node.childNodes) {
                await walkNode(child, newCtx);
            }

            if (blockTags.has(tag)) y += 4;
        };

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.splitTextToSize(title, maxWidth).forEach(l => {
            checkPage(28);
            doc.text(l, margin, y);
            y += 28;
        });
        y += 8;
        doc.setDrawColor(180);
        doc.line(margin, y, pageWidth - margin, y);
        y += 20;

        const container = document.createElement('div');
        container.innerHTML = note.content || '';
        const baseCtx = { fontSize: 11, bold: false, italic: false, indent: 0 };

        for (const node of container.childNodes) {
            await walkNode(node, baseCtx);
        }

        renderFooter();
        const pdfBlob = doc.output('blob');

        const downloadPdfBlob = async (blob) => {
            const reader = new FileReader();
            const base64Data = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            const payload = {
                data: base64Data,
                filename,
                mimeType: 'application/pdf'
            };

            if (window.MedianJsBridge?.downloadFile) {
                window.MedianJsBridge.downloadFile(payload);
                return;
            }
            if (window.median?.nativebridge?.downloadFile) {
                window.median.nativebridge.downloadFile(payload);
                return;
            }
            if (window.median?.nativebridge?.saveFile) {
                window.median.nativebridge.saveFile(payload);
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        await downloadPdfBlob(pdfBlob);
    } catch (err) {
        console.error('Export PDF failed', err);
        alert('Export to PDF failed: ' + (err && err.message ? err.message : 'Unknown error'));
    }

    this.closeDropdown('shareDropdown');
};

// ============================================================================
// 11. SELECTION TOOLBAR & TEXT FORMATTING 
// (With Dynamic Toolbar Positioning, Text Formatting Commands, and Custom Highlighting Functionality)
// ============================================================================

const selectionToolbar = document.getElementById('selectionToolbar');
const noteContentEl = document.getElementById('noteContentInput');
const HIGHLIGHT_HEX = getComputedStyle(document.documentElement)
    .getPropertyValue('--highlight-color').trim() || '#fff3a0';

function hexToRgbString(hex) {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return null;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
}

function getSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return null;
    return rects[0];
}

function showSelectionToolbar() {
    const rect = getSelectionRect();
    if (!rect) { hideSelectionToolbar(); return; }
    selectionToolbar.style.display = 'flex';
    const toolbarRect = selectionToolbar.getBoundingClientRect();
    let top = rect.top - toolbarRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    let left = rect.left + (rect.width / 2) - (toolbarRect.width / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarRect.width - 8));
    selectionToolbar.style.top = `${top + window.scrollY}px`;
    selectionToolbar.style.left = `${left + window.scrollX}px`;
}

function hideSelectionToolbar() {
    selectionToolbar.style.display = 'none';
}

function selectionCommand(cmd) {
    document.execCommand(cmd, false, null);
    noteContentEl.focus();
    app.updateCurrentNote();
}

function selectionCopy() {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (!text) return;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => { document.execCommand('copy'); });
    } else {
        document.execCommand('copy');
    }
}

function selectionPaste() {
    noteContentEl.focus();
    if (navigator.clipboard?.readText) {
        navigator.clipboard.readText()
            .then(text => {
                if (!text) return;
                document.execCommand('insertText', false, text);
                app.updateCurrentNote();
            })
            .catch(() => {
                document.execCommand('paste');
                app.updateCurrentNote();
            });
    } else {
        document.execCommand('paste');
        app.updateCurrentNote();
    }
    hideSelectionToolbar();
}

function hexToRgbString(hex) {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return null;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
}

function isSelectionHighlighted() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

    const range = sel.getRangeAt(0);
    const hlRgb = hexToRgbString(HIGHLIGHT_HEX);
    if (!hlRgb) return false;

    // Walk every text node in the selection and check its background
    const treeWalker = document.createTreeWalker(
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentNode
            : range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                return range.intersectsNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );

    let hasText = false;
    let node;
    while ((node = treeWalker.nextNode())) {
        if (!node.textContent.trim()) continue;
        hasText = true;
        const bg = window.getComputedStyle(node.parentElement).backgroundColor;
        // Normalize spaces before comparing
        if (bg.replace(/\s/g, '') !== hlRgb.replace(/\s/g, '')) return false;
    }

    return hasText;
}

function toggleHighlight() {
    const alreadyHighlighted = isSelectionHighlighted();

    if (alreadyHighlighted) {
        document.execCommand('backColor', false, 'transparent');
        document.execCommand('hiliteColor', false, 'transparent');
    } else {
        document.execCommand('backColor', false, HIGHLIGHT_HEX);
        document.execCommand('hiliteColor', false, HIGHLIGHT_HEX);
    }

    noteContentEl.focus();
    app.updateCurrentNote();
}

function setSelectionColor(color) {
    document.execCommand('foreColor', false, color);
    noteContentEl.focus();
    app.updateCurrentNote();
}

if (noteContentEl) {
    noteContentEl.addEventListener('mouseup', () => {
        setTimeout(() => {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && noteContentEl.contains(sel.anchorNode)) {
                showSelectionToolbar();
            } else {
                hideSelectionToolbar();
            }
        }, 0);
    });

    noteContentEl.addEventListener('keyup', (e) => {
        if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && noteContentEl.contains(sel.anchorNode)) {
                showSelectionToolbar();
            } else {
                hideSelectionToolbar();
            }
        } else {
            hideSelectionToolbar();
        }
    });

    noteContentEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        setTimeout(() => {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && noteContentEl.contains(sel.anchorNode)) {
                showSelectionToolbar();
            }
        }, 0);
    });
}

document.addEventListener('mousedown', (e) => {
    if (selectionToolbar && noteContentEl) {
        if (!selectionToolbar.contains(e.target) && !noteContentEl.contains(e.target)) {
            hideSelectionToolbar();
        }
    }
});

// ============================================================================
// 12. NAVIGATION & INITIALIZATION 
// (With Android Back Button Handling, Mobile View State Management, and Responsive Layout Handling)
// ============================================================================

function navigateToSettings() {
    window.location.href = 'settings.html';
}

// Handle window resize / viewport height for mobile


// ============================================================================
// 13. ANDROID BACK BUTTON HANDLER 
// (With Priority-Ordered Interception of Back Presses, Mobile View Navigation Handling, and Fallbacks for Different Environments)
// ============================================================================

// ============================================================================
// LOADING STATE MANAGEMENT
// (Skeleton Screens, Progress Bars, and Smooth Transitions)
// ============================================================================

app.loading = {
    container: null,
    progress: null,

    init() {
        this.container = document.getElementById('loadingContainer');
        this.progress = document.getElementById('loadingProgress');
    },

    show() {
        if (this.container) {
            this.container.classList.remove('fade-out');
            this.container.style.display = 'flex';
        }
    },

    hide() {
        if (this.container) {
            this.container.classList.add('fade-out');
            setTimeout(() => {
                this.container.style.display = 'none';
            }, 300);
        }
    },

    setProgress(percent) {
        if (this.progress) {
            this.progress.style.width = percent + '%';
        }
    },

    startProgress() {
        if (this.progress) {
            this.progress.classList.add('animate');
        }
    },

    stopProgress() {
        if (this.progress) {
            this.progress.classList.remove('animate');
        }
    }
};

// Initialize loading on app start
app.loading.init();

const BackHandler = {
    intercept() {
        // ── Priority 1: Close any open dialog first ──────────────────────
        const dialog = document.getElementById('appDialogOverlay');
        if (dialog?.classList.contains('show')) {
            AppDialog.close();
            return true;
        }

        // ── Priority 2: Close any open dropdown or context menu ──────────
        const openMenus = [
            'shareDropdown',
            'textStyleDropdown',
            'noteActionsMenu',
            'folderActionsMenu',
            'accountDropdown',
            'viewOptionsMenu'
        ];
        for (const menuId of openMenus) {
            const el = document.getElementById(menuId);
            if (el?.classList.contains('open')) {
                app.closeDropdown(menuId);
                return true;
            }
        }

        // ── Priority 3: Hide selection toolbar if visible ────────────────
        const selToolbar = document.getElementById('selectionToolbar');
        if (selToolbar?.style.display === 'flex') {
            hideSelectionToolbar();
            return true;
        }

        // ── Priority 4: Exit multi-select mode ───────────────────────────
        if (app.ui.multiSelect) {
            app.toggleMultiSelect();
            return true;
        }

        // ── Priority 5: Mobile view navigation ───────────────────────────
        if (app.ui.isMobile) {
            if (app.ui.mobileView === 'editor') {
                app.goToMobileView('notes');   // editor → notes list
                return true;
            }
            if (app.ui.mobileView === 'notes') {
                app.goToMobileView('folders'); // notes list → folders
                return true;
            }
            // folders → exit app (falls through, OS handles)
            return false;
        }

        // ── Desktop: nothing to intercept ────────────────────────────────
        return false;
    },

    init() {
        // ── Method 1: Median.co gonative bridge ──────────────────────────
        // Median calls window.gonative_back_pressed() when back is pressed
        window.gonative_back_pressed = () => {
            const intercepted = this.intercept();
            if (!intercepted && window.median?.nativebridge) {
                // Tell Median to proceed with default back (exit app)
                median.nativebridge.exitApp?.();
            }
            // returning false tells Median we handled it
            return !intercepted;
        };

        // ── Method 2: Median newer API ───────────────────────────────────
        if (window.median?.onBackPressed !== undefined) {
            median.onBackPressed = () => {
                return this.intercept(); // true = we handled it, false = let OS handle
            };
        }

        // ── Method 3: History API fallback (popstate) ────────────────────
        // Push a dummy state so we have something to catch
        history.pushState({ notozApp: true }, '');

        window.addEventListener('popstate', (e) => {
            const intercepted = this.intercept();
            if (intercepted) {
                // Re-push the dummy state so next back press is also caught
                history.pushState({ notozApp: true }, '');
            }
            // If not intercepted, popstate fires naturally → browser/OS handles exit
        });

        // ── Method 4: Physical keyboard back key (some Android keyboards) ─
        document.addEventListener('keydown', (e) => {
            if (e.key === 'BrowserBack' || e.keyCode === 166) {
                const intercepted = this.intercept();
                if (intercepted) e.preventDefault();
            }
        });
    }
};

// ============================================================================
// LOAD NOTES (OVERRIDE)
// ============================================================================

app.loadNotes = async function () {

console.log('[Startup] IndexedDB-first loading');

try {

    const localNotes = await getNotesOffline(CURRENT_USER_ID);

    if (localNotes && localNotes.length > 0) {

        this.notes = localNotes.sort((a, b) =>
            new Date(b.updated_at || 0) -
            new Date(a.updated_at || 0)
        );

        console.log(`[Startup] Loaded ${this.notes.length} local notes`);

        this.renderNotesList(false);
        this.renderEditor();
        this.updateNotesCount();

        await this.decryptNotesInBackground(); // decrypts all, patches list items as it goes

    } else {

        this.notes = [];
    }

} catch (err) {

    console.error('[IndexedDB] Failed:', err);
    this.notes = [];
}

if (isOnline()) {
    this.syncNotesFromServer();
}

};

// ============================================================================
// BACKGROUND SYNC
// ============================================================================

app.syncNotesFromServer = async function () {

console.log('[Sync] Starting background sync');

const { data, error } = await supabaseClient
    .from(NOTES_TABLE)
    .select('*')
    .eq('user_id', CURRENT_USER_ID)
    .order('updated_at', { ascending: false });

if (error || !data) {

    console.error('[Sync] Failed:', error);
    return;
}

await this.mergeServerNotes(data);

console.log('[Sync] Finished');

};

// ============================================================================
// MERGE SERVER NOTES
// ============================================================================

app.mergeServerNotes = async function (serverNotes) {

if (!serverNotes || !serverNotes.length) return;

const localMap = new Map(
    this.notes.map(note => [note.id, note])
);

let added = 0;
let updated = 0;

for (const serverNote of serverNotes) {

    const localNote = localMap.get(serverNote.id);

    // =====================================================
    // NEW NOTE
    // =====================================================

    if (!localNote) {

        this.notes.unshift(serverNote);

        await this.saveSingleNoteToIndexedDB(serverNote);

        this.insertSingleNoteIntoUI(serverNote);

        this.queueNoteDecrypt(serverNote);

        added++;
        continue;
    }

    // =====================================================
    // UPDATED NOTE
    // =====================================================

    const serverTime = new Date(serverNote.updated_at || 0).getTime();
    const localTime = new Date(localNote.updated_at || 0).getTime();

    if (serverTime > localTime) {
        _decryptCache.delete(serverNote.id);        // bust stale session cache
        Object.assign(localNote, serverNote);
        localNote._decrypted = false;                // ciphertext just landed, flag it
        localNote._previewDecrypted = false;
        
        await this.saveSingleNoteToIndexedDB(serverNote);
        this.updateNoteItemInList(serverNote.id);      // shows '...' placeholder correctly now

        if (this.activeNoteId === serverNote.id) {
            await DecryptQueue.priorityFull(serverNote.id); // full decrypt, not just preview
            this.renderEditor();
        } else {
            DecryptQueue.queuePreview(serverNote.id);
        }
        
        updated++;
    }
}

console.log(`[Sync] Added ${added}, Updated ${updated}`);

};

// ============================================================================
// SAVE SINGLE NOTE TO INDEXEDDB
// ============================================================================

app.saveSingleNoteToIndexedDB = async function (note) {

    const noteToStore = { ...note };

    if (note.title && !note.title.startsWith('enc:')) {
        noteToStore.title = await _fastEncrypt(note.title);
    }
    if (note.content && !note.content.startsWith('enc:')) {
        noteToStore.content = await _fastEncrypt(note.content);
    }

    return new Promise((resolve, reject) => {

        try {

            if (!db) {
                reject('IndexedDB unavailable');
                return;
            }

            const tx = db.transaction([STORES.notes], 'readwrite');
            const store = tx.objectStore(STORES.notes);

            store.put({
                ...noteToStore,
                synced: true,
                offline: false
            });

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);

        } catch (err) {

            reject(err);
        }
    });

};

// ============================================================================
// DECRYPT ONLY VISIBLE NOTES
// ============================================================================

app.decryptVisibleNotesOnly = async function () {

    // Wait for master key to be available before queuing
    const key = await getSessionMasterKey();
    if (!key) {
        console.warn('[Decrypt] Master key not ready, retrying in 300ms');
        setTimeout(() => this.decryptVisibleNotesOnly(), 300);
        return;
    }

    const notes = this.getNotesToDisplay().slice(0, 15);
    for (const note of notes) {
        if (!note._decrypted) {
            DecryptQueue.queuePreview(note.id);
        }
    }

    if (this.activeNoteId) {
        await DecryptQueue.priorityFull(this.activeNoteId);
    }

};

// ============================================================================
// QUEUE NOTE DECRYPT
// ============================================================================

app.queueNoteDecrypt = function (note) {

if (!note) return;

const encrypted =
    note.title?.startsWith('enc:') ||
    note.content?.startsWith('enc:');

if (!encrypted) return;

DecryptQueue.queuePreview(note.id);

};

// ============================================================================
// INSERT SINGLE NOTE INTO UI
// ============================================================================

app.insertSingleNoteIntoUI = function (note) {

const container = document.getElementById('notesListContainer');

if (!container) return;

const existing = document.querySelector(
    `[data-note-id="${note.id}"]`
);

if (existing) return;

const el = document.createElement('div');

el.className = 'note-item';
el.setAttribute('data-note-id', note.id);

el.innerHTML = `
    <div class="note-main">
        <div class="note-title">...</div>
        <div class="note-preview">...</div>
    </div>
`;

el.onclick = () => {
    this.activeNoteId = note.id;
    this.renderNotesList();
    this.renderEditor();
};

container.prepend(el);

this.updateNoteItemInList(note.id);

};

// ============================================================================
// REMOVE NOTE FROM UI
// ============================================================================

app.removeNoteFromUI = function (noteId) {

this.notes = this.notes.filter(n => n.id !== noteId);

const el = document.querySelector(
    `[data-note-id="${noteId}"]`
);

if (el) {
    el.remove();
}

if (this.activeNoteId === noteId) {
    this.activeNoteId = null;
    this.renderEditor();
}

this.updateNotesCount();

};

// ============================================================================
// REALTIME PATCH SYSTEM
// ============================================================================

app.initializeRealtimeSync = function () {

if (!CURRENT_USER_ID) return;

supabaseClient
    .channel('notes-realtime')
    .on(
        'postgres_changes',
        {
            event: '*',
            schema: 'public',
            table: NOTES_TABLE,
            filter: `user_id=eq.${CURRENT_USER_ID}`
        },
        async (payload) => {

            console.log('[Realtime]', payload.eventType);

            switch (payload.eventType) {

                case 'INSERT':
                    await this.mergeServerNotes([
                        payload.new
                    ]);
                    break;

                case 'UPDATE':
                    await this.mergeServerNotes([
                        payload.new
                    ]);
                    break;

                case 'DELETE':
                    this.removeNoteFromUI(
                        payload.old.id
                    );
                    break;
            }
        }
    )
    .subscribe();

};

// ============================================================================
// PATCH updateCurrentNote
// ============================================================================

const _originalUpdateCurrentNote = app.updateCurrentNote;

app.updateCurrentNote = async function () {

const note = this.getActiveNote();

if (!note) return;

await this.saveSingleNoteToIndexedDB({
    ...note,
    user_id: CURRENT_USER_ID
});

return _originalUpdateCurrentNote.apply(this, arguments);

};

document.addEventListener('DOMContentLoaded', function() {
    // Check if running inside the Median wrapper
    if (navigator.userAgent.indexOf('median') > -1) {
        
        // 1. Force the Navigation Bar to be transparent
        median.android.navigationBar.set({
            'color': '00000000', // Hex with 00 alpha for transparency
            'style': 'dark'      // 'dark' for white icons, 'light' for black
        });

        // 2. Optional: Sync the Status Bar to be sure
        median.statusbar.set({
            'overlay': true,
            'color': '00000000'
        });
    }
});

// ============================================================================
// PATCH INIT
// ============================================================================

const _originalInit = app.init;

app.init = async function () {

await _originalInit.apply(this, arguments);

this.initializeRealtimeSync();

// Handle shortcut URL parameters (e.g., ?action=new-note)
this.handleActionParams();

};

/**
 * Handle URL action parameters from shortcuts.
 * Detects ?action=new-note and triggers creating a new note,
 * then cleans up the URL to prevent re-triggering on refresh.
 */
app.handleActionParams = function () {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');

    if (action === 'new-note') {
        // Small delay to ensure app is fully initialized
        setTimeout(() => {
            this.createNewNote();
        }, 500);

        // Clean up the URL without reloading the page
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
};

// Initialize app
app.init();

// ============================================================================
// DONE
// ============================================================================