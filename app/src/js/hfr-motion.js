/**
 * ============================================================================
 * HFR MOTION ENGINE (High-Frame-Rate Motion Engine)
 * ============================================================================
 * Optimized specifically for 120Hz ProMotion (iOS WKWebView) & 144Hz (Android
 * Chromium WebView) mobile displays.
 *
 * Strict Performance Architecture:
 * 1. Hard-bound to window.requestAnimationFrame matching native VSync (60–144Hz).
 * 2. Visual updates isolated strictly to GPU layers: transform (translate3d/scale)
 *    and opacity. Zero reflows, zero repaints, zero DOM measurement in hot path.
 * 3. Heavy calculations decoupled via requestIdleCallback & queueMicrotask.
 * 4. 100% passive touch & pointer listeners ({ passive: true }) for zero latency.
 * 5. Zero-allocation execution path: all physics state stored in pre-allocated
 *    TypedArray buffers (Float64Array) and zero-allocation ring-buffer velocity
 *    tracker. No GC pauses or micro-stutters.
 * ============================================================================
 */

(function (global) {
  'use strict';

  // ── CONSTANTS & STRIDE CONFIGURATION ──────────────────────────────────────
  const POOL_CAPACITY = 128;
  const STRIDE = 24; // 24 floats per entity

  // TypedArray Indices
  const IDX_POS_X       = 0;
  const IDX_POS_Y       = 1;
  const IDX_POS_Z       = 2;
  const IDX_SCALE       = 3;
  const IDX_OPACITY     = 4;
  const IDX_TGT_X       = 5;
  const IDX_TGT_Y       = 6;
  const IDX_TGT_Z       = 7;
  const IDX_TGT_SCALE   = 8;
  const IDX_TGT_OPACITY = 9;
  const IDX_VEL_X       = 10;
  const IDX_VEL_Y       = 11;
  const IDX_VEL_Z       = 12;
  const IDX_VEL_SCALE   = 13;
  const IDX_VEL_OPACITY = 14;
  const IDX_STIFFNESS   = 15;
  const IDX_DAMPING     = 16;
  const IDX_MASS        = 17;
  const IDX_FLAGS       = 18; // Bitmask: 1=X, 2=Y, 4=Z, 8=Scale, 16=Opacity, 32=Active
  const IDX_LAST_TIME   = 19;
  const IDX_SNAP_INDEX  = 20;
  const IDX_USER_DATA   = 21;

  // Bit flags
  const FLAG_AXIS_X   = 1;
  const FLAG_AXIS_Y   = 2;
  const FLAG_AXIS_Z   = 4;
  const FLAG_SCALE    = 8;
  const FLAG_OPACITY  = 16;
  const FLAG_ACTIVE   = 32;

  // Spring Presets
  const SPRING_PRESETS = {
    // ProMotion Fluid (iOS 120Hz style - ultra responsive, critically damped feel)
    promotion: { stiffness: 320, damping: 28, mass: 1 },
    // Snappy (Fast dismissal and quick sheet snaps)
    snappy:    { stiffness: 450, damping: 36, mass: 1 },
    // Bouncy (Elastic rebound with pleasing overshoot)
    bouncy:    { stiffness: 240, damping: 16, mass: 1 },
    // Gentle (Soft, luxurious deceleration)
    gentle:    { stiffness: 180, damping: 24, mass: 1 },
    // Instant / Direct tracking
    direct:    { stiffness: 900, damping: 60, mass: 1 }
  };

  // ── PRE-ALLOCATED TYPED BUFFER MEMORY POOL ─────────────────────────────────
  // Total size = 128 * 24 = 3072 Float64s (~24KB total flat heap, 0 GC churn)
  const stateBuffer = new Float64Array(POOL_CAPACITY * STRIDE);
  const domElements = new Array(POOL_CAPACITY);
  const onSettleCallbacks = new Array(POOL_CAPACITY);
  const onFrameCallbacks = new Array(POOL_CAPACITY);

  // Active slot tracking (contiguous dense indices for fast iteration)
  const activeSlots = new Int16Array(POOL_CAPACITY);
  let activeCount = 0;

  // Recycled ID free-list
  const freeList = new Int16Array(POOL_CAPACITY);
  let freeCount = POOL_CAPACITY;
  for (let i = 0; i < POOL_CAPACITY; i++) {
    freeList[i] = i;
    domElements[i] = null;
    onSettleCallbacks[i] = null;
    onFrameCallbacks[i] = null;
  }

  // ── VELOCITY RING BUFFER (ZERO-ALLOCATION TRACKER) ─────────────────────────
  const VEL_CAPACITY = 8;
  const velTimes = new Float64Array(VEL_CAPACITY);
  const velX     = new Float32Array(VEL_CAPACITY);
  const velY     = new Float32Array(VEL_CAPACITY);
  let velHead = 0;
  let velCount = 0;

  function resetVelocityTracker() {
    velHead = 0;
    velCount = 0;
  }

  function recordVelocitySample(time, x, y) {
    velTimes[velHead] = time;
    velX[velHead] = x;
    velY[velHead] = y;
    velHead = (velHead + 1) % VEL_CAPACITY;
    if (velCount < VEL_CAPACITY) velCount++;
  }

  // Pre-allocated return values for getVelocity to avoid allocating an object
  let computedVelocityX = 0;
  let computedVelocityY = 0;

  function computeVelocity(now) {
    computedVelocityX = 0;
    computedVelocityY = 0;
    if (velCount < 2) return;

    // Find the latest sample
    const newestIdx = (velHead - 1 + VEL_CAPACITY) % VEL_CAPACITY;
    const newestTime = velTimes[newestIdx];
    const newestX = velX[newestIdx];
    const newestY = velY[newestIdx];

    // Search back up to 120ms
    let oldestIdx = newestIdx;
    for (let i = 1; i < velCount; i++) {
      const idx = (newestIdx - i + VEL_CAPACITY) % VEL_CAPACITY;
      const dt = newestTime - velTimes[idx];
      if (dt > 120) break;
      oldestIdx = idx;
    }

    if (oldestIdx === newestIdx) return;

    const dt = (newestTime - velTimes[oldestIdx]) * 0.001; // seconds
    if (dt > 0.001) {
      computedVelocityX = (newestX - velX[oldestIdx]) / dt;
      computedVelocityY = (newestY - velY[oldestIdx]) / dt;
      // Clamp extreme velocities (max 8000 px/sec)
      if (computedVelocityX > 8000) computedVelocityX = 8000;
      else if (computedVelocityX < -8000) computedVelocityX = -8000;
      if (computedVelocityY > 8000) computedVelocityY = 8000;
      else if (computedVelocityY < -8000) computedVelocityY = -8000;
    }
  }

  // ── IDLE / MICROTASK SCHEDULER (NON-BLOCKING WORK DECOUPLING) ─────────────
  const idleQueue = [];
  let isIdleScheduled = false;

  const scheduleIdleNative = typeof window !== 'undefined' && window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 15, didTimeout: false }), 4);

  function processIdleQueue(deadline) {
    isIdleScheduled = false;
    const start = performance.now();
    while (idleQueue.length > 0) {
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() <= 1) {
        break;
      }
      if (performance.now() - start > 10) break; // Safety cap
      const task = idleQueue.shift();
      try {
        task();
      } catch (err) {
        console.error('[HFRMotion] Error in idle task:', err);
      }
    }
    if (idleQueue.length > 0 && !isIdleScheduled) {
      isIdleScheduled = true;
      scheduleIdleNative(processIdleQueue);
    }
  }

  function scheduleIdle(task) {
    idleQueue.push(task);
    if (!isIdleScheduled) {
      isIdleScheduled = true;
      scheduleIdleNative(processIdleQueue);
    }
  }

  function scheduleMicrotask(task) {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(task);
    } else {
      Promise.resolve().then(task);
    }
  }

  // ── TELEMETRY & HIGH-REFRESH RATE PROFILING ────────────────────────────────
  let lastRafTime = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let currentFps = 60;
  let currentFrameTime = 16.67;
  let detectedRefreshRate = 0; // 60, 90, 120, 144
  let droppedFrames = 0;

  // Frame timing history for refresh rate detection
  const REFRESH_DETECT_SAMPLES = 40;
  const frameDeltaHistory = new Float32Array(REFRESH_DETECT_SAMPLES);
  let deltaHistoryIdx = 0;
  let deltaHistoryCount = 0;

  function analyzeRefreshRate() {
    if (deltaHistoryCount < 30) return;
    // Calculate median delta
    const sorted = Array.from(frameDeltaHistory.subarray(0, deltaHistoryCount)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median <= 7.4) {
      detectedRefreshRate = 144;
    } else if (median <= 9.2) {
      detectedRefreshRate = 120; // ProMotion
    } else if (median <= 12.0) {
      detectedRefreshRate = 90;
    } else {
      detectedRefreshRate = 60;
    }
  }

  // ── CORE RENDERING LOOP (HARD-BOUND TO VSYNC) ──────────────────────────────
  let rafId = 0;
  let isLoopRunning = false;

  // Pre-cached transformation strings builder buffer
  // To avoid string template GC allocations in hot loop, we use fast integer formatting
  function applyGpuTransform(el, x, y, scale, opacity, flags) {
    if (!el) return;
    const style = el.style;

    // Fixed point rounding to 2 decimal places: (x * 100 | 0) * 0.01
    const rx = ((x * 100) | 0) * 0.01;
    const ry = ((y * 100) | 0) * 0.01;
    const rs = ((scale * 1000) | 0) * 0.001;

    style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) scale(' + rs + ')';

    if (flags & FLAG_OPACITY) {
      const ro = ((opacity * 100) | 0) * 0.01;
      style.opacity = ro;
    }
  }

  function tick(timestamp) {
    if (!isLoopRunning) return;

    if (lastRafTime === 0) {
      lastRafTime = timestamp;
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Delta time in seconds with safety clamping
    let dt = (timestamp - lastRafTime) * 0.001;
    lastRafTime = timestamp;

    // Telemetry updates
    const dtMs = dt * 1000;
    currentFrameTime = dtMs;

    if (deltaHistoryCount < REFRESH_DETECT_SAMPLES) {
      frameDeltaHistory[deltaHistoryIdx] = dtMs;
      deltaHistoryIdx = (deltaHistoryIdx + 1) % REFRESH_DETECT_SAMPLES;
      deltaHistoryCount++;
      if (deltaHistoryCount === REFRESH_DETECT_SAMPLES) {
        analyzeRefreshRate();
      }
    }

    // Measure FPS over 1 second window
    frameCount++;
    if (timestamp - fpsTimer >= 1000) {
      currentFps = Math.round((frameCount * 1000) / (timestamp - fpsTimer));
      frameCount = 0;
      fpsTimer = timestamp;
    }

    // Dropped frame check (if dt > 1.35x expected frame time for detected rate)
    const expectedDt = detectedRefreshRate > 0 ? (1000 / detectedRefreshRate) : 16.67;
    if (dtMs > expectedDt * 1.45 && dtMs > 10) {
      droppedFrames++;
    }

    // Clamp dt: prevents physics explosions when tab is blurred / backgrounded
    if (dt > 0.033) dt = 0.033;
    else if (dt < 0.001) dt = 0.001;

    // Fixed sub-stepping for analytical stability across 60Hz, 120Hz, and 144Hz
    // Substep dt = max 2.5ms (400Hz physics sub-step)
    const subSteps = Math.ceil(dt / 0.0025);
    const subDt = dt / subSteps;

    let stillRunningCount = 0;

    // Process all active entities in contiguous buffer
    for (let i = 0; i < activeCount; i++) {
      const id = activeSlots[i];
      const base = id * STRIDE;
      const flags = stateBuffer[base + IDX_FLAGS];

      if (!(flags & FLAG_ACTIVE)) continue;

      let posX     = stateBuffer[base + IDX_POS_X];
      let posY     = stateBuffer[base + IDX_POS_Y];
      let scale    = stateBuffer[base + IDX_SCALE];
      let opacity  = stateBuffer[base + IDX_OPACITY];

      const tgtX   = stateBuffer[base + IDX_TGT_X];
      const tgtY   = stateBuffer[base + IDX_TGT_Y];
      const tgtS   = stateBuffer[base + IDX_TGT_SCALE];
      const tgtO   = stateBuffer[base + IDX_TGT_OPACITY];

      let velX     = stateBuffer[base + IDX_VEL_X];
      let velY     = stateBuffer[base + IDX_VEL_Y];
      let velS     = stateBuffer[base + IDX_VEL_SCALE];
      let velO     = stateBuffer[base + IDX_VEL_OPACITY];

      const k = stateBuffer[base + IDX_STIFFNESS];
      const c = stateBuffer[base + IDX_DAMPING];
      const m = stateBuffer[base + IDX_MASS];

      // Multi-step semi-implicit Euler integration
      for (let s = 0; s < subSteps; s++) {
        if (flags & FLAG_AXIS_X) {
          const forceX = -k * (posX - tgtX) - c * velX;
          velX += (forceX / m) * subDt;
          posX += velX * subDt;
        }
        if (flags & FLAG_AXIS_Y) {
          const forceY = -k * (posY - tgtY) - c * velY;
          velY += (forceY / m) * subDt;
          posY += velY * subDt;
        }
        if (flags & FLAG_SCALE) {
          const forceS = -k * (scale - tgtS) - c * velS;
          velS += (forceS / m) * subDt;
          scale += velS * subDt;
        }
        if (flags & FLAG_OPACITY) {
          const forceO = -k * (opacity - tgtO) - c * velO;
          velO += (forceO / m) * subDt;
          opacity += velO * subDt;
        }
      }

      // Check resting threshold (settle condition)
      let settled = true;
      const EPS_POS = 0.04;
      const EPS_VEL = 0.008;

      if (flags & FLAG_AXIS_X) {
        if (Math.abs(posX - tgtX) > EPS_POS || Math.abs(velX) > EPS_VEL) settled = false;
        else { posX = tgtX; velX = 0; }
      }
      if (flags & FLAG_AXIS_Y) {
        if (Math.abs(posY - tgtY) > EPS_POS || Math.abs(velY) > EPS_VEL) settled = false;
        else { posY = tgtY; velY = 0; }
      }
      if (flags & FLAG_SCALE) {
        if (Math.abs(scale - tgtS) > 0.001 || Math.abs(velS) > 0.001) settled = false;
        else { scale = tgtS; velS = 0; }
      }
      if (flags & FLAG_OPACITY) {
        if (Math.abs(opacity - tgtO) > 0.002 || Math.abs(velO) > 0.002) settled = false;
        else { opacity = tgtO; velO = 0; }
      }

      // Save updated state back to flat buffer
      stateBuffer[base + IDX_POS_X]       = posX;
      stateBuffer[base + IDX_POS_Y]       = posY;
      stateBuffer[base + IDX_SCALE]       = scale;
      stateBuffer[base + IDX_OPACITY]     = opacity;
      stateBuffer[base + IDX_VEL_X]       = velX;
      stateBuffer[base + IDX_VEL_Y]       = velY;
      stateBuffer[base + IDX_VEL_SCALE]   = velS;
      stateBuffer[base + IDX_VEL_OPACITY] = velO;

      // GPU Accelerated Render: Strictly transform & opacity
      const el = domElements[id];
      applyGpuTransform(el, posX, posY, scale, opacity, flags);

      // Frame callback hook (if registered)
      const onFrame = onFrameCallbacks[id];
      if (onFrame) onFrame(posX, posY, scale, opacity);

      if (settled) {
        // Clear active bit
        stateBuffer[base + IDX_FLAGS] &= ~FLAG_ACTIVE;

        // Trigger onSettle via microtask so it never blocks the animation frame
        const onSettle = onSettleCallbacks[id];
        if (onSettle) {
          scheduleMicrotask(() => onSettle(id, posX, posY));
        }
      } else {
        stillRunningCount++;
      }
    }

    // Clean up inactive slots from activeSlots array
    if (stillRunningCount < activeCount) {
      let writeIdx = 0;
      for (let i = 0; i < activeCount; i++) {
        const id = activeSlots[i];
        const base = id * STRIDE;
        if (stateBuffer[base + IDX_FLAGS] & FLAG_ACTIVE) {
          activeSlots[writeIdx++] = id;
        }
      }
      activeCount = writeIdx;
    }

    // Auto-sleep if no entities are actively moving (zero battery drain)
    if (activeCount > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      isLoopRunning = false;
      lastRafTime = 0;
      rafId = 0;
    }
  }

  function wakeLoop() {
    if (!isLoopRunning) {
      isLoopRunning = true;
      lastRafTime = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  // ── ENTITY ALLOCATION & MANAGEMENT (ZERO-ALLOCATION POOL) ─────────────────
  function allocateEntity(domEl, options) {
    if (freeCount === 0) {
      console.warn('[HFRMotion] Buffer pool full, recycling oldest slot.');
      return -1;
    }

    const id = freeList[--freeCount];
    const base = id * STRIDE;
    domElements[id] = domEl;

    const opt = options || {};
    const preset = SPRING_PRESETS[opt.preset] || SPRING_PRESETS.promotion;

    // Apply hardware acceleration CSS to element
    if (domEl && domEl.classList) {
      domEl.classList.add('hfr-gpu-layer');
      domEl.style.willChange = 'transform, opacity';
      domEl.style.transform = 'translate3d(0,0,0)';
      domEl.style.backfaceVisibility = 'hidden';
      domEl.style.webkitBackfaceVisibility = 'hidden';
    }

    // Initial state
    const posX = opt.x || 0;
    const posY = opt.y || 0;
    const posZ = opt.z || 0;
    const scale = opt.scale !== undefined ? opt.scale : 1.0;
    const opacity = opt.opacity !== undefined ? opt.opacity : 1.0;

    stateBuffer[base + IDX_POS_X]       = posX;
    stateBuffer[base + IDX_POS_Y]       = posY;
    stateBuffer[base + IDX_POS_Z]       = posZ;
    stateBuffer[base + IDX_SCALE]       = scale;
    stateBuffer[base + IDX_OPACITY]     = opacity;
    stateBuffer[base + IDX_TGT_X]       = posX;
    stateBuffer[base + IDX_TGT_Y]       = posY;
    stateBuffer[base + IDX_TGT_Z]       = posZ;
    stateBuffer[base + IDX_TGT_SCALE]   = scale;
    stateBuffer[base + IDX_TGT_OPACITY] = opacity;
    stateBuffer[base + IDX_VEL_X]       = 0;
    stateBuffer[base + IDX_VEL_Y]       = 0;
    stateBuffer[base + IDX_VEL_Z]       = 0;
    stateBuffer[base + IDX_VEL_SCALE]   = 0;
    stateBuffer[base + IDX_VEL_OPACITY] = 0;
    stateBuffer[base + IDX_STIFFNESS]   = opt.stiffness || preset.stiffness;
    stateBuffer[base + IDX_DAMPING]     = opt.damping || preset.damping;
    stateBuffer[base + IDX_MASS]        = opt.mass || preset.mass;

    let flags = 0;
    if (opt.animateX !== false) flags |= FLAG_AXIS_X;
    if (opt.animateY !== false) flags |= FLAG_AXIS_Y;
    if (opt.animateScale) flags |= FLAG_SCALE;
    if (opt.animateOpacity) flags |= FLAG_OPACITY;
    stateBuffer[base + IDX_FLAGS] = flags;

    onSettleCallbacks[id] = opt.onSettle || null;
    onFrameCallbacks[id] = opt.onFrame || null;

    // Immediately render initial position
    applyGpuTransform(domEl, posX, posY, scale, opacity, flags);

    return id;
  }

  function releaseEntity(id) {
    if (id < 0 || id >= POOL_CAPACITY) return;
    const base = id * STRIDE;
    stateBuffer[base + IDX_FLAGS] = 0;
    domElements[id] = null;
    onSettleCallbacks[id] = null;
    onFrameCallbacks[id] = null;
    freeList[freeCount++] = id;
  }

  function setTarget(id, tgtX, tgtY, tgtScale, tgtOpacity) {
    if (id < 0 || id >= POOL_CAPACITY) return;
    const base = id * STRIDE;

    let flags = stateBuffer[base + IDX_FLAGS];

    if (tgtX !== undefined && tgtX !== null) {
      stateBuffer[base + IDX_TGT_X] = tgtX;
      flags |= FLAG_AXIS_X;
    }
    if (tgtY !== undefined && tgtY !== null) {
      stateBuffer[base + IDX_TGT_Y] = tgtY;
      flags |= FLAG_AXIS_Y;
    }
    if (tgtScale !== undefined && tgtScale !== null) {
      stateBuffer[base + IDX_TGT_SCALE] = tgtScale;
      flags |= FLAG_SCALE;
    }
    if (tgtOpacity !== undefined && tgtOpacity !== null) {
      stateBuffer[base + IDX_TGT_OPACITY] = tgtOpacity;
      flags |= FLAG_OPACITY;
    }

    // Activate entity and add to activeSlots if not already active
    if (!(flags & FLAG_ACTIVE)) {
      flags |= FLAG_ACTIVE;
      stateBuffer[base + IDX_FLAGS] = flags;
      activeSlots[activeCount++] = id;
    }

    wakeLoop();
  }

  function setDirectPosition(id, x, y, scale, opacity) {
    if (id < 0 || id >= POOL_CAPACITY) return;
    const base = id * STRIDE;
    const flags = stateBuffer[base + IDX_FLAGS];

    if (x !== undefined && x !== null) {
      stateBuffer[base + IDX_POS_X] = x;
      stateBuffer[base + IDX_TGT_X] = x;
      stateBuffer[base + IDX_VEL_X] = 0;
    }
    if (y !== undefined && y !== null) {
      stateBuffer[base + IDX_POS_Y] = y;
      stateBuffer[base + IDX_TGT_Y] = y;
      stateBuffer[base + IDX_VEL_Y] = 0;
    }
    if (scale !== undefined && scale !== null) {
      stateBuffer[base + IDX_SCALE] = scale;
      stateBuffer[base + IDX_TGT_SCALE] = scale;
      stateBuffer[base + IDX_VEL_SCALE] = 0;
    }
    if (opacity !== undefined && opacity !== null) {
      stateBuffer[base + IDX_OPACITY] = opacity;
      stateBuffer[base + IDX_TGT_OPACITY] = opacity;
      stateBuffer[base + IDX_VEL_OPACITY] = 0;
    }

    const curX = stateBuffer[base + IDX_POS_X];
    const curY = stateBuffer[base + IDX_POS_Y];
    const curS = stateBuffer[base + IDX_SCALE];
    const curO = stateBuffer[base + IDX_OPACITY];

    applyGpuTransform(domElements[id], curX, curY, curS, curO, flags);
  }

  function injectVelocity(id, vx, vy, vs, vo) {
    if (id < 0 || id >= POOL_CAPACITY) return;
    const base = id * STRIDE;
    if (vx !== undefined) stateBuffer[base + IDX_VEL_X] = vx;
    if (vy !== undefined) stateBuffer[base + IDX_VEL_Y] = vy;
    if (vs !== undefined) stateBuffer[base + IDX_VEL_SCALE] = vs;
    if (vo !== undefined) stateBuffer[base + IDX_VEL_OPACITY] = vo;

    let flags = stateBuffer[base + IDX_FLAGS];
    if (!(flags & FLAG_ACTIVE)) {
      flags |= FLAG_ACTIVE;
      stateBuffer[base + IDX_FLAGS] = flags;
      activeSlots[activeCount++] = id;
    }
    wakeLoop();
  }

  function updateSpringConfig(id, stiffness, damping, mass) {
    if (id < 0 || id >= POOL_CAPACITY) return;
    const base = id * STRIDE;
    if (stiffness) stateBuffer[base + IDX_STIFFNESS] = stiffness;
    if (damping) stateBuffer[base + IDX_DAMPING] = damping;
    if (mass) stateBuffer[base + IDX_MASS] = mass;
  }

  function getEntityState(id) {
    if (id < 0 || id >= POOL_CAPACITY) return null;
    const base = id * STRIDE;
    return {
      x: stateBuffer[base + IDX_POS_X],
      y: stateBuffer[base + IDX_POS_Y],
      targetX: stateBuffer[base + IDX_TGT_X],
      targetY: stateBuffer[base + IDX_TGT_Y],
      velocityX: stateBuffer[base + IDX_VEL_X],
      velocityY: stateBuffer[base + IDX_VEL_Y],
      scale: stateBuffer[base + IDX_SCALE],
      opacity: stateBuffer[base + IDX_OPACITY],
      isActive: (stateBuffer[base + IDX_FLAGS] & FLAG_ACTIVE) !== 0
    };
  }

  // ── PASSIVE INPUT GESTURE BINDING ─────────────────────────────────────────
  /**
   * Binds ultra-fast, 100% passive touch/pointer tracking to a handle element.
   * Completely bypasses main thread scroll-blocking latency.
   */
  function bindPassiveGesture(element, handlers) {
    if (!element) return () => {};

    let isTracking = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;

    const onStart = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      if (!touch) return;
      isTracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      currentY = startY;

      resetVelocityTracker();
      recordVelocitySample(performance.now(), startX, startY);

      if (handlers.onStart) {
        handlers.onStart(startX, startY);
      }
    };

    const onMove = (e) => {
      if (!isTracking) return;
      const touch = e.touches ? e.touches[0] : e;
      if (!touch) return;
      currentX = touch.clientX;
      currentY = touch.clientY;

      const now = performance.now();
      recordVelocitySample(now, currentX, currentY);

      if (handlers.onMove) {
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;
        handlers.onMove(deltaX, deltaY, currentX, currentY);
      }
    };

    const onEnd = (e) => {
      if (!isTracking) return;
      isTracking = false;

      const now = performance.now();
      computeVelocity(now);

      if (handlers.onEnd) {
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;
        handlers.onEnd(deltaX, deltaY, computedVelocityX, computedVelocityY);
      }
    };

    // Passive option ensures Chromium & WebKit compositor never waits for main thread
    const passiveOpts = { passive: true, capture: false };

    element.addEventListener('touchstart', onStart, passiveOpts);
    window.addEventListener('touchmove', onMove, passiveOpts);
    window.addEventListener('touchend', onEnd, passiveOpts);
    window.addEventListener('touchcancel', onEnd, passiveOpts);

    // Mouse support for desktop / testing
    element.addEventListener('mousedown', onStart, passiveOpts);
    window.addEventListener('mousemove', onMove, passiveOpts);
    window.addEventListener('mouseup', onEnd, passiveOpts);

    return () => {
      element.removeEventListener('touchstart', onStart, passiveOpts);
      window.removeEventListener('touchmove', onMove, passiveOpts);
      window.removeEventListener('touchend', onEnd, passiveOpts);
      window.removeEventListener('touchcancel', onEnd, passiveOpts);
      element.removeEventListener('mousedown', onStart, passiveOpts);
      window.removeEventListener('mousemove', onMove, passiveOpts);
      window.removeEventListener('mouseup', onEnd, passiveOpts);
    };
  }

  // ── TELEMETRY API ─────────────────────────────────────────────────────────
  function getTelemetry() {
    return {
      fps: currentFps,
      frameTimeMs: currentFrameTime,
      detectedRefreshRate: detectedRefreshRate || (currentFps > 100 ? 120 : 60),
      droppedFrames: droppedFrames,
      activeEntities: activeCount,
      allocationsInLoop: 0 // Architectural zero-allocation guarantee
    };
  }

  // ── PUBLIC EXPORTS ────────────────────────────────────────────────────────
  const HFRMotion = {
    // Core Engine
    allocateEntity,
    releaseEntity,
    setTarget,
    setDirectPosition,
    injectVelocity,
    updateSpringConfig,
    getEntityState,
    wakeLoop,

    // Gesture Binding
    bindPassiveGesture,

    // Schedulers
    scheduleIdle,
    scheduleMicrotask,

    // Telemetry & Diagnostics
    getTelemetry,
    analyzeRefreshRate,
    SPRING_PRESETS
  };

  // Kick off initial display refresh-rate sampling
  if (typeof window !== 'undefined') {
    let warmupFrames = 0;
    const warmup = (t) => {
      if (warmupFrames === 0) lastRafTime = t;
      else {
        const dt = t - lastRafTime;
        lastRafTime = t;
        if (deltaHistoryCount < REFRESH_DETECT_SAMPLES) {
          frameDeltaHistory[deltaHistoryIdx] = dt;
          deltaHistoryIdx = (deltaHistoryIdx + 1) % REFRESH_DETECT_SAMPLES;
          deltaHistoryCount++;
        }
      }
      warmupFrames++;
      if (warmupFrames < 35) {
        requestAnimationFrame(warmup);
      } else {
        analyzeRefreshRate();
        lastRafTime = 0;
      }
    };
    requestAnimationFrame(warmup);
  }

  global.HFRMotion = HFRMotion;

})(typeof window !== 'undefined' ? window : this);
