/**
 * ANIMATION UTILITIES LIBRARY
 * Reusable animation helpers for smooth, professional interactions
 * Designed for Notoz but can be used in any project as a standalone animation library
 * Provides a wide range of common animations (fade, slide, pop, bounce, etc.)
 * with easy-to-use functions and customizable parameters
 * Also includes advanced features like staggered animations, sequential/parallel execution, and user preference handling
 */

const AnimationUtils = {
  /**
   * Animate an element with a keyframe animation
   * @param {Element} element - Target element
   * @param {string} animationName - CSS animation name
   * @param {number} duration - Duration in milliseconds
   * @param {function} onComplete - Callback when animation ends
   */
  animate: (element, animationName, duration = 300, onComplete = null) => {
    if (!element) return;
    
    element.style.animation = `${animationName} ${duration}ms ease-out forwards`;
    
    const handleAnimationEnd = () => {
      element.removeEventListener('animationend', handleAnimationEnd);
      element.style.animation = '';
      if (onComplete) onComplete();
    };
    
    element.addEventListener('animationend', handleAnimationEnd);
  },

  /**
   * Stagger animation for multiple elements
   * @param {NodeList|Array} elements - Elements to animate
   * @param {string} animationName - CSS animation name
   * @param {number} baseDelay - Base delay in ms
   * @param {number} staggerDelay - Delay between each element in ms
   */
  staggerAnimate: (elements, animationName, baseDelay = 0, staggerDelay = 50) => {
    elements.forEach((element, index) => {
      setTimeout(() => {
        element.style.animation = `${animationName} 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`;
      }, baseDelay + index * staggerDelay);
    });
  },

  /**
   * Fade element in
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  fadeIn: (element, duration = 300) => {
    AnimationUtils.animate(element, 'pageFadeIn', duration);
  },

  /**
   * Fade element out
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  fadeOut: (element, duration = 300) => {
    element.style.animation = `pageFadeIn ${duration}ms ease-out reverse forwards`;
  },

  /**
   * Slide element in from right
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  slideIn: (element, duration = 300) => {
    AnimationUtils.animate(element, 'pageSlideIn', duration);
  },

  /**
   * Slide element out to left
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  slideOut: (element, duration = 300) => {
    AnimationUtils.animate(element, 'pageSlideOut', duration);
  },

  /**
   * Scale element in
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  scaleIn: (element, duration = 300) => {
    AnimationUtils.animate(element, 'pageScaleIn', duration);
  },

  /**
   * Pop animation for cards
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  pop: (element, duration = 400) => {
    AnimationUtils.animate(element, 'cardPop', duration);
  },

  /**
   * Bounce animation for lists
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  bounce: (element, duration = 400) => {
    AnimationUtils.animate(element, 'listItemBounceIn', duration);
  },

  /**
   * Shake animation
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  shake: (element, duration = 400) => {
    AnimationUtils.animate(element, 'listItemShake', duration);
  },

  /**
   * Pulse animation
   * @param {Element} element - Target element
   * @param {number} times - Number of pulses
   */
  pulse: (element, times = 2) => {
    const duration = 600;
    element.style.animation = `buttonPulse ${duration}ms ease-in-out`;
  },

  /**
   * Spin animation
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  spin: (element, duration = 1000) => {
    element.style.animation = `spin ${duration}ms linear infinite`;
  },

  /**
   * Create ripple effect on element
   * @param {Element} element - Target element
   * @param {Event} event - Click event
   */
  ripple: (element, event) => {
    const rect = element.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      pointer-events: none;
      left: ${x}px;
      top: ${y}px;
      animation: rippleExpand 0.6s ease-out forwards;
    `;

    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);

    ripple.addEventListener('animationend', () => ripple.remove());
  },

  /**
   * Toast notification animation
   * @param {Element} element - Toast element
   * @param {string} direction - 'in' or 'out'
   * @param {function} onComplete - Callback
   */
  toast: (element, direction = 'in', onComplete = null) => {
    const animationName =
        direction === 'in'
            ? 'toastSlideInTop'
            : 'toastSlideOutTop';

    AnimationUtils.animate(element, animationName, 300, onComplete);
},

  /**
   * Swipe-dismiss a toast/notification to the right.
   * Reads the --drag-x custom property as its start position, so it can
   * continue smoothly from wherever a drag gesture released the element.
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   * @param {function} onComplete - Callback when animation ends
   */
  swipeOutRight: (element, duration = 250, onComplete = null) => {
    AnimationUtils.animate(element, 'toastSwipeOutRight', duration, onComplete);
  },

  /**
   * Swipe-dismiss a toast/notification to the left.
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   * @param {function} onComplete - Callback when animation ends
   */
  swipeOutLeft: (element, duration = 250, onComplete = null) => {
    AnimationUtils.animate(element, 'toastSwipeOutLeft', duration, onComplete);
  },

  /**
   * List item entry animation
   * @param {Element} element - Item element
   * @param {boolean} bounce - Use bounce effect
   */
  listItem: (element, bounce = false) => {
    const animationName = bounce ? 'listItemBounceIn' : 'listItemSlideIn';
    AnimationUtils.animate(element, animationName, 300);
  },

  /**
   * List item deletion animation
   * @param {Element} element - Item element
   * @param {function} onComplete - Callback
   */
  listItemDelete: (element, onComplete = null) => {
    AnimationUtils.animate(element, 'listItemSlideOut', 300, () => {
      element.remove();
      if (onComplete) onComplete();
    });
  },

  /**
   * Page transition animation
   * @param {Element} fromElement - Exiting element
   * @param {Element} toElement - Entering element
   * @param {string} effect - 'slide', 'fade', 'scale'
   */
  pageTransition: (fromElement, toElement, effect = 'slide') => {
    const outAnimation = effect === 'slide' ? 'pageSlideOut' :
                        effect === 'fade' ? 'pageFadeIn' : 'pageScaleIn';
    const inAnimation = effect === 'slide' ? 'pageSlideIn' :
                       effect === 'fade' ? 'pageFadeIn' : 'pageScaleIn';

    if (fromElement) {
      fromElement.style.animation = `${outAnimation} 0.3s ease-out forwards`;
    }

    toElement.style.animation = `${inAnimation} 0.3s ease-out forwards`;
  },

  /**
   * Button press feedback
   * @param {Element} button - Button element
   */
  buttonPress: (button) => {
    button.style.animation = 'buttonPressDown 0.1s ease-out forwards';
    setTimeout(() => {
      button.style.animation = 'buttonPressUp 0.1s ease-out forwards';
    }, 100);
  },

  /**
   * Glow effect on element
   * @param {Element} element - Target element
   * @param {number} duration - Duration in ms
   */
  glow: (element, duration = 1000) => {
    element.style.animation = `buttonGlow ${duration}ms ease-in-out`;
  },

  /**
   * Loading skeleton animation
   * @param {Element} element - Skeleton element
   */
  skeleton: (element) => {
    element.style.animation = 'skeletonLoading 1.5s ease-in-out infinite';
  },

  /**
   * Success checkmark animation
   * @param {Element} element - SVG checkmark element
   */
  checkmark: (element) => {
    const path = element.querySelector('path');
    if (path) {
      path.style.animation = 'checkmark 0.6s ease-out forwards';
      path.style.strokeDasharray = '50';
      path.style.strokeDashoffset = '50';
    }
  },

  /**
   * Celebration animation
   * @param {Element} element - Target element
   */
  celebrate: (element) => {
    AnimationUtils.animate(element, 'celebration', 600);
  },

  /**
   * Delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise}
   */
  delay: (ms = 0) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Sequential animations
   * @param {Array} animations - Array of animation functions
   */
  sequence: async (animations = []) => {
    for (const anim of animations) {
      await anim;
    }
  },

  /**
   * Parallel animations
   * @param {Array} animations - Array of animation functions
   */
  parallel: (animations = []) => {
    return Promise.all(animations);
  },

  /**
   * Get preferred animation duration based on theme
   * @returns {number} Duration in ms
   */
  getDuration: () => {
    const theme = document.documentElement.getAttribute('data-ui');
    const durations = {
      'ios': 300,
      'md3e': 240,
      'nothing': 350
    };
    return durations[theme] || 300;
  },

  /**
   * Check if animations are disabled
   * @returns {boolean}
   */
  prefersReducedMotion: () => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },

  /**
   * Safe animation wrapper (respects user preferences)
   * @param {function} animationFn - Animation function
   */
  safeAnimate: (animationFn) => {
    if (!AnimationUtils.prefersReducedMotion()) {
      animationFn();
    }
  }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AnimationUtils;
}