#!/bin/sh
# Run at boot by Homebrew Channel (/var/lib/webosbrew/init.d).
# Re-applies the patch: Hotstar app updates replace the app folder, and the
# overlay mount for preinstalled Hotstar does not survive a reboot.
DIR="$(dirname "$(readlink -f "$0")")"
"$DIR/patchctl.sh" start >/dev/null 2>&1
exit 0
