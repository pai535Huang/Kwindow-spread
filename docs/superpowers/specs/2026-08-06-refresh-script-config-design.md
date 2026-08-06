# Refresh Script Configuration Design

## Goal

Apply Kwindow-spread settings to the next window or desktop-cleanup decision
without requiring the user to disable and re-enable the script, while preserving
the title-bar menu fix.

## Root cause

The generic settings module writes the new values to the script's group in
`kwinrc`, but the running KWin script can continue reading the old in-memory
KConfig data. Calling `readConfig()` again does not itself reparse `kwinrc`.
Disabling and re-enabling the script reconstructs that state, which explains why
the saved settings become effective afterward.

The former workaround called the global `/KWin` `reconfigure` method on every
window lifecycle event. That refreshes configuration, but it also makes KWin
discard the title-bar user-actions menu. Restoring that call would regress the
menu-closing bug.

## Change

Add a narrowly scoped helper that asynchronously calls the KWin scripting
manager's `start` method:

- service: `org.kde.KWin`
- path: `/Scripting`
- interface: `org.kde.kwin.Scripting`
- method: `start`

Request this script-only refresh when a window is added and when a tracked
window is removed. Keep the existing delayed processing: placement occurs after
500 ms and empty-desktop cleanup after 300 ms. The scripting manager reparses
KWin configuration before those timers call the existing `refreshConfig()`, so
the placement and cleanup code read the newly saved values.

If issuing the D-Bus request throws synchronously, log the failure and continue
with the existing delayed behavior. Do not reload or unload the script, and do
not call the global `/KWin` `reconfigure` method.

No matching rules, focus behavior, desktop creation/removal behavior,
configuration keys, delays, or settings UI will change.

## Regression testing

Extend the current lifecycle regression coverage to assert the exact D-Bus
requests:

1. Adding a window requests `org.kde.kwin.Scripting.start` through
   `/Scripting`.
2. Removing a tracked window makes the same request.
3. Neither lifecycle event calls `/KWin` or the global `reconfigure` method.
4. The existing internal-popup test continues to prove that opening and closing
   a title-bar menu cannot trigger global KWin reconfiguration.
5. Existing configuration-reading, delayed placement, matching, focus, and
   desktop-cleanup tests remain unchanged and pass.

Final verification will run the complete Node test suite, JavaScript syntax
validation, XML parsing, and whitespace checks.

## Compatibility

The design uses the existing KWin scripting D-Bus interface and the script's
existing delays. It supports both the modern `windowAdded`/`windowRemoved`
signals and the legacy client-signal fallbacks already handled by the script.
No stored configuration migration is required.
