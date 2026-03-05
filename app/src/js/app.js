// ============================================================================
// PROJECT SCORPIO - NOTES APP
// ============================================================================

// ============================================================================
// 1. CONFIGURATION & INITIALIZATION
// ============================================================================

const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';

const NOTES_TABLE = 'notes';
const FOLDERS_TABLE = 'folders';

let CURRENT_USER_ID = null;

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
// 2. UTILITY FUNCTIONS
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
// 3. CRYPTOGRAPHY & ENCRYPTION HELPERS
// ============================================================================

function _b64Encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _b64Decode(str) {
    const bin = atob(str || '');
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

async function deriveKeyFromPassword(password, salt = 'notesapp_v1_salt') {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 200000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

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

function setLocalMasterKeyBytes(bytes) {
    localStorage.setItem('notes_master_key', _b64Encode(bytes));
}

function getLocalMasterKeyBytes() {
    const b64 = localStorage.getItem('notes_master_key');
    return b64 ? _b64Decode(b64) : null;
}

async function encryptWithMasterKey(plaintext) {
    if (!plaintext) return '';
    const mk = getLocalMasterKeyBytes();
    if (!mk) throw new Error('Master key not available locally.');
    const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return `enc:${_b64Encode(iv)}:${_b64Encode(ct)}`;
}

async function decryptWithMasterKey(stored) {
    if (!stored) return '';
    if (!stored.startsWith('enc:')) return stored;
    const mk = getLocalMasterKeyBytes();
    if (!mk) return stored;
    const [, ivB64, ctB64] = stored.split(':');
    const iv = _b64Decode(ivB64);
    const ct = _b64Decode(ctB64);
    const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
}

// ============================================================================
// 3.1 UNDO/REDO HISTORY MANAGER
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
// 4. DIALOG CONTROLLER
// ============================================================================

const AppDialog = {
    overlay: document.getElementById('appDialogOverlay'),
    titleEl: document.getElementById('dialogTitle'),
    msgEl: document.getElementById('dialogMessage'),
    inputEl: document.getElementById('dialogInput'),
    cancelBtn: document.getElementById('dialogCancelBtn'),
    confirmBtn: document.getElementById('dialogConfirmBtn'),
    currentOptions: null,

    open(opts) {
        this.currentOptions = opts || {};
        this.titleEl.textContent = opts.title || '';

        if (opts.message) {
            this.msgEl.textContent = opts.message;
            this.msgEl.style.display = 'block';
        } else {
            this.msgEl.style.display = 'none';
        }

        if (opts.showInput) {
            this.inputEl.style.display = 'block';
            this.inputEl.placeholder = opts.placeholder || '';
            this.inputEl.value = opts.defaultValue || '';
            setTimeout(() => this.inputEl.focus(), 10);
        } else {
            this.inputEl.style.display = 'none';
            this.inputEl.value = '';
        }

        this.confirmBtn.textContent = opts.confirmLabel || 'OK';
        if (opts.destructive) {
            this.confirmBtn.classList.add('destructive');
        } else {
            this.confirmBtn.classList.remove('destructive');
        }

        this.overlay.classList.add('show');
    },

    close() {
        this.overlay.classList.remove('show');
        this.currentOptions = null;
    },

    init() {
        if (!this.overlay) return;

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
// 5. MAIN APP OBJECT - STATE & CORE
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
        theme: 'light',
        multiSelect: false,
        selectedNoteIds: new Set(),
        undoRedoManager: null,
        lastSavedState: null,
        debounceTimer: null,
        debounceDelay: 500
    },

    // ========================================================================
    // 5.1 INITIALIZATION & AUTHENTICATION
    // ========================================================================

    async init() {
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
        const savedTheme = localStorage.getItem('notesApp_theme');
        const theme = savedTheme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        this.applyTheme(theme);

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
    },

    async handleLogout() {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
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
    // 5.2 DATA LOADING
    // ========================================================================

    async loadFolders() {
        // Folders are small — cache them in localStorage for offline use
        if (!isOnline()) {
            try {
                const cached = localStorage.getItem('notesApp_folders_' + CURRENT_USER_ID);
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
                const cached = localStorage.getItem('notesApp_folders_' + CURRENT_USER_ID);
                this.folders = cached ? JSON.parse(cached) : [];
            } catch (e) {
                this.folders = [];
            }
            return;
        }

        this.folders = data || [];
        // Mirror folders to localStorage for offline access
        try {
            localStorage.setItem('notesApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
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
                    if (note.title?.startsWith('enc:')) {
                        note.title = await decryptWithMasterKey(note.title);
                    }
                    if (note.content?.startsWith('enc:')) {
                        note.content = await decryptWithMasterKey(note.content);
                    }
                    note._decrypted = true;
                    this.updateNoteItemInList(note.id);
                } catch (e) {
                    console.error('[Decrypt] Failed for note:', note.id, e);
                }
            }));

            // Yield to browser between batches to keep UI responsive
            await new Promise(r => setTimeout(r, 0));
        }
    },

    // ========================================================================
    // 5.3 NOTES CRUD OPERATIONS
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
                    this.ui.mobileView = 'editor';
                    this.updateLayout();
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
            this.ui.mobileView = 'editor';
            this.updateLayout();
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
    // 5.4 FOLDER CRUD OPERATIONS
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
                        localStorage.setItem('notesApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
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
                        localStorage.setItem('notesApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
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
                    localStorage.setItem('notesApp_folders_' + CURRENT_USER_ID, JSON.stringify(this.folders));
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
// 6. RENDERING FUNCTIONS
// ============================================================================

// ========================================================================
// 6.1 RENDER NOTES & FOLDERS
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
                    this.ui.mobileView = 'editor';
                    this.updateLayout();
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
// 6.2 RENDER EDITOR & MOBILE NAV
// ========================================================================

app.renderEditor = function () {
    const emptyState = document.getElementById('editorEmptyState');
    const container = document.getElementById('editorContainer');
    const titleInput = document.getElementById('noteTitleInput');
    const contentInput = document.getElementById('noteContentInput');
    const inputArea = document.getElementById('editorInputArea');
    const pinBtn = document.getElementById('pinBtn');

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
                contentInput.innerHTML = decrypted;
                this.updateNoteItemInList(note.id);
            }).catch(e => {
                console.error('[Decrypt] On-demand decryption failed:', e);
            });
        } else {
            contentInput.innerHTML = note.content || '';
        }
    }

    inputArea.className = 'editor-inputs';
    if (note.paper_style) inputArea.classList.add(`style-${note.paper_style}`);

    document.getElementById('editorDateDisplay').innerText = Utils.formatDateTime(note.updated_at);

    pinBtn.querySelector('svg').style.fill = note.pinned ? 'var(--accent-color)' : 'none';
    pinBtn.querySelector('svg').style.stroke = note.pinned ? 'var(--accent-color)' : '#666';

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
        bar.innerHTML = `
            <div class="mobile-nav-left"></div>
            <div class="mobile-nav-title">Folders</div>
            <div class="mobile-nav-right"></div>
        `;
    } else if (this.ui.mobileView === 'notes') {
        bar.innerHTML = `
            <div class="mobile-nav-left">
                <button class="mobile-nav-back" onclick="app.goToMobileView('folders')">
                    <span class="mobile-nav-back-chev"></span>
                    <span>Folders</span>
                </button>
            </div>
            <div class="mobile-nav-title">${Utils.escapeHtml(folderName)}</div>
            <div class="mobile-nav-right"></div>
        `;
    } else if (this.ui.mobileView === 'editor') {
        const note = this.getActiveNote();
        const title = note?.title || 'New Note';
        bar.innerHTML = `
            <div class="mobile-nav-left">
                <button class="mobile-nav-back" onclick="app.goToMobileView('notes')">
                    <span class="mobile-nav-back-chev"></span>
                    <span>Notes</span>
                </button>
            </div>
            <div class="mobile-nav-title">${Utils.escapeHtml(title)}</div>
            <div class="mobile-nav-right">
                <button class="mobile-nav-text-btn" onclick="app.doneEditingMobile()">Done</button>
            </div>
        `;
    }
};

// ============================================================================
// 7. EDITOR & FORMATTING FUNCTIONS
// ============================================================================

// ========================================================================
// 7.1 TEXT FORMATTING & CHECKBOXES
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
        .from('note-images')                        // 🔁 change 'note-images' to your bucket name
        .upload(filename, blob, {
            contentType: mimeType,
            cacheControl: '31536000',               // cache for 1 year
            upsert: false
        });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data: urlData } = supabaseClient.storage
        .from('note-images')
        .getPublicUrl(data.path);

    return urlData.publicUrl;
}

// ── Main handler ─────────────────────────────────────────────────────────
app.handleImageFile = async function (input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const MAX_RAW_SIZE = 20 * 1024 * 1024; // 20MB raw cap before any processing

    if (file.size > MAX_RAW_SIZE) {
        alert(`File is too large. Maximum allowed is 20MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`);
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
        const imgHtml = `<img src="${imageUrl}" style="max-width:100%;border-radius:6px;" /><div><br></div>`;

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
    if (contentInput) contentInput.innerHTML = previousState.content;
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
    if (contentInput) contentInput.innerHTML = nextState.content;
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
// 8. DROPDOWN & MENU FUNCTIONS
// ============================================================================

app.toggleDropdown = function (e, dropdownId, triggerId) {
    e.stopPropagation();
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    if (!dropdown || !trigger) return;

    const isOpen = dropdown.classList.contains('open');
    this.closeDropdown(dropdownId);
    if (!isOpen) {
        const rect = trigger.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 8) + 'px';
        dropdown.style.left = Math.max(8, rect.left - 40) + 'px';
        dropdown.classList.add('open');
    }
};

app.closeDropdown = function (dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) dropdown.classList.remove('open');
};

app.handleDropdownClose = function (dropdownId, triggerId, e) {
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    if (!dropdown || !trigger) return;
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
        dropdown.classList.remove('open');
    }
};

app.handleMenuCloseOnly = function (menuId, e) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    if (!menu.contains(e.target)) {
        menu.classList.remove('open');
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
// 8.1 NOTE ACTIONS MENU
// ========================================================================

app.openNoteActionsMenu = function (ev, noteId) {
    this.activeNoteId = noteId;
    const menu = document.getElementById('noteActionsMenu');
    if (!menu) return;

    const note = this.getActiveNote();
    const pinBtn = menu.querySelector('#pinBtn');
    if (note && pinBtn) {
        pinBtn.textContent = note.pinned ? 'Unpin Note' : 'Pin Note';
        pinBtn.innerHTML = pinBtn.innerHTML.replace(/<svg.*<\/svg>/,
            `<svg viewBox="0 0 24 24" style="transform:rotate(45deg); fill:${note.pinned ? 'currentColor' : 'none'}; stroke:${note.pinned ? 'currentColor' : '#666'};">
                <line x1="12" y1="17" x2="12" y2="22"/>
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
            </svg>`);
    }

    const x = ev.clientX || (ev.touches?.[0]?.clientX) || 20;
    const y = ev.clientY || (ev.touches?.[0]?.clientY) || 20;

    menu.style.top = (y + 10) + 'px';
    menu.style.left = (x - 80) + 'px';
    menu.classList.add('open');

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    let left = rect.left;
    const maxLeft = window.innerWidth - rect.width - margin;

    if (left < margin) left = margin;
    if (left > maxLeft) left = maxLeft;
    menu.style.left = left + 'px';
};

app.requestDeleteActiveNoteFromMenu = function () {
    this.closeDropdown('noteActionsMenu');
    this.requestDeleteActiveNote();
};

// ========================================================================
// 8.2 FOLDER ACTIONS MENU
// ========================================================================

app.openFolderActionsMenu = function (ev, folderId) {
    if (folderId === 'all') return;
    this.pendingFolderId = folderId;
    const menu = document.getElementById('folderActionsMenu');
    if (!menu) return;

    const x = ev.clientX || (ev.touches?.[0]?.clientX) || 20;
    const y = ev.clientY || (ev.touches?.[0]?.clientY) || 20;

    menu.style.top = (y + 10) + 'px';
    menu.style.left = Math.max(8, x - 80) + 'px';
    menu.classList.add('open');
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
// ============================================================================

// ========================================================================
// 9.1 THEME & APPEARANCE
// ========================================================================

app.applyTheme = function (theme) {
    this.ui.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('notesApp_theme', theme);
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

    const newTheme = this.ui.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme);
};

app.updateThemeToggleIcon = function () {
    const icon = document.getElementById('themeToggleIcon');
    if (!icon) return;

    if (this.ui.theme === 'dark') {
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

        this.animateEl(sidebar);
        this.animateEl(notesPane);
        this.animateEl(editorPane);
    } else {
        if (mobileNav) mobileNav.style.display = 'flex';

        sidebar.style.display = (this.ui.mobileView === 'folders') ? 'flex' : 'none';
        notesPane.style.display = (this.ui.mobileView === 'notes') ? 'flex' : 'none';
        editorPane.style.display = (this.ui.mobileView === 'editor') ? 'flex' : 'none';

        if (this.ui.mobileView === 'folders') this.animateEl(sidebar);
        if (this.ui.mobileView === 'notes') this.animateEl(notesPane);
        if (this.ui.mobileView === 'editor') this.animateEl(editorPane);

        this.renderMobileNav();
    }

    this.updateMultiSelectUI();
};

app.animateEl = function (el) {
    if (!el) return;
    el.classList.remove('pane-animated');
    void el.offsetWidth;
    el.classList.add('pane-animated');
};

// ========================================================================
// 9.3 MOBILE & VIEW NAVIGATION
// ========================================================================

app.goToMobileView = function (view) {
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
        app.ui.mobileView = 'notes';
        app.updateLayout();
    }
}
app.setActiveFolder = setActiveFolder;

// ========================================================================
// 9.4 MULTI-SELECT
// ========================================================================

app.toggleMultiSelect = function () {
    this.ui.multiSelect = !this.ui.multiSelect;
    this.ui.selectedNoteIds = new Set();
    document.getElementById('editNotesBtn').innerText = this.ui.multiSelect ? 'Done' : 'Edit';
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
    if (results.length > 0 && window.AppAnimations) {
        AppAnimations.animateSearchResults(results);
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
    const largeAvatarDiv = document.querySelector('.account-avatar.account-avatar-lg');

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
                    if (smallAvatarDiv) smallAvatarDiv.style.background = gradientCSS;
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

app.exportPDF = function () {
    const note = this.getActiveNote();
    if (!note) return;

    const title = note.title || 'Note';
    const filename = Utils.sanitizeFilename(title) + '.pdf';

    // --- Parse HTML into clean lines ---
    const rawHtml = note.content || '';

    // Insert newline markers before stripping tags
    const withBreaks = rawHtml
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    const stripped = withBreaks.replace(/<[^>]+>/g, '');

    // Decode HTML entities (×, &amp;, etc.)
    const ta = document.createElement('textarea');
    ta.innerHTML = stripped;
    const decoded = ta.value;

    // Split into non-empty lines
    const lines = decoded
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // Classify each line
    const DAY_HEADER = /^(MON|TUE|WED|THU|FRI|SAT|SUN)\b/i;
    const LIST_ITEM = /^(\d+\.|[\u2022\u2713\u2714\u2610\u2611\-])\s/;

    const blocks = lines.map(text => {
        if (DAY_HEADER.test(text)) return { type: 'heading', text };
        if (LIST_ITEM.test(text)) return { type: 'listitem', text };
        return { type: 'body', text };
    });

    // --- jsPDF setup ---
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 60;
    const maxWidth = pageWidth - margin * 2;
    const bottomEdge = pageHeight - margin;
    let y = margin;

    const checkPage = (lineHeight) => {
        if (y + lineHeight > bottomEdge) {
            doc.addPage();
            y = margin;
        }
    };

    // --- Title ---
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

    // --- Body blocks ---
    blocks.forEach(block => {
        switch (block.type) {
            case 'heading': {
                y += 8;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.splitTextToSize(block.text, maxWidth).forEach(l => {
                    checkPage(18);
                    doc.text(l, margin, y);
                    y += 18;
                });
                y += 4;
                break;
            }
            case 'listitem': {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(11);
                doc.splitTextToSize(block.text, maxWidth - 12).forEach((l, i) => {
                    checkPage(16);
                    doc.text(i === 0 ? l : '  ' + l, margin + 8, y);
                    y += 16;
                });
                break;
            }
            default: {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(11);
                doc.splitTextToSize(block.text, maxWidth).forEach(l => {
                    checkPage(16);
                    doc.text(l, margin, y);
                    y += 16;
                });
            }
        }
    });

    doc.save(filename);
    this.closeDropdown('shareDropdown');
};

// ============================================================================
// 11. SELECTION TOOLBAR & TEXT FORMATTING
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
// ============================================================================

function navigateToSettings() {
    window.location.href = 'settings.html';
}

// Handle window resize / viewport height for mobile
(function () {
    function setVh() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', vh + 'px');
        const keyboardHeight = Math.max(0, window.outerHeight - window.innerHeight);
        document.documentElement.style.setProperty('--keyboard-height', keyboardHeight + 'px');
        document.documentElement.style.setProperty('--viewport-height', window.innerHeight + 'px');
    }

    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', () => { setTimeout(setVh, 100); });
    document.addEventListener('focusin', () => { setTimeout(setVh, 50); });
    document.addEventListener('focusout', () => { setTimeout(setVh, 50); });

    const scrollLock = () => { document.body.style.overflow = 'hidden'; };
    const scrollUnlock = () => { document.body.style.overflow = ''; };

    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea, [contenteditable="true"]')) {
            scrollLock();
        }
    });
    document.addEventListener('focusout', scrollUnlock);
})();

// ============================================================================
// 13. ANDROID BACK BUTTON HANDLER
// ============================================================================

const BackHandler = {

    // Priority-ordered list of "can we intercept this back press?"
    // First one that returns true wins — back is consumed, app stays put
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
            'accountDropdown'
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
        history.pushState({ notesApp: true }, '');

        window.addEventListener('popstate', (e) => {
            const intercepted = this.intercept();
            if (intercepted) {
                // Re-push the dummy state so next back press is also caught
                history.pushState({ notesApp: true }, '');
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

// Initialize app
app.init();