#!/usr/bin/env bash
# Fails the build when the generated Android project targets an API level below Google Play's requirement.
# Play requires new apps and updates to target API 36 (Android 16) from 2026-08-31. Raise MIN when Google raises it.
set -euo pipefail
MIN=36
file="android/gradle.properties"
target=$(grep -E '^android\.targetSdkVersion=' "$file" | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$target" ]; then echo "targetSdkVersion not found in $file"; exit 1; fi
if [ "$target" -lt "$MIN" ]; then echo "targetSdkVersion $target is below the Play requirement ($MIN)"; exit 1; fi
echo "targetSdkVersion $target (Play minimum $MIN)"
