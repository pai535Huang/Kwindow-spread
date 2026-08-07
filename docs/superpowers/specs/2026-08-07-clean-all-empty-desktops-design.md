# Clean All Empty Desktops Design

## Goal

Prevent unexpected empty virtual desktops from disrupting Kwindow-spread's
placement logic. Whenever the script observes a window being created, moved to
another virtual desktop, or closed, it will remove every empty virtual desktop
rather than considering only the desktop directly involved in that event.

The existing `RemoveEmptyVirtualDesktops` setting remains authoritative. When
it is disabled, none of these events will remove virtual desktops.

## Event handling

The script will request a full cleanup from all window lifecycle paths:

- `windowAdded` or the legacy `clientAdded` fallback;
- a tracked window's `desktopsChanged` or `desktopChanged` signal; and
- `windowRemoved`, `clientRemoved`, or the tracked window's `closed` signal.

These paths will share one scheduled cleanup operation. Repeated requests made
before its timer fires will be coalesced, so one KWin action cannot cause
several redundant scans or removal attempts. Cleanup remains delayed briefly so
KWin can finish updating its window and desktop state before the script reads
it.

New-window placement keeps its existing 500 ms delay. The cleanup request made
for a new window runs first, allowing the later placement decision to operate
on the compacted desktop list. A desktop-change signal emitted by the script's
own placement is handled safely by the same idempotent cleanup path.

## Full cleanup algorithm

At execution time, the cleanup operation refreshes configuration and reads a
fresh snapshot of all desktops and windows. A desktop is occupied only when it
contains a window that passes the existing normal-window filter. Dialogs,
panels, transient windows, and other excluded window types do not keep a
desktop alive; this preserves the script's current definition of an empty
desktop.

The operation builds a snapshot of all currently empty desktops and removes
each eligible desktop. Before every removal, it confirms that the desktop still
exists and still has no normal window. This protects against window state
changing between the initial scan and an individual removal call.

If at least one normal window exists and the active desktop is empty, the
script activates a non-empty desktop before removing the active one. When a
focused window has just closed, the existing most-recently-used focus recovery
remains the first choice. Otherwise, the nearest non-empty desktop is selected
using the existing left-first proximity rule.

If no normal windows exist anywhere, the current desktop is retained and all
other empty desktops are removed. If the current desktop is not present in the
desktop snapshot, the first desktop is retained instead. The script never
attempts to remove every virtual desktop.

All removal calls continue through the existing guarded `removeDesktop()`
adapter. Unsupported KWin versions and synchronous removal errors retain the
existing behavior: skip unsupported operations and log errors without stopping
other window handling.

## State and compatibility

The current per-window desktop tracking remains necessary for compatibility
and focus bookkeeping, but cleanup correctness no longer depends on a single
remembered desktop. Both modern `desktopsChanged` and legacy `desktopChanged`
signals are supported. If a KWin window exposes both signals for the same move,
timer coalescing reduces them to one cleanup.

No configuration keys, settings UI fields, matching rules, placement rules, or
desktop-creation behavior change. The existing script-only configuration
refresh request also remains unchanged.

## Testing

Automated tests will prove that:

- a window-created event removes all pre-existing empty desktops before
  delayed placement;
- moving a tracked window removes every empty desktop, including unrelated
  pre-existing empty desktops;
- closing a window removes every empty desktop rather than only its former
  desktop;
- repeated desktop-change signals coalesce into one scheduled cleanup;
- disabling `RemoveEmptyVirtualDesktops` prevents removal for all three event
  types;
- when no normal windows remain, the current desktop is retained and all other
  desktops are removed;
- active-desktop switching and previous-focus restoration still occur safely;
  and
- existing placement, grouping, configuration-refresh, and compatibility tests
  continue to pass.

Final verification will run the complete Node test suite, JavaScript syntax
validation, XML parsing, and whitespace checks.
