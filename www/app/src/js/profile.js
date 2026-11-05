// TOP OF FILE: Import Supabase directly from the CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.6/+esm'

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

// Finds the user's "Imports" folder, creating it the first time it's needed.
async function getOrCreateImportsFolder() {
    const { data: existing, error: findError } = await supabase
        .from('folders')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('name', 'Imports')
        .limit(1)
        .maybeSingle();

    if (findError) throw findError;
    if (existing) return existing.id;

    const { data: created, error: createError } = await supabase
        .from('folders')
        .insert([{ name: 'Imports', user_id: currentUser.id }])
        .select('id')
        .single();

    if (createError) throw createError;
    return created.id;
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ---------- Animated progress bar (export modal) ----------

function ensureProgressBar() {
    let wrap = document.getElementById('exportProgressWrap');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'exportProgressWrap';
    wrap.style.cssText = 'margin-top: 16px;';
    wrap.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:6px;">
            <span id="exportProgressLabel">Preparing…</span>
            <span id="exportProgressPct">0%</span>
        </div>
        <div style="height:6px; border-radius:999px; background:var(--bg-input); overflow:hidden;">
            <div id="exportProgressBar" style="height:100%; width:0%; background:var(--accent); border-radius:999px; transition:width 0.25s cubic-bezier(0.25,0.46,0.45,0.94);"></div>
        </div>
    `;

    const container = document.getElementById('modal-input-container');
    if (container) container.appendChild(wrap);
    return wrap;
}

function setExportProgress(fraction, label) {
    ensureProgressBar();
    const bar = document.getElementById('exportProgressBar');
    const pct = document.getElementById('exportProgressPct');
    const lbl = document.getElementById('exportProgressLabel');
    const clamped = Math.max(0, Math.min(1, fraction));

    if (bar) bar.style.width = `${Math.round(clamped * 100)}%`;
    if (pct) pct.textContent = `${Math.round(clamped * 100)}%`;
    if (lbl && label) lbl.textContent = label;
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
                <input type="radio" name="exportFormat" value="zip" style="margin-top:3px;width: 22px;height: 22px;">
                <span><strong>ZIP</strong> — each note as .txt, with images saved in their own format</span>
            </label>
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                <input type="radio" name="exportFormat" value="json" checked style="margin-top:3px;width: 22px;height: 22px;">
                <span><strong>JSON</strong> — all notes in one file, no images</span>
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

function exportNotesAsJson(decryptedNotes, recoveryInfo) {
    const exportData = {
        notozBackup: true,
        formatVersion: 1,
        exportDate: new Date().toISOString(),
        userEmail: currentUser.email,
        displayName: currentUser.user_metadata?.display_name || 'User',
        totalNotes: decryptedNotes.length,
        notes: decryptedNotes
    };

    if (recoveryInfo && recoveryInfo.failedNotes.length > 0) {
        exportData.failedNotes = recoveryInfo.failedNotes.map((f) => ({ id: f.id, error: f.error }));
        exportData.recoveryWarning = 'Some notes could not be decrypted and are NOT included above. If recoveryKeyBase64 is present, it is the raw local encryption key — it can decrypt ALL of your notes, so keep this file private and delete it once you no longer need it.';
        if (recoveryInfo.recoveryKeyB64) exportData.recoveryKeyBase64 = recoveryInfo.recoveryKeyB64;
        if (recoveryInfo.recoveryKeyError) exportData.recoveryKeyError = recoveryInfo.recoveryKeyError;
    }

    downloadBlob(
        new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }),
        `notes-backup-${new Date().toISOString().split('T')[0]}.json`
    );
}

async function exportNotesAsZip(decryptedNotes, onProgress, recoveryInfo) {
    await loadImportLibrary('jszip');

    const zip = new window.JSZip();
    const notesFolder = zip.folder('notes');
    const imagesFolder = zip.folder('images');
    const total = decryptedNotes.length || 1;
    const manifestNotes = [];

    for (let i = 0; i < decryptedNotes.length; i++) {
        const note = decryptedNotes[i];
        if (onProgress) onProgress(0.6 + (i / total) * 0.3, `Packing note ${i + 1} of ${decryptedNotes.length}...`);

        const { plainText, images } = await extractPlainTextAndImages(note.content, i + 1);
        const safeTitle = sanitizeFilename(note.title, `note-${i + 1}`);
        const heading = note.title || 'Untitled';
        const header = `${heading}\n${'='.repeat(heading.length)}\n\n`;
        const txtFilename = `${i + 1}-${safeTitle}.txt`;

        notesFolder.file(txtFilename, header + plainText);
        images.forEach((img) => imagesFolder.file(img.filename, img.blob));

        // Machine-readable companion to the human-readable .txt files, so
        // Restore Backup can rebuild folder/pin/style/dates exactly.
        manifestNotes.push({
            index: i + 1,
            title: note.title || 'Untitled',
            paper_style: note.paper_style || 'blank',
            folder_id: note.folder_id || null,
            pinned: !!note.pinned,
            created_at: note.created_at || null,
            updated_at: note.updated_at || null,
            textFile: `notes/${txtFilename}`,
            images: images.map((img) => `images/${img.filename}`)
        });
    }

    // Special-encoding marker Restore Backup looks for, so a stray .zip of
    // random files can't be mistaken for one of our backups.
    zip.file('backup-manifest.json', JSON.stringify({
        notozBackup: true,
        formatVersion: 1,
        exportDate: new Date().toISOString(),
        userEmail: currentUser.email,
        totalNotes: decryptedNotes.length,
        notes: manifestNotes
    }, null, 2));

    if (recoveryInfo && recoveryInfo.failedNotes.length > 0) {
        const lines = [
            `${recoveryInfo.failedNotes.length} note(s) could not be decrypted and are NOT included in this backup:`,
            ...recoveryInfo.failedNotes.map((f) => `  - note ${f.id}: ${f.error}`),
            ''
        ];

        if (recoveryInfo.recoveryKeyB64) {
            lines.push(
                'A recovery key is included below for these notes.',
                'This is the raw local encryption key — it can decrypt ALL of your notes, not just the failed ones.',
                'Keep this file private and delete it once you no longer need it.',
                '',
                `Recovery key (base64, AES-GCM): ${recoveryInfo.recoveryKeyB64}`
            );
        } else {
            lines.push(recoveryInfo.recoveryKeyError || 'No recovery key could be generated for this session.');
        }

        zip.file('RECOVERY-README.txt', lines.join('\n'));
    }

    if (onProgress) onProgress(0.92, 'Compressing files...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        if (onProgress) {
            onProgress(0.92 + (metadata.percent / 100) * 0.08, `Compressing files... ${Math.round(metadata.percent)}%`);
        }
    });
    downloadBlob(zipBlob, `notes-backup-${new Date().toISOString().split('T')[0]}.zip`);
}

async function exportNotesToFile(format = 'json') {
    const btn = document.getElementById('modal-confirm-btn');
    const statusEl = document.getElementById('exportStatus');
    const messageEl = document.getElementById('modal-message');

    // Lock the format choice in and show the progress bar
    document.querySelectorAll('input[name="exportFormat"]').forEach((el) => { el.disabled = true; });
    btn.disabled = true;
    setExportProgress(0, 'Starting export...');

    messageEl.textContent = 'Fetching notes...';
    statusEl.textContent = 'Exporting...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        const { decryptedNotes, failedNotes } = await fetchAndDecryptNotes((current, total, message) => {
            messageEl.textContent = message;
            if (total > 0) {
                setExportProgress((current / total) * 0.6, message);
                statusEl.textContent = `Decrypting ${current}/${total}`;
            }
        });

        if (decryptedNotes.length === 0 && failedNotes.length > 0) {
            throw new Error(`All ${failedNotes.length} notes failed to decrypt. Nothing could be exported.`);
        }

        // If some (but not all) notes failed, still export what succeeded and
        // attach a recovery key so the rest can be decrypted manually later.
        let recoveryInfo = null;
        if (failedNotes.length > 0) {
            setExportProgress(0.62, 'Preparing recovery key...');
            let recoveryKeyB64 = null;
            let recoveryKeyError = null;
            try {
                const key = await getSessionMasterKey();
                if (key) {
                    const raw = await crypto.subtle.exportKey('raw', key);
                    recoveryKeyB64 = _b64FromBuf(raw);
                } else {
                    recoveryKeyError = 'No local session key was available to export.';
                }
            } catch (err) {
                console.warn('[Export] Could not export raw recovery key:', err);
                recoveryKeyError = "This session's key isn't exportable, so no recovery key could be generated.";
            }
            recoveryInfo = { failedNotes, recoveryKeyB64, recoveryKeyError };
        }

        if (format === 'zip') {
            await exportNotesAsZip(decryptedNotes, (fraction, label) => setExportProgress(fraction, label), recoveryInfo);
        } else {
            setExportProgress(0.7, 'Building JSON file...');
            exportNotesAsJson(decryptedNotes, recoveryInfo);
        }

        setExportProgress(1, 'Done!');

        const noteWord = decryptedNotes.length === 1 ? 'note' : 'notes';

        if (failedNotes.length > 0) {
            statusEl.textContent = `⚠ Exported ${decryptedNotes.length} ${noteWord}, ${failedNotes.length} failed`;
            statusEl.style.color = 'var(--accent1)';
            messageEl.textContent = recoveryInfo.recoveryKeyB64
                ? `${failedNotes.length} note(s) couldn't be decrypted — a recovery key was included in your download so you can recover them manually.`
                : `${failedNotes.length} note(s) couldn't be decrypted and were left out. ${recoveryInfo.recoveryKeyError}`;
            showNotification(
                'Export finished with issues',
                `${failedNotes.length} note(s) failed to decrypt.${recoveryInfo.recoveryKeyB64 ? ' A recovery key was included.' : ''}`,
                'error'
            );
        } else {
            statusEl.textContent = `✓ Exported ${decryptedNotes.length} ${noteWord}`;
            statusEl.style.color = 'var(--accent)';
            messageEl.textContent = format === 'zip'
                ? 'ZIP backup created and downloaded successfully.'
                : 'JSON backup created and downloaded successfully.';
            showNotification('Export complete', `Exported ${decryptedNotes.length} ${noteWord} as ${format.toUpperCase()}.`, 'success');
        }

        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Export error:', error);

        statusEl.textContent = '✕ Export failed';
        statusEl.style.color = 'var(--accent1)';
        messageEl.textContent = error.message || 'Could not export notes.';
        showNotification('Export failed', error.message || 'Could not export notes.', 'error');

        document.querySelectorAll('input[name="exportFormat"]').forEach((el) => { el.disabled = false; });
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

// ---------- Import Files (single files -> "Imports" folder) ----------

const IMPORT_LIBRARY_SOURCES = {
    dompurify: ['https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js', 'DOMPurify'],
    jszip: ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip'],
    pdfjs: ['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'pdfjsLib'],
    mammoth: ['https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js', 'mammoth'],
    marked: ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'marked']
};
const importLibraryPromises = new Map();

function loadImportLibrary(name) {
    const source = IMPORT_LIBRARY_SOURCES[name];
    if (!source) return Promise.reject(new Error(`Unknown import library: ${name}`));
    const [url, globalName] = source;
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (importLibraryPromises.has(name)) return importLibraryPromises.get(name);

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => window[globalName]
            ? resolve(window[globalName])
            : reject(new Error(`${name} library loaded without its expected global.`));
        script.onerror = () => reject(new Error(`Could not load ${name} library.`));
        document.head.appendChild(script);
    });
    importLibraryPromises.set(name, promise);
    return promise;
}

async function ensureImportLibraries(files) {
    const extensions = new Set(files.map((file) => getFileExtension(file.name)));
    const libraries = ['dompurify'];
    if (extensions.has('pdf')) libraries.push('pdfjs');
    if (extensions.has('docx')) libraries.push('mammoth');
    if (extensions.has('md')) libraries.push('marked');
    await Promise.all(libraries.map((name) => loadImportLibrary(name)));
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
}

window.promptImportFiles = () => {
    document.getElementById('modal-title').textContent = 'Import Files';
    document.getElementById('modal-message').textContent = 'Select one or more files. Each becomes a new note in your "Imports" folder.';
    document.getElementById('modal-input-container').innerHTML = `
        <input id="notesImportFileInput" type="file" multiple accept=".txt,.md,.pdf,.docx,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,image/*" style="width:100%; padding: 10px 0;" />
        <p style="font-size: 13px; color: var(--text-dim); margin: 10px 0 0 0;">Supports text, Markdown, PDF, Word, HTML, and image files. For a full backup restore (.json/.zip), use "Restore Backup" instead.</p>
        <div id="importProgress" class="import-progress" hidden aria-live="polite">
            <span class="import-spinner" aria-hidden="true"></span>
            <span id="importProgressText">Preparing import...</span>
        </div>
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

function textToHtml(text) {
    const paragraphs = (text || '').split(/\n\s*\n/); // blank-line separated
    return paragraphs
        .map((para) => para.trim())
        .filter((para) => para.length > 0)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function markdownToHtml(text) {
    if (window.marked) {
        try {
            return typeof window.marked.parse === 'function' ? window.marked.parse(text) : window.marked(text);
        } catch (err) {
            console.warn('[Import] Markdown parse failed, falling back to plain text:', err);
        }
    }
    return textToHtml(text);
}

function pdfTextItemsToHtml(items) {
    const positioned = items
        .filter((item) => item.str && item.str.trim())
        .map((item) => ({
            text: item.str.trim(),
            x: item.transform[4],
            y: item.transform[5],
            size: Math.max(1, Math.abs(item.transform[0]) || item.height || 12),
            width: item.width || 0
        }));

    if (!positioned.length) return '';

    const sizes = positioned.map((item) => item.size).sort((a, b) => a - b);
    const bodySize = sizes[Math.floor(sizes.length / 2)] || 12;
    const lines = [];
    const tolerance = Math.max(2, bodySize * 0.35);

    for (const item of positioned.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
        if (line) {
            const previous = line.items[line.items.length - 1];
            const gap = item.x - (previous.x + previous.width);
            line.items.push(item);
            line.text += (gap > Math.max(1, item.size * 0.12) ? ' ' : '') + item.text;
            line.size = Math.max(line.size, item.size);
        } else {
            lines.push({ y: item.y, size: item.size, items: [item], text: item.text });
        }
    }

    lines.sort((a, b) => b.y - a.y);
    const gaps = lines.slice(1).map((line, index) => Math.abs(lines[index].y - line.y));
    const typicalGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : bodySize * 1.3;
    const blocks = [];
    let current = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const previous = lines[i - 1];
        const gap = previous ? Math.abs(previous.y - line.y) : 0;
        const startsNewBlock = current.length && (gap > typicalGap * 1.65 || line.size > bodySize * 1.35);
        if (startsNewBlock) {
            blocks.push(current);
            current = [];
        }
        current.push(line);
    }
    if (current.length) blocks.push(current);

    const html = [];
    let listItems = [];
    let listType = null;
    const flushList = () => {
        if (!listItems.length) return;
        html.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listType}>`);
        listItems = [];
        listType = null;
    };

    for (const block of blocks) {
        const blockText = block.map((line) => line.text.trim()).filter(Boolean);
        if (!blockText.length) continue;
        const first = blockText[0];
        const bulletMatch = first.match(/^([\u2022\u25E6\u25AA\u25CF]|[-*])\s+(.*)$/);
        const numberMatch = first.match(/^\d+[.)]\s+(.*)$/);

        if (bulletMatch || numberMatch) {
            const nextType = numberMatch ? 'ol' : 'ul';
            if (listType && listType !== nextType) flushList();
            listType = nextType;
            const content = numberMatch ? numberMatch[1] : bulletMatch[2];
            listItems.push(escapeHtml([content, ...blockText.slice(1)].join(' ')));
            continue;
        }
        flushList();

        const text = escapeHtml(blockText.join(' '));
        const isHeading = block.length === 1 && block[0].size >= bodySize * 1.35;
        html.push(isHeading ? `<h2>${text}</h2>` : `<p>${text}</p>`);
    }
    flushList();
    return html.join('');
}

async function renderPdfPageAsDataUrl(page) {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return `<p class="imported-image"><img src="${canvas.toDataURL('image/png')}" alt="Imported PDF page" style="max-width:100%;height:auto;" /></p>`;
}

async function extractHtmlFromPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF library failed to load.');
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    if (pdf.numPages > IMPORT_LIMITS.maxPdfPages) {
        throw new Error(`PDF has ${pdf.numPages} pages; the limit is ${IMPORT_LIMITS.maxPdfPages}.`);
    }
    const pageHtml = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const reconstructed = pdfTextItemsToHtml(textContent.items);
        const operatorList = await page.getOperatorList();
        const imageOps = [
            window.pdfjsLib.OPS?.paintImageMaskXObject,
            window.pdfjsLib.OPS?.paintImageXObject,
            window.pdfjsLib.OPS?.paintInlineImageXObject
        ].filter((value) => value !== undefined);
        const containsImage = operatorList.fnArray.some((operator) => imageOps.includes(operator));

        // A full-page raster preserves scanned/embedded imagery, but adding it
        // beside reconstructed text duplicates every text glyph on the page.
        pageHtml.push(containsImage ? await renderPdfPageAsDataUrl(page) : reconstructed);
    }

    return pageHtml.join('<div><br></div>');
}

// mammoth embeds images as base64 data URIs by default, which matches this
// app's existing offline-image fallback format, so they come through intact.
async function extractHtmlFromDocx(file) {
    if (!window.mammoth) throw new Error('DOCX library failed to load.');
    const buffer = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({
        arrayBuffer: buffer,
        convertImage: window.mammoth.images.imgElement((image) => image.read('base64').then((base64) => ({
            src: `data:${image.contentType};base64,${base64}`
        })))
    });
    return result.value || '';
}

async function extractHtmlFile(file) {
    const html = await file.text();
    const container = document.createElement('div');
    container.innerHTML = html;
    container.querySelectorAll('script, style, link, meta, iframe, object, embed, form').forEach((element) => element.remove());
    container.querySelectorAll('*').forEach((element) => {
        [...element.attributes].forEach((attribute) => {
            if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
        });
    });
    return container.body?.innerHTML || container.innerHTML;
}

async function extractImageFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
        reader.readAsDataURL(file);
    });

    const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Could not decode image.'));
        element.src = dataUrl;
    });
    const scale = Math.min(1, IMPORT_LIMITS.maxImageDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const compactDataUrl = canvas.toDataURL('image/webp', 0.82);
    return `<p class="imported-image"><img src="${compactDataUrl}" alt="${escapeHtml(titleFromFilename(file.name))}" style="max-width:100%;height:auto;" /></p>`;
}

const IMPORT_LIMITS = {
    maxFileBytes: 20 * 1024 * 1024,
    maxPdfPages: 100,
    maxImageDimension: 2400
};

const IMPORT_HTML_ALLOWED_TAGS = [
    'div', 'br', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'b', 'strong', 'i', 'em', 'u', 'strike', 's', 'del', 'ins',
    'small', 'mark', 'sub', 'sup', 'a', 'img', 'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tfoot',
    'tr', 'th', 'td'
];
const IMPORT_HTML_ALLOWED_ATTR = [
    'style', 'class', 'href', 'target', 'rel', 'src', 'alt', 'title',
    'width', 'height', 'colspan', 'rowspan'
];

function sanitizeImportedHtml(html) {
    if (!html) return '';
    if (window.DOMPurify) {
        return window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: IMPORT_HTML_ALLOWED_TAGS,
            ALLOWED_ATTR: IMPORT_HTML_ALLOWED_ATTR
        });
    }

    const fallback = document.createElement('div');
    fallback.innerHTML = html;
    fallback.querySelectorAll('script, style, link, meta, iframe, object, embed, form').forEach((element) => element.remove());
    fallback.querySelectorAll('*').forEach((element) => {
        [...element.attributes].forEach((attribute) => {
            if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
        });
    });
    return fallback.innerHTML;
}

function titleFromFilename(filename) {
    const base = (filename || 'Untitled').replace(/\.[^/.]+$/, '');
    return base.replace(/[-_]+/g, ' ').trim() || 'Untitled';
}

// Builds a {title, content} note from a single plain file, converting it to
// proper HTML rather than dumping raw extracted text into the note body.
async function noteFromPlainFile(file) {
    const ext = getFileExtension(file.name);
    let html = '';
    let rawText = '';
    let title = titleFromFilename(file.name);

    if (ext === 'pdf') {
        html = await extractHtmlFromPdf(file);
    } else if (ext === 'docx') {
        html = await extractHtmlFromDocx(file);
        const container = document.createElement('div');
        container.innerHTML = html;
        const firstHeading = container.querySelector('h1, h2');
        if (firstHeading && firstHeading.textContent.trim()) {
            title = firstHeading.textContent.trim();
            firstHeading.remove();
            html = container.innerHTML;
        }
    } else if (ext === 'md') {
        rawText = await file.text();
        const headingMatch = rawText.match(/^\s*#\s+(.+)$/m);
        if (headingMatch) {
            title = headingMatch[1].trim();
            rawText = rawText.replace(headingMatch[0], '').trim();
        }
        html = markdownToHtml(rawText);
    } else if (ext === 'html' || ext === 'htm') {
        html = await extractHtmlFile(file);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) || file.type.startsWith('image/')) {
        html = await extractImageFile(file);
    } else {
        rawText = await file.text(); // .txt and anything else readable as plain text
        html = textToHtml(rawText);
    }

    return {
        title,
        content: sanitizeImportedHtml(html.trim()),
        paper_style: 'blank',
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
    const SUPPORTED_EXTS = ['txt', 'md', 'pdf', 'docx', 'html', 'htm', 'png', 'jpg', 'jpeg', 'webp', 'gif'];
    const progressEl = document.getElementById('importProgress');
    const progressTextEl = document.getElementById('importProgressText');

    btn.disabled = true;
    progressEl?.removeAttribute('hidden');
    const setProgress = (text) => {
        if (progressTextEl) progressTextEl.textContent = text;
        messageEl.textContent = text;
    };
    setProgress('Reading file(s)...');
    statusEl.textContent = 'Importing...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        setProgress('Preparing import tools...');
        await ensureImportLibraries(files);
        let importedNotes = [];
        let skipped = 0;
        const failed = [];

        for (const file of files) {
            const ext = getFileExtension(file.name);

            if (ext === 'json' || ext === 'zip') {
                // Backups go through Restore Backup instead, so their metadata
                // (folders, pins, styles) is preserved rather than flattened.
                console.warn('[Import] Skipping backup file in Import Files flow:', file.name);
                skipped += 1;
            } else if (SUPPORTED_EXTS.includes(ext)) {
                if (file.size > IMPORT_LIMITS.maxFileBytes) {
                    failed.push(`${file.name} (over 20 MB)`);
                    continue;
                }
                setProgress(`Converting ${file.name}...`);
                try {
                    importedNotes.push(await noteFromPlainFile(file));
                } catch (error) {
                    console.warn(`[Import] Could not convert ${file.name}:`, error);
                    failed.push(`${file.name} (${error.message || 'conversion failed'})`);
                }
            } else {
                console.warn('[Import] Skipping unsupported file:', file.name);
                skipped += 1;
            }
        }

        if (importedNotes.length === 0) {
            const detail = failed.length ? ` Failed: ${failed.join(', ')}` : '';
            throw new Error(`No files could be imported. (.json/.zip backups use "Restore Backup" instead.)${detail}`);
        }

        setProgress('Finding your Imports folder...');
        const importsFolderId = await getOrCreateImportsFolder();

        setProgress(`Encrypting ${importedNotes.length} notes...`);

        const rows = [];
        for (const note of importedNotes) {
            rows.push({
                title: await encryptWithMasterKey(note.title || ''),
                content: await encryptWithMasterKey(note.content || ''),
                paper_style: note.paper_style || 'blank',
                user_id: currentUser.id,
                folder_id: importsFolderId,
                pinned: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }

        setProgress('Uploading encrypted notes...');

        const { error } = await supabase
            .from('notes')
            .insert(rows);

        if (error) throw error;

        const noteWord = rows.length === 1 ? 'note' : 'notes';
        statusEl.textContent = `✓ Imported ${rows.length} ${noteWord}`;
        statusEl.style.color = 'var(--accent)';
        progressEl?.setAttribute('hidden', '');
        const notices = [];
        if (skipped > 0) notices.push(`skipped ${skipped} unsupported file${skipped === 1 ? '' : 's'}`);
        if (failed.length) notices.push(`failed ${failed.length} file${failed.length === 1 ? '' : 's'}`);
        messageEl.textContent = notices.length
            ? `Added to your Imports folder; ${notices.join(' and ')}.`
            : 'Added to your Imports folder.';
        showNotification('Import complete', `Imported ${rows.length} ${noteWord} into "Imports".`, 'success');
        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Import error:', error);
        statusEl.textContent = '✕ Import failed';
        statusEl.style.color = 'var(--accent1)';
        progressEl?.setAttribute('hidden', '');
        messageEl.textContent = `Import failed: ${error.message || 'Invalid file.'}`;
        showNotification('Import failed', error.message || 'Invalid file.', 'error');
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

// ---------- Restore Backup (.json / .zip, full fidelity) ----------

function mimeFromExt(ext) {
    const map = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
    return map[ext] || 'image/png';
}

// Reads every file under images/ in the zip and returns a map of
// "images/filename.ext" -> base64 data URL, so placeholders can be re-inflated.
async function buildImageDataUrlMap(zip) {
    const map = {};
    const paths = Object.keys(zip.files).filter((p) => p.startsWith('images/') && !zip.files[p].dir);

    for (const path of paths) {
        const base64 = await zip.files[path].async('base64');
        const ext = getFileExtension(path);
        map[path] = `data:${mimeFromExt(ext)};base64,${base64}`;
    }

    return map;
}

// Turns a plain-text note body (with "[Image: images/...]" placeholders) back
// into HTML, re-inflating each placeholder as a real <img> tag.
function restoreContentFromZipText(bodyText, imageDataUrlByPath) {
    const withImages = (bodyText || '').replace(/\[Image: (images\/[^\]]+)\]/g, (match, path) => {
        const dataUrl = imageDataUrlByPath[path];
        return dataUrl ? `<img src="${dataUrl}" style="max-width:95%;border-radius:12px;" />` : '[Image unavailable]';
    });
    return textToHtml(withImages);
}

// Parses a backup .zip into restorable notes. Prefers backup-manifest.json
// for full-fidelity restore (folder/pin/style/dates); falls back to reading
// notes/*.txt directly for older zips exported before the manifest existed.
async function restoreNotesFromZip(zip) {
    const imageMap = await buildImageDataUrlMap(zip);
    const manifestFile = zip.file('backup-manifest.json');
    let manifest = null;

    if (manifestFile) {
        try {
            const manifestText = await manifestFile.async('string');
            const parsed = JSON.parse(manifestText);
            if (parsed && parsed.notozBackup) manifest = parsed;
        } catch (err) {
            console.warn('[Restore] Could not parse backup-manifest.json:', err);
        }
    }

    const restoredNotes = [];

    if (manifest && Array.isArray(manifest.notes)) {
        for (const entry of manifest.notes) {
            const txtFile = zip.file(entry.textFile);
            let body = '';
            if (txtFile) {
                const raw = await txtFile.async('string');
                const heading = entry.title || 'Untitled';
                const header = `${heading}\n${'='.repeat(heading.length)}\n\n`;
                body = raw.startsWith(header) ? raw.slice(header.length) : raw;
            }
            restoredNotes.push({
                title: entry.title || 'Untitled',
                content: restoreContentFromZipText(body, imageMap),
                paper_style: entry.paper_style || 'blank',
                folder_id: entry.folder_id || null,
                pinned: !!entry.pinned,
                created_at: entry.created_at || undefined,
                updated_at: entry.updated_at || undefined
            });
        }
        return { notes: restoredNotes, hadManifest: true };
    }

    // Fallback for zips without a manifest (older exports) — parse the
    // "Title\n=====\n\n" header off each notes/*.txt by hand.
    const txtPaths = Object.keys(zip.files).filter((p) => p.startsWith('notes/') && p.endsWith('.txt') && !zip.files[p].dir);

    for (const path of txtPaths) {
        const raw = await zip.files[path].async('string');
        const lines = raw.split('\n');
        let title = 'Untitled';
        let body = raw;

        if (lines[0] && lines[1] && /^=+$/.test(lines[1].trim())) {
            title = lines[0].trim();
            body = lines.slice(3).join('\n');
        }

        restoredNotes.push({
            title,
            content: restoreContentFromZipText(body, imageMap),
            paper_style: 'blank',
            folder_id: null,
            pinned: false
        });
    }

    return { notes: restoredNotes, hadManifest: false };
}

window.promptRestoreBackup = () => {
    document.getElementById('modal-title').textContent = 'Restore Backup';
    document.getElementById('modal-message').textContent = "Select a backup file created by this app's export (.json or .zip). Folders, pins, and styles are restored as they were.";
    document.getElementById('modal-input-container').innerHTML = `
        <input id="restoreBackupFileInput" type="file" accept=".json,.zip,application/json,application/zip" style="width:100%; padding: 10px 0;" />
        <p style="font-size: 13px; color: var(--text-dim); margin: 10px 0 0 0;">Only backups exported from this app are supported. For plain text, Markdown, PDF, or Word files, use "Import File/Notes" instead.</p>
    `;
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = 'Restore';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
        await restoreBackupFromFile();
    };
    document.getElementById('custom-modal-overlay').style.display = 'flex';
    ProfileDialog.openWithAnimation(ProfileDialog.lastSourceEl);
};

async function restoreBackupFromFile() {
    const fileInput = document.getElementById('restoreBackupFileInput');
    const messageEl = document.getElementById('modal-message');
    const statusEl = document.getElementById('exportStatus');
    const btn = document.getElementById('modal-confirm-btn');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showNotification('No file selected', 'Please choose a backup file to restore.', 'error');
        return;
    }

    const file = fileInput.files[0];
    const ext = getFileExtension(file.name);

    if (!['json', 'zip'].includes(ext)) {
        showNotification('Unsupported file', 'Restore only accepts .json or .zip backups exported from this app.', 'error');
        return;
    }

    btn.disabled = true;
    setExportProgress(0, 'Reading backup...');
    messageEl.textContent = 'Reading backup file...';
    statusEl.textContent = 'Restoring...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        let restoredNotes = [];

        if (ext === 'json') {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const recognized = parsed && (parsed.notozBackup === true || Array.isArray(parsed.notes));
            if (!recognized) throw new Error('This file is not a recognized backup. Use "Import Files" for plain notes.');
            restoredNotes = Array.isArray(parsed.notes) ? parsed.notes : [];
        } else {
            await loadImportLibrary('jszip');
            setExportProgress(0.1, 'Unpacking ZIP...');
            const zip = await window.JSZip.loadAsync(file);
            const { notes } = await restoreNotesFromZip(zip);
            restoredNotes = notes;
        }

        if (restoredNotes.length === 0) {
            throw new Error('No notes found in this backup.');
        }

        setExportProgress(0.4, 'Checking folders...');

        // Original folder_ids may point at folders that no longer exist —
        // fall back to no folder rather than failing the whole restore.
        const referencedFolderIds = [...new Set(restoredNotes.map((n) => n.folder_id).filter(Boolean))];
        let validFolderIds = new Set();
        if (referencedFolderIds.length > 0) {
            const { data: existingFolders } = await supabase
                .from('folders')
                .select('id')
                .eq('user_id', currentUser.id)
                .in('id', referencedFolderIds);
            validFolderIds = new Set((existingFolders || []).map((f) => f.id));
        }

        const rows = [];
        for (let i = 0; i < restoredNotes.length; i++) {
            const note = restoredNotes[i];
            const title = note.title || '';
            const content = note.content || '';
            setExportProgress(0.5 + (i / restoredNotes.length) * 0.4, `Encrypting note ${i + 1} of ${restoredNotes.length}...`);
            messageEl.textContent = `Encrypting note ${i + 1} of ${restoredNotes.length}...`;

            rows.push({
                title: title.startsWith('enc:') ? title : await encryptWithMasterKey(title),
                content: content.startsWith('enc:') ? content : await encryptWithMasterKey(content),
                paper_style: note.paper_style || 'blank',
                user_id: currentUser.id,
                folder_id: validFolderIds.has(note.folder_id) ? note.folder_id : null,
                pinned: !!note.pinned,
                created_at: note.created_at || new Date().toISOString(),
                updated_at: note.updated_at || new Date().toISOString()
            });
        }

        setExportProgress(0.92, 'Uploading restored notes...');
        messageEl.textContent = 'Uploading restored notes...';

        const { error } = await supabase
            .from('notes')
            .insert(rows);

        if (error) throw error;

        setExportProgress(1, 'Done!');
        const noteWord = rows.length === 1 ? 'note' : 'notes';
        statusEl.textContent = `✓ Restored ${rows.length} ${noteWord}`;
        statusEl.style.color = 'var(--accent)';
        messageEl.textContent = 'Backup restored successfully.';
        showNotification('Restore complete', `Restored ${rows.length} ${noteWord}.`, 'success');
        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Restore error:', error);
        statusEl.textContent = '✕ Restore failed';
        statusEl.style.color = 'var(--accent1)';
        messageEl.textContent = `Restore failed: ${error.message || 'Invalid backup file.'}`;
        showNotification('Restore failed', error.message || 'Invalid backup file.', 'error');
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