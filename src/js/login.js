// --- Supabase Client Initialization ---
const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';

if (typeof window.supabase === 'undefined') {
    console.error("Supabase SDK not loaded. Check script tag.");
    throw new Error("Supabase SDK missing.");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let CURRENT_USER_ID = null; // needed by migrateUserCrypto()

async function performFullSignOut() {
    await clearSessionMasterKey();
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}
window.performFullSignOut = performFullSignOut;

// --- DOM Elements ---
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginSection = document.getElementById('login-section');
const signupSection = document.getElementById('signup-section');
const showLoginLink = document.getElementById('show-login');
const showSignupLink = document.getElementById('show-signup');
const messageEl = document.getElementById('auth-message');
const loginEmailInput = document.getElementById('login-email');
const passwordGroup = document.getElementById('password-group');
const loginPasswordInput = document.getElementById('login-password');
const loginButton = loginForm?.querySelector('button[type="submit"]');


function displayMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.style.color = isError ? "#f44336" : "#4caf50";
    setTimeout(() => (messageEl.textContent = ""), 5000);
}

function handleAuthSuccess() {
    window.location.href = "./app/index.html";
}

// ---------------------------------------------------------
// 🔐 Crypto Helpers (PBKDF2 + AES-GCM + base64)
// ---------------------------------------------------------

function _b64FromBuf(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _bufFromB64(b64) {
    const bin = atob(b64);
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

const OLD_STATIC_SALT = "notesapp_v1_salt";
const OLD_ITERATIONS = 200000;
const NEW_ITERATIONS = 600000;

// salt is now required (no default) — caller must pass old or new salt explicitly.
async function deriveKeyFromPassword(password, salt, iterations = NEW_ITERATIONS) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptMasterKey(masterKeyBytes, password, salt, iterations) {
    const derived = await deriveKeyFromPassword(password, salt, iterations);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derived, masterKeyBytes);
    return { iv: _b64FromBuf(iv), data: _b64FromBuf(ct) };
}

async function decryptMasterKey(encObj, password, salt, iterations) {
    const derived = await deriveKeyFromPassword(password, salt, iterations);
    const iv = _bufFromB64(encObj.iv);
    const ct = _bufFromB64(encObj.data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derived, ct);
    return new Uint8Array(plain);
}

// ---------------------------------------------------------
// 🔒 Session key storage — IndexedDB, non-extractable CryptoKey
// (replaces the old localStorage-raw-bytes approach)
// ---------------------------------------------------------
const KEY_DB_NAME = 'notoz_session';
const KEY_STORE = 'keys';

function _openKeyDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(KEY_DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(KEY_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Takes the raw key bytes, imports them as a NON-EXTRACTABLE CryptoKey,
// and stores that object (not the bytes) in IndexedDB.
async function setSessionMasterKey(masterKeyBytes) {
    const key = await crypto.subtle.importKey(
        "raw",
        masterKeyBytes,
        "AES-GCM",
        false, // extractable: false — the raw bytes can never be read back out
        ["encrypt", "decrypt"]
    );
    const db = await _openKeyDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        tx.objectStore(KEY_STORE).put(key, "masterKey");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

// Returns the CryptoKey object directly, ready to use for encrypt/decrypt.
async function getSessionMasterKey() {
    const db = await _openKeyDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readonly");
        const req = tx.objectStore(KEY_STORE).get("masterKey");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function clearSessionMasterKey() {
    const db = await _openKeyDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, "readwrite");
        tx.objectStore(KEY_STORE).delete("masterKey");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

function makeRandomKey() {
    return crypto.getRandomValues(new Uint8Array(32));
}

function genSaltB64(len = 16) {
    return _b64FromBuf(crypto.getRandomValues(new Uint8Array(len)));
}

// ---------------------------------------------------------
// 🔁 Salt/iteration migration — called right after login
// ---------------------------------------------------------

async function migrateUserCrypto(password) {
    const { data: row, error } = await supabaseClient
        .from("user_keys")
        .select("encrypted_master_key, salt, kdf_iterations")
        .eq("user_id", CURRENT_USER_ID)
        .maybeSingle();

    if (error || !row?.encrypted_master_key) return null; // nothing to migrate yet

    const currentSalt = row.salt || OLD_STATIC_SALT;
    const currentIterations = row.salt ? (row.kdf_iterations || NEW_ITERATIONS) : OLD_ITERATIONS;

    const encObj = JSON.parse(row.encrypted_master_key);
    const masterKeyBytes = await decryptMasterKey(encObj, password, currentSalt, currentIterations);

    if (row.salt) return masterKeyBytes; // already migrated

    const newSalt = genSaltB64();
    const newEncrypted = await encryptMasterKey(masterKeyBytes, password, newSalt, NEW_ITERATIONS);

    const { error: updateErr } = await supabaseClient
        .from("user_keys")
        .update({
            encrypted_master_key: JSON.stringify(newEncrypted),
            salt: newSalt,
            kdf_iterations: NEW_ITERATIONS
        })
        .eq("user_id", CURRENT_USER_ID);

    if (updateErr) console.error("[Migrate] Failed to save new salt:", updateErr);
    else console.log("[Migrate] Upgraded to personal salt + 600k iterations.");

    return masterKeyBytes;
}

// ---------------------------------------------------------
// 🟦 SIGNUP
// ---------------------------------------------------------

async function handleSignup(e) {
    e.preventDefault();

    const displayName = document.getElementById("signup-display-name")?.value?.trim();
    const email = document.getElementById("signup-email")?.value?.trim()?.toLowerCase();
    const password = document.getElementById("signup-password")?.value;

    if (!displayName || !email || !password) {
        displayMessage("Please fill in all fields.", true);
        return;
    }
    if (password.length < 8) {
        displayMessage("Password must be at least 8 characters.", true);
        return;
    }

    displayMessage("Creating account...", false);

    const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { full_name: displayName }, emailRedirectTo: window.location.origin }
    });

    if (error) {
        if (error.message.toLowerCase().includes("already")) {
            displayMessage("An account with this email already exists. Please log in instead.", true);
        } else {
            displayMessage(error.message, true);
        }
        return;
    }

    if (data.user && !data.session) {
        displayMessage("Registration successful! Please check your email to verify your account before logging in.", false);
    } else {
        displayMessage("Account created successfully!", false);
    }

    switchForm(loginSection, signupSection);
}

// ---------------------------------------------------------
// 🟩 LOGIN
// ---------------------------------------------------------

async function handleLogin(e) {
    e.preventDefault();

    if (!passwordGroup.classList.contains('active')) {
        showPasswordFields();
        loginPasswordInput.focus();
        return;
    }

    const email = document.getElementById("login-email")?.value;
    const password = document.getElementById("login-password")?.value;
    if (!email || !password) return;

    displayMessage("Logging in...", false);

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        displayMessage(error.message, true);
        return;
    }

    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
        displayMessage("Login succeeded but failed to load user.", true);
        return;
    }

    CURRENT_USER_ID = userData.user.id;

    const { data: keyRow, error: keyErr } = await supabaseClient
        .from("user_keys")
        .select("encrypted_master_key")
        .eq("user_id", CURRENT_USER_ID)
        .maybeSingle();

    if (keyErr) {
        console.error("Error fetching key:", keyErr);
        displayMessage("Failed to fetch encryption key.", true);
        return;
    }

    // CASE 1: Key exists → migrate (decrypts + upgrades salt if needed) and use result
    if (keyRow) {
        try {
            const masterKeyBytes = await migrateUserCrypto(password);
            if (!masterKeyBytes) throw new Error("migration returned nothing");

            await setSessionMasterKey(masterKeyBytes);
            handleAuthSuccess();
            return;
        } catch (e) {
            console.error("Failed to decrypt stored master key:", e);
            displayMessage("Incorrect password for encrypted notes.", true);
            return;
        }
    }

    // CASE 2: No key exists → create new one directly on personal salt + 600k
    const newMasterKey = makeRandomKey();
    const newSalt = genSaltB64();
    const encrypted = await encryptMasterKey(newMasterKey, password, newSalt, NEW_ITERATIONS);

    const { error: insertErr } = await supabaseClient
        .from("user_keys")
        .insert({
            user_id: CURRENT_USER_ID,
            encrypted_master_key: JSON.stringify(encrypted),
            salt: newSalt,
            kdf_iterations: NEW_ITERATIONS
        });

    if (insertErr) {
        console.error("Failed to save new master key:", insertErr);
        displayMessage("Could not initialize encryption.", true);
        return;
    }

    await setSessionMasterKey(newMasterKey);
    handleAuthSuccess();
}


function isEmailComplete(email) {
    const EmailPattern = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    return EmailPattern.test(email);
}

function showPasswordFields() {
    const email = loginEmailInput.value.trim();
    if (isEmailComplete(email)) passwordGroup.classList.add('active');
    else passwordGroup.classList.remove('active');
}

function resetLoginView() {
    loginEmailInput.disabled = false;
    passwordGroup.classList.remove('active');
    loginForm.reset();
    displayMessage("", false);
}

function switchForm(targetSection, otherSection) {
    otherSection.classList.add('hidden-auth');
    setTimeout(() => {
        otherSection.style.display = 'none';
        targetSection.style.display = 'block';
        requestAnimationFrame(() => {
            targetSection.classList.remove('hidden-auth');
            resetLoginView();
        });
    }, 300);
}

if (loginSection && loginSection.style.display === 'none') {
    loginSection.classList.add('hidden-auth');
}

if (signupForm) signupForm.addEventListener("submit", handleSignup);
if (loginForm) loginForm.addEventListener("submit", handleLogin);

loginEmailInput?.addEventListener('input', showPasswordFields);

showLoginLink?.addEventListener("click", e => { e.preventDefault(); switchForm(loginSection, signupSection); });
showSignupLink?.addEventListener("click", e => { e.preventDefault(); switchForm(signupSection, loginSection); });

if (window.innerWidth <= 768) {
    document.addEventListener('touchstart', function (e) {
        if (e.target === loginEmailInput || e.target === loginPasswordInput) e.target.focus();
    });
    const submitButton = loginForm?.querySelector('button[type="submit"]');
    if (submitButton && navigator.vibrate) {
        submitButton.addEventListener('click', function () { navigator.vibrate(10); });
    }
}

supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) handleAuthSuccess();
});