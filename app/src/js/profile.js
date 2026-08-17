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

function getLocalMasterKeyBytes() {
    const stored = localStorage.getItem('notes_master_key');
    return stored ? _bufFromB64(stored) : null;
}

async function encryptWithMasterKey(plaintext) {
    if (!plaintext) return '';
    const mk = getLocalMasterKeyBytes();
    if (!mk) throw new Error('Master key not available locally.');
    const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['encrypt']);
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
    if (!stored.startsWith('enc:')) return stored;
    const mk = getLocalMasterKeyBytes();
    if (!mk) return stored;
    const [, ivB64, ctB64] = stored.split(':');
    const iv = _bufFromB64(ivB64);
    const ct = _bufFromB64(ctB64);
    const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
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
        showNotification('Error initializing profile', 'error');
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
        showNotification('Error loading profile', 'error');
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
        showNotification('Display name cannot be empty', 'error');
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
        
        showNotification('Profile updated successfully!', 'success');
        
        // Reload after 1.5s to sync everything
        setTimeout(() => {
            window.location.reload();
        }, 1500);

    } catch (error) {
        console.error('[Profile] Error updating profile:', error);
        showNotification('Error: ' + error.message, 'error');
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

window.promptExportNotes = () => {
    document.getElementById('modal-title').textContent = 'Export Notes Backup';
    document.getElementById('modal-message').textContent = 'This will fetch your online notes, decrypt them locally, and create a JSON backup file.';
    document.getElementById('modal-input-container').innerHTML = '';
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = 'Export';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
        await exportNotesToFile();
    };
    document.getElementById('custom-modal-overlay').style.display = 'flex';
    ProfileDialog.openWithAnimation(ProfileDialog.lastSourceEl);
};

async function exportNotesToFile() {
    const btn = document.getElementById('modal-confirm-btn');
    const statusEl = document.getElementById('exportStatus');
    const messageEl = document.getElementById('modal-message');

    btn.disabled = true;
    messageEl.textContent = 'Fetching notes...';
    statusEl.textContent = 'Exporting...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        const { data: notes, error } = await supabase
            .from('notes')
            .select('*')
            .eq('user_id', currentUser.id);

        if (error) throw error;

        const decryptedNotes = [];
        for (const note of notes || []) {
            decryptedNotes.push({
                title: await decryptContent(note.title),
                content: await decryptContent(note.content),
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
            displayName: currentUser.user_metadata?.display_name || 'User',
            totalNotes: decryptedNotes.length,
            notes: decryptedNotes
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `notes-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        statusEl.textContent = `✓ Exported ${decryptedNotes.length} ${decryptedNotes.length === 1 ? 'note' : 'notes'}`;
        statusEl.style.color = 'var(--accent)';
        messageEl.textContent = 'Backup created and downloaded successfully.';
        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Export error:', error);
        statusEl.textContent = '✕ Export failed';
        statusEl.style.color = 'var(--accent1)';
        messageEl.textContent = 'Could not export notes. Make sure your encryption key is available.';
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

window.promptImportNotes = () => {
    document.getElementById('modal-title').textContent = 'Import Notes Backup';
    document.getElementById('modal-message').textContent = 'Select a JSON backup file with plain note text. Notes will be encrypted locally and uploaded to your account.';
    document.getElementById('modal-input-container').innerHTML = `
        <input id="notesImportFileInput" type="file" accept="application/json" style="width:100%; padding: 10px 0;" />
        <p style="font-size: 13px; color: var(--text-dim); margin: 10px 0 0 0;">Choose the JSON file created by the notes export.</p>
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

async function importNotesFromFile() {
    const fileInput = document.getElementById('notesImportFileInput');
    const messageEl = document.getElementById('modal-message');
    const statusEl = document.getElementById('exportStatus');
    const btn = document.getElementById('modal-confirm-btn');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showNotification('Please choose a JSON file to import.', 'error');
        return;
    }

    const file = fileInput.files[0];
    btn.disabled = true;
    messageEl.textContent = 'Reading backup file...';
    statusEl.textContent = 'Importing...';
    statusEl.style.color = 'var(--text-dim)';

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedNotes = Array.isArray(parsed.notes) ? parsed.notes : [];

        if (importedNotes.length === 0) {
            throw new Error('Backup file contains no notes.');
        }

        messageEl.textContent = `Encrypting ${importedNotes.length} notes...`;

        const rows = [];
        for (const note of importedNotes) {
            const title = note.title || '';
            const content = note.content || '';
            rows.push({
                title: title.startsWith('enc:') ? title : await encryptWithMasterKey(title),
                content: content.startsWith('enc:') ? content : await encryptWithMasterKey(content),
                paper_style: note.paper_style || 'blank',
                user_id: currentUser.id,
                folder_id: note.folder_id || null,
                pinned: note.pinned || false,
                created_at: note.created_at || undefined,
                updated_at: note.updated_at || undefined
            });
        }

        messageEl.textContent = 'Uploading encrypted notes...';

        const { data, error } = await supabase
            .from('notes')
            .insert(rows);

        if (error) throw error;

        statusEl.textContent = `✓ Imported ${rows.length} ${rows.length === 1 ? 'note' : 'notes'}`;
        statusEl.style.color = 'var(--accent)';
        messageEl.textContent = 'Notes uploaded successfully.';
        btn.textContent = 'Done';
        btn.disabled = false;
        btn.onclick = window.closeCustomModal;
    } catch (error) {
        console.error('Import error:', error);
        statusEl.textContent = '✕ Import failed';
        statusEl.style.color = 'var(--accent1)';
        messageEl.textContent = `Import failed: ${error.message || 'Invalid backup file.'}`;
        btn.textContent = 'Try Again';
        btn.disabled = false;
    }
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.textContent = message;
    
    const bgColor = type === 'success' ? 'var(--accent)' : 'var(--accent1)';
    
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        background: ${bgColor};
        color: white;
        z-index: 9999;
        font-size: 14px;
        font-weight: 500;
        animation: slideUp 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideDown 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
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