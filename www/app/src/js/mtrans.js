/* =====================================================
   MOBILE CONTAINER TRANSFORM TRANSITIONS + BACK GESTURES
   File: mtrans.js
   For: Notoz (mobile layout, <= 1024px)

   Folder tapped  -> Notes view grows out of that folder.
   Note tapped    -> Editor grows out of that note.
   Back / close   -> The reverse: the pane shrinks back
                     into the folder / note it came from.

   Works wherever the item is (top, bottom, scrolled,
   list mode or grid mode) because the origin is measured
   from the real element at tap time.

   Edge-swipe back (finger-tracked, interactive):
     - iOS     : pane slides with the finger, previous pane
                 parallaxes in underneath with a dim + edge shadow.
     - Android : "predictive back" look - pane shrinks, rounds
                 its corners and reveals the previous pane.
   Swipe from the left edge (first 32px, 64px on Android).
   Release past the threshold (or flick) to go back, otherwise
   it springs back. The release animation continues with the
   finger's own velocity, so there is no hitch at lift-off.
   Force a style with window.MTRANS_BACK_STYLE = 'ios' | 'android'.

   Optional switches (set before this file loads):
     window.MTRANS_BACK_STYLE        'ios' | 'android'
     window.MTRANS_EDGE_PX           edge zone width in px
     window.MTRANS_NAV_CROSSFADE     false = don't cross-fade the top nav bar
   ===================================================== */

(() => {
  'use strict';

  if (window.__mtransLoaded) return;          // never bind twice
  window.__mtransLoaded = true;

  const PANE_ID = {
    folders: 'sidebar',
    notes: 'notes-list-pane',
    editor: 'editor-pane'
  };
  const RANK = { folders: 0, notes: 1, editor: 2 };

  const OPEN_MS = 780;
  const CLOSE_MS = 620;
  const EASE_FADE = 'cubic-bezier(0.2, 0, 0, 1)';
  const START_SCALE = 0.88;     // content "pop" while the pane grows (raised per item when it must be, see shapeFor)
  const TAP_FRESH_MS = 900;     // how long a tap counts as the origin
  const SHADOW_W = 48;          // iOS edge shadow width

  const $ = (id) => document.getElementById(id);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const fx2 = (n) => +n.toFixed(2);
  const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };


  /* ---------------------------------------------
     Spring easing (iOS / One UI style physics)
     Builds a CSS linear() easing from a damped spring.

       zeta  < 1  : tiny overshoot (organic landing)
       zeta >= 1  : critically damped (no overshoot)
       decay      : zeta * omega; higher = settles sooner
       v0         : INITIAL VELOCITY, in progress-units per
                    full duration. This is what makes a
                    gesture release continue the finger's
                    motion instead of restarting from rest.

     The curve is nudged by the tiny leftover of the spring
     (smoothstep-weighted) so it lands on exactly 1 with zero
     slope - no last-frame snap - without touching the start
     slope (v0).
  --------------------------------------------- */
  const SUPPORTS_LINEAR = !!(window.CSS && CSS.supports &&
    CSS.supports('animation-timing-function', 'linear(0, 1)'));
  const curveCache = new Map();

  function springCurve(zeta, decay, v0, ms) {
    const w = decay / zeta;
    v0 = Math.max(-2, Math.min(w, v0 || 0));     // w = largest v0 that still never overshoots (zeta = 1)
    const N = Math.max(32, Math.min(128, Math.round(ms / 7)));
    const key = v0 === 0 ? `${zeta}|${decay}|${N}` : null;
    if (key && curveCache.has(key)) return curveCache.get(key);

    const pts = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      if (zeta >= 1) {
        pts[i] = 1 - Math.exp(-w * t) * (1 + (w - v0) * t);
      } else {
        const wd = w * Math.sqrt(1 - zeta * zeta);
        pts[i] = 1 - Math.exp(-zeta * w * t) *
          (Math.cos(wd * t) + ((zeta * w - v0) / wd) * Math.sin(wd * t));
      }
    }
    const residual = 1 - pts[N];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts[i] += residual * t * t * (3 - 2 * t);
    }
    pts[N] = 1;

    const css = `linear(${pts.map(v => v.toFixed(4)).join(', ')})`;
    if (key) curveCache.set(key, css);
    return css;
  }

  function spring(zeta, decay, v0, ms, fallback) {
    return SUPPORTS_LINEAR ? springCurve(zeta, decay, v0, ms) : fallback;
  }

  const FALLBACK_OPEN = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const FALLBACK_CLOSE = 'cubic-bezier(0.3, 0, 0.1, 1)';
  const FALLBACK_RELEASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const EASE_OPEN = spring(0.86, 5.5, 0, OPEN_MS, FALLBACK_OPEN);
  const EASE_CLOSE = spring(1, 7.5, 0, CLOSE_MS, FALLBACK_CLOSE);

  /* Perf helpers: only active while a transition runs */
  const perfStyle = document.createElement('style');
  perfStyle.textContent = `
    .mt-layer {
      will-change: transform, clip-path, opacity;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }
    /* The leaving pane doesn't need its live blur: it is fading out,
       and re-blurring a full-screen pane every frame is what causes jank. */
    @media (max-width: 1024px) {
      html, body { overscroll-behavior-x: none; }
    }
    .mt-leaving, .mt-leaving * {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `;
  document.head.appendChild(perfStyle);

  let origGo = null;            // the untouched app.goToMobileView
  let lastTap = null;           // { rect, radius, time }
  let running = null;           // { cleanup, gs? }
  let releasing = null;         // gesture whose release animation is still playing
  const origins = {};           // origins[view] = { rect, radius } of the item that opened `view`

  /* ---------------------------------------------
     Remember which folder / note was tapped.
     Capture phase on document runs BEFORE the item's
     own onclick, so we measure it before app.js
     re-renders the lists.
  --------------------------------------------- */
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.folder-item, .note-item');
    if (!item) return;
    if (e.target.closest('.folder-more-btn, .note-more-btn')) return;
    const rect = measure(item);
    if (!rect) return;
    lastTap = {
      rect,
      radius: radiusOf(item, rect),
      time: performance.now()
    };
  }, true);

  /* ---------------------------------------------
     Helpers
  --------------------------------------------- */
  function measure(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    // fully off-screen (scrolled away) -> not usable
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  // Corner radius of an item, capped so pills (9999px / 50%) can't produce a nonsense clip.
  function radiusOf(el, rect) {
    const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    const r = Number.isFinite(raw) ? raw : 14;
    return Math.min(r, rect.width / 2, rect.height / 2);
  }

  const PANE_ANIM_CLASSES = ['pane-animated', 'pane-animate-from-top', 'pane-animate-from-bottom',
    'pane-animate-from-left', 'pane-animate-from-right'];

  // app.js leaves these classes on panes; CSS animations RESTART whenever a pane
  // goes display:none -> flex, so the old fadeSlideIn (with its offset + blur)
  // would replay on top of our transition and land misaligned.
  function stripPaneAnim(el) {
    if (el) el.classList.remove(...PANE_ANIM_CLASSES);
  }

  function boxOf(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  // Pin a pane to the exact box it occupies in normal layout, so the
  // "ghost" copy has identical size/position (no 100%-width + padding drift).
  function pinGhost(el, box, z) {
    el.style.display = 'flex';
    el.style.position = 'fixed';
    el.style.top = box.top + 'px';
    el.style.left = box.left + 'px';
    el.style.width = box.width + 'px';
    el.style.height = box.height + 'px';
    el.style.boxSizing = 'border-box';
    el.style.pointerEvents = 'none';
    el.style.zIndex = z;
  }

  // z-index is ignored on position:static (non-flex-item) boxes. Make sure the
  // layer we stack actually stacks; `relative` with no offsets never moves it.
  function ensurePositioned(el) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function withoutAppAnim(fn) {
    const real = app.animateEl;
    app.animateEl = () => {};
    try { return fn(); } finally { app.animateEl = real; }
  }

  function esc(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v);
  }

  function folderEl() {
    const id = app.activeFolderId;
    if (id == null) return null;
    if (id === 'all') {
      return document.querySelector('#folderListContainer .folder-item:not([data-folder-id])');
    }
    return document.querySelector(`#folderListContainer [data-folder-id="${esc(id)}"]`);
  }

  function noteEl() {
    const id = app.activeNoteId;
    if (id == null) return null;
    return document.querySelector(`#notes-list-pane [data-note-id="${esc(id)}"]`);
  }

  function fallbackRect() {
    const w = 140, h = 64;
    return {
      top: window.innerHeight * 0.55 - h / 2,
      left: window.innerWidth / 2 - w / 2,
      width: w,
      height: h
    };
  }

  // Origin when OPENING (measured while the old pane is still visible)
  function openOrigin(toView) {
    if (lastTap && performance.now() - lastTap.time < TAP_FRESH_MS) {
      return { rect: lastTap.rect, radius: lastTap.radius };
    }
    const el = toView === 'editor' ? noteEl() : folderEl();
    const rect = measure(el);
    return rect ? { rect, radius: radiusOf(el, rect) } : { rect: fallbackRect(), radius: 14 };
  }

  // Target when CLOSING (measured after the destination pane is shown, with no
  // transform on it). Prefers the live element; falls back to where that level
  // was opened from.
  function closeTarget(toView, fromView) {
    const el = toView === 'notes' ? noteEl() : folderEl();
    const live = measure(el);
    if (live) return { rect: live, radius: radiusOf(el, live) };
    if (origins[fromView]) return origins[fromView];
    return { rect: fallbackRect(), radius: 14 };
  }

  /* ---------------------------------------------
     Geometry: the item rect, expressed as a clip-path in the
     pane's own box.
  --------------------------------------------- */
  const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)';
  const xf = (tx, ty, s) => `translate3d(${fx2(tx)}px, ${fx2(ty)}px, 0px) scale(${+s.toFixed(4)})`;
  const roundClip = (r) => `inset(0px 0px 0px 0px round ${fx2(Math.max(0, r))}px)`;

  // Only the part of the item that is actually on screen / inside the pane counts.
  function visibleRect(rect, box) {
    const left = Math.max(rect.left, box.left);
    const top = Math.max(rect.top, box.top);
    const right = Math.min(rect.left + rect.width, box.left + box.width);
    const bottom = Math.min(rect.top + rect.height, box.top + box.height);
    if (right - left < 1 || bottom - top < 1) return rect;
    return { left, top, width: right - left, height: bottom - top };
  }

  function localCenter(rect, box) {
    return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top };
  }

  /**
   * Clip-path that matches `rect` on screen, expressed in the pane's own box.
   * The pane is also scaled by `s` around the rect's centre, so the rect is
   * enlarged by 1/s to cancel it.
   *
   * `s` is START_SCALE, but never smaller than what the item needs: a full-width
   * list row (e.g. 358px of a 390px screen) is WIDER than a 0.88-scaled pane
   * (343px), so with a fixed 0.88 the grown pane would start narrower than the
   * row it grows from. Raising `s` just enough makes t=0 line up to the pixel.
   */
  function shapeFor(rect, radius, box) {
    const r = visibleRect(rect, box);
    const c = localCenter(r, box);
    const need = Math.max(
      r.width / (2 * Math.max(c.x, 1)),
      r.width / (2 * Math.max(box.width - c.x, 1)),
      r.height / (2 * Math.max(c.y, 1)),
      r.height / (2 * Math.max(box.height - c.y, 1))
    );
    const s = Math.min(1, Math.max(START_SCALE, need + 0.002));
    const hw = r.width / 2 / s;
    const hh = r.height / 2 / s;
    const top = Math.max(0, c.y - hh);
    const left = Math.max(0, c.x - hw);
    const right = Math.max(0, box.width - (c.x + hw));
    const bottom = Math.max(0, box.height - (c.y + hh));
    const rad = Math.min(radius, r.width / 2, r.height / 2) / s;
    return {
      s,
      ox: c.x,
      oy: c.y,
      origin: `${fx2(c.x)}px ${fx2(c.y)}px`,
      clip: `inset(${fx2(top)}px ${fx2(right)}px ${fx2(bottom)}px ${fx2(left)}px round ${fx2(rad)}px)`
    };
  }


  /* =====================================================
     NAV BAR CROSS-FADE
     app.js swaps the top nav's content instantly on every view
     change. Fading the new content in from 0 makes the OLD
     content vanish in a single frame, so we keep a frozen copy
     of the old bar on top and fade it out while the real one
     fades in. If the bar didn't change, nothing is done.
  ===================================================== */
  function snapshotNav() {
    if (window.MTRANS_NAV_CROSSFADE === false) return null;
    const nav = $('mobileNavBar');
    if (!nav) return null;
    const rect = nav.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    try {
      return { nav, rect, html: nav.innerHTML, clone: nav.cloneNode(true) };
    } catch (_) {
      return null;
    }
  }

  function playNavSwap(snap, ms) {
    const fx = {
      anims: [],
      el: null,
      remove() { if (this.el) { this.el.remove(); this.el = null; } }
    };
    if (!snap || snap.nav.innerHTML === snap.html) return fx;
    try {
      const { nav, rect, clone } = snap;
      const z = parseInt(getComputedStyle(nav).zIndex, 10);
      clone.style.cssText +=
        ';position:fixed;right:auto;bottom:auto;margin:0;box-sizing:border-box;transform:none;pointer-events:none;' +
        `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;` +
        (Number.isNaN(z) ? '' : `z-index:${z};`);
      clone.setAttribute('aria-hidden', 'true');
      nav.after(clone);               // AFTER the real bar: getElementById still finds the real one first
      fx.el = clone;
      fx.anims.push(clone.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: ms * 0.55, easing: 'ease-out', fill: 'forwards' }));
      fx.anims.push(nav.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: ms * 0.6, delay: ms * 0.1, easing: 'ease-out', fill: 'backwards' }));
    } catch (_) {
      fx.remove();
    }
    return fx;
  }


  /* =====================================================
     CONTAINER TRANSFORM (open / close)
  ===================================================== */
  const PANE_PROPS = ['position', 'top', 'left', 'width', 'height', 'boxSizing', 'pointerEvents', 'zIndex', 'transformOrigin'];

  function animateOpen({ inPane, outPane, inBox, outBox, rect, radius }) {
    const shape = shapeFor(rect, radius, inBox);
    const anims = [];

    // New pane grows out of the tapped item
    inPane.style.transformOrigin = shape.origin;
    anims.push(inPane.animate([
      { clipPath: shape.clip, transform: xf(0, 0, shape.s) },
      { clipPath: FULL_CLIP, transform: xf(0, 0, 1) }
    ], { duration: OPEN_MS, easing: EASE_OPEN }));
    // fade in quickly on its own timeline so the spring doesn't drag it
    anims.push(inPane.animate([
      { opacity: 0 }, { opacity: 1 }
    ], { duration: OPEN_MS * 0.3, easing: 'ease-out' }));

    // Old pane recedes behind it
    const oc = localCenter(visibleRect(rect, outBox), outBox);
    outPane.style.transformOrigin = `${fx2(oc.x)}px ${fx2(oc.y)}px`;
    anims.push(outPane.animate([
      { opacity: 1, transform: xf(0, 0, 1) },
      { opacity: 0, transform: xf(0, 0, 0.94) }
    ], { duration: OPEN_MS * 0.85, easing: EASE_FADE, fill: 'forwards' }));

    return anims;
  }

  /**
   * Top pane shrinks back into the item it came from.
   * `from` describes where the pane is right now, so the same animation serves
   * both the button/hardware back (starts at rest, full-screen) and a committed
   * Android swipe (starts mid-drag).
   */
  function animateClose({ outPane, inPane, outBox, inBox, rect, shape, dur, ease, from, keepInOrigin }) {
    const anims = [];

    outPane.style.transformOrigin = shape.origin;
    anims.push(outPane.animate([
      { clipPath: from.clip, transform: from.transform },
      { clipPath: shape.clip, transform: xf(0, 0, shape.s) }
    ], { duration: dur, easing: ease, fill: 'forwards' }));
    // Content dissolves while it shrinks (no hold-then-pop)
    anims.push(outPane.animate([
      { opacity: 1 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0 }
    ], { duration: dur * 0.8, easing: 'ease-in', fill: 'forwards' }));

    // Destination pane is already there, and settles up into place
    if (!keepInOrigin) {
      const ic = localCenter(visibleRect(rect, inBox), inBox);
      inPane.style.transformOrigin = `${fx2(ic.x)}px ${fx2(ic.y)}px`;
    }
    anims.push(inPane.animate([
      { transform: from.destTransform }, { transform: xf(0, 0, 1) }
    ], { duration: dur, easing: ease }));
    anims.push(inPane.animate([
      { opacity: from.destOpacity }, { opacity: 1 }
    ], {
      duration: dur * 0.55,
      delay: from.destDelay == null ? dur * 0.05 : from.destDelay,
      easing: 'ease-out',
      fill: 'backwards'
    }));

    return anims;
  }

  function runTransition({ inPane, outPane, outNatural, opening, rect, radius, inView, outView, navFx }) {
    const inBox = boxOf(inPane);

    ensurePositioned(inPane);
    inPane.classList.add('mt-layer');
    outPane.classList.add('mt-layer', 'mt-leaving');

    // Keep the outgoing pane on screen as a "ghost" layer during the animation
    pinGhost(outPane, outNatural, opening ? '5' : '6');
    inPane.style.zIndex = opening ? '6' : '5';

    const anims = opening
      ? animateOpen({ inPane, outPane, inBox, outBox: outNatural, rect, radius })
      : animateClose({
          inPane, outPane, inBox, outBox: outNatural, rect,
          shape: shapeFor(rect, radius, outNatural),
          dur: CLOSE_MS,
          ease: EASE_CLOSE,
          from: { clip: FULL_CLIP, transform: xf(0, 0, 1), destTransform: xf(0, 0, 0.95), destOpacity: 0 }
        });
    if (navFx) anims.push(...navFx.anims);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      anims.forEach(a => { try { a.cancel(); } catch (_) {} });
      if (navFx) navFx.remove();
      inPane.classList.remove('mt-layer');
      outPane.classList.remove('mt-layer', 'mt-leaving');

      PANE_PROPS.forEach(p => { outPane.style[p] = ''; inPane.style[p] = ''; });

      // The outgoing pane should only stay visible if it is the current view again
      const cur = app.ui.mobileView;
      outPane.style.display = (cur === outView) ? 'flex' : 'none';
      inPane.style.display = (cur === inView) ? 'flex' : 'none';
      if (running && running.cleanup === cleanup) running = null;
    };

    Promise.all(anims.map(a => a.finished)).then(cleanup).catch(() => { /* cancelled */ });
    running = { cleanup };
  }

  /* ---------------------------------------------
     Wrap app.goToMobileView
  --------------------------------------------- */
  function install() {
    if (typeof app === 'undefined' || !app || !app.goToMobileView) return false;
    if (app._containerTransformsInstalled) return true;
    app._containerTransformsInstalled = true;

    const original = app.goToMobileView;
    origGo = original;
    installBackExit();

    app.goToMobileView = function (view) {
      const from = this.ui.mobileView;

      const canAnimate =
        this.ui.isMobile &&
        !reducedMotion.matches &&
        from !== view &&
        PANE_ID[from] && PANE_ID[view] &&
        typeof Element.prototype.animate === 'function';

      if (!canAnimate) return original.call(this, view);

      const opening = RANK[view] > RANK[from];
      const outPane = $(PANE_ID[from]);
      const inPane = $(PANE_ID[view]);
      if (!outPane || !inPane) return original.call(this, view);

      // A new navigation interrupts any running one
      if (running) running.cleanup();

      Object.values(PANE_ID).forEach(id => stripPaneAnim($(id)));
      const outNatural = boxOf(outPane);   // exact box of the pane that is leaving
      const navSnap = snapshotNav();       // frozen copy of the nav bar before app.js rewrites it

      // Opening: measure the origin now, while the old pane is still visible
      const origin = opening ? openOrigin(view) : null;
      if (opening) origins[view] = origin;

      // Run the normal view switch, but without its built-in fade/slide
      withoutAppAnim(() => original.call(this, view));

      // Closing: the destination is visible now, so measure where to shrink to
      const target = opening ? origin : closeTarget(view, from);

      runTransition({
        inPane,
        outPane,
        outNatural,
        opening,
        rect: target.rect,
        radius: target.radius,
        inView: view,
        outView: from,
        navFx: playNavSwap(navSnap, (opening ? OPEN_MS : CLOSE_MS) * 0.6)
      });

      lastTap = null;
    };
    return true;
  }


  /* =====================================================
     EDGE-SWIPE BACK GESTURE
  ===================================================== */
  const COMMIT_P = 0.35;              // progress needed to commit
  const COMMIT_VX = 0.45;             // px/ms flick velocity that also commits
  const SLOP = 6;                     // px before a horizontal drag is recognised
  const ANDROID_TRAVEL = 0.6;         // fraction of the width = full progress (android style)
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Android's own back-gesture zone swallows the first ~24px, so our zone is wider there.
  const EDGE_PX = window.MTRANS_EDGE_PX || (IS_IOS ? 32 : 64);
  const BACK_TO = { editor: 'notes', notes: 'folders' };
  const GESTURE_PROPS = ['position', 'top', 'left', 'width', 'height', 'boxSizing', 'pointerEvents', 'zIndex',
    'transformOrigin', 'transform', 'clipPath', 'opacity'];
  const DRAG_PROPS = ['transform', 'clipPath', 'opacity'];

  let g = null;                       // active (touching) gesture

  const backStyle = () => window.MTRANS_BACK_STYLE || (IS_IOS ? 'ios' : 'android');

  function backBlocked() {
    // Mirror BackHandler.intercept priorities 1-4: those consume "back" first.
    if ($('appDialogOverlay')?.classList.contains('show')) return true;
    const menus = ['shareDropdown', 'textStyleDropdown', 'noteActionsMenu',
      'folderActionsMenu', 'accountDropdown', 'viewOptionsMenu'];
    if (menus.some(id =>
      $(id)?.classList.contains('open') ||
      $(id)?.classList.contains('account-closing')
    )) return true;
    if ($('selectionToolbar')?.style.display === 'flex') return true;
    if (app.ui.multiSelect) return true;
    return false;
  }

  const nowMs = () => performance.now();

  function findTouch(e, id) {
    for (const t of e.touches) if (t.identifier === id) return t;
    return null;
  }

  document.addEventListener('touchstart', (e) => {
    if (typeof app === 'undefined' || !app || !app.ui || !app.ui.isMobile || !origGo) return;
    if (g || releasing || e.touches.length !== 1) return;
    const toView = BACK_TO[app.ui.mobileView];
    if (!toView) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_PX) return;
    if (backBlocked()) return;
    g = {
      state: 'pending',
      id: t.identifier,
      view: app.ui.mobileView,
      toView,
      startX: t.clientX,
      startY: t.clientY,
      originX: t.clientX,
      originY: t.clientY,
      dx: 0, dy: 0, p: 0, ty: 0,
      samples: [],
      anims: [],
      raf: 0,
      done: false
    };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = findTouch(e, g.id);
    if (!t) return;

    if (g.state === 'pending') {
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      // vertical intent -> this is a scroll, not a back swipe
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (!(dx > SLOP && dx > Math.abs(dy) * 1.2)) return;
      if (!beginGesture(g)) { g = null; return; }
      // Start tracking from the finger's position NOW, so the pane starts at 0
      // instead of jumping by the recognition slop on the first frame.
      g.originX = t.clientX;
      g.originY = t.clientY;
    }

    g.dx = t.clientX - g.originX;
    g.dy = t.clientY - g.originY;
    if (e.cancelable) e.preventDefault();
    g.samples.push({ x: t.clientX, t: nowMs() });
    if (g.samples.length > 8) g.samples.shift();
    if (!g.raf) {
      const gs = g;
      g.raf = requestAnimationFrame(() => { gs.raf = 0; if (!gs.done && gs.state === 'drag') paint(gs); });
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (g && [...e.changedTouches].some(t => t.identifier === g.id)) endTouch(false);
  }, { passive: true });
  document.addEventListener('touchcancel', () => endTouch(true), { passive: true });

  function beginGesture(gs) {
    if (running) running.cleanup();

    const top = $(PANE_ID[gs.view]);
    const dest = $(PANE_ID[gs.toView]);
    if (!top || !dest) return false;

    gs.state = 'drag';
    gs.top = top;
    gs.dest = dest;
    gs.style = backStyle();

    // Top pane becomes a fixed "ghost"; destination flows in underneath
    Object.values(PANE_ID).forEach(id => stripPaneAnim($(id)));
    const topBox = boxOf(top);
    ensurePositioned(dest);
    pinGhost(top, topBox, '7');
    dest.style.display = 'flex';
    dest.style.zIndex = '5';
    dest.style.opacity = '0';
    top.classList.add('mt-layer');
    dest.classList.add('mt-layer');

    const destBox = boxOf(dest);
    gs.topBox = topBox;
    gs.destBox = destBox;
    gs.W = topBox.width;

    // Where the pane would shrink to (the item it was opened from)
    gs.target = closeTarget(gs.toView, gs.view);

    if (gs.style === 'ios') {
      // dim + edge shadow are separate compositor-only layers, so they can fade
      // smoothly to nothing (a box-shadow on the pane would be cut off in one frame).
      gs.dim = document.createElement('div');
      gs.dim.style.cssText =
        `position:fixed;top:${destBox.top}px;left:${destBox.left}px;width:${destBox.width}px;height:${destBox.height}px;` +
        'background:#000;opacity:0;pointer-events:none;z-index:6;will-change:opacity;';
      gs.shadow = document.createElement('div');
      gs.shadow.style.cssText =
        `position:fixed;top:${topBox.top}px;left:${topBox.left}px;width:${SHADOW_W}px;height:${topBox.height}px;` +
        'background:linear-gradient(to left,rgba(0,0,0,0.20),rgba(0,0,0,0.07) 38%,rgba(0,0,0,0));' +
        `transform:translate3d(${-SHADOW_W}px,0,0);pointer-events:none;z-index:6;will-change:transform,opacity;`;
      document.body.appendChild(gs.dim);
      document.body.appendChild(gs.shadow);
    } else {
      // transform-origin is in the pane's OWN coordinates (the old code used screen coords)
      const shape = shapeFor(gs.target.rect, gs.target.radius, topBox);
      gs.ox = shape.ox;
      gs.oy = shape.oy;
      top.style.transformOrigin = shape.origin;
      const dc = localCenter(visibleRect(gs.target.rect, destBox), destBox);
      dest.style.transformOrigin = `${fx2(dc.x)}px ${fx2(dc.y)}px`;
    }

    running = { cleanup: () => endGesture(gs), gs };
    return true;
  }

  /* One function describes every on-screen value of the gesture as a function of
     progress p (0 = at rest, 1 = gone). The finger drives it, and the release
     animation samples the very same function, so the hand-over can't misalign. */
  function androidTopState(gs, p) {
    const s = 1 - (1 - START_SCALE) * p;
    return {
      tx: 20 * p,
      ty: gs.ty * clamp01(p * 4),            // follows the finger vertically, eased in from 0
      s,
      r: 30 * Math.min(1, p * 5)             // on-screen corner radius
    };
  }

  function gFrame(gs, p) {
    if (gs.style === 'ios') {
      const W = gs.W;
      const dOp = clamp01(p * 3);
      return {
        top: { transform: xf(p * W, 0, 1) },
        dest: { transform: xf(-(1 - p) * W * 0.28, 0, 1), opacity: +dOp.toFixed(3) },
        // dim follows the destination's own fade-in, so nothing darkens before it exists
        dim: { opacity: +(0.3 * (1 - p) * dOp).toFixed(3) },
        shadow: { transform: xf(p * W - SHADOW_W, 0, 1), opacity: +(1 - p).toFixed(3) }
      };
    }
    const st = androidTopState(gs, p);
    return {
      top: { transform: xf(st.tx, st.ty, st.s), clipPath: roundClip(st.r / st.s) },
      dest: {
        transform: xf(0, 0, 0.95 + 0.05 * Math.min(1, p * 1.5)),
        opacity: +clamp01(p * 2.5).toFixed(3)
      }
    };
  }

  const FRAME_KEYS = ['top', 'dest', 'dim', 'shadow'];

  function applyFrame(gs, frame) {
    FRAME_KEYS.forEach(k => {
      const el = gs[k], vals = frame[k];
      if (!el || !vals) return;
      for (const prop in vals) el.style[prop] = vals[prop];
    });
  }

  function paint(gs) {
    const range = gs.style === 'ios' ? gs.W : gs.W * ANDROID_TRAVEL;
    gs.p = clamp01(gs.dx / range);
    gs.ty = Math.max(-36, Math.min(36, gs.dy * 0.15));
    applyFrame(gs, gFrame(gs, gs.p));
  }

  // Keyframes that walk the gesture function from p0 to p1. Offsets are on the
  // EASED progress, so any spring (even with overshoot) stays exactly on the curve.
  function sampleFrames(gs, key, p0, p1) {
    const N = 10;
    const frames = [];
    for (let k = 0; k <= N; k++) {
      const vals = gFrame(gs, p0 + (p1 - p0) * (k / N))[key];
      frames.push(Object.assign({ offset: k / N }, vals));
    }
    return frames;
  }

  // Finger velocity (px/ms) over the last ~100ms. A finger that paused before
  // lifting has no velocity - the old code kept the stale value of the last move.
  function releaseVelocity(gs) {
    const now = nowMs();
    const recent = gs.samples.filter(s => now - s.t <= 100);
    if (recent.length < 2) return 0;
    const a = recent[0], b = recent[recent.length - 1];
    const dt = b.t - a.t;
    if (dt < 8 || now - b.t > 60) return 0;
    return (b.x - a.x) / dt;
  }

  function endTouch(cancelled) {
    const gs = g;
    if (!gs) return;
    if (gs.state === 'pending') { g = null; return; }
    if (gs.state !== 'drag') return;

    g = null;
    if (gs.raf) { cancelAnimationFrame(gs.raf); gs.raf = 0; }
    paint(gs);                                // settle on the final finger position

    const vx = releaseVelocity(gs);
    // A flick commits; a slow drag commits past the threshold unless the finger is clearly going back.
    const commit = !cancelled && gs.dx > 20 &&
      (vx > COMMIT_VX || (gs.p > COMMIT_P && vx > -0.25));

    gs.state = 'releasing';
    release(gs, commit, vx);
  }

  function endGesture(gs) {
    if (gs.done) return;
    gs.done = true;
    if (gs.raf) { cancelAnimationFrame(gs.raf); gs.raf = 0; }
    gs.anims.forEach(a => { try { a.cancel(); } catch (_) {} });
    if (gs.navFx) gs.navFx.remove();
    [gs.top, gs.dest].forEach(el => {
      GESTURE_PROPS.forEach(pr => { el.style[pr] = ''; });
      el.classList.remove('mt-layer', 'mt-leaving');
    });
    if (gs.dim) gs.dim.remove();
    if (gs.shadow) gs.shadow.remove();

    const cur = app.ui.mobileView;
    gs.top.style.display = (cur === gs.view) ? 'flex' : 'none';
    gs.dest.style.display = (cur === gs.toView) ? 'flex' : 'none';

    if (g === gs) g = null;                   // a programmatic navigation can end a gesture mid-drag
    if (releasing === gs) releasing = null;
    if (running && running.gs === gs) running = null;
  }

  function release(gs, commit, vx) {
    const ios = gs.style === 'ios';
    const p0 = gs.p;
    const p1 = commit ? 1 : 0;
    const dist = Math.abs(p1 - p0);
    const dir = p1 >= p0 ? 1 : -1;
    // finger speed in progress-units per ms (progress is not 1:1 with px for the android style)
    const pRate = vx / (ios ? gs.W : gs.W * ANDROID_TRAVEL);

    releasing = gs;
    running = { cleanup: () => endGesture(gs), gs };

    let navSnap = null;
    if (commit) {
      navSnap = snapshotNav();
      try {
        // Switch app state without its default pane animation
        withoutAppAnim(() => origGo.call(app, gs.toView));
      } catch (err) {
        endGesture(gs);
        throw err;
      }
      // updateLayout hid the top pane; keep it on screen while it animates out
      gs.top.style.display = 'flex';
      gs.dest.style.display = 'flex';
    }
    if (reducedMotion.matches) { endGesture(gs); return; }

    // Where everything is right now, then hand over from inline drag values to animations
    const frame0 = gFrame(gs, p0);
    const st0 = ios ? null : androidTopState(gs, p0);
    DRAG_PROPS.forEach(pr => FRAME_KEYS.forEach(k => { if (gs[k]) gs[k].style[pr] = ''; }));

    if (commit) {
      gs.navFx = playNavSwap(navSnap, CLOSE_MS * 0.6);
      gs.anims.push(...gs.navFx.anims);
    }

    if (commit && !ios) {
      // Same shrink-into-the-item animation as the back button, started from the current drag state.
      // The item may have moved while the app re-rendered (edited note jumps to the top), so re-measure.
      const tgt = closeTarget(gs.toView, gs.view);
      const shape = shapeFor(tgt.rect, tgt.radius, gs.topBox);
      const dur = CLOSE_MS;
      const v0 = pRate * dur / Math.max(dist, 0.05);
      // Moving transform-origin would shift a scaled pane; cancel that out so it doesn't jump.
      const k = 1 - st0.s;
      const tx = st0.tx - k * (shape.ox - gs.ox);
      const ty = st0.ty - k * (shape.oy - gs.oy);
      gs.anims.push(...animateClose({
        outPane: gs.top, inPane: gs.dest, outBox: gs.topBox, inBox: gs.destBox, rect: tgt.rect,
        shape, dur,
        ease: spring(1, 7.5, v0, dur, FALLBACK_CLOSE),
        keepInOrigin: true,
        from: {
          clip: roundClip(st0.r / st0.s),
          transform: xf(tx, ty, st0.s),
          destTransform: frame0.dest.transform,
          destOpacity: frame0.dest.opacity,
          destDelay: 0
        }
      }));
    } else {
      // iOS commit, and either style's spring-back: sample the gesture function p0 -> p1
      const dur = Math.round(commit ? 240 + 200 * dist : 220 + 160 * dist);
      const v0 = (pRate * dur * dir) / Math.max(dist, 0.05);
      const ease = spring(1, 8, v0, dur, FALLBACK_RELEASE);
      FRAME_KEYS.forEach(k => {
        if (!gs[k]) return;
        gs.anims.push(gs[k].animate(sampleFrames(gs, k, p0, p1),
          { duration: dur, easing: ease, fill: 'forwards' }));
      });
    }

    Promise.all(gs.anims.map(a => a.finished)).then(() => endGesture(gs)).catch(() => { /* cancelled */ });
  }


  /* =====================================================
     BACK ORDER + DOUBLE-BACK-TO-EXIT
     editor -> notes -> folders (handled by BackHandler),
     then at folders: 1st back shows a hint, 2nd back exits.
  ===================================================== */
  const EXIT_WINDOW_MS = 2000;
  let exitRequested = false;
  let exitToastTimer = 0;

  function showExitToast() {
    let el = $('mtExitToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mtExitToast';
      el.textContent = 'Press back again to exit';
      el.style.cssText =
        'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);' +
        'transform:translateX(-50%);z-index:9999;pointer-events:none;' +
        'padding:10px 18px;border-radius:999px;font-size:14px;font-weight:500;' +
        'font-family:var(--font-family-ui, var(--font-family, system-ui, sans-serif));' +
        'color:#fff;background:rgba(30,30,32,0.88);white-space:nowrap;' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.25);display:none;';
      document.body.appendChild(el);
    }
    clearTimeout(exitToastTimer);

    // Re-showing while it is still fading out must continue from where it is, not snap to 0.
    const visible = el.style.display !== 'none';
    const startOp = visible ? (parseFloat(getComputedStyle(el).opacity) || 0) : 0;
    el.getAnimations().forEach(a => a.cancel());
    el.style.display = 'block';
    el.animate(
      [{ opacity: startOp, transform: `translate(-50%, ${fx2(12 * (1 - startOp))}px)` },
       { opacity: 1, transform: 'translate(-50%, 0)' }],
      { duration: 240, easing: EASE_FADE, fill: 'forwards' });

    exitToastTimer = setTimeout(() => {
      const out = el.animate(
        [{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, 8px)' }],
        { duration: 200, easing: 'ease-in', fill: 'forwards' });
      out.onfinish = () => {
        el.getAnimations().forEach(a => a.cancel());
        el.style.display = 'none';
      };
    }, EXIT_WINDOW_MS - 200);
  }

  function installBackExit() {
    if (typeof BackHandler === 'undefined' || BackHandler._mtExit) return;
    BackHandler._mtExit = true;

    const base = BackHandler.intercept;
    let armedUntil = 0;

    BackHandler.intercept = function () {
      const handled = base.call(this);
      if (handled) { armedUntil = 0; return true; }
      if (!app.ui.isMobile || app.ui.mobileView !== 'folders') return false;

      const t = performance.now();
      if (t < armedUntil) {                 // second press inside the window -> exit
        armedUntil = 0;
        exitRequested = true;
        setTimeout(() => { exitRequested = false; }, 400);
        return false;
      }
      armedUntil = t + EXIT_WINDOW_MS;      // first press -> hint only
      showExitToast();
      return true;
    };

    // popstate path: the history entry is already consumed, so leave for real.
    window.addEventListener('popstate', () => {
      setTimeout(() => {
        if (!exitRequested) return;
        exitRequested = false;
        history.back();
      }, 0);
    });
  }


  /* =====================================================
     SAFETY NETS
     Pinned boxes go stale on rotation / resize, and animations are
     paused in a hidden tab - never leave a ghost layer behind.
  ===================================================== */
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;   // ignore keyboard / URL-bar height changes
    lastW = window.innerWidth;
    if (running) running.cleanup();
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) running.cleanup();
  });


  /* =====================================================
     BOOT
     app.js is loaded before this file, but be defensive:
     wait for DOM ready, then for `app` to exist.
  ===================================================== */
  function boot() {
    if (install()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (install() || ++tries > 60) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();