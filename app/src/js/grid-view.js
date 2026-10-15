/* =====================================================
   GRID VIEW MODULE
   File: grid-view.js

   Adds a switchable List / Grid layout, opened via a
   "more-view" popup — from the Notes mobile nav's top-right
   button, and from a matching button in the Folders sidebar
   header (mobile only). The chosen layout is a single global
   setting shared by both the Notes list and the Folders list.

   Design goals:
   - 100% additive. Does not edit app.js — it wraps the
     handful of functions it needs (renderNotesList,
     renderFolders, renderMobileNav, toggleMultiSelect) so a
     future update to app.js can't silently break this file,
     and this file can't silently break app.js.
   - Reuses the app's existing popup system (positionMenuByDirection,
     closeDropdown, handleMenuCloseOnly, the .dropdown-menu /
     .row / .btn markup) so each theme (iOS, MD3E, Nothing)
     styles it automatically, for free.
   - One List/Grid setting, remembered in localStorage, applied
     to both lists at once, and only ever shown on mobile —
     desktop keeps the existing list layout untouched.
   ===================================================== */

(function () {
    if (typeof app === 'undefined') return;

    const STORAGE_KEY = 'notozApp_viewMode';
    const SORT_STORAGE_KEY = 'notozApp_sortMode';
    const DEFAULT_SORT_MODE = 'updated-desc';
    const SORT_OPTIONS = [
        { value: 'updated-desc', label: 'Recently Updated' },
        { value: 'updated-asc', label: 'Oldest Updated' },
        { value: 'title-asc', label: 'Title A-Z' },
        { value: 'title-desc', label: 'Title Z-A' }
    ];

    function loadMode() {
        return localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'list';
    }

    function loadSortMode() {
        const savedMode = localStorage.getItem(SORT_STORAGE_KEY);
        return SORT_OPTIONS.some((option) => option.value === savedMode) ? savedMode : DEFAULT_SORT_MODE;
    }

    app.ui = app.ui || {};
    app.ui.viewMode = loadMode();
    app.ui.notesSortMode = loadSortMode();

    /* ---------------------------------------------------
       Icon set
       - TRIGGER_ICON: the button that opens the popup
       - LIST_ICON / GRID_ICON: the two layout choices
       - SELECT_ICON: the "Select Notes" shortcut
       - CHECK_ICON: marks whichever choice is active
    --------------------------------------------------- */
    const TRIGGER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`;

    const LIST_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3.5" y1="6" x2="3.51" y2="6"/><line x1="3.5" y1="12" x2="3.51" y2="12"/><line x1="3.5" y1="18" x2="3.51" y2="18"/></svg>`;

    const GRID_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;

    const SELECT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="7" r="2.6"/><path d="M3.8 7l1.1 1.1L7 6" stroke-width="1.4"/><line x1="10.5" y1="7" x2="20.5" y2="7"/><circle cx="5.5" cy="16" r="2.6"/><line x1="10.5" y1="16" x2="20.5" y2="16"/></svg>`;

    const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>`;

    function containerIdFor(context) {
        return context === 'notes' ? 'notesListContainer' : 'folderListContainer';
    }
    function itemSelectorFor(context) {
        return context === 'notes' ? '.note-item' : '.folder-item';
    }

    function applyContainerClass(context) {
        const el = document.getElementById(containerIdFor(context));
        if (!el) return;
        el.classList.toggle('grid-mode', app.ui.viewMode === 'grid');
    }

    /* ---------------------------------------------------
       Both trigger buttons always show the same static
       "view options" glyph — it opens a menu, it isn't a
       direct toggle, so it doesn't need to track the mode.
    --------------------------------------------------- */
    function updateTriggerIcons() {
        const editBtn = document.getElementById('editNotesBtn');
        if (editBtn) {
            editBtn.classList.toggle('sort-active', app.ui.notesSortMode !== DEFAULT_SORT_MODE);
            if (!app.ui.multiSelect) editBtn.innerHTML = TRIGGER_ICON;
        }

        const folderBtn = document.getElementById('folderViewBtn');
        if (folderBtn) folderBtn.innerHTML = TRIGGER_ICON;

    }

    const viewTransitionTimers = new Map();

    /* ---------------------------------------------------
       Exit and entrance choreography changes with the target
       layout and selected OS theme. The layout only swaps
       after the outgoing items have cleared the stage.
    --------------------------------------------------- */
    function animateContainerSwitch(context, mode, onSwapLayout) {
        const container = document.getElementById(containerIdFor(context));
        const itemSelector = itemSelectorFor(context);
        const items = container ? container.querySelectorAll(itemSelector) : [];
        const reduced = window.AnimationUtils && AnimationUtils.prefersReducedMotion();
        const previousTimers = viewTransitionTimers.get(context) || [];
        previousTimers.forEach(clearTimeout);
        viewTransitionTimers.delete(context);

        if (!container || !items.length || reduced) {
            if (container) {
                container.querySelectorAll(itemSelector).forEach((el) => {
                    el.style.animation = '';
                    el.style.animationDelay = '';
                });
            }
            onSwapLayout();
            return;
        }

        const ui = document.documentElement.getAttribute('data-ui') || 'ios';
        const animations = {
            ios: { listOut: 'iosListExit', gridOut: 'iosGridExit', listIn: 'iosListEnter', gridIn: 'iosGridEnter', out: 230, into: 460 },
            md3e: { listOut: 'md3ListExit', gridOut: 'md3GridExit', listIn: 'md3ListEnter', gridIn: 'md3GridEnter', out: 220, into: 420 },
            nothing: { listOut: 'nothingListExit', gridOut: 'nothingGridExit', listIn: 'nothingListEnter', gridIn: 'nothingGridEnter', out: 190, into: 360 }
        };
        const motion = animations[ui] || animations.ios;
        const leavingAnimation = mode === 'grid' ? motion.listOut : motion.gridOut;
        const enteringAnimation = mode === 'grid' ? motion.gridIn : motion.listIn;

        items.forEach((el, index) => {
            el.style.animation = `${leavingAnimation} ${motion.out}ms ${ui === 'nothing' ? 'steps(8, end)' : 'cubic-bezier(.2,.8,.2,1)'} both`;
            el.style.animationDelay = `${Math.min(index * 12, 84)}ms`;
        });

        const swapTimer = setTimeout(() => {
            onSwapLayout();
            const freshItems = container.querySelectorAll(itemSelectorFor(context));
            freshItems.forEach((el) => {
                el.style.animation = 'none';
                el.style.animationDelay = '';
            });
            void container.offsetWidth;
            freshItems.forEach((el, index) => {
                el.style.animation = `${enteringAnimation} ${motion.into}ms ${ui === 'nothing' ? 'steps(9, end)' : 'cubic-bezier(.2,.8,.2,1)'} both`;
                el.style.animationDelay = `${Math.min(index * 34, 238)}ms`;
            });

            const cleanupTimer = setTimeout(() => {
                freshItems.forEach((el) => {
                    el.style.animation = '';
                    el.style.animationDelay = '';
                });
                viewTransitionTimers.delete(context);
            }, motion.into + Math.min(freshItems.length * 34, 238) + 40);
            viewTransitionTimers.set(context, [cleanupTimer]);
        }, motion.out + 100);
        viewTransitionTimers.set(context, [swapTimer]);
    }

    app.setViewMode = function (mode) {
        if (mode !== 'grid' && mode !== 'list') return;

        if (this.ui.viewMode === mode) {
            this.closeDropdown('viewOptionsMenu');
            return;
        }

        this.ui.viewMode = mode;
        localStorage.setItem(STORAGE_KEY, mode);
        document.documentElement.setAttribute('data-view-mode', mode);

        animateContainerSwitch('notes', mode, () => applyContainerClass('notes'));
        animateContainerSwitch('folders', mode, () => applyContainerClass('folders'));

        this.closeDropdown('viewOptionsMenu');
    };

    app.setNotesSortMode = function (mode) {
        if (!SORT_OPTIONS.some((option) => option.value === mode)) return;
        this.ui.notesSortMode = mode;
        localStorage.setItem(SORT_STORAGE_KEY, mode);
        this.renderNotesList(false);
        updateTriggerIcons();
        this.closeDropdown('viewOptionsMenu');
    };

    /* ---------------------------------------------------
       The "more-view" popup. List/Grid apply globally;
       "Select Notes" only appears when opened from Notes,
       and is purely a shortcut to the existing multi-select.
    --------------------------------------------------- */
    app.openViewOptionsMenu = function (ev, context) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        const menu = document.getElementById('viewOptionsMenu');
        const row = document.getElementById('viewOptionsRow');
        if (!menu || !row) return;

        if (menu.classList.contains('open') && menu.dataset.context === context) {
            this.closeDropdown('viewOptionsMenu');
            return;
        }

        menu.dataset.context = context;
        const current = this.ui.viewMode;
        const currentSort = this.ui.notesSortMode || DEFAULT_SORT_MODE;

        let html = `
            <button class="btn ${current === 'list' ? 'active' : ''}" onclick="app.setViewMode('list')">
                <span class="view-opt-label">${LIST_ICON}<span>List View</span></span>${current === 'list' ? CHECK_ICON : ''}
            </button>
            <button class="btn ${current === 'grid' ? 'active' : ''}" onclick="app.setViewMode('grid')">
                <span class="view-opt-label">${GRID_ICON}<span>Grid View</span></span>${current === 'grid' ? CHECK_ICON : ''}
            </button>
        `;

        if (context === 'notes') {
            html += `
                <div class="dropdown-sep"></div>
                <div class="dropdown-section-label">Sort by</div>
                ${SORT_OPTIONS.map((option) => `
                    <button class="btn ${currentSort === option.value ? 'active' : ''}" role="menuitemradio" aria-checked="${currentSort === option.value}" onclick="app.setNotesSortMode('${option.value}')">
                        <span class="view-opt-label"><span>${option.label}</span></span>${currentSort === option.value ? CHECK_ICON : ''}
                    </button>
                `).join('')}
            `;

            const selecting = !!this.ui.multiSelect;
            html += `
                <div class="dropdown-sep"></div>
                <button class="btn" onclick="app.closeDropdown('viewOptionsMenu'); app.toggleMultiSelect();">
                    <span class="view-opt-label">${SELECT_ICON}<span>${selecting ? 'Exit Selection' : 'Select Notes'}</span></span>
                </button>
            `;
        }

        row.innerHTML = html;

        const trigger = ev?.currentTarget || ev?.target;
        const triggerRect = trigger?.getBoundingClientRect?.();
        const x = triggerRect ? triggerRect.left + triggerRect.width / 2
            : (ev && (ev.clientX || ev.touches?.[0]?.clientX)) || (window.innerWidth - 30);
        const y = triggerRect ? triggerRect.bottom
            : (ev && (ev.clientY || ev.touches?.[0]?.clientY)) || 60;

        this.positionMenuByDirection(menu, x, y);
        menu.classList.add('open', 'is-open');
        menu.setAttribute('aria-expanded', 'true');
        menu.setAttribute('aria-hidden', 'false');
    };

    // Same outside-click / Escape conventions the rest of the app's popups use.
    document.addEventListener('click', (e) => {
        app.handleMenuCloseOnly('viewOptionsMenu', e);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') app.closeDropdown('viewOptionsMenu');
    });

    /* ---------------------------------------------------
       Wrap renderNotesList / renderFolders: re-apply the
       grid/list class after every render (their innerHTML
       gets wiped each time, but the CONTAINER element itself
       persists — this is just a safety net).
    --------------------------------------------------- */
    const originalRenderNotesList = app.renderNotesList;
    app.renderNotesList = function (...args) {
        originalRenderNotesList.apply(this, args);
        applyContainerClass('notes');
    };

    const originalRenderFolders = app.renderFolders;
    app.renderFolders = function (...args) {
        originalRenderFolders.apply(this, args);
        applyContainerClass('folders');
    };

    /* ---------------------------------------------------
       Wrap toggleMultiSelect so the top-right button always
       goes back to our trigger icon once selection mode ends
       (the original function otherwise leaves it on its own
       hard-coded "..." icon).
    --------------------------------------------------- */
    const originalToggleMultiSelect = app.toggleMultiSelect;
    app.toggleMultiSelect = function (...args) {
        originalToggleMultiSelect.apply(this, args);
        if (!this.ui.multiSelect) updateTriggerIcons();
    };

    /* ---------------------------------------------------
       Wrap renderMobileNav — Notes view only: repurpose the
       existing top-right button into the "more-view" trigger
       instead of jumping straight into multi-select. Folders
       and Editor views are left completely untouched (the
       mobile nav bar stays hidden in Folders view, exactly
       like before this file existed).
    --------------------------------------------------- */
    const originalRenderMobileNav = app.renderMobileNav;
    app.renderMobileNav = function () {
        originalRenderMobileNav.call(this);

        if (this.ui.isMobile && this.ui.mobileView === 'notes') {
            const editBtn = document.getElementById('editNotesBtn');
            if (editBtn) {
                editBtn.title = 'Sort, view, and selection options';
                editBtn.setAttribute('aria-label', 'Sort, view, and selection options');
                editBtn.onclick = (ev) => app.openViewOptionsMenu(ev, 'notes');
                updateTriggerIcons();
            }
        }
    };

    /* ---------------------------------------------------
    Notes view exposes the view trigger beside search/new note.
    --------------------------------------------------- */
    function wireNotesViewButton() {
        const btn = document.getElementById('notesViewBtn');
        if (!btn || btn.dataset.gridViewBound) return;
        btn.dataset.gridViewBound = 'true';
        btn.innerHTML = TRIGGER_ICON;
        btn.title = 'View options';
        btn.setAttribute('aria-label', 'View options');
        btn.addEventListener('click', (ev) => app.openViewOptionsMenu(ev, 'notes'));
    }

    /* ---------------------------------------------------
       Apply the saved mode as soon as the (static) containers
       exist — no need to wait on app.init()'s data loading.
    --------------------------------------------------- */
    function init() {
        applyContainerClass('notes');
        applyContainerClass('folders');
        wireNotesViewButton();
        updateTriggerIcons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();