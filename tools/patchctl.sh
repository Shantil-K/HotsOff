#!/bin/sh
DIR="$(dirname "$0")"
. "$DIR/lib/common.sh"
. "$DIR/lib/patch.sh"

require_root

SERVICESTATE="unknown"
setServiceState() {
  if is_patched; then
    SERVICESTATE="running"
  elif [ "${1:-}" = "start" ]; then
    SERVICESTATE="error"
  else
    SERVICESTATE="stopped"
  fi
}

AUTOSTART_ENABLED="false"
setAutostartState() {
  if [ -e "/var/lib/webosbrew/init.d/$AUTOSTART_ENTRY" ]; then
    AUTOSTART_ENABLED="true"
  else
    AUTOSTART_ENABLED="false"
  fi
}

printState() {
  echo -n "{\"state\":{\"autostart\":${AUTOSTART_ENABLED:-false},\"logs\":\"$(base64 < "$LOG" | tr -d '\n')\", \"service\":\"$SERVICESTATE\"}}"
}

case "$1" in
  start)
    : > "$LOG"
    do_patch
    ;;
  stop)
    : > "$LOG"
    do_unpatch
    ;;
  status)
    : > "$LOG"
    patch_status_log
    ;;
  autostart_toggle)
    : > "$LOG"
    setAutostartState
    if [ "$AUTOSTART_ENABLED" = "true" ]; then
      rm -f "/var/lib/webosbrew/init.d/$AUTOSTART_ENTRY" >>"$LOG" 2>&1 && log "Removed Autostart"
    else
      mkdir -p /var/lib/webosbrew/init.d && ln -sf "$AUTOSTART_SCRIPT" "/var/lib/webosbrew/init.d/$AUTOSTART_ENTRY" >>"$LOG" 2>&1 && log "Set Autostart"
    fi
    ;;
  *)
    : > "$LOG"
    log "usage: patchctl.sh start|stop|status|autostart_toggle"
    setServiceState
    setAutostartState
    printState
    exit 1
    ;;
esac

setServiceState "${1:-}"
setAutostartState
printState
exit 0
