// --- Supabase Client Initialization ---
const SUPABASE_URL = 'https://scorpio-native-app.webg.workers.dev';
const SUPABASE_ANON_KEY = 'sb_publishable_mAXfLlr54xCYHL4aXCnRmg_0BULcwxs';

if (typeof window.supabase === 'undefined') {
    console.error("Supabase SDK not loaded. Check script tag.");
    throw new Error("Supabase SDK missing.");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    window.location.href = "./app/";
}

// ---------------------------------------------------------
// 🔐 Crypto Helpers (PBKDF2 + AES-GCM + base64) - UNTOUCHED
// ---------------------------------------------------------

function _b64FromBuf(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _bufFromB64(b64) {
    const bin = atob(b64);
    return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

async function deriveKeyFromPassword(password, salt = "notesapp_v1_salt") {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(salt),
            iterations: 200000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptMasterKey(masterKeyBytes, password) {
    const derived = await deriveKeyFromPassword(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derived, masterKeyBytes);

    return { iv: _b64FromBuf(iv), data: _b64FromBuf(ct) };
}

async function decryptMasterKey(encObj, password) {
    const derived = await deriveKeyFromPassword(password);
    const iv = _bufFromB64(encObj.iv);
    const ct = _bufFromB64(encObj.data);

    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derived, ct);
    return new Uint8Array(plain);
}

function setLocalMasterKeyBytes(bytes) {
    localStorage.setItem("notes_master_key", _b64FromBuf(bytes));
}

function getLocalMasterKeyBytes() {
    const b64 = localStorage.getItem("notes_master_key");
    return b64 ? _bufFromB64(b64) : null;
}

// Utility: random 32-byte key
function makeRandomKey() {
    return crypto.getRandomValues(new Uint8Array(32));
}

// ---------------------------------------------------------
// 🟦 SIGNUP (Auth Function)
// ---------------------------------------------------------

async function handleSignup(e) {
    e.preventDefault();

    const displayName = document
        .getElementById("signup-display-name")
        ?.value?.trim();

    const email = document
        .getElementById("signup-email")
        ?.value?.trim()
        ?.toLowerCase();

    const password = document
        .getElementById("signup-password")
        ?.value;

    // --- Validate inputs ---
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
        email,
        password,
        options: {
            data: { full_name: displayName },
            emailRedirectTo: window.location.origin
        }
    });

    // --- Handle errors ---
    if (error) {

        // Reject if email already exists
        if (error.message.toLowerCase().includes("already")) {
            displayMessage(
                "An account with this email already exists. Please log in instead.",
                true
            );
        } else {
            displayMessage(error.message, true);
        }

        return;
    }

    // --- Email verification flow ---
    if (data.user && !data.session) {
        displayMessage(
            "Registration successful! Please check your email to verify your account before logging in.",
            false
        );
    } else {
        // Happens only if email confirmation disabled
        displayMessage("Account created successfully!", false);
    }

    // Switch to login form
    switchForm(loginSection, signupSection);
}


// ---------------------------------------------------------
// 🟩 LOGIN (Auth + Key Management Function)
// ---------------------------------------------------------

async function handleLogin(e) {
    e.preventDefault();
    
    // If the password field is not visible, show it and stop submission
    if (!passwordGroup.classList.contains('active')) {
        showPasswordFields(); 
        loginPasswordInput.focus();
        return;
    }

    const email = document.getElementById("login-email")?.value;
    const password = document.getElementById("login-password")?.value;

    if (!email || !password) return;

    displayMessage("Logging in...", false);

    // Step 1: Log in the user
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        displayMessage(error.message, true);
        return;
    }

    // Step 2: Get authenticated user
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
        displayMessage("Login succeeded but failed to load user.", true);
        return;
    }

    const userId = userData.user.id;

    // Step 3: Try to fetch encrypted master key
    const { data: keyRow, error: keyErr } = await supabaseClient
        .from("user_keys")
        .select("encrypted_master_key")
        .eq("user_id", userId)
        .maybeSingle();

    if (keyErr) {
        console.error("Error fetching key:", keyErr);
        displayMessage("Failed to fetch encryption key.", true);
        return;
    }

    // CASE 1: Key exists → decrypt it using password
    if (keyRow) {
        try {
            const encObj = JSON.parse(keyRow.encrypted_master_key);
            const masterKeyBytes = await decryptMasterKey(encObj, password);

            setLocalMasterKeyBytes(masterKeyBytes);
            handleAuthSuccess();
            return;
        } catch (e) {
            console.error("Failed to decrypt stored master key:", e);
            displayMessage("Incorrect password for encrypted notes.", true);
            return;
        }
    }

    // CASE 2: No key exists → create + store new one
    const newMasterKey = makeRandomKey();
    const encrypted = await encryptMasterKey(newMasterKey, password);

    const { error: insertErr } = await supabaseClient
        .from("user_keys")
        .insert({
            user_id: userId,
            encrypted_master_key: JSON.stringify(encrypted)
        });

    if (insertErr) {
        console.error("Failed to save new master key:", insertErr);
        displayMessage("Could not initialize encryption.", true);
        return;
    }

    // Store decrypted key locally
    setLocalMasterKeyBytes(newMasterKey);

    handleAuthSuccess();
}


function isEmailComplete(email) {
    const EmailPattern = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    return EmailPattern.test(email);
}

function showPasswordFields() {
    const email = loginEmailInput.value.trim();

    if (isEmailComplete(email)) {
        passwordGroup.classList.add('active');
    }
    else {
        passwordGroup.classList.remove('active');
    }
}


function resetLoginView() {
    loginEmailInput.disabled = false;
    passwordGroup.classList.remove('active');
    loginForm.reset();
    displayMessage("", false);
}

// ---------------------------------------------------------
// 🔄 Form Switching Logic (For Animation)
// ---------------------------------------------------------

function switchForm(targetSection, otherSection) {
    // 1. Hide the current section using the animation class
    otherSection.classList.add('hidden-auth');
    
    // 2. Wait for the fade-out/slide-out transition (300ms)
    setTimeout(() => {
        // Hide the old section and show the new one
        otherSection.style.display = 'none';
        targetSection.style.display = 'block';

        // 3. Start the fade-in/slide-in animation
        requestAnimationFrame(() => {
            targetSection.classList.remove('hidden-auth');
            resetLoginView(); // Reset the login form state
        });
        
    }, 300); // Must match the CSS transition duration
}

// Ensure the login section is hidden with the class for animation, as it starts hidden
if (loginSection && loginSection.style.display === 'none') {
    loginSection.classList.add('hidden-auth');
}


// ---------------------------------------------------------
// Events
// ---------------------------------------------------------

if (signupForm) signupForm.addEventListener("submit", handleSignup);
if (loginForm) loginForm.addEventListener("submit", handleLogin); 

// Auto-show password field on email input
loginEmailInput?.addEventListener('input', showPasswordFields);


// Toggle to Log In View
showLoginLink?.addEventListener("click", e => {
    e.preventDefault();
    switchForm(loginSection, signupSection);
});


// Toggle to Sign Up View
showSignupLink?.addEventListener("click", e => {
    e.preventDefault();
    switchForm(signupSection, loginSection);
});

// --- MOBILE ENHANCEMENTS ---
if (window.innerWidth <= 768) {
    // Prevent zoom on input focus for better UX
    document.addEventListener('touchstart', function(e) {
        if (e.target === loginEmailInput || e.target === loginPasswordInput) {
            e.target.focus();
        }
    });

    // Add haptic feedback on button press (if supported)
    const submitButton = loginForm?.querySelector('button[type="submit"]');
    if (submitButton && navigator.vibrate) {
        submitButton.addEventListener('click', function() {
            navigator.vibrate(10);
        });
    }
}

// Auto-redirect if session exists
supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) handleAuthSuccess();
});