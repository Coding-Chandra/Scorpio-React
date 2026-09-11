/* =====================================================
   APP NOTIFICATIONS
   -----------------------------------------------------
   Same markup/classes as the settings-page notifications
   (#notification-container, .notif, .notif-close) so the
   CSS you copy over from settings applies without changes.

   Exposes window.showNotification(title, message, type)
   so security-monitor.js (and anything else) can use it
   here exactly like it does on the settings page.

   Requires AnimationUtils (already used elsewhere in app.js)
   for the toast in/out animation.
===================================================== */

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

    const MAX_NOTIFICATIONS = 1;
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
            <span></span>
        </div>
        <div class="notif-message" style="opacity: 0.9; font-size: 13px; margin-left: 24px;"></div>
    `;
    notification.querySelector('div[style*="font-weight"] span').textContent = String(title ?? '');
    notification.querySelector('.notif-message').textContent = String(message ?? '');

    container.appendChild(notification);

    AnimationUtils.toast(notification, 'in');

    const dismiss = () => {
        if (notification._timeout) clearTimeout(notification._timeout);
        AnimationUtils.toast(notification, 'out', () => notification.remove());
    };

    notification._timeout = setTimeout(dismiss, 4000);

    notification.addEventListener('click', () => {
        if (notification.dataset.suppressClick === 'true') {
            delete notification.dataset.suppressClick;
            return;
        }
        dismiss();
    });

    const closeBtn = notification.querySelector('.notif-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });
        closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // Swipe-to-dismiss (touch and mouse drag, via Pointer Events)
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
            const swipeOut = currentX > 0 ? AnimationUtils.swipeOutRight : AnimationUtils.swipeOutLeft;
            swipeOut(notification, 250, () => notification.remove());
        } else {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        }
    };

    notification.addEventListener('pointerup', endDrag);
    notification.addEventListener('pointercancel', endDrag);
}

window.showNotification = showNotification;