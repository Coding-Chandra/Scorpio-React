const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_GEN = path.join(ROOT, 'src-tauri', 'gen', 'android');
const RES_GEN = path.join(ANDROID_GEN, 'app', 'src', 'main', 'res');
const MANIFEST_PATH = path.join(ANDROID_GEN, 'app', 'src', 'main', 'AndroidManifest.xml');
const BUILD_GRADLE_KTS = path.join(ANDROID_GEN, 'app', 'build.gradle.kts');

const ICONS_SRC = path.join(ROOT, 'src-tauri', 'icons', 'android');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function patchIcons() {
  console.log('[patch-android] Copying authentic app icons to gen/android/app/src/main/res ...');
  if (fs.existsSync(ICONS_SRC) && fs.existsSync(RES_GEN)) {
    for (const folder of fs.readdirSync(ICONS_SRC)) {
      if (folder.startsWith('mipmap') || folder.startsWith('drawable') || folder === 'values') {
        const srcFolder = path.join(ICONS_SRC, folder);
        const destFolder = path.join(RES_GEN, folder);
        copyDirRecursive(srcFolder, destFolder);
      }
    }
    console.log('[patch-android] ✓ App icons copied.');
  } else {
    console.warn('[patch-android] ! Icon directory not found:', { ICONS_SRC, RES_GEN });
  }

  // Clean any Theme.SplashScreen references if present in gen/android values
  if (fs.existsSync(RES_GEN)) {
    const valuesDirs = fs.readdirSync(RES_GEN).filter(d => d.startsWith('values'));
    for (const vDir of valuesDirs) {
      const fullDir = path.join(RES_GEN, vDir);
      for (const file of fs.readdirSync(fullDir)) {
        if (file.endsWith('.xml')) {
          const filePath = path.join(fullDir, file);
          let content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('Theme.SplashScreen') || content.includes('windowSplashScreenBackground')) {
            console.log(`[patch-android] Cleaning Theme.SplashScreen references from ${file}...`);
            content = content.replace(/<style[^>]*name="AppTheme\.NoActionBarLaunch"[^>]*>[\s\S]*?<\/style>/gi, '');
            content = content.replace(/parent="Theme\.SplashScreen"/gi, 'parent="Theme.Material3.DayNight.NoActionBar"');
            content = content.replace(/<item name="windowSplashScreen[^"]*">[^<]*<\/item>/gi, '');
            content = content.replace(/<item name="postSplashScreenTheme">[^<]*<\/item>/gi, '');
            fs.writeFileSync(filePath, content, 'utf8');
          }
        }
      }
    }
  }
}

function patchManifest() {
  console.log('[patch-android] Patching AndroidManifest.xml permissions ...');
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.warn('[patch-android] ! AndroidManifest.xml not found at', MANIFEST_PATH);
    return;
  }

  let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

  // Replace any legacy splashscreen theme references
  xml = xml.replace(/android:theme="@style\/AppTheme\.NoActionBarLaunch"/g, 'android:theme="@style/Theme.Material3.DayNight.NoActionBar"');

  const permissions = `
    <!-- Essential permissions for Camera, Photos, Biometrics, and Downloads -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
    <uses-permission android:name="android.permission.USE_FINGERPRINT" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
`;

  // Inject permissions if not already present
  if (!xml.includes('android.permission.CAMERA')) {
    xml = xml.replace('<application', permissions + '\n    <application');
  }

  // Add requestLegacyExternalStorage on application tag
  if (!xml.includes('android:requestLegacyExternalStorage')) {
    xml = xml.replace('<application', '<application\n        android:requestLegacyExternalStorage="true"');
  }

  fs.writeFileSync(MANIFEST_PATH, xml, 'utf8');
  console.log('[patch-android] ✓ AndroidManifest.xml patched.');
}

function patchGradle() {
  console.log('[patch-android] Patching build.gradle.kts for release signing and ABI splits ...');
  if (!fs.existsSync(BUILD_GRADLE_KTS)) {
    console.warn('[patch-android] ! build.gradle.kts not found at', BUILD_GRADLE_KTS);
    return;
  }

  let gradle = fs.readFileSync(BUILD_GRADLE_KTS, 'utf8');

  // Ensure release build signs with debug signingConfig when no release key is present
  if (gradle.includes('getByName("release") {') && !gradle.includes('signingConfigs.getByName("debug")')) {
    gradle = gradle.replace(
      'getByName("release") {',
      'getByName("release") {\n            signingConfig = signingConfigs.getByName("debug")'
    );
  }

  // Ensure splits configuration is added if not present
  if (!gradle.includes('splits {')) {
    const splitsBlock = `
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }
`;
    gradle = gradle.replace(/buildTypes\s*\{/, splitsBlock + '\n    buildTypes {');
  }

  fs.writeFileSync(BUILD_GRADLE_KTS, gradle, 'utf8');
  console.log('[patch-android] ✓ build.gradle.kts patched.');
}

function main() {
  patchIcons();
  patchManifest();
  patchGradle();
  console.log('[patch-android] All Android customizations successfully applied.');
}

main();
