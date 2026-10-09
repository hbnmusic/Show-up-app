/**
 * Release signing for Play. Keeps the keystore out of the repo: when the environment variables below are set
 * (the release workflow sets them from GitHub secrets), the release build is signed with that key; otherwise the
 * build is unchanged and uses the debug key as before (the sideload APK workflow).
 *
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 *   ANDROID_VERSION_CODE   optional integer; overrides expo.android.versionCode
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// setnik-release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    // Add a release signing config next to the generated debug one.
    if (!/signingConfigs\s*\{/.test(gradle)) throw new Error('withReleaseSigning: signingConfigs block not found');
    gradle = gradle.replace(/signingConfigs\s*\{/, `signingConfigs {\n        release {\n            if (System.getenv('ANDROID_KEYSTORE_PATH')) {\n                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))\n                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n                keyAlias System.getenv('ANDROID_KEY_ALIAS')\n                keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n            }\n        }`);

    // The release build type uses it when the keystore is provided.
    const releaseBlock = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseBlock.test(gradle)) throw new Error('withReleaseSigning: release signingConfig line not found');
    gradle = gradle.replace(
      releaseBlock,
      `$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug`,
    );

    if (!/versionCode\s+\d+/.test(gradle)) throw new Error('withReleaseSigning: versionCode not found');
    gradle = gradle.replace(/versionCode\s+(\d+)/, `versionCode Integer.parseInt(System.getenv('ANDROID_VERSION_CODE') ?: '$1')`);

    gradle += `\n${MARKER}\n`;
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
