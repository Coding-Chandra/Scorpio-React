/* =====================================================
   MD3E Enhance – Pixel Visual Layer (SAFE) (NO INTERFERENCE)
    - Adds ripple effect to interactive elements
    - Uses MD3 seed color for ripple
    - No interference with existing functionality or styles
    - Only active when MD3E theme is selected
   File: md3e-enhance.js
   ===================================================== */

window.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "SET_MD3E_COLOR") return;

  const hex = e.data.color;
  if (!hex) return;

  const v = hex.replace("#","");
  document.documentElement.style.setProperty(
    "--md-seed",
    `${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)}`
  );
});


(() => {
  // Only run when MD3E theme is active
  if (document.documentElement.getAttribute("data-ui") !== "md3e" && document.documentElement.getAttribute("data-ui") !== "nothing") return;

  const RIPPLE_CLASS = "md3e-ripple";
  const ACTIVE_CLASS = "md3e-active";

  /* ---------------------------------------------
     Inject minimal ripple CSS (scoped & safe)
  --------------------------------------------- */
  const style = document.createElement("style");
  style.textContent = `
    .md3e-ripple {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      transform: scale(0);
      opacity: 0.35;
      background-image: url("../assets/icons/noise.png");
      background: currentColor;
      background-repeat: repeat;
      background-blend-mode: overlay;
      animation: md3e-ripple 620ms cubic-bezier(0,0,0,1);
    }

    @keyframes md3e-ripple {
      to {
        transform: scale(1);
        opacity: 0;
      }
    }

    .md3e-active::before {
      background-color: rgba(var(--md-seed), 0.18) !important;
    }
  `;
  document.head.appendChild(style);

  /* ---------------------------------------------
     Utility: create ripple
  --------------------------------------------- */
  function createRipple(e, el) {
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");

    ripple.className = RIPPLE_CLASS;
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = e.clientX - rect.left - size / 2 + "px";
    ripple.style.top = e.clientY - rect.top - size / 2 + "px";

    // Color comes from MD3 seed via currentColor
    ripple.style.color = getComputedStyle(el).getPropertyValue("--accent-color");

    el.appendChild(ripple);

    ripple.addEventListener("animationend", () => {
      ripple.remove();
    });
  }

  /* ---------------------------------------------
     Pointer handling (NO interference)
  --------------------------------------------- */
  document.addEventListener("pointerdown", (e) => {
    const target = e.target.closest(
      ".folder-item, .note-item, .icon-btn, button"
    );
    if (!target) return;

    // Ensure positioning
    if (getComputedStyle(target).position === "static") {
      target.style.position = "relative";
    }
    target.style.overflow = "hidden";

    // MD3 pressed state
    target.classList.add(ACTIVE_CLASS);

    // Real ripple origin
    createRipple(e, target);
  }, true);

  document.addEventListener("pointerup", (e) => {
    const target = e.target.closest(
      ".folder-item, .note-item, .icon-btn, button"
    );
    if (!target) return;

    target.classList.remove(ACTIVE_CLASS);
  }, true);

  document.addEventListener("pointercancel", (e) => {
    const target = e.target.closest(
      ".folder-item, .note-item, .icon-btn, button"
    );
    if (!target) return;

    target.classList.remove(ACTIVE_CLASS);
  }, true);

})();
