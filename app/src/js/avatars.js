/**
 * Advanced Avatar Generator
 * Supports: Emoji Mode, Initials Mode, Meaningful Presets, Custom Gradients
 */

const AdvancedAvatarGenerator = {
    // Meaningful emoji categories
    emojiCategories: {
        nature: {
            name: 'Nature',
            emojis: ['🌿', '🌲', '🌳', '🌴', '🌵', '🌾', '🌻', '🌺', '🌸', '🌼', '🌷', '🌹']
        },
        animals: {
            name: 'Animals',
            emojis: ['🦁', '🐯', '🐻', '🐼', '🐨', '🦊', '🐺', '🐮', '🐷', '🐸', '🦅', '🦋']
        },
        celestial: {
            name: 'Celestial',
            emojis: ['⭐', '✨', '🌟', '💫', '🌙', '☀️', '🌤️', '⛅', '🌈', '☄️', '🌠', '🔭']
        },
        energy: {
            name: 'Energy & Power',
            emojis: ['🔥', '⚡', '💥', '✨', '💎', '🚀', '⚔️', '🎯', '🏆', '👑', '💪', '🎪']
        },
        creativity: {
            name: 'Creativity',
            emojis: ['🎨', '🎭', '🎪', '🎬', '🎸', '🎹', '🎺', '🖌️', '✏️', '🖍️', '🖊️', '✒️']
        },
        technology: {
            name: 'Technology',
            emojis: ['💻', '🖥️', '📱', '⌨️', '🖱️', '🔧', '🔨', '⚙️', '🛠️', '🔬', '🔭', '💡']
        },
        growth: {
            name: 'Growth & Learning',
            emojis: ['📚', '📖', '📝', '✍️', '🧠', '💡', '🎓', '🏅', '📈', '🌱', '🌿', '🔑']
        },
        vibes: {
            name: 'Vibes',
            emojis: ['😎', '🤓', '🥳', '😊', '🤗', '💪', '🎉', '✌️', '🙌', '👏', '🔮', '💫']
        },
        objects: {
            name: 'Objects',
            emojis: ['📚', '🎒', '🧳', '🎁', '🎀', '🎪', '🎢', '🎡', '🎠', '🎭', '🎬', '🎤']
        }
    },

    // Color palettes for initials/gradients
    colorPalettes: [
        { name: 'Coral Sunset', start: '#FF6B6B', end: '#FF8E72' },
        { name: 'Ocean Breeze', start: '#4ECDC4', end: '#44A08D' },
        { name: 'Mint Fresh', start: '#95E1D3', end: '#38ADA9' },
        { name: 'Dreamy Pink', start: '#F38181', end: '#AA96DA' },
        { name: 'Cotton Candy', start: '#FCBAD3', end: '#A6C0FE' },
        { name: 'Aurora', start: '#A8EDEA', end: '#FED6E3' },
        { name: 'Spicy Orange', start: '#FF9A56', end: '#FF6348' },
        { name: 'Royal Violet', start: '#667EEA', end: '#764BA2' },
        { name: 'Rose Garden', start: '#F093FB', end: '#F5576C' },
        { name: 'Sky Blue', start: '#4FACFE', end: '#00F2FE' },
        { name: 'Minty Green', start: '#43E97B', end: '#38F9D7' },
        { name: 'Sunny Yellow', start: '#FA709A', end: '#FEE140' },
        { name: 'Deep Space', start: '#30CFD0', end: '#330867' },
        { name: 'Earthy', start: '#A8E6CF', end: '#FFD3B6' },
        { name: 'Peachy', start: '#FF9671', end: '#FFC75F' }
    ],

    /**
     * Get all emojis flattened for easy access
     */
    getAllEmojis() {
        const all = [];
        Object.values(this.emojiCategories).forEach(category => {
            all.push(...category.emojis);
        });
        return all;
    },

    /**
     * Get color palette based on user ID (deterministic)
     */
    getColorPaletteForUser(userId) {
        if (!userId) return this.colorPalettes[0];
        const hash = userId.split('').reduce((acc, char) => {
            return acc + char.charCodeAt(0);
        }, 0);
        const index = hash % this.colorPalettes.length;
        return this.colorPalettes[index];
    },

    /**
     * Extract initials from name
     */
    getInitials(name) {
        if (!name || typeof name !== 'string') return 'U';
        const trimmed = name.trim();
        if (!trimmed) return 'U';
        const parts = trimmed.split(/[\s._-]+/).filter(p => p.length > 0);
        if (parts.length === 0) return 'U';
        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }
        return (parts[0][0] + parts[1][0]).toUpperCase();
    },

    /**
     * Create SVG avatar with initials - PROPERLY CENTERED
     */
    createInitialsSvg(initials, userId, customGradient = null) {
        const palette = customGradient || this.getColorPaletteForUser(userId);
        const gradId = `grad-${userId}-${Math.random().toString(36).substr(2, 9)}`;
        const svg = `
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:${palette.start};stop-opacity:1" />
                        <stop offset="100%" style="stop-color:${palette.end};stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle cx="100" cy="100" r="100" fill="url(#${gradId})"/>
                <text x="100" y="110" font-size="80" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="white"
                    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
                    ${initials}
                </text>
            </svg>
        `;
        return svg;
    },

    /**
     * Create SVG avatar with emoji - PROPERLY CENTERED with gradient background
     */
    createEmojiSvg(emoji, customGradient = null) {
        const bgGradient = customGradient || { start: '#f0f0f0', end: '#e8e8e8' };
        const gradId = `grad-emoji-${Math.random().toString(36).substr(2, 9)}`;
        const svg = `
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:${bgGradient.start};stop-opacity:1" />
                        <stop offset="100%" style="stop-color:${bgGradient.end};stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle cx="100" cy="100" r="100" fill="url(#${gradId})"/>
                <text x="100" y="105" font-size="100" text-anchor="middle" dominant-baseline="middle">
                    ${emoji}
                </text>
            </svg>
        `;
        return svg;
    },

    /**
     * Get base64 data URL for avatar
     */
    getAvatarBase64(initials, userId, emoji = null, customGradient = null) {
        const svg = emoji 
            ? this.createEmojiSvg(emoji, customGradient)
            : this.createInitialsSvg(initials, userId, customGradient);
        const base64 = btoa(unescape(encodeURIComponent(svg)));
        return `data:image/svg+xml;base64,${base64}`;
    },

    /**
     * Update an HTML element with avatar
     */
    updateAvatarElement(element, initials, userId, emoji = null, customGradient = null) {
        if (!element) return;
        const base64Url = this.getAvatarBase64(initials, userId, emoji, customGradient);
        if (element.tagName === 'IMG') {
            element.src = base64Url;
            element.alt = emoji || initials;
        } else {
            element.style.backgroundImage = `url('${base64Url}')`;
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
        }
    },

    /**
     * Create gradient picker HTML
     */
    createGradientPickerHTML() {
        let html = '<div class="gradient-picker">';
        
        this.colorPalettes.forEach((palette, index) => {
            html += `
                <button type="button" 
                    class="gradient-btn" 
                    onclick="window.AdvancedAvatarGenerator.selectGradient(${index})"
                    title="${palette.name}"
                    style="background: linear-gradient(135deg, ${palette.start}, ${palette.end});">
                    <span class="gradient-name">${palette.name}</span>
                </button>
            `;
        });
        
        html += '</div>';
        return html;
    },

    /**
     * Open gradient picker modal
     */
    openGradientPicker(onSelect) {
        const modal = document.createElement('div');
        modal.id = 'gradientPickerModal';
        modal.className = 'gradient-picker-modal';
        modal.innerHTML = `
            <div class="gradient-picker-content">
                <div class="gradient-picker-header">
                    <h2>Choose Avatar Gradient</h2>
                    <button type="button" class="gradient-picker-close" onclick="document.getElementById('gradientPickerModal').remove()">✕</button>
                </div>
                ${this.createGradientPickerHTML()}
            </div>
        `;
        
        // Store callback name for later use
        modal.dataset.onSelect = onSelect;
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    },

    /**
     * Select gradient (called from picker)
     */
    selectGradient(index) {
        const modal = document.getElementById('gradientPickerModal');
        if (modal) {
            modal.remove();
        }
        // Dispatch custom event that profile page can listen to
        window.dispatchEvent(new CustomEvent('gradientSelected', { detail: { index, gradient: this.colorPalettes[index] } }));
    },

    /**
     * Create emoji picker HTML
     */
    createEmojiPickerHTML() {
        let html = '<div class="emoji-picker">';
        
        Object.entries(this.emojiCategories).forEach(([key, category]) => {
            html += `
                <div class="emoji-category">
                    <h4>${category.name}</h4>
                    <div class="emoji-grid">
            `;
            
            category.emojis.forEach(emoji => {
                html += `
                    <button type="button" class="emoji-btn" onclick="window.AdvancedAvatarGenerator.selectEmoji('${emoji}')">
                        ${emoji}
                    </button>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    },

    /**
     * Open emoji picker modal
     */
    openEmojiPicker(onSelect) {
        const modal = document.createElement('div');
        modal.id = 'emojiPickerModal';
        modal.className = 'emoji-picker-modal';
        modal.innerHTML = `
            <div class="emoji-picker-content">
                <div class="emoji-picker-header">
                    <h2>Choose Avatar Emoji</h2>
                    <button type="button" class="emoji-picker-close" onclick="document.getElementById('emojiPickerModal').remove()">✕</button>
                </div>
                ${this.createEmojiPickerHTML()}
            </div>
        `;
        
        // Store callback name for later use
        modal.dataset.onSelect = onSelect;
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    },

    /**
     * Select emoji (called from picker)
     */
    selectEmoji(emoji) {
        const modal = document.getElementById('emojiPickerModal');
        if (modal) {
            modal.remove();
        }
        // Dispatch custom event that profile page can listen to
        window.dispatchEvent(new CustomEvent('emojiSelected', { detail: { emoji } }));
    }
};

// Export for use
if (typeof window !== 'undefined') {
    window.AdvancedAvatarGenerator = AdvancedAvatarGenerator;
}