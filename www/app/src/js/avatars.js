/**
 * Advanced Avatar Generator
 * Supports: Emoji Mode, Initials Mode, Meaningful Presets, Custom Gradients
 */

const AdvancedAvatarGenerator = {
    // Meaningful emoji categories
    emojiCategories: {
    nature: {
        name: 'Nature',
        emojis: [
            '🌿', '🍃', '🌱', '🌵', '🌻', '🌸',
            '🌹', '🌷', '🍀', '🍁', '🌲', '🌴'
        ]
    },

    animals: {
        name: 'Animals',
        emojis: [
            '🐶', '🐱', '🐻', '🐼', '🦊', '🐨',
            '🐰', '🐯', '🦁', '🐸', '🐵', '🐺'
        ]
    },

    celestial: {
        name: 'Celestial',
        emojis: [
            '🌙', '☀️', '⭐', '🌟', '✨', '💫',
            '🌌', '🌈', '🪐', '☄️', '🌠', '🔮'
        ]
    },

    energy: {
        name: 'Energy',
        emojis: [
            '🔥', '⚡', '💥', '🚀', '💎', '🎯',
            '🏆', '👑', '💪', '🦾', '🔋', '🌪️'
        ]
    },

    creativity: {
        name: 'Creative',
        emojis: [
            '🎨', '🖌️', '🎭', '🎬', '🎸', '🎹',
            '🎧', '📷', '🎤', '✏️', '🧩', '🎵'
        ]
    },

    technology: {
        name: 'Tech',
        emojis: [
            '💻', '🖥️', '📱', '⌨️', '🖱️', '🤖',
            '⚙️', '🔧', '🛠️', '💡', '🔌', '💾'
        ]
    },

    learning: {
        name: 'Learning',
        emojis: [
            '📚', '📖', '🧠', '🎓', '🔬', '🔭',
            '💡', '📝', '✍️', '📐', '🧮', '📊'
        ]
    },

    vibes: {
        name: 'Vibes',
        emojis: [
            '😎', '🤓', '🤩', '🥳', '😊', '😌',
            '🤗', '😈', '🫶', '🙌', '✌️', '❤️'
        ]
    },

    lifestyle: {
        name: 'Lifestyle',
        emojis: [
            '☕', '🍕', '🎮', '🏋️', '⚽', '🏀',
            '🎧', '✈️', '🚗', '🏠', '🛹', '🎒'
        ]
    }
},

    // Color palettes for initials/gradients
    colorPalettes: [
    // ☀️ Light-friendly
    { name: 'Coral', start: '#FF8A80', end: '#FFB199' },
    { name: 'Mint', start: '#7DDCC8', end: '#A8E6CF' },
    { name: 'Powder Blue', start: '#82B1FF', end: '#A7D8FF' },
    { name: 'Lavender', start: '#B39DDB', end: '#D1C4E9' },
    { name: 'Peach', start: '#FFB07C', end: '#FFD3A5' },
    // ◐ Universal — Light & Dark
    { name: 'Ocean', start: '#4DB6AC', end: '#64B5F6' },
    { name: 'Rose', start: '#EC7090', end: '#B58CFF' },
    { name: 'Teal', start: '#26A69A', end: '#80CBC4' },
    { name: 'Indigo', start: '#667EEA', end: '#8B9CF6' },
    { name: 'Amber', start: '#F6A65B', end: '#FFD166' },
    // 🌙 Dark-friendly
    { name: 'Midnight', start: '#315C9B', end: '#182848' },
    { name: 'Deep Teal', start: '#167D78', end: '#123F3B' },
    { name: 'Plum', start: '#6B4FA1', end: '#2E1B47' },
    { name: 'Burgundy', start: '#963F58', end: '#401C2A' },
    { name: 'Deep Amber', start: '#B86B32', end: '#4A2A18' }
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
            <div class="gradient-picker-overlay">
                <div class="gradient-picker-content">
                    <div class="gradient-picker-header">
                        <h2>Choose Avatar Gradient</h2>
                        <button type="button" class="gradient-picker-close" onclick="window.AdvancedAvatarGenerator.closeGradientPickerModal()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                    ${this.createGradientPickerHTML()}
                </div>
            </div>
        `;
        
        // Store callback name for later use
        modal.dataset.onSelect = onSelect;
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'gradientPickerModal' || e.target.classList.contains('gradient-picker-overlay')) {
                AvatarPickerDialog.closeGradientPicker();
            }
        });
        
        document.body.appendChild(modal);
        
        // Trigger animation
        const content = modal.querySelector('.gradient-picker-content');
        if (content) {
            AvatarPickerDialog.animatePickerOpen(content);
        }
    },

    /**
     * Close gradient picker modal (for button click)
     */
    closeGradientPickerModal() {
        AvatarPickerDialog.closeGradientPicker();
    },
    selectGradient(index) {
        const modal = document.getElementById('gradientPickerModal');
        if (modal) {
            AvatarPickerDialog.closeGradientPicker();
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
            <div class="emoji-picker-overlay">
                <div class="emoji-picker-content">
                    <div class="emoji-picker-header">
                        <h2>Choose Avatar Emoji</h2>
                        <button type="button" class="emoji-picker-close" onclick="window.AdvancedAvatarGenerator.closeEmojiPicker()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                    ${this.createEmojiPickerHTML()}
                </div>
            </div>
        `;
        
        // Store callback name for later use
        modal.dataset.onSelect = onSelect;
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'emojiPickerModal' || e.target.classList.contains('emoji-picker-overlay')) {
                this.closeEmojiPicker();
            }
        });
        
        document.body.appendChild(modal);
        
        // Trigger animation
        const content = modal.querySelector('.emoji-picker-content');
        if (content) {
            AvatarPickerDialog.animatePickerOpen(content);
        }
    },

    /**
     * Close emoji picker with animation
     */
    closeEmojiPicker() {
        const modal = document.getElementById('emojiPickerModal');
        if (modal) {
            AvatarPickerDialog.closeEmojiPicker();
        }
    },

    /**
     * Select emoji (called from picker)
     */
    selectEmoji(emoji) {
        const modal = document.getElementById('emojiPickerModal');
        if (modal) {
            AvatarPickerDialog.closeEmojiPicker();
        }
        // Dispatch custom event that profile page can listen to
        window.dispatchEvent(new CustomEvent('emojiSelected', { detail: { emoji } }));
    }
};

// Avatar Picker Dialog Controller (for smooth animations)
const AvatarPickerDialog = {
    activeAnimation: null,

    cancelActiveAnimation(element) {
        if (!element) return;
        const animations = element.getAnimations ? element.getAnimations() : [];
        animations.forEach((animation) => {
            try {
                animation.cancel();
            } catch (error) {
                // Ignore cancel errors
            }
        });
        this.activeAnimation = null;
    },

    playAnimation(element, keyframes, duration, easing) {
        if (!element) return;

        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finalDuration = reducedMotion ? Math.min(duration, 120) : duration;
        const finalEasing = reducedMotion ? 'ease-out' : easing;

        this.cancelActiveAnimation(element);
        element.style.willChange = 'transform, opacity';

        const animation = element.animate(keyframes, {
            duration: finalDuration,
            easing: finalEasing,
            fill: 'forwards'
        });

        this.activeAnimation = animation;

        animation.onfinish = () => {
            element.style.willChange = 'auto';
            this.activeAnimation = null;
        };
        animation.oncancel = () => {
            element.style.willChange = 'auto';
            this.activeAnimation = null;
        };
    },

    animatePickerOpen(content) {
        if (!content) return;
        content.style.opacity = '0';
        content.style.transform = 'scale(0.85) translateY(20px)';
        
        requestAnimationFrame(() => {
            this.playAnimation(content, [
                { opacity: '0', transform: 'scale(0.85) translateY(20px)' },
                { opacity: '1', transform: 'scale(1) translateY(0)' }
            ], 300, 'cubic-bezier(.22, 1.12, .28, 1)');
        });
    },

    closeGradientPicker() {
        const modal = document.getElementById('gradientPickerModal');
        if (!modal) return;
        
        const content = modal.querySelector('.gradient-picker-content');
        if (content) {
            this.playAnimation(content, [
                { opacity: '1', transform: 'scale(1) translateY(0)' },
                { opacity: '0', transform: 'scale(0.85) translateY(20px)' }
            ], 250, 'cubic-bezier(.22, 1.12, .28, 1)');
            
            setTimeout(() => {
                modal.remove();
            }, 250);
        } else {
            modal.remove();
        }
    },

    closeEmojiPicker() {
        const modal = document.getElementById('emojiPickerModal');
        if (!modal) return;
        
        const content = modal.querySelector('.emoji-picker-content');
        if (content) {
            this.playAnimation(content, [
                { opacity: '1', transform: 'scale(1) translateY(0)' },
                { opacity: '0', transform: 'scale(0.85) translateY(20px)' }
            ], 250, 'cubic-bezier(.22, 1.12, .28, 1)');
            
            setTimeout(() => {
                modal.remove();
            }, 250);
        } else {
            modal.remove();
        }
    }
};

// Export for use
if (typeof window !== 'undefined') {
    window.AdvancedAvatarGenerator = AdvancedAvatarGenerator;
    window.AvatarPickerDialog = AvatarPickerDialog;
}