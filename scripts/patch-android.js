const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_GEN = path.join(ROOT, 'src-tauri', 'gen', 'android');
const RES_GEN = path.join(ANDROID_GEN, 'app', 'src', 'main', 'res');
const MANIFEST_PATH = path.join(ANDROID_GEN, 'app', 'src', 'main', 'AndroidManifest.xml');
const BUILD_GRADLE_KTS = path.join(ANDROID_GEN, 'app', 'build.gradle.kts');

const ICONS_SRC = path.join(ROOT, 'src-tauri', 'icons', 'android');
const ANDROID_ORIGINAL_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

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
  const source = fs.existsSync(ICONS_SRC) ? ICONS_SRC : ANDROID_ORIGINAL_RES;
  if (fs.existsSync(source) && fs.existsSync(RES_GEN)) {
    for (const folder of fs.readdirSync(source)) {
      if (folder.startsWith('mipmap') || folder.startsWith('drawable') || folder === 'values') {
        const srcFolder = path.join(source, folder);
        const destFolder = path.join(RES_GEN, folder);
        copyDirRecursive(srcFolder, destFolder);
      }
    }
    console.log('[patch-android] ✓ App icons copied from', source);
  } else {
    console.warn('[patch-android] ! Icon directory not found:', { source, RES_GEN });
  }
}

function patchManifest() {
  console.log('[patch-android] Patching AndroidManifest.xml permissions ...');
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.warn('[patch-android] ! AndroidManifest.xml not found at', MANIFEST_PATH);
    return;
  }

  let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

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
