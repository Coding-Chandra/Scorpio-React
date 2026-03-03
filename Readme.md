# 🦂 Project Scorpio — PWA Notes App

**Project Scorpio** is a modern Progressive Web Application (PWA) designed for speed, clarity, and offline-first usage. It delivers a minimalist yet powerful note-taking experience with rich editing tools, folder organization, user profiles, and seamless cross-platform support.

[Features](#-features) • [PWA Capabilities](#-pwa-capabilities) • [User Profile & Stats](#-user-profile--stats) • [Installation](#-installation--local-setup) • [Tech Stack](#-tech-stack)

---

## ⚠️ Disclaimer

> [!IMPORTANT]
> **AI-Generated Code Notice**
> This project contains code generated or assisted by Artificial Intelligence in some capacity. While the logic has been reviewed and tested for performance and security, users should exercise standard due diligence when deploying or modifying the codebase for production environments.

---

## ✨ Features

### 🗂️ Organization & Navigation

* **Folder Management:** Create, rename, and delete custom folders.
* **Global Search:** Find notes across all folders instantly.
* **Smart Lists:** View notes by active folder or a comprehensive "All Notes" view.
* **Pinning:** Keep critical notes at the top of your list.
* **Multi-Select:** Batch deletion and organization tools.

### ✍️ Advanced Editor

* **Rich Text Support:** Full `contenteditable` area with Bold, Italic, and List support.
* **Interactive Checklists:** Insert and toggle task lists directly in your note body.
* **Media Integration:** Upload images or scans directly into notes (max 5MB).
* **Typography:** Support for Title, Heading, Subheading, and Body text styles.
* **Paper Templates:** Toggle between **Blank**, **Lined**, or **Grid** backgrounds.
* **Undo/Redo:** Full history support with keyboard shortcuts (Ctrl+Z, Ctrl+Y).

### 🎨 Custom Selection Toolbar

An intuitive floating toolbar appears upon text selection:

* **Decorations:** Bold, Italic, Underline, and Strikethrough.
* **Highlighting:** Built-in text highlighting with yellow color.
* **Color Palette:** Black, Blue (`#007aff`), Red (`#ff3b30`), and Gray (`#8e8e93`).
* **Copy/Paste:** Direct clipboard operations from toolbar.

### 👤 User Profile & Authentication

* **Display Name Management:** Edit and update your profile name globally across the app.
* **Profile Page:** Dedicated profile settings page with user information display.
* **Email Display:** View your account email address.
* **Account Info:** See your User ID, account creation date, and last update timestamp.
* **Data Export:** Download all notes in JSON format (with decrypted content).

### 📊 Smart User Statistics

View personalized statistics on your profile page:

* **Total Notes:** Lifetime count of all your notes.
* **Notes This Month:** Count of notes created in the current month.
* **Monthly Streak:** Consecutive days with edits in the current month (resets monthly).
* **Oldest Note:** When you created your first note (smart date format).
* **Recently Edited:** Last time you made any edit (smart date format: "Today", "Yesterday", "2 weeks ago", etc.).

### 🎭 Avatar Generation

* **Automatic Avatars:** Beautiful gradient avatars generated from user initials.
* **Deterministic Colors:** Same user always gets the same color palette.
* **15 Color Palettes:** Vibrant, accessible color combinations.
* **No Storage:** Avatars generated on-the-fly, no file uploads needed.
* **Theme Aware:** Works seamlessly in light and dark mode.

### ⚙️ Settings & Customization

* **Theme Toggle:** Switch between light and dark mode.
* **Settings Page:** Centralized settings with profile link.
* **Account Dropdown:** Quick access to profile, settings, and logout.

---

## 🚀 PWA Capabilities

* **Service Worker:** Manages intelligent asset caching and fetch requests.
* **Manifest Integration:** Fully installable on Android, iOS, and Desktop.
* **Native Feel:** Responsive design using dynamic `--vh` variables for mobile viewport accuracy.
* **Manual Update Control:** Users are notified of updates and can choose when to install.
* **Cache Management:** Automatic cleanup of old cache versions, keeping only active + latest.
* **Offline Support:** Full functionality without internet connection (encrypted notes cached locally).

---

## 🔐 Security & Encryption

* **End-to-End Encryption:** Notes are encrypted using AES-GCM with master key derivation.
* **Master Key Management:** Stored securely in browser's `localStorage`.
* **Secure Export:** Downloaded notes are decrypted client-side before export.
* **RLS Policies:** Supabase Row Level Security ensures users can only access their own data.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3 (Glassmorphism UI, CSS Grid/Flexbox)
* **Logic:** Vanilla JavaScript (No heavy frameworks)
* **Backend:** Supabase (PostgreSQL, Auth, Storage, RLS)
* **Encryption:** Web Crypto API (AES-GCM, PBKDF2)
* **PWA:** Service Worker API, Web Manifest
* **Assets:** System fonts, custom vectorized icons, CSS animations

---

## 📂 Project Structure

```
project-scorpio/
├── src/
│   ├── css/
│   │   ├── app.css
│   │   ├── settings.css
│   │   ├── profile.css
│   │   ├── animations.css
│   │   └── themes.css
│   ├── js/
│   │   ├── app.js
│   │   ├── settings.js
│   │   ├── profile.js
│   │   ├── avatar-generator.js
│   │   ├── cache-update.js
│   │   ├── animation-utils.js
│   │   └── md3e-enhance.js
│   └── pages/
│       ├── theme.html
│       ├── about.html
│       ├── privacy.html
│       ├── tos.html
│       └── profile.html
├── index.html
├── app.html
├── settings.html
├── profile.html
├── sw.js
└── manifest.json
```

---

## 💻 Installation / Local Setup

1. **Download XAMPP:** Ensure you have a local server environment.
2. **Clone/Move Project:** Place the `project-scorpio` folder inside `htdocs`.
```bash
C:\xampp\htdocs\project-scorpio
```

3. **Start Apache:** Run Apache from the XAMPP Control Panel.
4. **Access App:** Navigate to `http://localhost/project-scorpio` in your browser.

---

## 🔄 PWA Cache & Updates

### Updating the PWA Cache

To push updates to users, update the `CACHE_NAME` version string inside `sw.js`:

**Versioning Format:**
`X[Major].XX[Minor].XXXX[Fixes/Patch]`

**Example:**
```javascript
// Inside sw.js
const CACHE_NAME = 'notoj-app-cache-vX.XX.XXXX';
```

### Cache Management

* **Automatic Cleanup:** Only active and latest cache versions are kept.
* **Manual Updates:** Users see "Update Available" notification and click to update.
* **Session Refresh:** Update activates on next app load.
* **Transparent Versioning:** Build number auto-syncs from `CACHE_NAME`.

---

## 🔐 Supabase Setup

### Required Tables

```sql
-- Users (built-in with Supabase Auth)
-- profiles table for display name and metadata
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Folders
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notes (with encryption)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  folder_id UUID REFERENCES folders(id),
  title TEXT DEFAULT 'New Note',
  content TEXT, -- encrypted with AES-GCM
  pinned BOOLEAN DEFAULT FALSE,
  paper_style TEXT DEFAULT 'blank',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Environment Variables

Create a `.env` or use inline config:

```javascript
const SUPABASE_URL = 'your_supabase_url';
const SUPABASE_ANON_KEY = 'your_anon_key';
```

---

## 🚀 Deployment

### Vercel / Netlify

1. Connect your repository
2. Set environment variables
3. Deploy automatically on push

### Traditional Hosting

1. Build/minify assets if needed
2. Upload all files to your web server
3. Ensure HTTPS is enabled (required for PWA)
4. Configure CORS headers for Supabase

---

## 📋 Features Checklist

### Notes
- [x] Create, read, update, delete notes
- [x] Rich text editing
- [x] Image uploads
- [x] Checklists
- [x] Undo/redo history
- [x] Search across notes
- [x] Paper style templates

### Organization
- [x] Folders
- [x] Pinning
- [x] Multi-select
- [x] Sorting by date and pinned status

### User Features
- [x] User authentication (Supabase Auth)
- [x] Profile page with editable display name
- [x] User statistics and insights
- [x] Avatar generation from initials
- [x] Data export with decryption

### PWA
- [x] Service worker
- [x] Offline support
- [x] Manifest (installable)
- [x] Manual cache updates
- [x] Mobile responsive

### Security
- [x] End-to-end encryption
- [x] Row-level security (RLS)
- [x] Secure key management
- [x] Input validation

---

## 🎯 Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Undo | Ctrl+Z | Cmd+Z |
| Redo | Ctrl+Y or Ctrl+Shift+Z | Cmd+Y or Cmd+Shift+Z |
| Bold | Ctrl+B | Cmd+B |
| Italic | Ctrl+I | Cmd+I |
| Underline | Ctrl+U | Cmd+U |

---

## 📖 Documentation

* **[TBH]

---

## 🐛 Troubleshooting

### Notes not syncing?
- Check internet connection
- Verify Supabase credentials
- Check browser console for errors

### PWA not installing?
- Ensure HTTPS is enabled
- Check manifest.json is valid
- Clear browser cache and try again

### Encryption errors?
- Verify master key is set in localStorage
- Check Web Crypto API support in browser
- Clear localStorage and re-authenticate

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 🙏 Credits

Built with ❤️ using Supabase, Web APIs, and modern PWA technologies.

**Last Updated:** February 2026