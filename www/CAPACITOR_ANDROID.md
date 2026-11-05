# 📱 Capacitor Android Hybrid Wrapper Guide

This project wraps the **Notoz (Project Scorpio)** web application in an enterprise-grade **Capacitor 8** Android native shell, engineered specifically for **maximum stability, offline readiness, and fluid native UX**.

---

## 🛠️ Android Stability & Performance Engineering

The wrapper incorporates several stability layers to resolve common hybrid app failure modes:

### 1. 100% Offline-First Local Vendor Bundling
- **Problem:** Hybrid apps often pull script dependencies (`@supabase/supabase-js`, `DOMPurify`, `jspdf`) from CDNs (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`). In airplane mode, spotty cellular, or restricted networks, DNS lookup failure leaves the app frozen or in an unauthenticated broken state.
- **Solution:** All vendor libraries have been downloaded and bundled directly into the local assets directory (`vendor/`). Startup requires zero remote network calls.

### 2. Hierarchical Hardware Back-Button Engine
- **Problem:** Default Android back-button either quits the app or naively runs `history.back()`, closing the app while editing a note or leaving open dialogs stuck.
- **Solution:** `capacitor-bridge.js` implements a 9-stage hierarchical navigation stack:
  1. **Active Dialog Overlays** (`#appDialogOverlay`) → Dismisses dialog cleanly.
  2. **Settings Portal Iframes** (`#portal-layer`) → Calls `closePortal()`.
  3. **Multi-Select Mode** (`app.ui.multiSelect`) → Cancels multi-selection.
  4. **Generic Modals & Drawers** → Closes top-most layer.
  5. **Mobile View Stack** → Editor (`editor`) ➔ Notes list (`notes`) ➔ Folder directory (`folders`).
  6. **Settings Page** → Returns to main app `index.html`.
  7. **Sub-Pages** (`/pages/*.html`) → Clean browser history navigation.
  8. **Browser History** → Native `window.history.back()`.
  9. **Root Level** → `App.minimizeApp()` (preserves state in memory instead of killing process).

### 3. Android WebView Hardening (`MainActivity.java`)
- **Hardware Acceleration:** Enabled for smooth 60fps list scrolling and animated transitions.
- **DOM & Database Storage:** Full `localStorage` and `IndexedDB` persistence enabled.
- **Overscroll Prevention:** Removed the rubber-band bounce effect on Android WebViews.
- **Safe Browsing & Security:** Mixed content blocked (`MIXED_CONTENT_NEVER_ALLOW`), safe browsing enabled, cleartext traffic disabled.
- **Large Heap Allocation:** Enabled in `AndroidManifest.xml` (`android:largeHeap="true"`) to prevent out-of-memory crashes during large note imports or image attachments.

### 4. Edge-to-Edge Status Bar & Keyboard Handling
- **Overlay Status Bar:** Transparent status bar overlaying the WebView with dark iconography.
- **Safe Area Insets:** Custom CSS variables `--safe-area-top` and `--safe-area-bottom` ensure headers and footers never clip under the notch or navigation pills.
- **Keyboard Auto-Scroll:** Detects soft keyboard appearances via `@capacitor/keyboard` and smoothly scrolls active inputs / contenteditable editors into view.

### 5. External Link Protection
- Intercepts clicks on external `http://` / `https://` URLs and safely launches them in an in-app browser sheet via `@capacitor/browser` rather than hijacking the app's WebView session.

---

## 🚀 Development & Build Commands

All commands are configured in `package.json`:

| Command | Action |
|---|---|
| `npm run copy-web` | Syncs source files into the `www/` staging directory |
| `npm run cap:sync` | Updates web assets and synchronizes Android native plugins |
| `npm run cap:open` | Opens the native Android project in **Android Studio** |
| `npm run cap:run` | Builds and deploys directly to a connected Android device or emulator |
| `npm run cap:build` | Assembles debug APK via command line |

---

## 📦 Building an APK in Android Studio

1. **Open Android Studio:**
   ```powershell
   cd C:\Users\Nishant\.gemini\antigravity\scratch\Scorpio-native
   npx cap open android
   ```
2. Wait for Gradle sync to complete.
3. Select **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
4. The generated APK will be in:
   `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📂 Project Directory Layout

```text
Scorpio-native/
├── android/                   # Native Android Studio Project
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml   # Permissions, deep links, security config
│   │   │   ├── java/app/notoz/android/
│   │   │   │   └── MainActivity.java # WebView hardening & configuration
│   │   │   └── res/                  # App icons, splash screens, themes
│   │   └── build.gradle
│   └── build.gradle
├── capacitor.config.json      # Capacitor configuration
├── scripts/
│   ├── copy-web.js            # Build script for web staging
│   └── download-vendor.js     # Vendor library bundle script
├── vendor/                    # Offline-bundled third party libraries
│   ├── supabase.min.js
│   ├── purify.min.js
│   └── jspdf.umd.min.js
├── www/                       # Capacitor web directory (synced to Android)
│   ├── capacitor-bridge.js    # Native bridge (back button, haptics, lifecycle)
│   ├── capacitor-native.css   # Android-specific CSS adaptations & safe areas
│   └── error.html             # Offline fallback screen
├── index.html                 # Login & auth entry point
└── app/                       # Main note-taking application
```
