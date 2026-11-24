#!/bin/sh
# Shared helpers for the lifecycle scripts. Sourced, not executed.
PKG="synbee"
PKGVAR="${SYNOPKG_PKGVAR:-/var/packages/$PKG/var}"
PKGDEST="${SYNOPKG_PKGDEST:-/var/packages/$PKG/target}"
CONFIG="$PKGVAR/config.env"
PIDFILE="$PKGVAR/supervisor.pid"
MQTT_PORT=18830

log_err() { echo "$1" > "${SYNOPKG_TEMP_LOGFILE:-/dev/stderr}"; }

valid_share() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'; }
valid_port() { printf '%s' "$1" | grep -Eq '^[0-9]{4,5}$' && [ "$1" -ge 1025 ] && [ "$1" -le 65535 ]; }
valid_coordinator() { [ -z "$1" ] || printf '%s' "$1" | grep -Eq '^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$'; }

# Succeeds if something is already listening on the TCP port.
port_in_use() {
    hex=$(printf '%04X' "$1")
    for f in /proc/net/tcp /proc/net/tcp6; do
        [ -r "$f" ] || continue
        if awk -v p=":$hex" 'NR > 1 && $4 == "0A" && substr($2, length($2) - 4) == p { found = 1 } END { exit !found }' "$f"; then
            return 0
        fi
    done
    return 1
}

load_config() {
    DATA_SHARE=$(sed -n 's/^DATA_SHARE=//p' "$CONFIG" 2>/dev/null | head -n 1)
    INTERNAL_PORT=$(sed -n 's/^INTERNAL_PORT=//p' "$CONFIG" 2>/dev/null | head -n 1)
    COORDINATOR=$(sed -n 's/^COORDINATOR=//p' "$CONFIG" 2>/dev/null | head -n 1)
    # Installs from before the app port was asked for have none, or an older PUBLIC_PORT: both mean the default.
    APP_PORT=$(sed -n 's/^APP_PORT=//p' "$CONFIG" 2>/dev/null | head -n 1)
    [ -n "$APP_PORT" ] || APP_PORT=$(sed -n 's/^PUBLIC_PORT=//p' "$CONFIG" 2>/dev/null | head -n 1)
    [ -n "$APP_PORT" ] || APP_PORT=8443
    valid_share "$DATA_SHARE" && valid_port "$INTERNAL_PORT" && valid_port "$APP_PORT" && valid_coordinator "$COORDINATOR"
}

data_dir() { printf '/var/packages/%s/shares/%s/%s' "$PKG" "$DATA_SHARE" "$PKG"; }

apply_ports() {
    sed -i "s/\"port\": \"[0-9]*\"/\"port\": \"$INTERNAL_PORT\"/" "$PKGDEST/ui/config"
    sed -e "s/@INTERNAL@/$INTERNAL_PORT/" -e "s/@APP@/$APP_PORT/" "$PKGDEST/synbee.sc.template" > "$PKGDEST/synbee.sc"
}

supervisor_running() {
    [ -r "$PIDFILE" ] || return 1
    pid=$(cat "$PIDFILE")
    printf '%s' "$pid" | grep -Eq '^[0-9]+$' || return 1
    [ -r "/proc/$pid/cmdline" ] || return 1
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "$PKGDEST/hub/supervisor/supervisor.mjs"
}

# The wizards' reset option: leaves a marker in the private secrets folder, which the hub reads at its next start.
request_password_reset() {
    # Written as a case so the package validator's secret check doesn't mistake the default for a value.
    case "${wizard_reset_password:-}" in
        true)
            mkdir -m 700 -p -- "$PKGVAR/secrets"
            : > "$PKGVAR/secrets/reset-admin-password"
            echo "The hub's admin password will be reset at the next start."
            ;;
    esac
}
