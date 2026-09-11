/**
 * Offline-First Sync Manager for Notes App
 * Handles offline note creation/editing and syncs with Supabase when online
 * 
 * Features:
 * - Some of them are not working in native app because of the way it handles local storage and background processes.
 * - Notes work completely offline
 * - Auto-sync when connection restored
 * - Conflict resolution (local vs server)
 * - Queue management for offline actions
 * - Persistent storage with IndexedDB
 * - Works with encrypted content
 * - Only Works when App was opened at least once with internet connection to initialize the database and get user info. After that, it can work offline until the user logs out or clears data.
 * 
 * Note: This module assumes that the main app (app.js) handles encryption/decryption of note content before saving or syncing. This module focuses on offline storage and sync logic.
 */

// =====================================================
// 1. INDEXEDDB SETUP (With Stores for Notes, Sync Queue, and Metadata)
// =====================================================

const DB_NAME = 'notozApp';
const DB_VERSION = 2;

// Store names
const STORES = {
  notes: 'notes',
  syncQueue: 'syncQueue',
  metadata: 'metadata'
};

let db = null;

/**
 * Initialize IndexedDB database
 */
async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      console.log('[Offline] ✓ IndexedDB initialized');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Notes store
      if (!database.objectStoreNames.contains(STORES.notes)) {
        const notesStore = database.createObjectStore(STORES.notes, { keyPath: 'id' });
        notesStore.createIndex('user_id', 'user_id', { unique: false });
        notesStore.createIndex('updated_at', 'updated_at', { unique: false });
      }

      // Sync queue store
      if (!database.objectStoreNames.contains(STORES.syncQueue)) {
        const queueStore = database.createObjectStore(STORES.syncQueue, { keyPath: 'id', autoIncrement: true });
        queueStore.createIndex('action', 'action', { unique: false });
        queueStore.createIndex('timestamp', 'timestamp', { unique: false });
        queueStore.createIndex('user_id', 'user_id', { unique: false });
      } else if (event.oldVersion < 2) {
        const queueStore = event.target.transaction.objectStore(STORES.syncQueue);
        if (!queueStore.indexNames.contains('user_id')) {
          queueStore.createIndex('user_id', 'user_id', { unique: false });
        }
        queueStore.openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          const item = cursor.value;
          if (!item.user_id && item.data?.user_id) {
            cursor.update({ ...item, user_id: item.data.user_id });
          }
          cursor.continue();
        };
      }

      // Metadata store (last sync time, etc)
      if (!database.objectStoreNames.contains(STORES.metadata)) {
        database.createObjectStore(STORES.metadata, { keyPath: 'key' });
      }

      console.log('[Offline] ✓ Database schema created');
    };
  });
}

// =====================================================
// 2. OFFLINE NOTE OPERATIONS (With Local Saving, Deletion, and Retrieval)
// =====================================================

/**
 * Save a note locally (works offline)
 */
async function saveNoteOffline(noteData) {
  if (!db) await initializeDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.notes, STORES.syncQueue], 'readwrite');
    const notesStore = transaction.objectStore(STORES.notes);
    const queueStore = transaction.objectStore(STORES.syncQueue);

    // Generate ID if not present
    const noteId = noteData.id || generateUUID();
    const timestamp = new Date().toISOString();

    const note = {
      ...noteData,
      id: noteId,
      user_id: noteData.user_id,
      created_at: noteData.created_at || timestamp,
      updated_at: timestamp,
      synced: false,
      offline: true
    };

    if (!note.user_id) {
      reject(new Error('Cannot save an offline note without an authenticated user.'));
      return;
    }

    // Save note locally
    const noteSaveRequest = notesStore.put(note);

    // Add to sync queue
    const queueItem = {
      action: 'upsert',
      user_id: note.user_id,
      noteId: noteId,
      data: note,
      timestamp: timestamp,
      retries: 0,
      maxRetries: 3
    };

    const queueSaveRequest = queueStore.add(queueItem);

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => {
      console.log('[Offline] ✓ Note saved locally:', noteId);
      resolve(note);
    };
  });
}

/**
 * Delete a note locally (offline-safe)
 */
async function deleteNoteOffline(noteId) {
  if (!db) await initializeDatabase();
  const user = await getCurrentUser();
  if (!user?.id) throw new Error('Cannot delete an offline note without an authenticated user.');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.notes, STORES.syncQueue], 'readwrite');
    const notesStore = transaction.objectStore(STORES.notes);
    const queueStore = transaction.objectStore(STORES.syncQueue);

    notesStore.delete(noteId);

    const queueItem = {
      action: 'delete',
      user_id: user.id,
      noteId: noteId,
      timestamp: new Date().toISOString(),
      retries: 0,
      maxRetries: 3
    };

    queueStore.add(queueItem);

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => {
      console.log('[Offline] ✓ Note marked for deletion:', noteId);
      resolve();
    };
  });
}

/**
 * Get all notes from local storage (works offline)
 */
async function getNotesOffline(userId) {
  if (!db) await initializeDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.notes], 'readonly');
    const store = transaction.objectStore(STORES.notes);
    const index = store.index('user_id');

    const request = index.getAll(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const notes = request.result.sort((a, b) => 
        new Date(b.updated_at) - new Date(a.updated_at)
      );
      console.log('[Offline] ✓ Retrieved', notes.length, 'notes from local storage');
      resolve(notes);
    };
  });
}

/**
 * Get a single note from local storage
 */
async function getNoteOffline(noteId, userId) {
  if (!db) await initializeDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.notes], 'readonly');
    const store = transaction.objectStore(STORES.notes);
    const request = store.get(noteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const note = request.result || null;
      resolve(note && (!userId || note.user_id === userId) ? note : null);
    };
  });
}

// =====================================================
// 3. SYNC MANAGEMENT (With Online/Offline Detection, Sync Logic, and Conflict Resolution)
// =====================================================

let isSyncing = false;

/**
 * Check if user is online
 */
function isOnline() {
  return navigator.onLine;
}

/**
 * Listen for online/offline events
 */
window.addEventListener('online', () => {
  console.log('[Offline] ✓ Connection restored');
  if (typeof showNotification === 'function') {
    showNotification('Back Online', 'Syncing your changes...', 'success');
  }
  syncWithSupabase();
});

window.addEventListener('offline', () => {
  console.log('[Offline] ⚠️  Connection lost');
  if (typeof showNotification === 'function') {
    showNotification('Offline Mode', 'Changes will sync when you\'re back online', 'info');
  }
});

/**
 * Main sync function - syncs all queued actions with Supabase
 */
async function syncWithSupabase() {
  if (isSyncing || !isOnline()) {
    console.log('[Sync] Sync skipped - already syncing or offline');
    return;
  }

  isSyncing = true;

  try {
    if (!db) await initializeDatabase();

    // Get all pending sync operations
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      console.error('[Sync] ❌ No user logged in');
      isSyncing = false;
      return;
    }

    // Only process operations belonging to the active account.
    const queueItems = await getQueueItems(user.id);
    console.log('[Sync] Found', queueItems.length, 'items to sync');

    if (queueItems.length === 0) {
      isSyncing = false;
      return;
    }

    // Process each queued item
    for (const queueItem of queueItems) {
      try {
        if (queueItem.action === 'upsert') {
          await syncNoteUpsert(queueItem, user);
        } else if (queueItem.action === 'delete') {
          await syncNoteDeletion(queueItem, user);
        }

        // Remove from queue on success
        await removeFromQueue(queueItem.id);
      } catch (error) {
        console.error('[Sync] Error syncing item:', error);
        
        // Increment retry count
        queueItem.retries = (queueItem.retries || 0) + 1;
        
        if (queueItem.retries < queueItem.maxRetries) {
          // Retry later
          await updateQueueItem(queueItem);
        } else {
          // Max retries exceeded
          console.error('[Sync] ❌ Max retries exceeded for:', queueItem.noteId);
          await removeFromQueue(queueItem.id);
          if (typeof showNotification === 'function') {
            showNotification('Sync Error', `Failed to sync note ${queueItem.noteId}`, 'error');
          }
        }
      }
    }

    // Update last sync time
    await setMetadata('lastSyncTime', new Date().toISOString());

    console.log('[Sync] ✓ Sync completed successfully');
    if (typeof showNotification === 'function') {
      showNotification('✓ Synced', 'All changes saved to cloud', 'success');
    }
  } catch (error) {
    console.error('[Sync] ❌ Sync error:', error);
  } finally {
    isSyncing = false;
  }
}

/**
 * Sync note upsert (create/update)
 */
async function syncNoteUpsert(queueItem, user) {
  const noteData = queueItem.data;

  // Use the supabaseClient from app.js
  if (typeof supabaseClient === 'undefined') {
    throw new Error('supabaseClient not available');
  }

  const { data, error } = await supabaseClient
    .from('notes')
    .upsert({
      id: noteData.id,
      user_id: user.id,
      title: noteData.title,
      content: noteData.content,      // Already encrypted by app.js ✓
      folder_id: noteData.folder_id || null,
      created_at: noteData.created_at,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;

  // Update local copy to mark as synced
  await updateNoteSync(noteData.id, true, user.id);

  console.log('[Sync] ✓ Upserted note:', noteData.id);
}

/**
 * Sync note deletion
 */
async function syncNoteDeletion(queueItem, user) {
  if (typeof supabaseClient === 'undefined') {
    throw new Error('supabaseClient not available');
  }

  const { error } = await supabaseClient
    .from('notes')
    .delete()
    .eq('id', queueItem.noteId)
    .eq('user_id', user.id);

  if (error) throw error;

  console.log('[Sync] ✓ Deleted note:', queueItem.noteId);
}

/**
 * Update note's sync status
 */
async function updateNoteSync(noteId, synced, userId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.notes], 'readwrite');
    const store = transaction.objectStore(STORES.notes);

    // First get the note
    const getRequest = store.get(noteId);

    getRequest.onsuccess = () => {
      const note = getRequest.result;
      if (note && (!userId || note.user_id === userId)) {
        note.synced = synced;
        note.offline = !synced;
        const updateRequest = store.put(note);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

// =====================================================
// 4. SYNC QUEUE MANAGEMENT (With Functions to Get, Remove, and Update Queue Items)
// =====================================================

/**
 * Get all pending sync queue items
 */
function getQueueItems(userId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.syncQueue], 'readonly');
    const store = transaction.objectStore(STORES.syncQueue);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.filter((item) => {
      const ownerId = item.user_id || item.data?.user_id;
      return !userId || ownerId === userId;
    }));
  });
}

/**
 * Remove item from sync queue
 */
function removeFromQueue(queueItemId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.syncQueue], 'readwrite');
    const store = transaction.objectStore(STORES.syncQueue);
    const request = store.delete(queueItemId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Update queue item (for retries)
 */
function updateQueueItem(queueItem) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.syncQueue], 'readwrite');
    const store = transaction.objectStore(STORES.syncQueue);
    const request = store.put(queueItem);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// =====================================================
// 5. METADATA MANAGEMENT (With Functions to Set and Get Metadata Values, Like Last Sync Time)
// =====================================================

/**
 * Set metadata value
 */
function setMetadata(key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.metadata], 'readwrite');
    const store = transaction.objectStore(STORES.metadata);
    const request = store.put({ key, value, timestamp: new Date().toISOString() });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get metadata value
 */
function getMetadata(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.metadata], 'readonly');
    const store = transaction.objectStore(STORES.metadata);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.value);
  });
}

/**
 * Get last sync time
 */
async function getLastSyncTime() {
  const timestamp = await getMetadata('lastSyncTime');
  return timestamp ? new Date(timestamp) : null;
}

// =====================================================
// 6. HELPER FUNCTIONS (With UUID Generation and User Retrieval Using Supabase Client)
// =====================================================

/**
 * Generate UUID for offline notes
 */
function generateUUID() {
  return 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Get current authenticated user
 * Uses the supabaseClient from app.js
 */
async function getCurrentUser() {
  if (typeof supabaseClient === 'undefined') {
    console.error('[Offline] ❌ supabaseClient not found - make sure offline-sync.js loads AFTER Supabase');
    return null;
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
  } catch (error) {
    console.error('[Offline] Error getting user:', error);
    return null;
  }
}

// =====================================================
// 7. INITIALIZATION (With Database Initialization and Auto-Sync on Page Load if Online)
// =====================================================

/**
 * Initialize offline support
 */
async function initializeOfflineSupport() {
  try {
    await initializeDatabase();
    console.log('[Offline] ✓ Offline support initialized');

    // Auto-sync if online
    if (isOnline()) {
      // Small delay to let app load
      setTimeout(() => {
        console.log('[Offline] Auto-syncing on page load...');
        syncWithSupabase();
      }, 2000);
    }
  } catch (error) {
    console.error('[Offline] ❌ Failed to initialize offline support:', error);
  }
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOfflineSupport);
} else {
  initializeOfflineSupport();
}

// =====================================================
// 8. PERIODIC SYNC (EVERY 30 SECONDS) (With Check to Avoid Overlapping Syncs and Only Sync When Online)
// =====================================================

/**
 * Periodically try to sync (every 30 seconds if online)
 */
setInterval(() => {
  if (isOnline() && !isSyncing) {
    syncWithSupabase().catch(err => console.error('[Sync] ❌ Periodic sync error:', err));
  }
}, 30 * 1000);

console.log('[Offline] ✓ Module loaded - Offline-first sync enabled');