# Trailing Spare Desktop Design

## Goal

Make a newly opened application window appear directly on an already-existing
empty virtual desktop instead of showing it on the source desktop, waiting,
creating a desktop, and then moving it.

The script will adopt a dynamic-workspace model: while it is enabled, the last
virtual desktop is kept empty as the target for the next ordinary application
window. A window is assigned to that desktop synchronously from KWin's
`windowAdded` callback, before any fixed-delay timer runs. After the assignment,
the script appends the next empty desktop.

The implementation targets Plasma 6 on Wayland. It supports both native
Wayland windows and XWayland windows managed by that session. Plasma 5 and a
standalone KWin X11 session are outside the compatibility scope.

## KWin lifecycle constraint

A KWin script cannot select a desktop before a window object exists because
the earliest relevant scripting hook is `workspace.windowAdded`. On Plasma 6,
KWin emits that signal after it has managed the window and added it to the
workspace. The script can still make the placement visually direct: the target
desktop already exists, and the script changes `window.desktops`
synchronously from the signal handler, normally before the compositor paints
the next frame.

The design does not claim to move a client before it is mapped at the Wayland
or XWayland protocol level. Its success criterion is that no fixed 500 ms wait
or visible source-desktop appearance occurs in normal use.

## Desktop invariant

When desktop creation is available and the script is in a stable state, the
last virtual desktop has no normal managed window and is reserved for the next
ordinary application window.

"Empty" continues to use the script's existing definition: a desktop is
occupied only by a window accepted by `shouldTreatAsNormalWindow`. Panels,
menus, dialogs, transient windows, portal windows, and other excluded window
types do not consume the spare desktop.

The invariant is established in four situations:

- when the script starts or reloads;
- after a window is assigned to the current spare desktop;
- after a tracked window changes desktops or closes; and
- after a late identity correction finishes.

If the last desktop is occupied, the script appends one desktop. If it is
already empty, the script reuses it. If no normal windows exist, the current
desktop is retained as the sole required empty desktop.

The `CreateVirtualDesktops` setting will be removed from the configuration
schema and settings UI. Creating the trailing spare desktop is intrinsic to
the feature and is always attempted. A stale value left in a user's existing
KWin configuration is harmless and will no longer be read.

## Initialization

At startup the script will:

1. connect only the Plasma 6 workspace signals `windowAdded`, `windowRemoved`,
   and `windowActivated`;
2. track existing windows and seed focus history;
3. inspect the current desktop and window snapshots; and
4. synchronously ensure that an empty trailing desktop exists.

Legacy `clientAdded`, `clientRemoved`, `clientActivated`, the scalar
`window.desktop` property, and other Plasma 5 compatibility branches will be
removed. Desktop assignment will consistently use the Plasma 6 `desktops`
list.

## New-window placement

The `windowAdded` handler records the source desktop and previously active
window before making any assignment. It then refreshes configuration,
normalizes the window, and applies placement priorities in this order:

1. non-normal windows are ignored;
2. dialogs, transient windows, portal windows, and configured source-desktop
   applications remain on the captured source desktop;
3. windows matching a same-desktop group go to the desktop containing an
   existing group member; and
4. every other normal window goes to the existing trailing spare desktop.

If the source desktop is itself the spare desktop, the fourth case requires no
desktop change. In all cases, the script calls the invariant reconciler before
returning. When the spare has become occupied, the reconciler appends a new
empty desktop immediately after the window assignment. This ordering means the
new window never waits for desktop creation, while the next `windowAdded`
event still has a spare available.

KWin delivers workspace signals serially in its event loop. Because each
handler restores the invariant before returning, multiple rapidly created
windows consume successive spare desktops instead of sharing one target.

Focus behavior remains controlled by `KeepCurrentFocus`. When disabled, the
script activates the selected desktop and new window. When enabled, it restores
the captured desktop and focus window after placement.

The fixed `WINDOW_CREATED_DELAY_MS`, delayed-placement timer, and
`pendingMoves` bookkeeping will be removed.

## Late identity correction

Window type information is normally complete when `windowAdded` fires, but an
application title, desktop file name, XWayland class, window role, or transient
relationship can change shortly afterward. Initial placement is never delayed
for these properties.

For each newly added normal window, the script creates a bounded placement
state containing:

- the source desktop and original focus window;
- the desktop selected by initial placement;
- the expected desktop used to distinguish script movement from user
  movement;
- whether a correction has already been applied; and
- a deadline one second after `windowAdded`.

During that interval it observes `captionChanged`, `desktopFileNameChanged`,
`windowClassChanged`, `windowRoleChanged`, and `transientChanged` when those
signals are available. Identity changes are coalesced until they have been
quiet for a short debounce interval, capped by the one-second deadline. The
script then recomputes the same placement priorities from fresh window and
desktop snapshots.

At most one corrective desktop assignment is performed. A correction can
return a late-identified source-desktop window to its captured source desktop
or move a late-identified group member to the group's existing desktop. If the
user focused another window in the meantime, correction changes placement only
and does not switch desktops or steal focus.

If `desktopsChanged` reports a desktop other than the script's expected
desktop during the settling interval, the move is treated as a user action and
automatic correction is cancelled. Signals caused by the script's own
assignment match the expected desktop and do not cancel or duplicate work.

The placement state, debounce timer, deadline timer, and signal connections are
released when correction settles or the window closes.

## Empty-desktop reconciliation

`RemoveEmptyVirtualDesktops` remains the only desktop-lifecycle setting.

When it is enabled, reconciliation removes every empty desktop except the one
trailing spare. Before each removal, the script confirms that the desktop still
exists and is still empty. If an active empty desktop must be removed, the
existing focus policy remains in effect: prefer the previous focused window,
otherwise activate the nearest occupied desktop. If no normal window exists,
retain the current desktop and remove the other empty desktops, making the
retained desktop the sole spare.

When automatic removal is disabled, reconciliation never removes a user's
existing empty desktops. It still ensures that the final desktop is empty,
appending one when the final desktop is occupied. This can leave additional
empty desktops in the middle by explicit user choice.

Reconciliation requests caused by add, move, correction, and close events are
debounced. The immediate post-placement append is not delayed: it is required
to make the spare available to the next window before the current event
handler returns. Later removal of redundant empty desktops can remain delayed
briefly so KWin can finish propagating desktop changes.

## Failure handling

If `workspace.createDesktop()` is absent, throws, or cannot create another
desktop, the script logs the failure once for that reconciliation attempt and
continues. If no trailing spare is available for a new ordinary window, it
tries one synchronous repair. If repair still fails, it falls back to the last
existing desktop, or the captured source desktop when no last desktop is
available. It does not retry in a loop or interrupt handling of other windows.

Before assigning or removing a desktop, the script checks that the object is
still present in `workspace.desktops`. A target that disappears is recomputed
once from a fresh snapshot. Removal failures are logged and do not prevent
other eligible empty desktops from being processed.

A window that closes during its identity-settling interval has its correction
state cancelled before cleanup. All event handlers remain idempotent so that
script-generated `desktopsChanged` signals cannot create a desktop creation or
removal loop.

## Configuration and documentation changes

The following user-facing changes are part of the implementation:

- remove `CreateVirtualDesktops` from `contents/config/main.xml`;
- remove its checkbox from `contents/ui/config.ui`;
- remove the corresponding runtime configuration field and branches;
- describe the permanent trailing-spare behavior in the README;
- update empty-desktop cleanup wording to state that one trailing empty
  desktop is retained; and
- document that Plasma 6 Wayland, including XWayland clients, is the supported
  environment.

The application grouping, source-desktop application rules,
`KeepCurrentFocus`, and `RemoveEmptyVirtualDesktops` settings remain.

## Automated testing

Tests will assert event timing as well as final state:

- startup appends a spare only when the final desktop is occupied;
- startup reuses an existing final empty desktop;
- with no normal windows, the current desktop is the only required spare;
- immediately after `windowAdded`, without firing a timer, an ordinary window
  is already assigned to the previous spare and a new trailing spare exists;
- a window launched while the current desktop is the spare stays there and
  causes a new spare to be appended;
- rapidly added windows consume successive spare desktops;
- dialogs, transient windows, portal windows, and configured source-desktop
  applications do not consume the spare;
- same-group windows use the existing group desktop;
- late class, app ID, title, role, and transient changes produce the correct
  single correction;
- repeated identity signals coalesce and correction never moves a window more
  than once;
- late correction does not steal focus after the user activates another
  window;
- a user desktop move cancels pending correction, while the script's own
  desktop signal does not;
- closing a settling window cancels its timers and state;
- cleanup removes intermediate empty desktops and leaves one final spare;
- disabling automatic cleanup preserves existing empty desktops while still
  ensuring a final spare;
- desktop creation and removal failures use their documented fallbacks without
  loops; and
- the configuration schema and UI no longer expose
  `CreateVirtualDesktops`.

The KWin test harness will model Plasma 6 `Window` properties and identity
signals directly. Legacy Plasma 5 compatibility assertions will be deleted or
rewritten rather than preserved.

## Manual verification

On an actual Plasma 6 Wayland session, verify:

1. a native Wayland application such as Konsole appears directly on the
   existing trailing spare desktop;
2. an XWayland application follows the same path;
3. several rapidly launched windows occupy successive desktops;
4. file choosers, portal dialogs, and transient dialogs remain with their
   source window;
5. late grouping and source-desktop rules correct at most once without taking
   focus back from the user;
6. closing and manually moving windows leaves the expected single trailing
   spare when cleanup is enabled; and
7. Overview and desktop-switch animations show neither a 500 ms source-desktop
   flash nor unnecessary create-then-move behavior.

Final repository verification will run the complete Node test suite,
JavaScript syntax validation, XML parsing, and Git whitespace checks.
