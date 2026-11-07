#!/bin/sh
# Installs / removes the HotsOff user script inside the Hotstar app folder.

overlay_mounted() {
  grep -q " $TARGET_DIR_SYSTEM " /proc/mounts 2>/dev/null
}

# Directory we actually write into.
effective_dir() {
  if [ "$TARGET_MODE" = "system" ]; then
    echo "$OVERLAY_DIR"
  else
    echo "$TARGET_DIR"
  fi
}

prepare_overlay() {
  if overlay_mounted; then
    log "Overlay already mounted on $TARGET_DIR_SYSTEM"
    return 0
  fi
  log "Hotstar is a system app, creating bind-mount overlay"
  rm -rf "$OVERLAY_DIR" 2>/dev/null
  mkdir -p "$OVERLAY_DIR" || die "mkdir failed: $OVERLAY_DIR"
  cp -a "$TARGET_DIR_SYSTEM/." "$OVERLAY_DIR/" || die "copy to overlay failed"
}

mount_overlay() {
  overlay_mounted && return 0
  mount --bind "$OVERLAY_DIR" "$TARGET_DIR_SYSTEM" || die "bind mount failed"
  log "Mounted overlay on $TARGET_DIR_SYSTEM"
}

patch_userscript() {
  dir="$(effective_dir)"
  dst="$dir/$USERSCRIPT_REL"
  [ -f "$USERSCRIPT_SRC" ] || die "user script missing: $USERSCRIPT_SRC"
  mkdir -p "$dir/webOSUserScripts" || die "mkdir failed: $dir/webOSUserScripts"

  # Keep a foreign user script (e.g. from another mod) so unpatch can restore it.
  if [ -f "$dst" ] && ! grep -q "HotsOff user script" "$dst" 2>/dev/null; then
    [ -f "$dst.bak" ] || cp "$dst" "$dst.bak"
    log "Backed up existing user script"
  fi

  cat "$USERSCRIPT_SRC" > "$dst" || die "write failed: $dst"
  chmod 755 "$dir/webOSUserScripts" 2>/dev/null
  chmod 644 "$dst" 2>/dev/null
  log "Installed user script: $dst"
}

unpatch_userscript() {
  dir="$(effective_dir)"
  dst="$dir/$USERSCRIPT_REL"
  if [ -f "$dst.bak" ]; then
    cat "$dst.bak" > "$dst" && rm -f "$dst.bak"
    log "Restored previous user script"
  elif [ -f "$dst" ]; then
    rm -f "$dst"
    rmdir "$dir/webOSUserScripts" 2>/dev/null
    log "Removed user script"
  fi
}

is_patched() {
  [ -n "$TARGET_DIR" ] || return 1
  # Check through the real app path so a missing overlay mount reads as unpatched.
  cmp -s "$TARGET_DIR/$USERSCRIPT_REL" "$USERSCRIPT_SRC"
}

# ---- telemetry hosts block (best effort, /etc/hosts may be read-only) ----
patch_hosts() {
  [ -f "$HOSTS_SRC" ] || { log "No hosts block list, skipping"; return 0; }
  unpatch_hosts quiet
  {
    echo "$HOSTS_MARK_BEGIN"
    grep -v '^[[:space:]]*#' "$HOSTS_SRC" | grep -v '^[[:space:]]*$'
    echo "$HOSTS_MARK_END"
  } >> "$HOSTS_SYSTEM" 2>/dev/null && log "Blocked telemetry hosts" || log "Could not write $HOSTS_SYSTEM (skipped)"
}

unpatch_hosts() {
  [ -f "$HOSTS_SYSTEM" ] || return 0
  grep -qF "$HOSTS_MARK_BEGIN" "$HOSTS_SYSTEM" || return 0
  tmp="/tmp/hosts.hotsoff.$$"
  awk -v b="$HOSTS_MARK_BEGIN" -v e="$HOSTS_MARK_END" '
    $0 == b { skip=1; next }
    $0 == e { skip=0; next }
    !skip { print }
  ' "$HOSTS_SYSTEM" > "$tmp" && cat "$tmp" > "$HOSTS_SYSTEM"
  rm -f "$tmp"
  [ "${1:-}" = "quiet" ] || log "Removed telemetry hosts block"
}

do_patch() {
  require_root
  require_target
  log "patching target=$TARGET_DIR mode=$TARGET_MODE"
  [ "$TARGET_MODE" = "system" ] && prepare_overlay
  patch_userscript
  [ "$TARGET_MODE" = "system" ] && mount_overlay
  patch_hosts
  close_target_app
  if is_patched; then
    log "Successfully patched"
  else
    log "Patch verification FAILED"
  fi
}

do_unpatch() {
  require_root
  require_target
  log "unpatch started: target=$TARGET_DIR"
  if [ "$TARGET_MODE" = "system" ]; then
    if overlay_mounted; then
      umount "$TARGET_DIR_SYSTEM" && log "Unmounted overlay"
    fi
    rm -rf "$OVERLAY_DIR" 2>/dev/null
  else
    unpatch_userscript
  fi
  unpatch_hosts
  close_target_app
  log "Successfully unpatched"
}

patch_status_log() {
  log "---- PATCH INFO ----"
  log "target app: $TARGET_APP_ID"
  log "target dir: ${TARGET_DIR:-not found} (${TARGET_MODE:-n/a})"
  if [ -n "$TARGET_DIR" ]; then
    log "app version: $(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$TARGET_DIR/appinfo.json" 2>/dev/null)"
  fi
  [ "$TARGET_MODE" = "system" ] && { overlay_mounted && log "overlay: mounted" || log "overlay: not mounted"; }
  if is_patched; then
    log "user script: installed (current)"
  elif [ -n "$TARGET_DIR" ] && [ -f "$TARGET_DIR/$USERSCRIPT_REL" ]; then
    log "user script: present but different (other mod or old version)"
  else
    log "user script: not installed"
  fi
  if grep -qF "$HOSTS_MARK_BEGIN" "$HOSTS_SYSTEM" 2>/dev/null; then
    log "telemetry hosts block: active"
  else
    log "telemetry hosts block: inactive"
  fi
  log "--------"
}
