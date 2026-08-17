# Kwindow-spread

Kwindow-spread is a KDE Plasma 6 KWin script for Wayland sessions. It supports
both native Wayland and XWayland application windows. Plasma 5 and standalone
X11 sessions are outside its support scope.

By default, the script keeps a trailing empty virtual desktop ready for
ordinary new normal application windows. Dialogs, transient windows, portals,
configured source-desktop applications, and same-desktop groups follow the
exceptions described below. For a window on the default spreading path, the
target already exists when KWin reports it, so the window can be assigned
without a fixed 500 ms delay or a create-then-move flash on the current
desktop. The script then appends the next trailing spare.

## Behavior

- Always keeps one trailing empty virtual desktop ready. This is a built-in
  invariant and cannot be disabled.
- Places a new normal window on the existing trailing spare synchronously,
  then creates the next spare before handling another new window.
- Leaves dialogs, transient windows, file pickers, portal windows, and other
  auxiliary windows on their source desktop.
- Keeps configured source-desktop applications on their source desktop.
- Places configured same-desktop application groups with an existing member.
- Rechecks window identity through KWin events for about one second when a
  title, app ID, window role, transient relationship, or XWayland `WM_CLASS`
  arrives late. It applies at most one correction and does not override a
  manual desktop move or take focus back from the user.
- Optionally keeps focus on the current window when another window opens.

Placement rules are evaluated before ordinary spreading: auxiliary and portal
windows stay on the source desktop, configured source-desktop rules take
precedence over same-desktop groups, and a matching group uses the desktop of
an existing member. All other normal windows use the trailing spare.

When **Remove extra empty virtual desktops** is enabled, the script removes
redundant empty desktops while always retaining one trailing spare. Before it
removes an active empty desktop, it restores the previously focused normal
window or switches to the nearest occupied desktop. If no normal windows
remain, it retains the current desktop as the sole spare. When cleanup is
disabled, user-created extra empty desktops are preserved, but the script still
ensures that the final desktop is an empty spare.

## Install

From this repository:

```sh
kpackagetool6 --type KWin/Script --install .
```

Then enable **Kwindow-spread** in **System Settings → Window Management → KWin
Scripts**.

## Update

```sh
kpackagetool6 --type KWin/Script --upgrade .
```

To reload the script after an update, disable **Kwindow-spread** in the KWin
Scripts settings page and select **Apply**. Then enable it and select **Apply**
again.

## Remove

Disable the script, then remove its package:

```sh
kpackagetool6 --type KWin/Script --remove kwindow-spread
```

## Configure

Open the configuration dialog from the KWin Scripts settings page. Settings
are read when the script starts or reloads. After saving changes, disable
**Kwindow-spread** and select **Apply**. Then enable it and select **Apply**
again.

### Same-desktop groups

Use one group per line. English commas separate different applications that
belong to the same group. Matching is case-insensitive. `*` matches any
sequence of characters and `?` matches one character.

```text
wechat, WeChat
qq
virt-manager
*preview*
```

Each pattern is matched against KWin's app ID, resource class, resource name,
and window title. Applications matching patterns on the same line open on the
same virtual desktop.

### Source-desktop applications

Use one independent rule per line. Matching is case-insensitive, `*` matches
any sequence of characters, and `?` matches one character. Rules match the app
ID, resource class, and resource name, including XWayland `WM_CLASS`, but not
the window title.

```text
spectacle
org.kde.spectacle
```

Built-in handling for file pickers, dialogs, transient windows, and portal
windows remains active regardless of these rules.

## Test

```sh
npm test
node --check contents/code/main.js
xmllint --noout contents/config/main.xml contents/ui/config.ui
```
