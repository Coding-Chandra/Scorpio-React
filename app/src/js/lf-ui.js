/* =========================================================
   NOTOZ — LOCKED FOLDER UI
   Presentation layer only.

   Authentication/state remains inside lf.js / lf-engine.js.
   This file handles:
   - Lock screen presentation
   - Existing Notoz avatar
   - Existing Notoz theme resolution
   - iOS / MD3E / Nothing layouts
   - PIN keypad
   - Biometric button
   - PIN length picker
   ========================================================= */

(() => {
    'use strict';

    const UI = {};

    let activeOverlay = null;
    let activeRequest = null;

    const registeredPinPickers = new Set();

    /* ---------------------------------------------------------
       Notoz context
       --------------------------------------------------------- */

    function root() {
        return document.documentElement;
    }

    function getUiTheme() {
        return root().getAttribute('data-ui') || 'ios';
    }

    function getColorTheme() {
        return root().getAttribute('data-theme') || 'dark';
    }

    function getMd3eSeed() {
        const seed =
            localStorage.getItem('md3e-seed') ||
            localStorage.getItem('md3eSeed') ||
            '';

        return isCssColor(seed) ? seed : '';
    }

    function isCssColor(value) {
        if (!value || typeof value !== 'string') return false;

        const tester = document.createElement('span');

        tester.style.color = '';
        tester.style.color = value;

        return !!tester.style.color;
    }

    function syncContext(overlay) {
        if (!overlay) return;

        overlay.dataset.ui = getUiTheme();
        overlay.dataset.theme = getColorTheme();

        const seed = getMd3eSeed();

        if (seed) {
            overlay.style.setProperty('--lf-md3e-seed', seed);
        } else {
            overlay.style.removeProperty('--lf-md3e-seed');
        }
    }

    /* ---------------------------------------------------------
       Existing Notoz avatar
       --------------------------------------------------------- */

    function getExistingAvatar() {
        const source =
            document.querySelector('.account-avatar.account-avatar-lg') ||
            document.querySelector('.account-avatar-lg') ||
            document.querySelector('.account-avatar-pill');

        if (!source) return null;

        const clone = source.cloneNode(true);

        clone.removeAttribute('id');

        clone.querySelectorAll('[id]').forEach(el => {
            el.removeAttribute('id');
        });

        clone.querySelectorAll('[onclick]').forEach(el => {
            el.removeAttribute('onclick');
        });

        clone.classList.add('lf-ui-avatar-source');

        return clone;
    }

    function getProfileText() {
        const display =
            document.getElementById('accountDisplayName')?.textContent?.trim();

        const email =
            document.getElementById('accountEmail')?.textContent?.trim();

        return {
            display: display || '',
            email: email || ''
        };
    }

    function buildAvatar() {
        const wrapper = document.createElement('div');
        wrapper.className = 'lf-ui-avatar';

        const existing = getExistingAvatar();

        if (existing) {
            wrapper.appendChild(existing);
            return wrapper;
        }

        const profile = getProfileText();

        const initialsSource =
            document.getElementById('accountInitialsLg')?.textContent?.trim() ||
            profile.display ||
            profile.email ||
            'N';

        const initials = initialsSource
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part.charAt(0).toUpperCase())
            .join('');

        wrapper.textContent = initials || 'N';

        return wrapper;
    }

    /* ---------------------------------------------------------
       Keypad shapes
       --------------------------------------------------------- */

    const MD3E_SHAPES = [
        'circle',
        'pill',
        'squircle',
        'soft',
        'blob',
        'cookie',
        'flower',
        'diamond'
    ];

    function randomMd3eShape(button) {
        if (!button || button.dataset.empty === 'true') return;

        const current = button.dataset.shape;

        let shape = current;

        while (shape === current) {
            shape =
                MD3E_SHAPES[
                    Math.floor(Math.random() * MD3E_SHAPES.length)
                ];
        }

        button.dataset.shape = shape;
    }

    /* ---------------------------------------------------------
       Error helper
       --------------------------------------------------------- */

    function displayError(errorEl, message) {
        if (!errorEl) return;

        const text = message || '';
        errorEl.textContent = text;
        errorEl.classList.toggle('has-error', Boolean(text));
    }

    /* ---------------------------------------------------------
       PIN prompt
       --------------------------------------------------------- */

    function askPin({
        title = 'Enter PIN',
        length = 4,
        bio = null,
        autoBio = false,
        check = async () => null
    } = {}) {
        return new Promise(resolve => {
            if (activeOverlay) {
                activeOverlay.remove();
                activeOverlay = null;
            }

            const overlay = document.createElement('div');

            overlay.className = 'lf-ui-overlay';
            overlay.setAttribute('role', 'presentation');

            syncContext(overlay);

            overlay.innerHTML = `
                <section
                    class="lf-ui-card"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="lf-ui-title"
                >
                    <div class="lf-ui-avatar-wrap"></div>

                    <h2 class="lf-ui-title" id="lf-ui-title"></h2>

                    <p class="lf-ui-subtitle">Locked Folder</p>

                    <div
                        class="lf-ui-dots"
                        aria-hidden="true"
                    ></div>

                    <input
                        class="lf-ui-input lf-ui-pin"
                        type="password"
                        inputmode="numeric"
                        autocomplete="off"
                        placeholder="Enter PIN"
                        maxlength="${Number(length) || 4}"
                        aria-label="PIN"
                        tabindex="-1"
                    >

                    <div
                        class="lf-ui-error"
                        aria-live="polite"
                    ></div>

                    <div
                        class="lf-ui-pad"
                        id="lf-ui-pad"
                        aria-label="PIN keypad"
                    ></div>

                    <div class="lf-ui-actions">
                        <button
                            class="lf-ui-action lf-ui-cancel"
                            type="button"
                        >
                            Cancel
                        </button>

                        <button
                            class="lf-ui-action lf-ui-keypad-toggle"
                            type="button"
                            aria-label="Show on-screen keypad"
                            title="Show on-screen keypad"
                            aria-controls="lf-ui-pad"
                            aria-expanded="false"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <rect x="3" y="5" width="18" height="14" rx="2.5"></rect>
                                <path d="M7 9h.01M10.5 9h.01M14 9h.01M17.5 9h.01M7 12h.01M10.5 12h.01M14 12h.01M17.5 12h.01M9 15h6"></path>
                            </svg>
                        </button>

                        <button
                            class="lf-ui-action lf-ui-bio"
                            type="button"
                            hidden
                        >
                            Use biometrics
                        </button>
                    </div>
                </section>
            `;

            const card = overlay.querySelector('.lf-ui-card');
            const avatarWrap = overlay.querySelector('.lf-ui-avatar-wrap');
            const titleEl = overlay.querySelector('.lf-ui-title');
            const subtitle = overlay.querySelector('.lf-ui-subtitle');
            const dots = overlay.querySelector('.lf-ui-dots');
            const input = overlay.querySelector('.lf-ui-input');
            const error = overlay.querySelector('.lf-ui-error');
            const pad = overlay.querySelector('.lf-ui-pad');
            const cancel = overlay.querySelector('.lf-ui-cancel');
            const keypadToggle = overlay.querySelector('.lf-ui-keypad-toggle');
            const bioButton = overlay.querySelector('.lf-ui-bio');

            avatarWrap.appendChild(buildAvatar());

            titleEl.textContent = title;

            let value = '';
            let busy = false;
            let finished = false;
            let completing = false;
            let desktopKeypadVisible = false;

            function isMobile() {
                return window.matchMedia('(max-width: 699px)').matches;
            }

            function currentUi() {
                return overlay.dataset.ui || 'ios';
            }

            function showVisualInput() {
                return !isMobile();
            }

            function showDots() {
                return isMobile() && currentUi() === 'ios';
            }

            function animateKeypad(show) {
                if (
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
                    typeof pad.animate !== 'function'
                ) {
                    return null;
                }

                return pad.animate(
                    show
                        ? [
                            { opacity: 0, transform: 'translateY(-7px) scale(.985)' },
                            { opacity: 1, transform: 'translateY(0) scale(1)' }
                        ]
                        : [
                            { opacity: 1, transform: 'translateY(0) scale(1)' },
                            { opacity: 0, transform: 'translateY(-7px) scale(.985)' }
                        ],
                    {
                        duration: 180,
                        easing: 'cubic-bezier(.2, .8, .2, 1)'
                    }
                );
            }

            function updateVisibility(animatePad = false) {
                const mobile = isMobile();
                const visualInput = showVisualInput();
                const visualDots = showDots();

                input.hidden = !visualInput;
                input.tabIndex = visualInput ? 0 : -1;

                dots.hidden = !visualDots;

                /*
                 * Mobile:
                 * MD3E / Nothing = keypad-only.
                 * iOS = passcode dots + keypad.
                 */
                const shouldShowPad = mobile || desktopKeypadVisible;

                if (animatePad && !mobile && shouldShowPad) {
                    pad.hidden = false;
                    animateKeypad(true);
                } else if (animatePad && !mobile && !shouldShowPad && !pad.hidden) {
                    const animation = animateKeypad(false);

                    if (animation) {
                        animation.onfinish = () => {
                            if (!desktopKeypadVisible && !isMobile()) {
                                pad.hidden = true;
                            }
                        };
                    } else {
                        pad.hidden = true;
                    }
                } else {
                    pad.hidden = !shouldShowPad;
                }

                keypadToggle.hidden = mobile;
                const keypadLabel = desktopKeypadVisible
                    ? 'Hide on-screen keypad'
                    : 'Show on-screen keypad';
                keypadToggle.setAttribute(
                    'aria-expanded',
                    String(desktopKeypadVisible)
                );
                keypadToggle.setAttribute('aria-label', keypadLabel);
                keypadToggle.title = keypadLabel;

                /*
                 * Subtitle can stay because it is informational,
                 * not an input indicator.
                 */
                subtitle.hidden = false;
            }

            function drawDots() {
                dots.innerHTML = Array.from(
                    { length },
                    (_, index) =>
                        `<span class="lf-ui-dot${
                            index < value.length ? ' on' : ''
                        }"></span>`
                ).join('');
            }

            function syncInput() {
                input.value = value;
            }

            function focusInput() {
                if (!showVisualInput()) return;

                requestAnimationFrame(() => {
                    try {
                        input.focus({ preventScroll: true });

                        input.setSelectionRange(
                            input.value.length,
                            input.value.length
                        );
                    } catch (_) {}
                });
            }

            function finish(result) {
                if (finished) return;

                finished = true;

                document.removeEventListener(
                    'keydown',
                    onKey,
                    true
                );

                input.removeEventListener(
                    'input',
                    onInput
                );

                if (observer) {
                    observer.disconnect();
                }

                if (activeRequest === finish) {
                    activeRequest = null;
                }

                if (activeOverlay === overlay) {
                    activeOverlay = null;
                }

                overlay.remove();

                resolve(result);
            }

            function finishSuccess(result) {
                if (finished || completing) return;

                completing = true;

                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    finish(result);
                    return;
                }

                overlay.classList.add('lf-ui-success');
                setTimeout(() => finish(result), 220);
            }

            function animateFailure() {
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    return;
                }

                card.classList.remove('lf-ui-shake');
                void card.offsetWidth;
                card.classList.add('lf-ui-shake');
            }

            async function press(key) {
                if (finished || busy || completing) return;

                if (key === 'delete') {
                    value = value.slice(0, -1);
                } else if (
                    /^\d$/.test(key) &&
                    value.length < length
                ) {
                    value += key;
                } else {
                    return;
                }

                displayError(error, '');

                syncInput();
                drawDots();

                if (value.length !== length) return;

                busy = true;

                try {
                    const message = await check(value);

                    if (!message) {
                        finishSuccess(value);
                        return;
                    }

                    displayError(error, message);

                    value = '';

                    syncInput();
                    drawDots();

                    animateFailure();
                } catch (err) {
                    displayError(
                        error,
                        err?.message || 'Authentication failed.'
                    );

                    value = '';

                    syncInput();
                    drawDots();

                    animateFailure();
                } finally {
                    busy = false;

                    if (!finished) {
                        focusInput();
                    }
                }
            }

            function onInput() {
                if (finished || busy || completing) return;

                const digits = String(input.value || '')
                    .replace(/\D/g, '')
                    .slice(0, length);

                value = digits;

                syncInput();
                drawDots();

                displayError(error, '');

                if (value.length === length) {
                    const finalDigit = value.charAt(value.length - 1);
                    value = value.slice(0, -1);
                    syncInput();
                    drawDots();
                    press(finalDigit);
                }
            }

            function morphFromPress(button) {
                if (overlay.dataset.ui !== 'md3e') return;

                randomMd3eShape(button);

                button.classList.remove('lf-ui-key-pressed');
                void button.offsetWidth;
                button.classList.add('lf-ui-key-pressed');
            }

            const keys = [
                '1',
                '2',
                '3',
                '4',
                '5',
                '6',
                '7',
                '8',
                '9',
                '',
                '0',
                'delete'
            ];

            keys.forEach(key => {
                const button = document.createElement('button');

                button.type = 'button';
                button.className = 'lf-ui-key';

                if (!key) {
                    button.dataset.empty = 'true';
                    button.tabIndex = -1;
                    button.setAttribute('aria-hidden', 'true');
                } else {
                    button.textContent =
                        key === 'delete' ? '⌫' : key;

                    button.dataset.action =
                        key === 'delete' ? 'delete' : 'digit';

                    button.setAttribute(
                        'aria-label',
                        key === 'delete'
                            ? 'Delete'
                            : `Digit ${key}`
                    );

                    if (overlay.dataset.ui === 'md3e') {
                        button.dataset.shape = 'circle';
                    }

                    button.addEventListener(
                        'pointerenter',
                        event => {
                            if (
                                event.pointerType === 'mouse' ||
                                event.pointerType === 'pen'
                            ) {
                                morphFromPress(button);
                            }
                        },
                        { passive: true }
                    );

                    button.addEventListener(
                        'pointerdown',
                        () => {
                            morphFromPress(button);
                        },
                        { passive: true }
                    );

                    button.addEventListener(
                        'pointerleave',
                        () => {
                            if (overlay.dataset.ui === 'md3e') {
                                button.dataset.shape = 'circle';
                            }
                        },
                        { passive: true }
                    );

                    button.addEventListener(
                        'click',
                        () => press(key)
                    );
                }

                pad.appendChild(button);
            });

            function onKey(event) {
                if (finished || completing) return;

                if (/^\d$/.test(event.key)) {
                    press(event.key);
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                if (event.key === 'Backspace') {
                    press('delete');
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                if (event.key === 'Escape') {
                    finish(null);
                    event.preventDefault();
                    event.stopPropagation();
                }

                if (event.key === 'Enter') {
                    if (value.length === length) {
                        press(
                            value.charAt(value.length - 1)
                        );
                    }

                    event.preventDefault();
                    event.stopPropagation();
                }
            }

            document.addEventListener(
                'keydown',
                onKey,
                true
            );

            input.addEventListener(
                'input',
                onInput
            );

            cancel.addEventListener(
                'click',
                () => {
                    if (!completing) finish(null);
                }
            );

            keypadToggle.addEventListener('click', () => {
                if (completing) return;
                desktopKeypadVisible = !desktopKeypadVisible;
                updateVisibility(true);
            });

            const tryBio = async () => {
                if (
                    finished ||
                    busy ||
                    completing ||
                    typeof bio !== 'function'
                ) {
                    return;
                }

                busy = true;

                try {
                    const success = await bio();

                    if (success) {
                        finish('__bio__');
                    }
                } catch (_) {
                    displayError(
                        error,
                        'Biometric authentication was cancelled or unavailable.'
                    );
                } finally {
                    busy = false;
                }
            };

            if (typeof bio === 'function') {
                bioButton.hidden = false;

                bioButton.addEventListener(
                    'click',
                    tryBio
                );

                if (autoBio) {
                    setTimeout(
                        tryBio,
                        220
                    );
                }
            }

            drawDots();
            updateVisibility();

            document.body.appendChild(overlay);

            activeOverlay = overlay;
            activeRequest = finish;

            let observer = null;

            /*
             * Keep this tied to Notoz's own theme system.
             * No separate system-theme engine is created here.
             */
            observer = new MutationObserver(() => {
                syncContext(overlay);

                updateVisibility();

                /*
                 * MD3E shapes are only a presentation detail;
                 * changing theme should never affect auth state.
                 */
                if (
                    overlay.dataset.ui !== 'md3e'
                ) {
                    pad.querySelectorAll('.lf-ui-key').forEach(button => {
                        button.removeAttribute('data-shape');
                    });
                }
            });

            observer.observe(
                root(),
                {
                    attributes: true,
                    attributeFilter: [
                        'data-ui',
                        'data-theme'
                    ]
                }
            );

            window.addEventListener(
                'resize',
                updateVisibility,
                { passive: true, once: false }
            );

            if (showVisualInput()) {
                focusInput();
            }

            if (
                overlay.dataset.ui === 'nothing' ||
                overlay.dataset.ui === 'md3e'
            ) {
                document.body.setAttribute(
                    'data-lf-keyboard-lock',
                    'true'
                );
            }

            setTimeout(() => {
                if (
                    document.body.getAttribute(
                        'data-lf-keyboard-lock'
                    ) === 'true'
                ) {
                    document.body.removeAttribute(
                        'data-lf-keyboard-lock'
                    );
                }
            }, 50);
        });
    }

    /* ---------------------------------------------------------
       Public close
       --------------------------------------------------------- */

    UI.askPin = askPin;

    function choosePinLength({ current = 4 } = {}) {
        return new Promise(resolve => {
            if (activeRequest) {
                activeRequest(null);
            } else if (activeOverlay) {
                activeOverlay.remove();
            }

            const overlay = document.createElement('div');
            overlay.className = 'lf-ui-overlay lf-ui-length-overlay';
            overlay.setAttribute('role', 'presentation');
            syncContext(overlay);

            overlay.innerHTML = `
                <section
                    class="lf-ui-card lf-ui-length-card"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="lf-ui-length-title"
                >
                    <h2 class="lf-ui-title" id="lf-ui-length-title">Change PIN</h2>
                    <p class="lf-ui-subtitle">Choose the new PIN length</p>
                    <div class="lf-ui-length-options" role="group" aria-label="PIN length">
                        <button class="lf-ui-length-choice" type="button" data-length="4">
                            <strong>4</strong><span>digits</span>
                        </button>
                        <button class="lf-ui-length-choice" type="button" data-length="6">
                            <strong>6</strong><span>digits</span>
                        </button>
                    </div>
                    <div class="lf-ui-actions">
                        <button class="lf-ui-action lf-ui-cancel" type="button">Cancel</button>
                    </div>
                </section>
            `;

            let finished = false;

            function finish(length = null) {
                if (finished) return;
                finished = true;

                document.removeEventListener('keydown', onKey, true);

                if (activeOverlay === overlay) {
                    activeOverlay = null;
                    activeRequest = null;
                }

                overlay.remove();
                resolve(length);
            }

            function onKey(event) {
                if (event.key !== 'Escape') return;

                finish();
                event.preventDefault();
                event.stopPropagation();
            }

            overlay.querySelectorAll('[data-length]').forEach(button => {
                const length = Number(button.dataset.length);
                button.setAttribute('aria-pressed', String(length === Number(current)));
                button.addEventListener('click', () => finish(length));
            });

            overlay.querySelector('.lf-ui-cancel').addEventListener(
                'click',
                () => finish()
            );

            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(overlay);
            activeOverlay = overlay;
            activeRequest = finish;

            overlay.querySelector(
                `[data-length="${Number(current) === 6 ? 6 : 4}"]`
            ).focus({ preventScroll: true });
        });
    }

    UI.choosePinLength = choosePinLength;

    UI.close = () => {
        if (activeRequest) {
            activeRequest(null);
        } else if (activeOverlay) {
            activeOverlay.remove();
            activeOverlay = null;
        }
    };

    /* ---------------------------------------------------------
       PIN length picker
       --------------------------------------------------------- */

    function preferredLength() {
        const stored =
            Number(
                localStorage.getItem(
                    'locked-folder-pin-length'
                )
            );

        return stored === 6 ? 6 : 4;
    }

    function getLockedFolderConfig() {
        try {
            return window.LockedFolder?.getConfig?.() || null;
        } catch (_) {
            return null;
        }
    }

    function setPickerSelection(picker, length) {
        const buttons = picker.querySelectorAll(
            '[data-length]'
        );

        buttons.forEach(button => {
            const selected =
                Number(button.dataset.length) === Number(length);

            button.setAttribute(
                'aria-checked',
                selected ? 'true' : 'false'
            );

            button.classList.toggle(
                'selected',
                selected
            );
        });
    }

    function syncAllPickers(length) {
        registeredPinPickers.forEach(picker => {
            if (!document.contains(picker)) {
                registeredPinPickers.delete(picker);
                return;
            }

            setPickerSelection(
                picker,
                length
            );
        });
    }

    async function refreshPicker(picker) {
        if (!picker) return;

        const config =
            getLockedFolderConfig();

        if (config?.enabled) {
            setPickerSelection(
                picker,
                Number(config.pinLength) === 6
                    ? 6
                    : 4
            );

            localStorage.setItem(
                'locked-folder-pin-length',
                String(
                    Number(config.pinLength) === 6
                        ? 6
                        : 4
                )
            );

            return;
        }

        setPickerSelection(
            picker,
            preferredLength()
        );
    }

    UI.initPinLengthPicker = picker => {
        if (!picker) return;

        if (
            registeredPinPickers.has(picker)
        ) {
            refreshPicker(picker);
            return;
        }

        registeredPinPickers.add(picker);

        picker.setAttribute(
            'role',
            'radiogroup'
        );

        picker.querySelectorAll(
            '[data-length]'
        ).forEach(button => {
            button.setAttribute(
                'role',
                'radio'
            );

            button.addEventListener(
                'click',
                async () => {
                    const requested =
                        Number(
                            button.dataset.length
                        ) === 6
                            ? 6
                            : 4;

                    const config =
                        getLockedFolderConfig();

                    /*
                     * Nothing happens when the same
                     * length is already active.
                     */
                    if (
                        config?.enabled &&
                        Number(config.pinLength) === requested
                    ) {
                        setPickerSelection(
                            picker,
                            requested
                        );

                        return;
                    }

                    /*
                     * When Locked Folder is enabled,
                     * LockedFolder.ui.changePin()
                     * forces the current PIN first,
                     * then creates the new PIN.
                     */
                    if (config?.enabled) {
                        button.disabled = true;

                        try {
                            const changed =
                                await window.LockedFolder?.ui?.changePin?.({
                                    length: requested
                                });

                            if (changed) {
                                localStorage.setItem(
                                    'locked-folder-pin-length',
                                    String(requested)
                                );

                                syncAllPickers(
                                    requested
                                );

                                return;
                            }

                            await refreshPicker(
                                picker
                            );
                        } catch (_) {
                            await refreshPicker(
                                picker
                            );
                        } finally {
                            button.disabled = false;
                        }

                        return;
                    }

                    /*
                     * When disabled, just remember
                     * the preferred setup length.
                     */
                    localStorage.setItem(
                        'locked-folder-pin-length',
                        String(requested)
                    );

                    syncAllPickers(
                        requested
                    );
                }
            );
        });

        refreshPicker(picker);

        /*
         * Settings.js may show/hide the section by
         * changing its style. Keep the selected length
         * synchronized without taking over settings logic.
         */
        const parent =
            picker.closest(
                '.lf-settings-pin-length'
            ) || picker.parentElement;

        if (parent) {
            const observer =
                new MutationObserver(() => {
                    if (
                        getComputedStyle(parent).display !== 'none'
                    ) {
                        refreshPicker(picker);
                    }
                });

            observer.observe(
                parent,
                {
                    attributes: true,
                    attributeFilter: [
                        'style',
                        'class'
                    ]
                }
            );

            picker.__lfPinLengthObserver =
                observer;
        }
    };

    UI.getPreferredPinLength = preferredLength;

    UI.setPreferredPinLength = length => {
        const normalized =
            Number(length) === 6 ? 6 : 4;

        localStorage.setItem(
            'locked-folder-pin-length',
            String(normalized)
        );

        syncAllPickers(
            normalized
        );
    };

    /* ---------------------------------------------------------
       Auto initialization
       --------------------------------------------------------- */

    function autoInitPicker() {
        const picker =
            document.getElementById(
                'lfPinLengthPicker'
            );

        if (picker) {
            UI.initPinLengthPicker(
                picker
            );
        }
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            autoInitPicker,
            { once: true }
        );
    } else {
        autoInitPicker();
    }

    /* ---------------------------------------------------------
       Public API
       --------------------------------------------------------- */

    window.LockedFolderUI = UI;
})();