# Kwindow-spread

Kwindow-spread is a KDE Plasma KWin script that moves newly created normal
application windows to the next virtual desktop after the last non-empty virtual
desktop.

## Behavior

- Leaves the first normal window on the current virtual desktop.
- Moves later normal app windows to the desktop after the last non-empty desktop.
- Creates the target virtual desktop when KWin exposes desktop creation support.
- Keeps dialog-like windows, file pickers, portal windows, and transient windows
  on the source desktop.
- Groups related applications by configurable patterns so they open on the same
  virtual desktop.
- Keeps configured applications on the source desktop.
- Optionally keeps focus on the current window when new windows open.
- When closing the focused window empties a virtual desktop, switches back to
  the previous focused window or the nearest non-empty desktop, then removes the
  empty desktop when supported.

## Install

From this repository:

```sh
kpackagetool6 --type KWin/Script --install .
```

On Plasma 5:

```sh
kpackagetool5 --type KWin/Script --install .
```

Then enable `Kwindow-spread` in:

```text
System Settings -> Window Management -> KWin Scripts
```

On Wayland, log out and log back in if KWin does not load the new script
immediately.

## Update

```sh
kpackagetool6 --type KWin/Script --upgrade .
```

Use `kpackagetool5` on Plasma 5.

## Remove

```sh
kpackagetool6 --type KWin/Script --remove kwindow-spread
```

Use `kpackagetool5` on Plasma 5.

## Configure

Open the configuration dialog from the KWin Scripts settings page.

Same-desktop groups use one group per line. English commas separate different
applications that belong to the same group. Matching is case-insensitive. `*`
matches any sequence of characters and `?` matches one character.

```text
wechat, WeChat
qq
virt-manager
*preview*
```

Each pattern in a group is matched against KWin's app identifier, resource
class, resource name, and window title. Applications matching patterns on the
same line open on the same virtual desktop.

Source-desktop applications use one independent rule per line. Matching is
case-insensitive, `*` matches any sequence of characters, and `?` matches one
character. Rules match the app identifier, resource class, and resource name
(including X11 `WM_CLASS`), but not the window title.

```text
spectacle
org.kde.spectacle
```

Built-in handling for file pickers, dialogs, and portal windows remains active.

## Test

```sh
npm test
node --check contents/code/main.js
```
