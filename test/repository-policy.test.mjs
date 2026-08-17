import test from 'node:test';
import assert from 'node:assert/strict';
import { findForbiddenPaths } from '../scripts/check-repository-policy.mjs';

test('identifies known local tooling paths', () => {
  const forbidden = [
    'docs/superpowers/specs/design.md',
    '.agents/config.json',
    '.codex/config.toml',
    '.claude/settings.json',
    '.cursor/rules/project.mdc',
    '.opencode/config.json',
    '.gemini/settings.json',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
  ];

  assert.deepEqual(findForbiddenPaths([...forbidden, 'README.md']), forbidden);
});
