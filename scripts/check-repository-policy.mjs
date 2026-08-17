import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const forbiddenPaths = [
  /^docs\/superpowers(?:\/|$)/,
  /^\.agents(?:\/|$)/,
  /^\.codex(?:\/|$)/,
  /^\.claude(?:\/|$)/,
  /^\.cursor(?:\/|$)/,
  /^\.opencode(?:\/|$)/,
  /^\.gemini(?:\/|$)/,
  /^AGENTS\.md$/i,
  /^CLAUDE\.md$/i,
  /^GEMINI\.md$/i,
  /^\.github\/copilot-instructions\.md$/i,
];

export function findForbiddenPaths(paths) {
  return paths.filter((path) =>
    forbiddenPaths.some((pattern) => pattern.test(path)));
}

function checkTrackedPaths() {
  const trackedPaths = readFileSync(0, 'utf8')
    .split('\0')
    .filter((path) => path && existsSync(path));
  const violations = findForbiddenPaths(trackedPaths);

  if (violations.length === 0)
    return;

  console.error('Forbidden tracked paths:');
  violations.forEach((path) => console.error('- ' + path));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkTrackedPaths();
