# 🦀 Notoz (Project Scorpio) — Rust Native Android (Tauri v2)

Notoz has been migrated from Capacitor to **Rust Native on Android** powered by **Tauri v2 Mobile**.

---

## ⚡ Architecture Overview

* **Native Backend:** Rust (`src-tauri/src/lib.rs` and `main.rs`) compiled to native shared libraries (`.so`) using Android NDK (`aarch64`, `armv7`, `x86_64`).
* **Frontend Runtime:** High-performance Android System WebView managed directly by Tauri's Rust core (`wry` / `tao`).
* **Bridge Layer (`tauri-bridge.js`):**
  - Edge-to-edge status bar & gesture navigation safe area padding (`--safe-area-top`, `--safe-area-bottom`).
  - Hierarchical hardware back-button routing (dialogs -> image sheets -> settings portal -> Notoz `BackHandler` -> mobile view navigation -> app exit).
  - Native haptic feedback via Rust/Web vibration APIs.
  - External link isolation with secure browser routing.
  - Complete backwards compatibility with legacy `window.__NOTOZ_CAPACITOR` and `window.__NOTOZ_NATIVE` APIs.

---

## 📂 Project Structure

```text
CS/
├── src-tauri/                  # Rust Native Backend
│   ├── Cargo.toml             # Rust dependencies & crate configuration
│   ├── tauri.conf.json        # Tauri v2 application configuration
│   ├── build.rs               # Tauri build script
│   ├── capabilities/          # Application security capabilities & permissions
│   │   └── default.json
│   ├── icons/                 # Multi-resolution Android & app icons
│   └── src/
│       ├── lib.rs             # Rust native commands & Android mobile entry point
│       └── main.rs            # Desktop / CLI entry point
├── scripts/
│   └── copy-web.js            # Syncs web assets to www/ staging
├── .github/workflows/
│   └── build-apk.yml          # GitHub Actions workflow for building Android APK
├── tauri-bridge.js            # Native Android bridge
├── www/                       # Staged web distribution directory
└── app/                       # Main note-taking application
```

---

## 🚀 Building the APK via GitHub Actions

Every push or pull request to `main`/`master` automatically triggers `.github/workflows/build-apk.yml`:

1. Checks out repository.
2. Installs Node.js 22, Temurin JDK 17, and Android SDK/NDK 27.
3. Configures Rust stable toolchain with Android targets (`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`).
4. Staged frontend web assets into `www/`.
5. Scaffolds Android project with `tauri android init`.
6. Compiles Rust native code and packages the Android APK (`tauri android build --apk --debug`).
7. Uploads the built APK to GitHub Actions Artifacts (`notoz-rust-native-apk`).

You can also trigger builds manually via the **Actions** tab on GitHub with the `workflow_dispatch` button.

---

## 💻 Local Development Commands

```powershell
# Copy web source to www staging
npm run copy-web

# Initialize Tauri Android project (requires Android SDK & NDK)
npm run tauri:android:init

# Build debug APK locally
npm run tauri:android:build

# Run in development mode
npm run tauri:dev
```
