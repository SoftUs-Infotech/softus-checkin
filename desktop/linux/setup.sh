#!/bin/sh
# One-time setup of a Linux computer for Softus Checkin. Run as root — the app
# runs it through pkexec, which asks for the administrator password; IT can run
# it directly:
#
#   sudo sh setup.sh install <helper binary> [service file]
#   sudo sh setup.sh uninstall
#   sh setup.sh status
#
# What "install" does:
#   1. Installs the activity helper (counts key presses and clicks from the
#      kernel; never which keys) as a system service.
#   2. Installs what screenshots need on a Wayland desktop: GStreamer's
#      PipeWire plugin (GNOME, KDE) or grim (Sway, Hyprland, …).
set -eu
# (Steps are named do_*: a shell function called "install" would shadow the
# install(1) command used to copy files.)

PREFIX=/usr/local/libexec/softus-checkin
HELPER="$PREFIX/softus-checkin-helper"
UNIT=/etc/systemd/system/softus-checkin-helper.service
SOCKET=/run/softus-checkin/helper.sock

say() { printf '%s\n' "$*"; }

need_root() {
  if [ "$(id -u)" != 0 ]; then
    say "Run this as the administrator (sudo or pkexec)." >&2
    exit 1
  fi
}

install_packages() {
  # Screenshots on Wayland: GStreamer with its PipeWire plugin (GNOME, KDE…)
  # and grim (Sway, Hyprland…). One package at a time, so a name one
  # distribution does not have never stops the others. A failure here is
  # reported, not fatal: the helper is what cannot be done any other way.
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    manager="apt-get"
    packages="gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pipewire grim"
    add() { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$1" >/dev/null 2>&1; }
  elif command -v dnf >/dev/null 2>&1; then
    manager="dnf"
    packages="gstreamer1 gstreamer1-plugins-base gstreamer1-plugins-good pipewire-gstreamer grim"
    add() { dnf install -y -q "$1" >/dev/null 2>&1; }
  elif command -v zypper >/dev/null 2>&1; then
    manager="zypper"
    packages="gstreamer-utils gstreamer-plugins-base gstreamer-plugins-good gstreamer-plugin-pipewire grim"
    add() { zypper --non-interactive --quiet install "$1" >/dev/null 2>&1; }
  elif command -v pacman >/dev/null 2>&1; then
    manager="pacman"
    packages="gstreamer gst-plugins-base gst-plugins-good gst-plugin-pipewire grim"
    add() { pacman -S --needed --noconfirm "$1" >/dev/null 2>&1; }
  else
    say "WARNING: unknown package manager; install GStreamer's PipeWire plugin (and grim on Sway/Hyprland) by hand."
    return 0
  fi
  missing=""
  for package in $packages; do
    add "$package" || missing="$missing $package"
  done
  if [ -n "$missing" ]; then
    say "WARNING: $manager could not install:$missing"
  else
    say "Screenshot components installed ($manager)."
  fi
}

do_install() {
  need_root
  source_binary="$1"
  source_unit="${2:-$(dirname "$0")/softus-checkin-helper.service}"
  [ -f "$source_binary" ] || { say "Helper binary not found: $source_binary" >&2; exit 1; }
  [ -f "$source_unit" ] || { say "Service file not found: $source_unit" >&2; exit 1; }
  command -v systemctl >/dev/null 2>&1 || { say "This setup needs systemd." >&2; exit 1; }

  say "Installing the activity helper…"
  mkdir -p "$PREFIX"
  command install -m 0755 "$source_binary" "$HELPER.new"
  mv -f "$HELPER.new" "$HELPER"
  command install -D -m 0644 "$source_unit" "$UNIT"
  systemctl daemon-reload
  systemctl enable softus-checkin-helper.service >/dev/null 2>&1
  systemctl restart softus-checkin-helper.service

  say "Installing the screenshot components…"
  install_packages

  # Ready when the socket answers.
  i=0
  while [ ! -S "$SOCKET" ] && [ $i -lt 20 ]; do sleep 0.25; i=$((i + 1)); done
  if [ -S "$SOCKET" ]; then
    say "Done. Softus Checkin is set up on this computer."
  else
    say "The helper did not start. See: journalctl -u softus-checkin-helper" >&2
    exit 1
  fi
}

do_uninstall() {
  need_root
  systemctl disable --now softus-checkin-helper.service >/dev/null 2>&1 || true
  rm -f "$UNIT" "$HELPER"
  rmdir "$PREFIX" 2>/dev/null || true
  systemctl daemon-reload || true
  say "Softus Checkin helper removed."
}

do_status() {
  if [ -S "$SOCKET" ]; then say "helper: running"; else say "helper: not running"; fi
  "$HELPER" --version 2>/dev/null | sed 's/^/version: /' || true
}

case "${1:-}" in
  install) shift; do_install "$@" ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
  *) say "usage: setup.sh install <helper binary> [service file] | uninstall | status" >&2; exit 2 ;;
esac
