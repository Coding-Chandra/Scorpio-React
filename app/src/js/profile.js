// TOP OF FILE: Import Supabase directly from the CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentAvatarMode = 'initials'; // 'initials' or 'emoji'
let currentEmoji = null;
let currentDisplayName = null;
let currentGradientIndex = null; // Index of selected gradient

function _b64FromBuf(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _bufFromB64(b64) {
    const bin = atob(b64 || '');
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

// ============================================================================
// SESSION MASTER KEY — IndexedDB
// ============================================================================

const KEY_DB_NAME = 'notoz_session';
const KEY_STORE = 'keys';

function _openKeyDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(KEY_DB_NAME, 1);

        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(KEY_STORE)) {
                req.result.createObjectStore(KEY_STORE);
            }
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

        req.onsuccess = () => resolve(req.result || null);
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

async function encryptWithMasterKey(plaintext) {
    if (!plaintext) return '';

    const key = await getSessionMasterKey();

    if (!key) {
        throw new Error('Master key not available locally.');
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(plaintext)
    );

    return `enc:${_b64FromBuf(iv)}:${_b64FromBuf(ciphertext)}`;
}

async function decryptWithMasterKey(stored) {
    if (!stored) return '';

    if (!stored.startsWith('enc:')) {
        return stored;
    }

    const key = await getSessionMasterKey();

    if (!key) {
        throw new Error('Master key not available locally.');
    }

    const parts = stored.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted note format.');
    }

    const [, ivB64, ctB64] = parts;

    const iv = _bufFromB64(ivB64);
    const ciphertext = _bufFromB64(ctB64);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    return new TextDecoder().decode(decrypted);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initializeProfile();
    setupAvatarEventListeners();
});

/**
 * Setup event listeners for avatar system
 */
function setupAvatarEventListeners() {
    // Listen for emoji selected event from avatar picker
    window.addEventListener('emojiSelected', (e) => {
        currentEmoji = e.detail.emoji;
        currentAvatarMode = 'emoji';
        displayProfileAvatar();
        saveAvatarPreferences();
    });

    // Listen for gradient selected event from gradient picker
    window.addEventListener('gradientSelected', (e) => {
        currentGradientIndex = e.detail.index;
        displayProfileAvatar();
        saveAvatarPreferences();
    });
}

/**
 * Toggle avatar editor visibility
 */
window.toggleAvatarEditMode = () => {
    const avatarEditSection = document.getElementById('avatarEditSection');
    const isHidden = avatarEditSection.style.display === 'none';
    
    if (isHidden) {
        avatarEditSection.style.display = 'block';
        avatarEditSection.classList.add('animate-list-item-in');
    } else {
        avatarEditSection.style.display = 'none';
    }
};

/**
 * Toggle between initials and emoji avatar modes
 */
window.toggleAvatarMode = async (mode) => {
    currentAvatarMode = mode;
    
    // Update button states
    document.getElementById('initialsMode').classList.toggle('active', mode === 'initials');
    document.getElementById('emojiMode').classList.toggle('active', mode === 'emoji');
    
    // Update action buttons
    const actionButtons = document.getElementById('avatarActionButtons');
    if (mode === 'initials') {
        actionButtons.innerHTML = `
            <button type="button" class="change-gradient-btn" onclick="window.selectGradient()">Change Gradient</button>
        `;
    } else {
        actionButtons.innerHTML = `
            <button type="button" class="change-emoji-btn" onclick="window.selectNewEmoji()">Select Emoji</button>
            <button type="button" class="change-gradient-btn" onclick="window.selectGradient()">Change Gradient</button>
        `;
    }
    
    displayProfileAvatar();
    await saveAvatarPreferences();
};

/**
 * Open emoji picker to select or change emoji
 */
window.selectNewEmoji = () => {
    if (window.AdvancedAvatarGenerator) {
        window.AdvancedAvatarGenerator.openEmojiPicker('selectEmoji');
    }
};

/**
 * Open gradient picker to select or change gradient
 */
window.selectGradient = () => {
    if (window.AdvancedAvatarGenerator) {
        window.AdvancedAvatarGenerator.openGradientPicker('selectGradient');
    }
};

/**
 * Display the profile avatar based on current mode
 */
function displayProfileAvatar() {
    const avatarElement = document.getElementById('profileAvatarDisplay');
    if (!avatarElement) return;
    
    const initials = window.AdvancedAvatarGenerator.getInitials(currentDisplayName);
    let customGradient = null;
    
    if (currentGradientIndex !== null) {
        customGradient = window.AdvancedAvatarGenerator.colorPalettes[currentGradientIndex];
    }
    
    if (currentAvatarMode === 'emoji' && currentEmoji) {
        window.AdvancedAvatarGenerator.updateAvatarElement(
            avatarElement, 
            initials, 
            currentUser.id, 
            currentEmoji,
            customGradient
        );
    } else {
        window.AdvancedAvatarGenerator.updateAvatarElement(
            avatarElement, 
            initials, 
            currentUser.id,
            null,
            customGradient
        );
    }
}

/**
 * Save avatar preferences to database
 */
async function saveAvatarPreferences() {
    try {
        const { error } = await supabase
            .from('profiles')
            .upsert({
                id: currentUser.id,
                avatar_mode: currentAvatarMode,
                avatar_emoji: currentEmoji,
                avatar_gradient_index: currentGradientIndex,
                updated_at: new Date().toISOString()
            });
        
        if (error) {
            console.warn('[Avatar] Could not save preferences:', error);
        } else {
            console.log('[Avatar] ✓ Preferences saved:', { 
                mode: currentAvatarMode, 
                emoji: currentEmoji,
                gradientIndex: currentGradientIndex
            });
        }
    } catch (error) {
        console.error('[Avatar] Error saving preferences:', error);
    }
}

/**
 * Load avatar preferences from database
 */
async function loadAvatarPreferences() {
    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('avatar_mode, avatar_emoji, avatar_gradient_index')
            .eq('id', currentUser.id)
            .single();
        
        if (!error && profile) {
            if (profile.avatar_mode) {
                currentAvatarMode = profile.avatar_mode;
            }
            if (profile.avatar_emoji) {
                currentEmoji = profile.avatar_emoji;
            }
            if (profile.avatar_gradient_index !== null && profile.avatar_gradient_index !== undefined) {
                currentGradientIndex = profile.avatar_gradient_index;
            }
            console.log('[Avatar] ✓ Preferences loaded:', { 
                mode: currentAvatarMode, 
                emoji: currentEmoji,
                gradientIndex: currentGradientIndex
            });
            
            // Sync UI to match loaded preferences
            syncAvatarUIState();
        }
    } catch (error) {
        console.warn('[Avatar] Could not load preferences:', error);
    }
}

/**
 * Sync UI buttons and action buttons to match current avatar state
 */
function syncAvatarUIState() {
    // Update mode buttons if they exist
    const initialsBtn = document.getElementById('initialsMode');
    const emojiBtn = document.getElementById('emojiMode');
    
    if (initialsBtn) initialsBtn.classList.toggle('active', currentAvatarMode === 'initials');
    if (emojiBtn) emojiBtn.classList.toggle('active', currentAvatarMode === 'emoji');
    
    // Update action buttons
    const actionButtons = document.getElementById('avatarActionButtons');
    if (actionButtons) {
        if (currentAvatarMode === 'initials') {
            actionButtons.innerHTML = `
                <button type="button" class="change-gradient-btn" onclick="window.selectGradient()">Change Gradient</button>
            `;
        } else {
            actionButtons.innerHTML = `
                <button type="button" class="change-emoji-btn" onclick="window.selectNewEmoji()">Select Emoji</button>
                <button type="button" class="change-gradient-btn" onclick="window.selectGradient()">Change Gradient</button>
            `;
        }
    }
    
    // Re-display avatar with loaded preferences
    displayProfileAvatar();
}

async function initializeProfile() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            window.location.href = '../index.html';
            return;
        }
        
        currentUser = user;
        await loadProfileData();
        await loadAvatarPreferences();
    } catch (error) {
        console.error('Error initializing profile:', error);
        showNotification('Profile error', 'Could not initialize your profile.', 'error');
    }
}

async function loadProfileData() {
    try {
        // Try to get display name from profiles table first (source of truth)
        let displayName = null;
        
        try {
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('display_name')
                .eq('id', currentUser.id)
                .single();
            
            if (!profileError && profile?.display_name) {
                displayName = profile.display_name;
                console.log('[Profile] Loaded from profiles table:', displayName);
            }
        } catch (e) {
            console.warn('[Profile] Profiles table not accessible:', e.message);
        }
        
        // Fallback to auth metadata
        if (!displayName) {
            displayName = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
            console.log('[Profile] Loaded from auth metadata:', displayName);
        }
        
        currentDisplayName = displayName;
        const email = currentUser.email || 'N/A';
        const userId = currentUser.id;
        const createdAt = new Date(currentUser.created_at).toLocaleDateString();
        const lastSignIn = currentUser.last_sign_in_at ? new Date(currentUser.last_sign_in_at).toLocaleDateString() : 'N/A';

        // Update UI
        if(document.getElementById('displayNameText')) document.getElementById('displayNameText').textContent = displayName;
        if(document.getElementById('displayNameInput')) document.getElementById('displayNameInput').value = displayName;
        if(document.getElementById('emailText')) document.getElementById('emailText').textContent = email;
        if(document.getElementById('userIdText')) document.getElementById('userIdText').textContent = userId;
        if(document.getElementById('joinedText')) document.getElementById('joinedText').textContent = createdAt;
        if(document.getElementById('lastUpdatedText')) document.getElementById('lastUpdatedText').textContent = lastSignIn;

        // Display initial avatar
        displayProfileAvatar();

        // Load and display stats
        await loadAndDisplayStats();

    } catch (error) {
        console.error('Error loading profile:', error);
        showNotification('Profile error', 'Could not load your profile data.', 'error');
    }
}

async function loadAndDisplayStats() {
    try {
        const { data: notes, error } = await supabase
            .from('notes')
            .select('id, title, content, created_at, updated_at')
            .eq('user_id', currentUser.id);

        if (error) throw error;

        const stats = calculateSmartStats(notes || []);
        displayStats(stats);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function calculateSmartStats(notes) {
    if (notes.length === 0) {
        return {
            totalNotes: '0 notes',
            notesThisMonth: '0 notes',
            monthlyStreak: '0 days',
            oldestNote: '—',
            recentlyEdited: '—'
        };
    }

    let oldestDate = null;
    let newestDate = null;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Count notes this month
    let notesThisMonth = 0;
    const today = new Date();
    const monthStart = new Date(currentYear, currentMonth, 1);
    
    notes.forEach(note => {
        const createdAt = new Date(note.created_at);
        const updatedAt = new Date(note.updated_at);

        // Count notes created this month
        if (createdAt >= monthStart && createdAt <= now) {
            notesThisMonth++;
        }

        if (!oldestDate || createdAt < oldestDate) {
            oldestDate = createdAt;
        }
        if (!newestDate || updatedAt > newestDate) {
            newestDate = updatedAt;
        }
    });

    // Calculate monthly streak
    const monthlyStreak = calculateMonthlyStreak(notes, currentMonth, currentYear);
    
    // Format dates smartly
    const formatSmartDate = (date) => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const isToday = date.toDateString() === today.toDateString();
        const isYesterday = date.toDateString() === yesterday.toDateString();
        
        if (isToday) return 'Today';
        if (isYesterday) return 'Yesterday';
        
        const daysAgo = Math.floor((today - date) / (1000 * 60 * 60 * 24));
        if (daysAgo < 7) return `${daysAgo} days ago`;
        if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} weeks ago`;
        if (daysAgo < 365) return `${Math.floor(daysAgo / 30)} months ago`;
        
        return date.toLocaleDateString();
    };

    return {
        totalNotes: notes.length === 1 ? '1 note' : `${notes.length} notes`,
        notesThisMonth: notesThisMonth === 1 ? '1 note' : `${notesThisMonth} notes`,
        monthlyStreak: monthlyStreak === 1 ? '1 day' : `${monthlyStreak} days`,
        oldestNote: formatSmartDate(oldestDate),
        recentlyEdited: formatSmartDate(newestDate)
    };
}

function calculateMonthlyStreak(notes, month, year) {
    if (notes.length === 0) return 0;

    // Get all dates in current month that have notes
    const datesWithNotes = new Set();
    
    notes.forEach(note => {
        const createdAt = new Date(note.created_at);
        if (createdAt.getMonth() === month && createdAt.getFullYear() === year) {
            datesWithNotes.add(createdAt.toDateString());
        }
    });

    if (datesWithNotes.size === 0) return 0;

    // Calculate consecutive days from today backwards
    let streak = 0;
    const today = new Date();
    
    for (let i = 0; i < 31; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() - i);
        
        // Stop if we're out of current month
        if (checkDate.getMonth() !== month || checkDate.getFullYear() !== year) {
            break;
        }
        
        if (datesWithNotes.has(checkDate.toDateString())) {
            streak++;
        } else {
            // Break streak if there's a gap
            if (streak > 0) break;
        }
    }
    
    return streak;
}

function displayStats(stats) {
    // Create or update stats section
    let statsSection = document.getElementById('statsSection');
    
    // If element doesn't exist or is empty, build it
    if (statsSection) {
        statsSection.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-value">${stats.totalNotes}</span>
                    <span class="stat-label">Total Notes</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${stats.notesThisMonth}</span>
                    <span class="stat-label">This Month</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${stats.monthlyStreak}</span>
                    <span class="stat-label">Monthly Streak</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${stats.oldestNote}</span>
                    <span class="stat-label">Oldest Note</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${stats.recentlyEdited}</span>
                    <span class="stat-label">Last Edited</span>
                </div>
            </div>
        `;
        // Add classes for styling if needed
        statsSection.className = 'stats-group animate-list-item-in';
        statsSection.style.animationDelay = '0.15s';
    }
}

// Make global functions accessible to HTML
window.toggleEditMode = () => {
    const editSection = document.getElementById('editSection');
    const isHidden = editSection.style.display === 'none';
    
    if (isHidden) {
        editSection.style.display = 'block';
        editSection.classList.add('animate-list-item-in');
        document.getElementById('displayNameInput').focus();
    } else {
        editSection.style.display = 'none';
    }
};

window.saveDisplayName = async () => {
    const newName = document.getElementById('displayNameInput').value.trim();
    
    if (!newName) {
        showNotification('Name required', 'Display name cannot be empty.', 'error');
        return;
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        // Step 1: Update in Supabase Auth metadata
        const { error: updateAuthError } = await supabase.auth.updateUser({
            data: { display_name: newName }
        });

        if (updateAuthError) throw updateAuthError;
        console.log('[Profile] ✓ Updated auth metadata');

        // Step 2: Update in profiles table (source of truth)
        const { error: updateProfileError } = await supabase
            .from('profiles')
            .upsert({
                id: currentUser.id,
                display_name: newName,
                email: currentUser.email,
                updated_at: new Date().toISOString()
            });

        if (updateProfileError) {
            console.warn('[Profile] Warning: Could not update profiles table:', updateProfileError);
            // Continue anyway - auth metadata is updated
        } else {
            console.log('[Profile] ✓ Updated profiles table');
        }

        // Step 3: Update local state
        currentDisplayName = newName;

        // Step 4: Update UI
        document.getElementById('displayNameText').textContent = newName;
        
        // Step 5: Update avatar with new initials
        displayProfileAvatar();
        
        // Hide edit section
        document.getElementById('editSection').style.display = 'none';
        
        // Step 6: Update currentUser
        if (!currentUser.user_metadata) {
            currentUser.user_metadata = {};
        }
        currentUser.user_metadata.display_name = newName;
        
        // Step 7: Broadcast change to other pages
        localStorage.setItem('displayNameUpdate', JSON.stringify({
            name: newName,
            timestamp: Date.now()
        }));
        
        showNotification('Profile updated', 'Your display name was updated successfully.', 'success');
        
        // Reload after 1.5s to sync everything
        setTimeout(() => {
            window.location.reload();
        }, 1500);

    } catch (error) {
        console.error('[Profile] Error updating profile:', error);
        showNotification('Update failed', error.message || 'Something went wrong.', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
};

// Decryption utility
async function decryptContent(storedText) {
    try {
        return await decryptWithMasterKey(storedText);
    } catch (error) {
        console.error('Error decrypting content:', error);
        return storedText || '';
    }
}

// ---------- Shared file/blob helpers ----------

function sanitizeFilename(name, fallback = 'untitled') {
    const cleaned = (name || '').toString().trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80);
    return cleaned || fallback;
}

function guessExtFromMime(mime) {
    if (!mime) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    return 'png';
}

function dataUrlToBlobParts(dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!match) return null;
    const mime = match[1];
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, blob: new Blob([bytes], { type: mime }) };
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function getFileExtension(filename) {
    const parts = (filename || '').toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
}

// Walks a note's HTML content, pulls each <img> out to its own file (fetching
// it from Supabase Storage or decoding a base64 data URL), and swaps it for a
// plain-text placeholder so the note still reads sensibly as a .txt file.
async function extractPlainTextAndImages(html, noteIndex) {
    const container = document.createElement('div');
    container.innerHTML = html || '';

    const images = [];
    const imgEls = Array.from(container.querySelectorAll('img'));
    let imgCounter = 0;

    for (const img of imgEls) {
        imgCounter += 1;
        const src = img.getAttribute('src') || '';
        let blob = null;
        let ext = 'png';

        try {
            if (src.startsWith('data:')) {
                const parts = dataUrlToBlobParts(src);
                if (parts) {
                    blob = parts.blob;
                    ext = guessExtFromMime(parts.mime);
                }
            } else if (/^https?:\/\//.test(src)) {
                const res = await fetch(src);
                if (res.ok) {
                    blob = await res.blob();
                    ext = guessExtFromMime(blob.type) || (src.split('.').pop() || 'png').split('?')[0];
                }
            }
        } catch (err) {
            console.warn('[Export] Could not fetch image for note', noteIndex, err);
        }

        const filename = `note${noteIndex}-img${imgCounter}.${ext}`;
        if (blob) {
            images.push({ filename, blob });
            img.replaceWith(document.createTextNode(`\n[Image: images/${filename}]\n`));
        } else {
            img.replaceWith(document.createTextNode('\n[Image: unavailable]\n'));
        }
    }

    // Turn common block-level tags into line breaks before flattening to text
    container.querySelectorAll('div, p, br, li').forEach((el) => {
        el.insertAdjacentText('afterend', '\n');
    });

    const plainText = container.textContent.replace(/\n{3,}/g, '\n\n').trim();
    return { plainText, images };
}

// ---------- Export ----------

window.promptExportNotes = () => {
    document.getElementById('modal-title').textContent = 'Export Notes Backup';
    document.getElementById('modal-message').textContent = 'Choose a backup format.';
    document.getElementById('modal-input-container').innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px; margin: 4px 0 14px 0;">
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                <input type="radio" name="exportFormat" value="json" checked style="margin-top:3px;width: 22px;height: 22px;">
                <span><strong>JSON</strong> — all notes in one file, no images</span>
            </label>
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                <input type="radio" name="exportFormat" value="zip" style="margin-top:3px;width: 22px;height: 22px;">
                <span><strong>ZIP</strong> — each note as .txt, with images saved in their own format</span>
            </label>
        </div>
    `;
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = 'Export';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
        const selected = document.querySelector('input[name="exportFormat"]:checked');
        await exportNotesToFile(selected ? selected.value : 'json');
    };
    document.getElementById('custom-modal-overlay').style.display = 'flex';
    ProfileDialog.openWithAnimation(ProfileDialog.lastSourceEl);
};

async function fetchAndDecryptNotes(progressCallback) {
    const { data: notes, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', currentUser.id);

    if (error) throw error;

    const decryptedNotes = [];
    const failedNotes = [];

    const total = (notes || []).length;

    for (let i = 0; i < total; i++) {
        const note = notes[i];

        if (progressCallback) {
            progressCallback(
                i,
                total,
                `Decrypting note ${i + 1} of ${total}...`
            );
        }

        try {
            const title = await decryptContent(note.title);
            const content = await decryptContent(note.content);

            decryptedNotes.push({
                title,
                content,
                paper_style: note.paper_style || 'blank',
                folder_id: note.folder_id || null,
                pinned: note.pinned || false,
                created_at: note.created_at,
                updated_at: note.updated_at
            });

        } catch (error) {
            console.error(
                `[Export] Failed to decrypt note ${note.id}:`,
                error
            );

            failedNotes.push({
                id: note.id,
                title: '[Could not decrypt]',
                error: error.message || 'Decryption failed'
            });
        }
    }

    if (progressCallback) {
        progressCallback(
            total,
            total,
            'Decryption complete.'
        );
    }

    return {
        decryptedNotes,
        failedNotes
    };
}

function exportNotesAsJson(decryptedNotes) {
    const exportData = {
        exportDate: new Date().toISOString(),
        userEmail: currentUser.email,
        displayName: currentUser.user_metadata?.display_name || 'User',
        totalNotes: decryptedNotes.length,
        notes: decryptedNotes
    };

    downloadBlob(
        new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }),
        `notes-backup-${new Date().toISOString().split('T')[0]}.json`
    );
}

async function exportNotesAsZip(decryptedNotes, messageEl) {
    if (!window.JSZip) throw new Error('ZIP library failed to load.');

    const zip = new window.JSZip();
    const notesFolder = zip.folder('notes');
    const imagesFolder = zip.folder('images');

    for (let i = 0; i < decryptedNotes.length; i++) {
        const note = decryptedNotes[i];
        if (messageEl) messageEl.textContent = `Processing note ${i + 1} of ${decryptedNotes.length}...`;

        const { plainText, images } = await extractPlainTextAndImages(note.content, i + 1);
        const safeTitle = sanitizeFilename(note.title, `note-${i + 1}`);
        const heading = note.title || 'Untitled';
        const header = `${heading}\n${'='.repeat(heading.length)}\n\n`;

        notesFolder.file(`${i + 1}-${safeTitle}.txt`, header + plainText);
        images.forEach((img) => imagesFolder.file(img.filename, img.blob));
    }

    if (messageEl) messageEl.textContent = 'Compressing files...';
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `notes-backup-${new Date().toISOString().split('T')[0]}.zip`);
}

async function exportNotesToFile(format = 'json') {
    const btn = document.getElementById('modal-confirm-btn');
    const statusEl = document.getElementById('exportStatus');
    const messageEl = document.getElementById('modal-message');

    btn.disabled = true;

    messageEl.textContent = 'Fetching notes...';
    statusEl.textContent = 'Exporting...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        const {
            decryptedNotes,
            failedNotes
        } = await fetchAndDecryptNotes(
            (current, total, message) => {
                messageEl.textContent = message;

                if (statusEl && total > 0) {
                    statusEl.textContent =
                        `Decrypting ${current}/${total}`;
                }
            }
        );

        // NEVER export ciphertext.
        if (failedNotes.length > 0) {
            throw new Error(
                `${failedNotes.length} note${
                    failedNotes.length === 1 ? '' : 's'
                } could not be decrypted. Nothing was exported to prevent encrypted ciphertext from being included.`
            );
        }

        if (format === 'zip') {
            await exportNotesAsZip(
                decryptedNotes,
                messageEl
            );
        } else {
            exportNotesAsJson(decryptedNotes);
        }

        const noteWord =
            decryptedNotes.length === 1
                ? 'note'
                : 'notes';

        statusEl.textContent =
            `✓ Exported ${decryptedNotes.length} ${noteWord}`;

        statusEl.style.color = 'var(--accent)';

        messageEl.textContent =
            format === 'zip'
                ? 'ZIP backup created and downloaded successfully.'
                : 'JSON backup created and downloaded successfully.';

        showNotification(
            'Export complete',
            `Exported ${decryptedNotes.length} ${noteWord} as ${format.toUpperCase()}.`,
            'success'
        );

        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;

    } catch (error) {
        console.error('Export error:', error);

        statusEl.textContent = '✕ Export failed';
        statusEl.style.color = 'var(--accent1)';

        messageEl.textContent =
            error.message || 'Could not export notes.';

        showNotification(
            'Export failed',
            error.message || 'Could not export notes.',
            'error'
        );

        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

// ---------- Import ----------

window.promptImportNotes = () => {
    document.getElementById('modal-title').textContent = 'Import Notes';
    document.getElementById('modal-message').textContent = 'Select one or more files to import.';
    document.getElementById('modal-input-container').innerHTML = `
        <input id="notesImportFileInput" type="file" multiple accept=".json,.txt,.md,.pdf,.docx,application/json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="width:100%; padding: 10px 0;" />
        <p style="font-size: 13px; color: var(--text-dim); margin: 10px 0 0 0;">Supports JSON backups (full restore), plus .txt, .md, .pdf, and .docx — each becomes its own note.</p>
    `;
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = 'Upload';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
        await importNotesFromFile();
    };
    document.getElementById('custom-modal-overlay').style.display = 'flex';
    ProfileDialog.openWithAnimation(ProfileDialog.lastSourceEl);
};

async function extractTextFromPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF library failed to load.');
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pageTexts = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        pageTexts.push(textContent.items.map((item) => item.str).join(' '));
    }
    return pageTexts.join('\n\n');
}

async function extractTextFromDocx(file) {
    if (!window.mammoth) throw new Error('DOCX library failed to load.');
    const buffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || '';
}

function titleFromFilename(filename) {
    const base = (filename || 'Untitled').replace(/\.[^/.]+$/, '');
    return base.replace(/[-_]+/g, ' ').trim() || 'Untitled';
}

// Builds a {title, content} note from a single non-JSON file.
async function noteFromPlainFile(file) {
    const ext = getFileExtension(file.name);
    let text = '';

    if (ext === 'pdf') {
        text = await extractTextFromPdf(file);
    } else if (ext === 'docx') {
        text = await extractTextFromDocx(file);
    } else {
        text = await file.text(); // .txt, .md, and anything else readable as plain text
    }

    let title = titleFromFilename(file.name);
    if (ext === 'md') {
        // Prefer a leading "# Heading" as the title over the filename
        const headingMatch = text.match(/^\s*#\s+(.+)$/m);
        if (headingMatch) {
            title = headingMatch[1].trim();
            text = text.replace(headingMatch[0], '').trim();
        }
    }

    return {
        title,
        content: text.trim(),
        paper_style: 'blank',
        folder_id: null,
        pinned: false
    };
}

async function importNotesFromFile() {
    const fileInput = document.getElementById('notesImportFileInput');
    const messageEl = document.getElementById('modal-message');
    const statusEl = document.getElementById('exportStatus');
    const btn = document.getElementById('modal-confirm-btn');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showNotification('No file selected', 'Please choose at least one file to import.', 'error');
        return;
    }

    const files = Array.from(fileInput.files);
    const SUPPORTED_EXTS = ['json', 'txt', 'md', 'pdf', 'docx'];

    btn.disabled = true;
    messageEl.textContent = 'Reading file(s)...';
    statusEl.textContent = 'Importing...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        let importedNotes = [];
        let skipped = 0;

        for (const file of files) {
            const ext = getFileExtension(file.name);

            if (ext === 'json') {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const notesFromJson = Array.isArray(parsed.notes) ? parsed.notes : [];
                importedNotes = importedNotes.concat(notesFromJson);
            } else if (SUPPORTED_EXTS.includes(ext)) {
                messageEl.textContent = `Extracting text from ${file.name}...`;
                importedNotes.push(await noteFromPlainFile(file));
            } else {
                console.warn('[Import] Skipping unsupported file:', file.name);
                skipped += 1;
            }
        }

        if (importedNotes.length === 0) {
            throw new Error('No importable notes found in the selected file(s).');
        }

        messageEl.textContent = `Encrypting ${importedNotes.length} notes...`;

        const rows = [];
        for (const note of importedNotes) {
            const title = note.title || '';
            const content = note.content || '';
            rows.push({
                title: title.startsWith('enc:')
                ? title
                : await encryptWithMasterKey(title),
                
                content: content.startsWith('enc:')
                ? content
                : await encryptWithMasterKey(content),

                paper_style: note.paper_style || 'blank',
                user_id: currentUser.id,
                folder_id: note.folder_id || null,
                pinned: note.pinned || false,

                created_at: note.created_at || new Date().toISOString(),
                updated_at: note.updated_at || new Date().toISOString()
});
        }

        messageEl.textContent = 'Uploading encrypted notes...';

        const { data, error } = await supabase
            .from('notes')
            .insert(rows);

        if (error) throw error;

        const noteWord = rows.length === 1 ? 'note' : 'notes';
        statusEl.textContent = `✓ Imported ${rows.length} ${noteWord}`;
        statusEl.style.color = 'var(--accent)';
        messageEl.textContent = skipped > 0
            ? `Notes uploaded successfully. Skipped ${skipped} unsupported file${skipped === 1 ? '' : 's'}.`
            : 'Notes uploaded successfully.';
        showNotification('Import complete', `Imported ${rows.length} ${noteWord}.`, 'success');
        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Import error:', error);
        statusEl.textContent = '✕ Import failed';
        statusEl.style.color = 'var(--accent1)';
        messageEl.textContent = `Import failed: ${error.message || 'Invalid file.'}`;
        showNotification('Import failed', error.message || 'Invalid backup file.', 'error');
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

// Dynamic notification system (mirrors settings.js so export/import/etc. all
// surface consistent, dismissible, swipeable toasts app-wide)
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
            <span>${title}</span>
        </div>
        <div style="opacity: 0.9; font-size: 13px; margin-left: 24px;">${message}</div>
    `;

    container.appendChild(notification);

    const animateToast = window.AnimationUtils?.toast || function (el, direction, cb) {
        el.style.animation = direction === 'in'
            ? 'toastSlideIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
            : 'toastSlideOut 0.3s ease-in forwards';
        if (direction === 'out') setTimeout(() => cb && cb(), 300);
    };

    animateToast(notification, 'in');

    // Shared dismiss helper function (used by timeout, tap, and the X button)
    const dismiss = () => {
        if (notification._timeout) clearTimeout(notification._timeout);
        animateToast(notification, 'out', () => notification.remove());
    };

    // Store timeout reference on the element so MAX_NOTIFICATIONS check can clear it
    notification._timeout = setTimeout(dismiss, 1600);

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
        closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // --- Swipe-to-dismiss (touch and mouse drag, via Pointer Events) ---
    const SWIPE_THRESHOLD = 80;
    const SWIPE_VELOCITY_THRESHOLD = 0.5;
    let drag = null;

    notification.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.notif-close')) return;
        drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startTime: Date.now(),
            currentX: 0,
            axis: null
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

        if (drag.axis !== 'x') return;

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
            if (notification._timeout) clearTimeout(notification._timeout);
            notification.style.transform = '';
            notification.style.setProperty('--drag-x', `${currentX}px`);
            if (window.AnimationUtils) {
                const swipeOut = currentX > 0 ? window.AnimationUtils.swipeOutRight : window.AnimationUtils.swipeOutLeft;
                swipeOut(notification, 250, () => notification.remove());
            } else {
                notification.classList.add(currentX > 0 ? 'animate-toast-swipe-out-right' : 'animate-toast-swipe-out-left');
                setTimeout(() => notification.remove(), 250);
            }
        } else {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        }
    };

    notification.addEventListener('pointerup', endDrag);
    notification.addEventListener('pointercancel', endDrag);
}

window.openModal = (title, message, buttonText, buttonColor, callback, sourceEl) => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-confirm-btn').textContent = buttonText;
    document.getElementById('modal-confirm-btn').style.background = buttonColor;
    document.getElementById('modal-confirm-btn').onclick = callback;
    document.getElementById('custom-modal-overlay').style.display = 'flex';
    
    // Use ripple animation from source element
    ProfileDialog.openWithAnimation(sourceEl || ProfileDialog.lastSourceEl);
};

window.closeCustomModal = () => {
    ProfileDialog.closeWithAnimation();
};

// Enhanced Dialog Controller for Profile (Similar to SettingsDialog in settings.js)
const ProfileDialog = {
    overlay: document.getElementById('custom-modal-overlay'),
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

        this.overlay.classList.remove('hidden');

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
        if (!this.overlay || this.overlay.classList.contains('hidden') || !this.modalBox) return;

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
            this.overlay.classList.add('hidden');
            this.overlay.style.display = 'none';
            if (this.modalBox) {
                this.modalBox.style.transform = '';
                this.modalBox.style.transformOrigin = 'center center';
            }
        }, 520);
    }
};

// Track which button triggered the modal
document.addEventListener('click', (e) => {
    const button = e.target.closest('[onclick*="Modal"], [onclick*="Export"], [onclick*="Import"], .clickable, .settings-action-btn, button');
    if (button) {
        ProfileDialog.lastSourceEl = button;
    }
});

document.getElementById('custom-modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('custom-modal-overlay')) {
        window.closeCustomModal();
    }
});