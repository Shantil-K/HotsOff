#!/bin/sh
BASE="/tmp/hotsoff"
LOG="$BASE/patcher.log"

mkdir -m 777 -p "$BASE"

log() {
  [ -f "$LOG" ] || : > "$LOG"
  echo "$(date +%H:%M:%S) $*" >> "$LOG"
}

die() {
  log "ERROR: $*"
  cat "$LOG"
  exit 1
}

APP_ID="com.hotsoff.patcher"
TARGET_APP_ID="hotstar"

PATCHER_BASE_DIR="/media/developer/apps/usr/palm/applications/$APP_ID"
PATCHER_RESOURCES_DIR="$PATCHER_BASE_DIR/resources/$TARGET_APP_ID"
TOOLS_DIR="$PATCHER_BASE_DIR/tools"
SCRIPTS_DIR="$TOOLS_DIR/lib"

# Store-installed apps live in cryptofs (writable as root). Some TVs ship
# Hotstar preinstalled in the read-only rootfs, those get a bind-mount overlay.
TARGET_DIR_STORE="/media/cryptofs/apps/usr/palm/applications/$TARGET_APP_ID"
TARGET_DIR_SYSTEM="/usr/palm/applications/$TARGET_APP_ID"
OVERLAY_DIR="/media/developer/hotsoff-overlay/$TARGET_APP_ID"

TARGET_DIR=""
TARGET_MODE=""
if [ -d "$TARGET_DIR_STORE" ]; then
  TARGET_DIR="$TARGET_DIR_STORE"
  TARGET_MODE="store"
elif [ -d "$TARGET_DIR_SYSTEM" ]; then
  TARGET_DIR="$TARGET_DIR_SYSTEM"
  TARGET_MODE="system"
fi

USERSCRIPT_SRC="$PATCHER_RESOURCES_DIR/webOSUserScripts/userScript.js"
USERSCRIPT_REL="webOSUserScripts/userScript.js"
HOSTS_SRC="$PATCHER_RESOURCES_DIR/config/hosts.block"
HOSTS_SYSTEM="/etc/hosts"
HOSTS_MARK_BEGIN="# >>> hotsoff >>>"
HOSTS_MARK_END="# <<< hotsoff <<<"

AUTOSTART_ENTRY="50-custom-hotsoff"
AUTOSTART_SCRIPT="$TOOLS_DIR/autostart.sh"

require_root() {
  if [ "$(id -u 2>/dev/null)" != "0" ]; then
    die "not root (must be run via hbchannel exec)"
  fi
}

require_target() {
  [ -n "$TARGET_DIR" ] || die "Hotstar app not installed (looked in $TARGET_DIR_STORE and $TARGET_DIR_SYSTEM)"
}

toast() {
  luna-send -n 1 -a "$APP_ID" luna://com.webos.notification/createToast \
    "{\"message\":\"$1\", \"iconUrl\":\"$PATCHER_BASE_DIR/hotsoff.png\", \"sourceId\":\"$APP_ID\"}" >/dev/null 2>&1
}

close_target_app() {
  luna-send -n 1 luna://com.webos.applicationManager/closeByAppId \
    "{\"id\":\"$TARGET_APP_ID\"}" >/dev/null 2>&1 && log "Closed running $TARGET_APP_ID app"
  return 0
}
