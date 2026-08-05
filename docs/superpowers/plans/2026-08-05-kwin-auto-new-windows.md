# Kwindow-spread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `Kwindow-spread`, a KDE Plasma KWin script that places newly created windows on KDE virtual desktops according to the behavior requested by the user.

**Architecture:** Put testable window-placement rules in `contents/code/rules.mjs`, then have `contents/code/main.js` adapt KWin window and desktop objects to those pure functions. Package metadata, KConfigXT settings, and a Qt Designer UI make the script installable and configurable through KWin.

**Tech Stack:** KWin JavaScript scripting API, KPackage metadata, KConfigXT XML, Qt Designer `.ui`, Node.js `node:test`.

---

### Task 1: Core Rule Tests

**Files:**
- Create: `package.json`
- Create: `test/rules.test.mjs`
- Create: `contents/code/rules.mjs`

- [x] **Step 1: Write failing tests**

Create `package.json` with `npm test`, and create `test/rules.test.mjs` covering:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  getPlacementDecision,
  shouldTreatAsNormalWindow,
} from '../contents/code/rules.mjs';

const desktop = index => ({ index, name: `Desktop ${index + 1}` });
const win = overrides => ({
  normalWindow: true,
  skipTaskbar: false,
  skipPager: false,
  onAllDesktops: false,
  transient: false,
  dialog: false,
  role: '',
  title: '',
  resourceClass: '',
  resourceName: '',
  appId: '',
  desktop: null,
  ...overrides,
});

test('leaves the first normal window on the source desktop', () => {
  const source = desktop(0);
  const decision = getPlacementDecision({
    window: win({ desktop: source, title: 'Terminal' }),
    desktops: [source],
    windows: [],
    sourceDesktop: source,
    rules: DEFAULT_RULES,
  });
  assert.equal(decision.kind, 'stay');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because `contents/code/rules.mjs` does not exist.

- [x] **Step 3: Write minimal implementation**

Create `contents/code/rules.mjs` exporting default rules, wildcard matching, normal-window filtering, and placement decisions.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test`

Expected: all `rules.test.mjs` tests pass.

### Task 2: KWin Script Adapter

**Files:**
- Create: `contents/code/main.js`

- [x] **Step 1: Implement adapter**

Create `contents/code/main.js` to:
- read KWin config values with `readConfig()`;
- track focus MRU through `workspace.windowActivated`;
- listen to `workspace.windowAdded` and delay placement;
- listen to `workspace.windowRemoved` and clean empty desktops;
- move windows through `window.desktops = [targetDesktop]`;
- activate windows and desktops through `workspace.activeWindow` and `workspace.currentDesktop`;
- create/delete virtual desktops when KWin exposes `workspace.createDesktop()` and `workspace.removeDesktop()`.

- [x] **Step 2: Static syntax check**

Run: `node --check contents/code/main.js`

Expected: PASS.

### Task 3: Package and Configuration UI

**Files:**
- Create: `metadata.json`
- Create: `contents/config/main.xml`
- Create: `contents/ui/config.ui`
- Create: `README.md`

- [x] **Step 1: Add package files**

Create a KWin script package with `X-Plasma-API=javascript`, `X-Plasma-MainScript=code/main.js`, KConfigXT entries for behavior/rule settings, and a Qt Designer form exposing those settings.

- [x] **Step 2: Add usage docs**

Document install, update, remove, and configuration commands for Plasma 6 and Plasma 5.

- [x] **Step 3: Verify files exist**

Run: `find . -maxdepth 4 -type f | sort`

Expected: package, config, source, tests, docs, and README are present.

### Task 4: Final Verification

**Files:**
- Verify all files

- [x] **Step 1: Run automated tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 2: Run syntax checks**

Run:

```bash
node --check contents/code/rules.mjs
node --check contents/code/main.js
```

Expected: PASS.

- [x] **Step 3: Note Git status**

Run: `git status --short`

Expected: This workspace is not a Git repository, so no commit is possible in this environment.
