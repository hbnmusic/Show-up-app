# Releasing to Google Play

## One-time setup

1. **Create an upload keystore** on your own computer (not in the repo). Pick strong passwords and store them in a password manager.
   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **Back it up** (password manager or encrypted drive). With Play App Signing, Google holds the real app-signing key, and this is
   only the upload key; a lost upload key can be reset through Play support, but it is slow.
3. **Add four repository secrets** (GitHub → repo → Settings → Secrets and variables → Actions → New repository secret):
   - `ANDROID_KEYSTORE_BASE64`: the keystore, base64-encoded. `base64 -w0 upload-keystore.jks` on Linux, or `base64 -i upload-keystore.jks | tr -d '\n'` on macOS.
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`upload` if you used the command above)
   - `ANDROID_KEY_PASSWORD`
   Never commit the keystore (`.gitignore` blocks `*.jks`/`*.keystore`).
4. **Repository variables** `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Variables tab) must be set, same as for the sideload build.
5. In Play Console, create the app (package `com.hbnmusic.pullup`) and opt in to **Play App Signing** when uploading the first bundle.

## Each release

1. Actions → **Android release (Play AAB)** → Run workflow. Leave `version_code` blank to use the run number, or enter a number higher
   than every bundle you have uploaded.
2. When it finishes, download the artifact `pull-up-play-bundle-N` and upload the `.aab` in Play Console → Testing → Internal testing
   (then promote to production when ready).
3. Bump `expo.version` in `app.json` for user-visible versions.

The sideload APK workflow (`android-apk.yml`) is unchanged and still publishes `build-N` releases signed with the debug key.
Do not mix the two: an APK signed with the debug key cannot be updated by a Play install.

## Target API level

The generated project targets API 36 (`expo-build-properties` in `app.json`, checked in CI by `scripts/check-target-sdk.sh`).
Google's stated rule is that new apps and updates must target API 36 from 2026-08-31 [inference from search results]; raise
`MIN` in that script and the `targetSdkVersion` in `app.json` when Google raises the requirement.

## Placeholders to fill in before publishing

| Placeholder | Where | Meaning |
| --- | --- | --- |
| `[LEGAL_NAME]` | `docs/*.html` | The person or company operating the app |
| `[CONTACT_EMAIL]` | `docs/*.html`, `docs/play/store-listing.md` | Public contact for support, privacy and deletion requests |
| `[JURISDICTION]` | `docs/terms.html` | Governing law, for example "the State of New York, USA" |
| `[EFFECTIVE_DATE]` | `docs/privacy.html`, `docs/terms.html` | Date you publish |
| `[EMAIL_PROVIDER]` | `docs/privacy.html` | Who sends sign-in emails (Supabase built-in or your SMTP provider) |
| `[BACKUP_RETENTION_DAYS]` | `docs/delete-account.html` | Your Supabase plan's backup retention |
| `support@example.com` | `src/lib/legal.ts` (`SUPPORT_EMAIL`) | Same address as `[CONTACT_EMAIL]` |

Search with `grep -rn "\[[A-Z_]*\]" docs src/lib/legal.ts` to find any left.
Also check `DOCS_URL` in `src/lib/legal.ts` matches your GitHub Pages address.

## Closed testing requirement

Google's rule for newly created personal developer accounts is a closed test with at least 12 testers for 14 days before applying
for production access [inference from training data; check the current rule in Play Console].
