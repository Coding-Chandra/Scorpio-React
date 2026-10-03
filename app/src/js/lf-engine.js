/* =====================================================
   LOCKED FOLDER  (PIN 4/6 + biometrics)
   Load on index.html AFTER app.js, and on settings.html.
   Needs: supabaseClient global (or LockedFolder.configure({client})).
   Local: IndexedDB 'notoz-locked-folder'
   Server backup: locked_folder_config
   ===================================================== */

(function () {
  'use strict';

  const DB = 'notoz-locked-folder';
  const STORE = 'cfg';
  const TBL = 'locked_folder_config';

  const ITER = 150000;
  const MAX_FAILS = 5;
  const LOCK_MS = 30000;
  const AUTOLOCK_MS = 30000;

  const LOCKED_NAME = 'Locked';
  const FALLBACK_NAME = 'Unlocked Notes';
  const LAST_KEY = 'lf_last_folder_';
  const NOTIFICATIONS_DISABLED_KEY = 'locked_folder_notifications_disabled';

  let cfg = null;
  let uid = null;
  let unlocked = false;
  let override = {};
  let hideTimer = null;

  const hasApp = () =>
    typeof app !== 'undefined' && app;

  const client = () =>
    override.client ||
    (typeof supabaseClient !== 'undefined'
      ? supabaseClient
      : null);

  const online = () =>
    navigator.onLine !== false;

  const notify = (t, m, type) => {
    if (
      localStorage.getItem(NOTIFICATIONS_DISABLED_KEY) ===
      'true'
    ) {
      return;
    }

    return window.showNotification
      ? window.showNotification(t, m, type)
      : console.log(t, m);
  };

  const emit = n =>
    window.dispatchEvent(
      new CustomEvent('lockedfolder:' + n)
    );

  /* ---------- User ---------- */

  async function userId() {
    if (uid) return uid;

    const { data } =
      await client().auth.getSession();

    return (
      uid =
        data?.session?.user?.id ||
        null
    );
  }

  /* ---------- IndexedDB ---------- */

  const openDb = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);

      r.onupgradeneeded = () => {
        r.result.createObjectStore(STORE);
      };

      r.onsuccess = () =>
        res(r.result);

      r.onerror = () =>
        rej(r.error);
    });

  async function idb(mode, fn) {
    const d = await openDb();

    return new Promise((res, rej) => {
      const q =
        fn(
          d
            .transaction(STORE, mode)
            .objectStore(STORE)
        );

      q.onsuccess = () =>
        res(q.result ?? null);

      q.onerror = () =>
        rej(q.error);
    });
  }

  const idbGet = k =>
    idb(
      'readonly',
      s => s.get(k)
    );

  const idbSet = (k, v) =>
    idb(
      'readwrite',
      s => s.put(v, k)
    );

  const idbDel = k =>
    idb(
      'readwrite',
      s => s.delete(k)
    );

  /* ---------- Crypto ---------- */

  const b64 = b =>
    btoa(
      String.fromCharCode(
        ...new Uint8Array(b)
      )
    );

  const unb64 = s =>
    Uint8Array.from(
      atob(s),
      c => c.charCodeAt(0)
    );

  async function hashPin(pin, salt) {
    const k =
      await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pin),
        'PBKDF2',
        false,
        ['deriveBits']
      );

    return b64(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: unb64(salt),
          iterations: ITER
        },
        k,
        256
      )
    );
  }

  const safeEq = (a, b) => {
    if (a.length !== b.length)
      return false;

    let r = 0;

    for (
      let i = 0;
      i < a.length;
      i++
    ) {
      r |=
        a.charCodeAt(i) ^
        b.charCodeAt(i);
    }

    return r === 0;
  };

  const validPin = p =>
    /^(\d{4}|\d{6})$/.test(
      p || ''
    );

  /* ---------- Config load / sync ---------- */

  async function init() {
    const id = await userId();

    if (!id) return null;

    let local =
      await idbGet(id);

    if (online()) {
      try {
        const { data } =
          await client()
            .from(TBL)
            .select('*')
            .eq('user_id', id)
            .maybeSingle();

        if (
          data &&
          (
            !local ||
            local.hash !== data.pin_hash
          )
        ) {
          local = {
            ...(local || {}),
            enabled: data.enabled,
            pinLength: data.pin_length,
            salt: data.pin_salt,
            hash: data.pin_hash,
            fails: 0,
            lockUntil: 0
          };

          await idbSet(id, local);
        } else if (
          !data &&
          local?.enabled
        ) {
          await pushServer(
            local,
            id
          ).catch(() => {});
        } else if (
          !data &&
          local &&
          !local.enabled
        ) {
          await idbDel(id);
          local = null;
        }
      } catch (e) {
        console.warn(
          '[LockedFolder] sync failed',
          e
        );
      }
    }

    cfg = local;

    return cfg;
  }

  /* ---------- Server sync ---------- */

  async function pushServer(c, id) {
    const { error } =
      await client()
        .from(TBL)
        .upsert(
          {
            user_id: id,
            enabled: !!c.enabled,
            pin_length: c.pinLength,
            pin_salt: c.salt,
            pin_hash: c.hash
          },
          {
            onConflict: 'user_id'
          }
        );

    if (error) throw error;
  }

  async function saveLocal() {
    const id = await userId();

    if (id && cfg) {
      await idbSet(id, cfg);
    }
  }

  /* ---------- PIN verification ---------- */

  async function verifyPin(pin) {
    if (!cfg?.enabled) {
      return {
        ok: true
      };
    }

    if (
      cfg.lockUntil &&
      Date.now() < cfg.lockUntil
    ) {
      const left =
        Math.ceil(
          (cfg.lockUntil - Date.now()) /
            1000
        );

      return {
        ok: false,
        message:
          `Too many attempts. Try again in ${left}s.`
      };
    }

    if (
      !validPin(pin) ||
      pin.length !== cfg.pinLength
    ) {
      return {
        ok: false,
        message:
          `Enter a ${cfg.pinLength}-digit PIN.`
      };
    }

    const hash =
      await hashPin(
        pin,
        cfg.salt
      );

    if (
      safeEq(
        hash,
        cfg.hash
      )
    ) {
      cfg.fails = 0;
      cfg.lockUntil = 0;

      await saveLocal();

      return {
        ok: true
      };
    }

    cfg.fails =
      (cfg.fails || 0) + 1;

    if (
      cfg.fails >= MAX_FAILS
    ) {
      cfg.fails = 0;
      cfg.lockUntil =
        Date.now() + LOCK_MS;
    }

    await saveLocal();

    return {
      ok: false,
      message:
        cfg.lockUntil
          ? 'Too many incorrect attempts. Locked for 30 seconds.'
          : 'Incorrect PIN.'
    };
  }

  /* ---------- Biometrics ---------- */

  function biometricAvailable() {
    return !!(
      window.PublicKeyCredential &&
      navigator.credentials
    );
  }

  async function registerBiometric() {
    if (!biometricAvailable()) {
      throw new Error(
        'Biometric authentication is not available on this device.'
      );
    }

    const challenge =
      crypto.getRandomValues(
        new Uint8Array(32)
      );

    const user =
      crypto.getRandomValues(
        new Uint8Array(16)
      );

    const credential =
      await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'Notoz'
          },
          user: {
            id: user,
            name: 'notoz-user',
            displayName: 'Notoz'
          },
          pubKeyCredParams: [
            {
              type: 'public-key',
              alg: -7
            },
            {
              type: 'public-key',
              alg: -257
            }
          ],
          authenticatorSelection: {
            authenticatorAttachment:
              'platform',
            userVerification:
              'required'
          },
          timeout: 60000,
          attestation: 'none'
        }
      });

    if (!credential) {
      throw new Error(
        'Biometric registration failed.'
      );
    }

    return b64(
      credential.rawId
    );
  }

  async function biometricAuth() {
    if (!cfg?.credId)
      return false;

    try {
      await navigator.credentials.get({
        publicKey: {
          challenge:
            crypto.getRandomValues(
              new Uint8Array(32)
            ),
          allowCredentials: [
            {
              type: 'public-key',
              id: unb64(
                cfg.credId
              )
            }
          ],
          userVerification:
            'required',
          timeout: 60000
        }
      });

      return true;
    } catch {
      return false;
    }
  }

  /* ---------- Locked folder row ---------- */

  const cacheFolders = id => {
    try {
      localStorage.setItem(
        'notozApp_folders_' + id,
        JSON.stringify(
          app.folders
        )
      );
    } catch (_) {}
  };

  async function ensureLockedFolder() {
    const id = await userId();
    const c = client();

    let { data } =
      await c
        .from('folders')
        .select('*')
        .eq('user_id', id)
        .eq('is_locked', true)
        .maybeSingle();

    if (!data) {
      const r =
        await c
          .from('folders')
          .insert({
            user_id: id,
            name: LOCKED_NAME,
            is_locked: true
          })
          .select()
          .single();

      if (r.error)
        throw r.error;

      data = r.data;
    }

    if (
      hasApp() &&
      app.folders &&
      !app.folders.some(
        f =>
          String(f.id) ===
          String(data.id)
      )
    ) {
      app.folders.push(data);

      cacheFolders(id);

      app.renderFolders?.();
    }

    return data;
  }

  const lockedIds = () =>
    new Set(
      (
        hasApp()
          ? app.folders || []
          : []
      )
        .filter(
          f => f.is_locked
        )
        .map(
          f => String(f.id)
        )
    );

  /* ---------- Public operations ---------- */

  async function setup(
    pin,
    { biometric = false } = {}
  ) {
    if (!validPin(pin)) {
      throw new Error(
        'PIN must be 4 or 6 digits'
      );
    }

    if (!online()) {
      throw new Error(
        'You need to be online to enable the locked folder'
      );
    }

    const id =
      await userId();

    const salt =
      b64(
        crypto.getRandomValues(
          new Uint8Array(16)
        )
      );

    const credId =
      biometric
        ? await registerBiometric()
        : null;

    const next = {
      enabled: true,
      pinLength: pin.length,
      salt,
      hash:
        await hashPin(
          pin,
          salt
        ),
      biometric:
        !!credId,
      credId,
      fails: 0,
      lockUntil: 0
    };

    await ensureLockedFolder();

    await pushServer(
      next,
      id
    );

    cfg = next;

    await saveLocal();

    unlocked = true;

    emit('changed');

    return true;
  }

  async function changePin(
    oldPin,
    newPin
  ) {
    const v =
      await verifyPin(oldPin);

    if (!v.ok)
      throw new Error(
        v.message
      );

    if (!validPin(newPin)) {
      throw new Error(
        'PIN must be 4 or 6 digits'
      );
    }

    if (!online()) {
      throw new Error(
        'You need to be online to change the PIN'
      );
    }

    const salt =
      b64(
        crypto.getRandomValues(
          new Uint8Array(16)
        )
      );

    const next = {
      ...cfg,
      pinLength:
        newPin.length,
      salt,
      hash:
        await hashPin(
          newPin,
          salt
        ),
      fails: 0,
      lockUntil: 0
    };

    await pushServer(
      next,
      await userId()
    );

    cfg = next;

    await saveLocal();

    emit('changed');

    return true;
  }

  async function setBiometric(
    on,
    pin
  ) {
    const v =
      await verifyPin(pin);

    if (!v.ok)
      throw new Error(
        v.message
      );

    if (on) {
      cfg.credId =
        await registerBiometric();

      cfg.biometric = true;
    } else {
      cfg.credId = null;
      cfg.biometric = false;
    }

    await saveLocal();

    emit('changed');

    return cfg.biometric;
  }

  async function disable(pin) {
    const v =
      await verifyPin(pin);

    if (!v.ok)
      throw new Error(
        v.message
      );

    if (!online()) {
      throw new Error(
        'You need to be online to disable the locked folder'
      );
    }

    const id =
      await userId();

    const c = client();

    const {
      data: locked
    } =
      await c
        .from('folders')
        .select('id')
        .eq('user_id', id)
        .eq('is_locked', true)
        .maybeSingle();

    let target = null;
    let created = null;

    if (locked) {
      const { count } =
        await c
          .from('notes')
          .select(
            'id',
            {
              count: 'exact',
              head: true
            }
          )
          .eq('user_id', id)
          .eq(
            'folder_id',
            locked.id
          );

      if (count > 0) {
        const last =
          localStorage.getItem(
            LAST_KEY + id
          );

        if (last) {
          const { data: f } =
            await c
              .from('folders')
              .select('id')
              .eq(
                'user_id',
                id
              )
              .eq(
                'id',
                last
              )
              .eq(
                'is_locked',
                false
              )
              .maybeSingle();

          if (f)
            target = f.id;
        }

        if (target == null) {
          let { data: f } =
            await c
              .from('folders')
              .select('*')
              .eq(
                'user_id',
                id
              )
              .eq(
                'name',
                FALLBACK_NAME
              )
              .eq(
                'is_locked',
                false
              )
              .maybeSingle();

          if (!f) {
            const r =
              await c
                .from('folders')
                .insert({
                  user_id: id,
                  name: FALLBACK_NAME
                })
                .select()
                .single();

            if (r.error)
              throw r.error;

            f =
              created =
                r.data;
          }

          target = f.id;
        }
      }

      const { error } =
        await c.rpc(
          'disable_locked_folder',
          {
            p_target: target
          }
        );

      if (error)
        throw error;
    } else {
      await c
        .from(TBL)
        .delete()
        .eq(
          'user_id',
          id
        );
    }

    await idbDel(id);

    cfg = null;
    unlocked = false;

    if (
      hasApp() &&
      locked
    ) {
      const moved = [];

      (
        app.notes || []
      ).forEach(n => {
        if (
          String(n.folder_id) ===
          String(locked.id)
        ) {
          n.folder_id = target;
          moved.push(n);
        }
      });

      app.folders =
        (
          app.folders || []
        ).filter(
          f =>
            String(f.id) !==
            String(locked.id)
        );

      if (created)
        app.folders.push(
          created
        );

      if (
        String(
          app.activeFolderId
        ) ===
        String(locked.id)
      ) {
        app.activeFolderId =
          'all';
      }

      cacheFolders(id);

      if (moved.length) {
        app.mirrorNotesToIndexedDB?.(
          moved
        );
      }

      app.renderFolders?.();
      app.renderNotesList?.();
      app.renderEditor?.();
    }

    emit('changed');

    return {
      movedTo: target
    };
  }

  function lock({ preserveNavigation = false } = {}) {
    if (!unlocked)
      return;

    unlocked = false;

    if (
      hasApp() &&
      !preserveNavigation
    ) {
      const ids =
        lockedIds();

      const note =
        app.getActiveNote?.();

      if (
        ids.has(
          String(
            app.activeFolderId
          )
        ) ||
        (
          note &&
          ids.has(
            String(
              note.folder_id
            )
          )
        )
      ) {
        app.activeNoteId = null;
        app.activeFolderId =
          'all';
      }

      app.renderFolders?.();
      app.renderNotesList?.();
      app.renderEditor?.();
    }

    emit('locked');
    notify(
      'Locked Folder',
      'Locked',
      'success'
    );
  }

  async function promptUnlock() {
    if (unlocked)
      return true;

    if (!cfg)
      await init();

    if (!cfg?.enabled)
      return true;

    const bio =
      cfg.biometric &&
      cfg.credId;

    const r =
      await askPin({
        title: 'Enter PIN',
        length: cfg.pinLength,

        bio:
          bio
            ? biometricAuth
            : null,

        autoBio:
          !!bio,

        check:
          async p => {
            const v =
              await verifyPin(p);

            return v.ok
              ? null
              : v.message;
          }
      });

    if (r) {
      unlocked = true;
      emit('unlocked');
      notify(
        'Locked Folder',
        'Unlocked',
        'success'
      );
    }

    return !!r;
  }

  /* ---------- UI bridge ---------- */

  /*
     Authentication stays here.
     Presentation lives in locked-folder-ui.js.

     If the UI layer hasn't loaded yet, this fallback
     prevents the engine from completely breaking.
  */

  function askPin(options) {
    if (
      window.LockedFolderUI?.askPin
    ) {
      return window.LockedFolderUI.askPin(
        options
      );
    }

    return new Promise(
      resolve => {
        const pin =
          window.prompt(
            options?.title ||
              'Enter PIN',
            ''
          );

        if (pin == null) {
          resolve(null);
          return;
        }

        Promise.resolve(
          options?.check
            ? options.check(pin)
            : null
        )
          .then(error => {
            resolve(
              error
                ? null
                : pin
            );
          })
          .catch(() => {
            resolve(null);
          });
      }
    );
  }

  /* ---------- Ready-made flows for settings.js ---------- */

  const guard =
    async fn => {
      try {
        return await fn();
      } catch (e) {
        notify(
          'Locked Folder',
          e.message ||
            String(e),
          'error'
        );

        return false;
      }
    };

  async function newPinFlow(
    length
  ) {
    const p1 =
      await askPin({
        title: 'Create PIN',
        length
      });

    if (!p1)
      return null;

    const p2 =
      await askPin({
        title:
          'Confirm PIN',
        length,

        check:
          async p =>
            p === p1
              ? null
              : 'PINs do not match'
      });

    return p2 || null;
  }

  const ui = {
    enable:
      ({
        length = 4,
        biometric = false
      } = {}) =>
        guard(
          async () => {
            const p =
              await newPinFlow(
                length
              );

            if (!p)
              return false;

            await setup(
              p,
              {
                biometric
              }
            );

            notify(
              'Locked Folder',
              'Enabled',
              'success'
            );

            return true;
          }
        ),

    changePin:
      ({ length } = {}) =>
        guard(
          async () => {
            const old =
              await askPin({
                title:
                  'Current PIN',
                length:
                  cfg.pinLength,

                check:
                  async p => {
                    const v =
                      await verifyPin(
                        p
                      );

                    return v.ok
                      ? null
                      : v.message;
                  }
              });

            if (!old)
              return false;

            const n =
              await newPinFlow(
                length ||
                  cfg.pinLength
              );

            if (!n)
              return false;

            await changePin(
              old,
              n
            );

            notify(
              'Locked Folder',
              'PIN changed',
              'success'
            );

            return true;
          }
        ),

    disable:
      () =>
        guard(
          async () => {
            const pin =
              await askPin({
                title:
                  'Enter PIN to disable',
                length:
                  cfg.pinLength,

                check:
                  async p => {
                    const v =
                      await verifyPin(
                        p
                      );

                    return v.ok
                      ? null
                      : v.message;
                  }
              });

            if (!pin)
              return false;

            await disable(
              pin
            );

            notify(
              'Locked Folder',
              'Disabled',
              'success'
            );

            return true;
          }
        ),

    setBiometric:
      on =>
        guard(
          async () => {
            const pin =
              await askPin({
                title:
                  'Enter PIN',
                length:
                  cfg.pinLength,

                check:
                  async p => {
                    const v =
                      await verifyPin(
                        p
                      );

                    return v.ok
                      ? null
                      : v.message;
                  }
              });

            if (!pin)
              return false;

            return await setBiometric(
              on,
              pin
            );
          }
        )
  };

  /* ---------- Patch app.js behaviour ---------- */

  function patchApp() {
    if (
      !hasApp() ||
      app.__lfPatched
    ) {
      return;
    }

    app.__lfPatched = true;

    const origSet =
      app.setActiveFolder;

    const origGoToMobileView =
      app.goToMobileView;

    const origHandleResize =
      app.handleResize;

    const origList =
      app.getNotesToDisplay;

    app.setActiveFolder =
      async function (
        id,
        ...rest
      ) {
        const currentFolder =
          (
            this.folders ||
            []
          ).find(
            folder =>
              String(folder.id) ===
              String(this.activeFolderId)
          );

        const f =
          (
            this.folders ||
            []
          ).find(
            x =>
              String(x.id) ===
              String(id)
          );

        if (
          unlocked &&
          currentFolder?.is_locked &&
          String(this.activeFolderId) !== String(id)
        ) {
          lock({
            preserveNavigation: true
          });
        }

        if (
          f?.is_locked &&
          cfg?.enabled !== false &&
          !unlocked &&
          !(
            await promptUnlock()
          )
        ) {
          return;
        }

        if (
          f &&
          !f.is_locked &&
          uid
        ) {
          localStorage.setItem(
            LAST_KEY + uid,
            f.id
          );
        }

        return origSet.call(
          this,
          id,
          ...rest
        );
      };

    if (typeof origGoToMobileView === 'function') {
      app.goToMobileView = function (view, ...rest) {
        const currentFolder =
          (this.folders || []).find(
            folder =>
              String(folder.id) ===
              String(this.activeFolderId)
          );

        if (
          unlocked &&
          this.ui?.isMobile &&
          this.ui.mobileView === 'notes' &&
          view === 'folders' &&
          currentFolder?.is_locked
        ) {
          lock();
        }

        return origGoToMobileView.call(
          this,
          view,
          ...rest
        );
      };
    }

    if (typeof origHandleResize === 'function') {
      app.handleResize = function (...args) {
        const switchingToMobile =
          !this.ui?.isMobile &&
          window.innerWidth <= 1024;

        const currentFolder =
          (this.folders || []).find(
            folder =>
              String(folder.id) ===
              String(this.activeFolderId)
          );

        if (
          switchingToMobile &&
          unlocked &&
          currentFolder?.is_locked
        ) {
          lock();
        }

        return origHandleResize.apply(this, args);
      };
    }

    app.getNotesToDisplay =
      function (...a) {
        const r =
          origList.apply(
            this,
            a
          );

        if (unlocked)
          return r;

        const ids =
          lockedIds();

        return ids.size
          ? r.filter(
              n =>
                !ids.has(
                  String(
                    n.folder_id
                  )
                )
            )
          : r;
      };
  }

  /* ---------- Auto lock ---------- */

  document.addEventListener(
    'visibilitychange',
    () => {
      clearTimeout(
        hideTimer
      );

      if (
        document.visibilityState ===
        'hidden'
      ) {
        hideTimer =
          setTimeout(
            lock,
            AUTOLOCK_MS
          );
      }
    }
  );

  window.addEventListener(
    'pagehide',
    () => lock()
  );

  /* ---------- Public API ---------- */

  window.LockedFolder = {
    configure:
      o => {
        override = o || {};
        uid = null;
      },

    init,

    isEnabled:
      () => !!cfg?.enabled,

    isUnlocked:
      () => unlocked,

    getConfig:
      () =>
        cfg
          ? {
              enabled:
                cfg.enabled,
              pinLength:
                cfg.pinLength,
              biometric:
                !!cfg.biometric
            }
          : null,

    biometricAvailable,

    setup,
    changePin,
    setBiometric,
    disable,
    verifyPin,

    lock,
    promptUnlock,
    askPin,

    ui
  };

  patchApp();

  window.addEventListener(
    'load',
    () =>
      init().catch(
        () => {}
      )
  );
})();