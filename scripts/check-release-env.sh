#!/usr/bin/env bash
# Startup self-check for the Play bundle. Prints which build settings are present (names only, never values) and exits 1 with a plain
# message if the app would be built without its Supabase connection.
#
#   Run in CI:      the release workflow runs it first, with the repository variables passed in.
#   Run by hand:    SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> scripts/check-release-env.sh
#   Signing check:  add --signing (needs ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD in the
#                   environment; checks they exist and that the keystore opens with that password and alias).
#
# Without SUPABASE_URL and SUPABASE_ANON_KEY the app still installs but has no Community, flyer sharing, feedback, analytics, going counts,
# kill switches or first-party venue shows (it shows the JamBase feed only). That must never reach Play by accident.
set -uo pipefail

url="${EXPO_PUBLIC_SUPABASE_URL:-${SUPABASE_URL:-}}"
key="${EXPO_PUBLIC_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}"
fail=0
where="GitHub > Settings > Secrets and variables > Actions > Variables tab (repository variables, not secrets)"

line() { printf '%-22s %s\n' "$1" "$2"; }
bad() { echo "::error title=Release build settings::$1" 2>/dev/null; echo "PROBLEM: $1"; fail=1; }

echo "Build settings for the Play bundle"
if [ -z "$url" ]; then line "SUPABASE_URL" "MISSING"; bad "SUPABASE_URL is not set. The bundle would have no server connection. Add it as a repository variable ($where). Value: https://<project-ref>.supabase.co"
else
  line "SUPABASE_URL" "set ($(printf '%s' "$url" | sed -E 's#^(https?://[^/]+).*#\1#'))"
  case "$url" in https://*) ;; *) bad "SUPABASE_URL must start with https://";; esac
  if ! printf '%s' "$url" | grep -Eq '^https://[a-z0-9]{20}\.supabase\.co/?$'; then echo "NOTE: SUPABASE_URL does not look like https://<20-character ref>.supabase.co (fine only if you use a custom domain)"; fi
fi

if [ -z "$key" ]; then line "SUPABASE_ANON_KEY" "MISSING"; bad "SUPABASE_ANON_KEY is not set. Add the project's anon (public) key as a repository variable ($where)."
else
  line "SUPABASE_ANON_KEY" "set (${#key} characters)"
  case "$key" in
    sb_secret_*) bad "SUPABASE_ANON_KEY holds a SECRET key (sb_secret_...). Never ship that in an app. Use the anon or publishable key.";;
    sb_publishable_*) ;;
    eyJ*.*.*)
      payload=$(printf '%s' "$key" | cut -d. -f2 | tr '_-' '/+')
      while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="${payload}="; done
      if printf '%s' "$payload" | base64 -d 2>/dev/null | grep -q '"role":"service_role"'; then
        bad "SUPABASE_ANON_KEY is the service_role key. Never ship that in an app. Use the anon key."
      fi;;
    *) bad "SUPABASE_ANON_KEY does not look like a Supabase key (expected a JWT starting eyJ or sb_publishable_...).";;
  esac
fi

if [ "${1:-}" = "--signing" ]; then
  echo; echo "Play upload-key settings"
  for v in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
    if [ -z "${!v:-}" ]; then line "$v" "MISSING"; bad "$v is not set (repository secret). See docs/play/RELEASING.md."; else line "$v" "set"; fi
  done
  if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${ANDROID_KEY_ALIAS:-}" ]; then
    if command -v keytool >/dev/null 2>&1; then
      tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
      if printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$tmp" 2>/dev/null && keytool -list -keystore "$tmp" -storepass "$ANDROID_KEYSTORE_PASSWORD" -alias "$ANDROID_KEY_ALIAS" >/dev/null 2>&1; then
        line "keystore" "opens, alias found"
      else
        line "keystore" "DOES NOT OPEN"; bad "The keystore did not open with that password and alias (or the base64 is damaged). Re-create ANDROID_KEYSTORE_BASE64 (base64 -w0 upload.keystore) and re-check the password and alias."
      fi
    else
      line "keystore" "not checked (keytool not installed here)"
    fi
  fi
fi

echo
if [ "$fail" -ne 0 ]; then echo "RESULT: NOT READY. Fix the items marked PROBLEM and run again."; exit 1; fi
echo "RESULT: OK"
