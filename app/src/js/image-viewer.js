(function () {
    'use strict';

    const noteContent = document.getElementById('noteContentInput');
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');
    const closeButton = document.getElementById('modalCloseBtn');
    const contextMenu = document.getElementById('imageContextMenu');
    const clearAltMenuItem = document.getElementById('imageContextClearAltItem');
    const replaceImageInput = document.getElementById('replaceImageInput');
    const toast = document.getElementById('imageActionToast');
    const toastMessage = document.getElementById('imageActionToastMessage');
    const undoButton = document.getElementById('imageActionUndo');

    if (!noteContent || !modal || !modalImage || !modalCaption || !closeButton ||
        !contextMenu || !clearAltMenuItem || !replaceImageInput || !toast || !toastMessage || !undoButton) {
        throw new Error('Image viewer markup is incomplete.');
    }

    let isModalOpen = false;
    let isContextMenuOpen = false;
    let activeTargetImage = null;
    let modalSourceImage = null;
    let lastActiveElement = null;
    let previousBodyOverflow = '';
    let longPressTimer = null;
    let longPressTriggered = false;
    let longPressResetTimer = null;
    let toastTimer = null;
    let pendingUndo = null;
    let touchOrigin = null;

    function noteImageFor(target) {
        return target === modalImage ? modalSourceImage : target;
    }

    function getImageCaption(image) {
        const figure = image.closest('figure');
        const caption = figure
            ? figure.querySelector('figcaption')
            : image.nextElementSibling?.classList.contains('note-image-caption')
                ? image.nextElementSibling
                : null;
        return caption ? caption.textContent.trim() : image.alt || '';
    }

    function prepareNoteImages() {
        noteContent.querySelectorAll('img').forEach((image) => {
            image.classList.add('note-thumbnail');
            image.setAttribute('tabindex', '0');
            image.setAttribute('role', 'button');
            image.setAttribute('aria-haspopup', 'dialog');
            image.setAttribute('aria-label', 'Open full-screen image viewer');
        });
    }

    function closeContextMenu(restoreFocus) {
        if (!isContextMenuOpen) return;

        contextMenu.classList.remove('is-open');
        contextMenu.hidden = true;
        contextMenu.setAttribute('aria-hidden', 'true');
        isContextMenuOpen = false;

        if (restoreFocus && activeTargetImage && activeTargetImage.isConnected) {
            activeTargetImage.focus({ preventScroll: true });
        }
    }

    function openModal(image) {
        if (isModalOpen) return;

        closeContextMenu(false);
        prepareNoteImages();
        modalSourceImage = image;
        activeTargetImage = image;
        lastActiveElement = image;
        modalImage.src = image.dataset.fullSrc || image.src;
        modalImage.alt = image.alt || '';
        modalCaption.textContent = getImageCaption(image);
        modalCaption.hidden = !modalCaption.textContent;

        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        isModalOpen = true;
        document.addEventListener('keydown', handleModalKeydown);
        closeButton.focus();
    }

    function closeModal() {
        if (!isModalOpen) return;

        closeContextMenu(false);
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = previousBodyOverflow;
        document.removeEventListener('keydown', handleModalKeydown);
        isModalOpen = false;

        if (lastActiveElement && document.contains(lastActiveElement)) {
            lastActiveElement.focus({ preventScroll: true });
        }
        lastActiveElement = null;
        modalSourceImage = null;
    }

    function handleModalKeydown(event) {
        if (!isModalOpen) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeModal();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusableElements = isContextMenuOpen
            ? [...getVisibleMenuItems(), modalImage, closeButton]
            : [modalImage, closeButton];
        const currentIndex = focusableElements.indexOf(document.activeElement);

        if (event.shiftKey && currentIndex <= 0) {
            event.preventDefault();
            focusableElements[focusableElements.length - 1].focus();
        } else if (!event.shiftKey &&
            (currentIndex === focusableElements.length - 1 || currentIndex === -1)) {
            event.preventDefault();
            focusableElements[0].focus();
        }
    }

    function showToast(message, undo) {
        window.clearTimeout(toastTimer);
        pendingUndo = typeof undo === 'function' ? undo : null;
        toastMessage.textContent = message;
        undoButton.hidden = !pendingUndo;
        toast.hidden = false;
        toast.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => toast.classList.add('is-visible'));
        toastTimer = window.setTimeout(hideToast, pendingUndo ? 7000 : 2800);
    }

    function hideToast() {
        toast.classList.remove('is-visible');
        toast.setAttribute('aria-hidden', 'true');
        pendingUndo = null;
        window.setTimeout(() => {
            if (toast.getAttribute('aria-hidden') === 'true') toast.hidden = true;
        }, 220);
    }

    function updateNote() {
        if (window.app && typeof window.app.updateCurrentNote === 'function') {
            Promise.resolve(window.app.updateCurrentNote()).catch((error) => {
                console.error('[ImageViewer] Could not save note changes:', error);
                showToast('Could not save the image changes.');
            });
        }
    }

    function openContextMenu(target, x, y) {
        closeContextMenu(false);
        activeTargetImage = target;
        const image = noteImageFor(target);
        clearAltMenuItem.hidden = !image?.alt.trim();
        contextMenu.hidden = false;
        contextMenu.setAttribute('aria-hidden', 'false');
        contextMenu.style.left = '0px';
        contextMenu.style.top = '0px';
        contextMenu.classList.add('is-open');

        const left = Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8));
        const top = Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8));
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        isContextMenuOpen = true;
        contextMenu.querySelector('[role="menuitem"]')?.focus();
    }

    function getVisibleMenuItems() {
        return Array.from(contextMenu.querySelectorAll('[role="menuitem"]'))
            .filter((item) => !item.closest('li')?.hidden);
    }

    function handleContextMenu(event) {
        const image = event.target instanceof Element
            ? event.target.closest('img.note-thumbnail, #modalImage')
            : null;
        if (!image) return;

        event.preventDefault();
        openContextMenu(image, event.clientX, event.clientY);
    }

    function cancelLongPress() {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
        touchOrigin = null;
    }

    function startLongPress(event) {
        if (event.touches.length !== 1) {
            cancelLongPress();
            return;
        }

        const image = event.target instanceof Element
            ? event.target.closest('img.note-thumbnail, #modalImage')
            : null;
        if (!image) return;

        const touch = event.touches[0];
        touchOrigin = { x: touch.clientX, y: touch.clientY };
        window.clearTimeout(longPressTimer);
        window.clearTimeout(longPressResetTimer);
        longPressTimer = window.setTimeout(() => {
            longPressTriggered = true;
            openContextMenu(image, touchOrigin.x, touchOrigin.y);
            longPressResetTimer = window.setTimeout(() => {
                longPressTriggered = false;
            }, 900);
            longPressTimer = null;
        }, 500);
    }

    function moveLongPress(event) {
        if (!longPressTimer || !touchOrigin || !event.touches.length) return;
        const touch = event.touches[0];
        if (Math.hypot(touch.clientX - touchOrigin.x, touch.clientY - touchOrigin.y) > 10) {
            cancelLongPress();
        }
    }

    function endLongPress() {
        cancelLongPress();
    }

    function suppressLongPressClick(event) {
        if (!longPressTriggered) return false;

        event.preventDefault();
        event.stopPropagation();
        longPressTriggered = false;
        window.clearTimeout(longPressResetTimer);
        return true;
    }

    function handleImageClick(event) {
        if (suppressLongPressClick(event)) return;

        const image = event.target instanceof Element
            ? event.target.closest('img.note-thumbnail')
            : null;
        if (!image || !noteContent.contains(image)) return;

        event.preventDefault();
        openModal(image);
    }

    function handleModalImageClick(event) {
        if (longPressTriggered) {
            event.preventDefault();
            event.stopPropagation();
            longPressTriggered = false;
            window.clearTimeout(longPressResetTimer);
        }
    }

    function startCaptionEdit(image, editInModal) {
        const figure = image.closest('figure');
        let imageCaption = figure
            ? figure.querySelector('figcaption')
            : image.nextElementSibling?.classList.contains('note-image-caption')
                ? image.nextElementSibling
                : null;

        if (!imageCaption && !editInModal) {
            imageCaption = document.createElement(figure ? 'figcaption' : 'span');
            imageCaption.className = 'note-image-caption';
            imageCaption.textContent = image.alt || '';
            image.insertAdjacentElement('afterend', imageCaption);
        }

        const caption = editInModal ? modalCaption : imageCaption;
        const wasHidden = caption.hidden === true;
        if (editInModal) {
            caption.textContent = getImageCaption(image);
            caption.hidden = false;
        }
        const originalText = caption.textContent;
        let finished = false;
        caption.contentEditable = 'true';
        caption.setAttribute('role', 'textbox');
        caption.setAttribute('aria-label', 'Image caption');
        caption.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(caption);
        selection.removeAllRanges();
        selection.addRange(range);

        const finish = (save) => {
            if (finished) return;
            finished = true;
            if (!save) caption.textContent = originalText;
            caption.contentEditable = 'false';
            caption.removeAttribute('role');
            caption.removeAttribute('aria-label');
            caption.removeEventListener('keydown', handleCaptionKeydown);
            caption.removeEventListener('blur', handleCaptionBlur);

            if (save) {
                image.alt = caption.textContent.trim();
                if (editInModal && imageCaption) imageCaption.textContent = image.alt;
                if (!editInModal && !caption.textContent.trim() &&
                    caption.classList.contains('note-image-caption')) {
                    caption.remove();
                }
                if (isModalOpen && modalSourceImage === image) {
                    modalCaption.textContent = image.alt;
                    modalCaption.hidden = !image.alt;
                    modalImage.alt = image.alt;
                }
                updateNote();
                showToast('Image caption updated.');
            } else if (editInModal) {
                caption.hidden = wasHidden;
            }
        };

        const handleCaptionKeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                caption.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
                caption.blur();
            }
        };
        const handleCaptionBlur = () => finish(true);
        caption.addEventListener('keydown', handleCaptionKeydown);
        caption.addEventListener('blur', handleCaptionBlur);
    }

    function removeImageFromNote(image) {
        if (!image?.isConnected) return;
        const figure = image.closest('figure');
        const node = figure || image;
        const parent = node.parentNode;
        if (!parent) return;
        const caption = !figure && image.nextElementSibling?.classList.contains('note-image-caption')
            ? image.nextElementSibling
            : null;
        const restoreBefore = caption ? caption.nextSibling : node.nextSibling;

        node.remove();
        if (caption) caption.remove();
        updateNote();

        if (isModalOpen && modalSourceImage === image) closeModal();

        showToast('Image removed from note.', () => {
            if (!parent.isConnected) return;
            parent.insertBefore(node, restoreBefore?.parentNode === parent ? restoreBefore : null);
            if (caption) parent.insertBefore(caption, node.nextSibling);
            prepareNoteImages();
            updateNote();
        });
    }

    function clearAltText(image) {
        image.alt = '';
        if (isModalOpen && modalSourceImage === image) {
            modalImage.alt = '';
            modalCaption.textContent = getImageCaption(image);
            modalCaption.hidden = !modalCaption.textContent;
        }
        updateNote();
        showToast('Image alt text deleted.');
    }

    function getActiveImage() {
        return noteImageFor(activeTargetImage);
    }

    async function copyImage(target) {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
            throw new Error('Image clipboard access is not available in this browser.');
        }

        const response = await fetch(target.src);
        if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
        let blob = await response.blob();

        if (blob.type !== 'image/png') {
            if (typeof createImageBitmap !== 'function') {
                throw new Error('This browser cannot convert the image to PNG for copying.');
            }
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close();
            blob = await new Promise((resolve, reject) => {
                canvas.toBlob((png) => {
                    if (png) resolve(png);
                    else reject(new Error('Could not convert the image to PNG.'));
                }, 'image/png');
            });
        }

        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Image copied to clipboard.');
    }

    function downloadImage(target) {
        const link = document.createElement('a');
        link.href = target.dataset.fullSrc || target.src;
        link.download = 'note-image.png';
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast('Image download started.');
    }

    function replaceImage(target) {
        replaceImageInput.value = '';
        replaceImageInput.onchange = async () => {
            const file = replaceImageInput.files?.[0];
            replaceImageInput.onchange = null;
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Choose a valid image file.');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                showToast('Image is too large. Maximum size is 5 MB.');
                return;
            }

            try {
                const source = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('Could not read the selected image.'));
                    reader.readAsDataURL(file);
                });
                if (!target.isConnected) throw new Error('The image is no longer in this note.');

                target.src = source;
                target.removeAttribute('data-full-src');
                target.alt = file.name.replace(/\.[^.]+$/, '');
                const figure = target.closest('figure');
                const caption = figure
                    ? figure.querySelector('figcaption')
                    : target.nextElementSibling?.classList.contains('note-image-caption')
                        ? target.nextElementSibling
                        : null;
                if (caption) caption.textContent = target.alt;
                if (isModalOpen && modalSourceImage === target) {
                    modalImage.src = source;
                    modalImage.alt = target.alt;
                    modalCaption.textContent = getImageCaption(target);
                    modalCaption.hidden = !modalCaption.textContent;
                }
                updateNote();
                showToast('Image replaced.');
            } catch (error) {
                console.error('[ImageViewer] Image replacement failed:', error);
                showToast(error.message || 'Image replacement failed.');
            } finally {
                replaceImageInput.value = '';
            }
        };
        replaceImageInput.click();
    }

    function runImageAction(action) {
        const target = activeTargetImage;
        const image = getActiveImage();
        closeContextMenu(false);
        if (!target || !image) return;

        if (action === 'view') {
            if (target === modalImage) {
                window.open(target.src, '_blank', 'noopener');
            } else {
                openModal(image);
            }
        } else if (action === 'copy') {
            copyImage(target).catch((error) => {
                console.error('[ImageViewer] Could not copy image:', error);
                showToast(error.message || 'Could not copy image.');
            });
        } else if (action === 'download') {
            downloadImage(target);
        } else if (action === 'caption') {
            startCaptionEdit(image, target === modalImage);
        } else if (action === 'replace') {
            replaceImage(image);
        } else if (action === 'clear-alt') {
            clearAltText(image);
        } else if (action === 'delete') {
            removeImageFromNote(image);
        }
    }

    noteContent.addEventListener('click', handleImageClick);
    modalImage.addEventListener('click', handleModalImageClick);
    noteContent.addEventListener('keydown', (event) => {
        const image = event.target instanceof HTMLImageElement ? event.target : null;
        if (!image?.classList.contains('note-thumbnail')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        openModal(image);
    });

    document.addEventListener('contextmenu', handleContextMenu);
    noteContent.addEventListener('touchstart', startLongPress, { passive: true });
    noteContent.addEventListener('touchmove', moveLongPress, { passive: true });
    noteContent.addEventListener('touchend', endLongPress, { passive: true });
    noteContent.addEventListener('touchcancel', endLongPress, { passive: true });
    modalImage.addEventListener('touchstart', startLongPress, { passive: true });
    modalImage.addEventListener('touchmove', moveLongPress, { passive: true });
    modalImage.addEventListener('touchend', endLongPress, { passive: true });
    modalImage.addEventListener('touchcancel', endLongPress, { passive: true });

    document.addEventListener('pointerdown', (event) => {
        if (!isContextMenuOpen || contextMenu.contains(event.target)) return;
        closeContextMenu(false);
    }, true);
    document.addEventListener('click', (event) => {
        if (isContextMenuOpen && !contextMenu.contains(event.target)) {
            closeContextMenu(false);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isContextMenuOpen) {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeContextMenu(true);
            return;
        }
        if (!isContextMenuOpen) return;

        const items = getVisibleMenuItems();
        const currentIndex = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = currentIndex < 0
                ? (direction > 0 ? 0 : items.length - 1)
                : (currentIndex + direction + items.length) % items.length;
            items[nextIndex].focus();
        }
    });
    contextMenu.addEventListener('click', (event) => {
        const button = event.target instanceof Element
            ? event.target.closest('[data-image-action]')
            : null;
        if (button) runImageAction(button.dataset.imageAction);
    });
    window.addEventListener('scroll', () => closeContextMenu(false), true);
    window.addEventListener('resize', () => closeContextMenu(false));

    closeButton.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    undoButton.addEventListener('click', () => {
        if (!pendingUndo) return;
        const undo = pendingUndo;
        hideToast();
        undo();
    });

    prepareNoteImages();
    new MutationObserver(prepareNoteImages).observe(noteContent, {
        childList: true,
        subtree: true
    });
})();
