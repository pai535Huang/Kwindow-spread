# Kwindow-spread

Kwindow-spread is a KWin script that automatically places new application windows on separate virtual desktops. Supports KDE Plasma 6 on Wayland.

## How it works

- Always maintains one trailing empty virtual desktop at the end of the desktop list.
- Moves ordinary new application windows there, then creates the next empty desktop.
- Leaves dialogs, transient windows, file pickers, and portal windows on their original desktop.
- Applies placement rules in this order: auxiliary windows, source-desktop applications, same-desktop groups, then ordinary spreading.
- Can preserve the current focus and remove extra empty desktops without removing the trailing spare.

## Install

```sh
kpackagetool6 --type KWin/Script --install .
```

Enable **Kwindow-spread** in **System Settings → Window Management → KWin Scripts**.

## Configuration

Open the script's configuration dialog from the KWin Scripts page.

| Setting | Default | Description |
| --- | --- | --- |
| Keep focus on the current window | Off | Prevents a newly opened window from taking focus. |
| Remove extra empty virtual desktops | On | Removes redundant empty desktops while retaining one trailing spare. |
| Windows that stay together | Empty | Places matching applications on the same desktop. |
| Applications that stay on their original desktop | Empty | Excludes matching applications from automatic spreading. |

Rules are case-insensitive and support `*` for any sequence of characters and `?` for one character.

### Same-desktop groups

Enter one group per line and separate applications or aliases with commas:

```text
wechat, WeChat
qq
virt-manager
*preview*
```

Patterns match the app ID, resource class, resource name, and window title.

### Source-desktop applications

Enter one application pattern per line:

```text
spectacle
org.kde.spectacle
```

Patterns match the app ID, resource class, and resource name, including XWayland `WM_CLASS`. Window titles are not matched.

Configuration changes take effect for subsequent window and desktop events after selecting **Apply**. No script reload is required.

## Update and uninstall

Update the installed package:

```sh
kpackagetool6 --type KWin/Script --upgrade .
```

After updating, reload the script: disable it and select **Apply**, then enable it and select **Apply** again.

To uninstall, disable the script first, then run:

```sh
kpackagetool6 --type KWin/Script --remove kwindow-spread
```

## Development

Run the automated tests and static checks:

```sh
npm test
node --check contents/code/main.js
xmllint --noout contents/config/main.xml contents/ui/config.ui
```
