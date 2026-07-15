// ============================================================================
// LIVE UPDATES — cross-device note sync
// Load this file AFTER app.js. Replaces app.initializeRealtimeSync.
// ============================================================================

app.initializeRealtimeSync = function () {
    if (!CURRENT_USER_ID) return;
    if (this._liveChannel) return; // already subscribed

    this._liveChannel = supabaseClient
        .channel('notes-live-' + CURRENT_USER_ID)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: NOTES_TABLE,
            filter: `user_id=eq.${CURRENT_USER_ID}`
        }, (payload) => this._handleLiveChange(payload))
        .subscribe((status, err) => {
            // SUBSCRIBED = good. CHANNEL_ERROR/TIMED_OUT = realtime not reaching you
            // (usually: table not added to supabase_realtime publication, or RLS).
            console.log('[Live] channel status:', status, err || '');
        });
};

app._handleLiveChange = async function (payload) {
    if (payload.eventType === 'DELETE') {
        this.removeNoteFromUI(payload.old.id);
        return;
    }

    const incoming = payload.new;
    if (!incoming) return;

    // Only delay if the user is actively typing in THIS note right now.
    // Viewing it (not focused) still updates instantly.
    const activeEl = document.activeElement;
    const isTypingThis = this.activeNoteId === incoming.id &&
        (activeEl?.id === 'noteContentInput' || activeEl?.id === 'noteTitleInput');

    if (isTypingThis) {
        this._pendingRemoteUpdate = incoming; // applied on blur, see listener below
        return;
    }

    await this._applyRemoteNote(incoming);
};

app._applyRemoteNote = async function (incoming) {
    const local = this.notes.find(n => n.id === incoming.id);

    // Decrypt incoming fields (server copy is always encrypted form).
    const decryptedTitle = incoming.title?.startsWith('enc:')
        ? await _fastDecrypt(incoming.title) : incoming.title;
    const decryptedContent = incoming.content?.startsWith('enc:')
        ? await _fastDecrypt(incoming.content) : incoming.content;

    const merged = { ...incoming, title: decryptedTitle, content: decryptedContent, _decrypted: true };

    if (!local) {
        this.notes.unshift(merged);
    } else {
        // Only overwrite if remote is actually newer (avoid stomping on a faster local save).
        const remoteTime = new Date(incoming.updated_at || 0).getTime();
        const localTime = new Date(local.updated_at || 0).getTime();
        if (remoteTime <= localTime) return;
        Object.assign(local, merged);
    }

    try { await this.saveSingleNoteToIndexedDB(incoming); } catch (e) { /* best effort */ }

    this.renderNotesList();
    if (this.activeNoteId === incoming.id) this.renderEditor();
};

// Flush any update that arrived while the user was typing, once they blur out.
['noteContentInput', 'noteTitleInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('blur', () => {
        if (app._pendingRemoteUpdate && app._pendingRemoteUpdate.id === app.activeNoteId) {
            const pending = app._pendingRemoteUpdate;
            app._pendingRemoteUpdate = null;
            app._applyRemoteNote(pending);
        }
    });
});

// Clean up subscription on logout.
const _origHandleLogout = app.handleLogout;
app.handleLogout = async function () {
    if (this._liveChannel) {
        supabaseClient.removeChannel(this._liveChannel);
        this._liveChannel = null;
    }
    return _origHandleLogout.apply(this, arguments);
};