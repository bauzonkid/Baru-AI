#!/usr/bin/env node
/**
 * Release script — bump version, build, publish to GitHub Releases, commit + tag, push.
 *
 * Why this exists: `npm version patch` doesn't auto-commit when run from a
 * sub-folder (here: electron/) because git's root is the parent. We do the
 * git ops ourselves at the repo root.
 *
 * Order:
 *   1. Verify working tree clean (at repo root).
 *   2. Auto-load GH_TOKEN from ../.env if not in process env.
 *   3. Bump version in electron/package.json (npm version --no-git-tag-version).
 *   4. Run `npm run publish` (vite build + python bundle + electron-builder
 *      --publish always). If this fails, revert the version bump and exit.
 *   5. Commit + tag at repo root.
 *   6. git push --follow-tags.
 *
 * Usage (from electron/):
 *   node scripts/release.mjs patch    # 0.1.0 -> 0.1.1
 *   node scripts/release.mjs minor    # 0.1.0 -> 0.2.0
 *   node scripts/release.mjs major    # 0.1.0 -> 1.0.0
 *
 * Or via npm:
 *   npm run release:patch
 *   npm run release:minor
 *   npm run release:major
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ELECTRON = resolve(__dirname, "..");
const REPO = resolve(ELECTRON, "..");

function die(msg) {
  console.error("\n[release] ERROR:", msg);
  process.exit(1);
}

function sh(cmd, cwd) {
  console.log(`\n[release] > ${cmd}${cwd ? `   (cwd=${cwd})` : ""}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function shCapture(cmd, cwd) {
  return execSync(cmd, { cwd }).toString().trim();
}

// ---- 0. Parse arg --------------------------------------------------------

const bumpType = process.argv[2];
if (!["patch", "minor", "major"].includes(bumpType)) {
  die(
    `Usage: node scripts/release.mjs <patch|minor|major>\n` +
      `Got: ${bumpType ?? "(nothing)"}`,
  );
}

// ---- 1. Working tree must be clean --------------------------------------

const status = shCapture("git status --porcelain", REPO);
if (status) {
  die(
    `Working tree dirty. Commit or stash changes first:\n${status}`,
  );
}

// ---- 2. Load .env so GH_TOKEN is available ------------------------------

const envPath = resolve(REPO, ".env");
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    // Don't override values already set in the shell.
    if (!process.env[k]) process.env[k] = v;
  }
}

if (!process.env.GH_TOKEN || !/^ghp_|^github_pat_/.test(process.env.GH_TOKEN)) {
  die(
    `GH_TOKEN missing or malformed. Add a real PAT to ${envPath}:\n` +
      `  GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n` +
      `Create one at https://github.com/settings/tokens (Classic, scope "repo").`,
  );
}

// ---- 3. Bump version (no git ops) ---------------------------------------

const pkgPath = resolve(ELECTRON, "package.json");
const before = JSON.parse(readFileSync(pkgPath, "utf8")).version;

sh(`npm version ${bumpType} --no-git-tag-version`, ELECTRON);

const after = JSON.parse(readFileSync(pkgPath, "utf8")).version;
const tag = `v${after}`;
console.log(`\n[release] Version bumped: ${before} -> ${after}`);

// Mirror version into baru_ai/__init__.py so the FastAPI ``/`` endpoint
// (and the UI's "v0.1.x" badge) match electron's version. Single source
// of truth across the Python + Electron halves.
const pyInitPath = resolve(REPO, "baru_ai", "__init__.py");
const pyInit = readFileSync(pyInitPath, "utf8");
const pyInitNew = pyInit.replace(
  /__version__\s*=\s*"[^"]*"/,
  `__version__ = "${after}"`,
);
if (pyInitNew === pyInit) {
  die(
    `Could not find __version__ assignment in ${pyInitPath}. ` +
      `Expected pattern: __version__ = "X.Y.Z"`,
  );
}
writeFileSync(pyInitPath, pyInitNew);
console.log(`[release] Updated ${pyInitPath}`);

// ---- 4. Build + publish. On failure, revert the version bump. -----------

try {
  sh("npm run publish", ELECTRON);
} catch {
  console.error(
    `\n[release] !! publish failed. Reverting version bump...`,
  );
  sh(
    "git checkout HEAD -- electron/package.json electron/package-lock.json baru_ai/__init__.py",
    REPO,
  );
  die("publish failed. package.json reverted. See output above for the underlying error.");
}

// ---- 5. Commit + tag at repo root ---------------------------------------

sh(
  "git add electron/package.json electron/package-lock.json baru_ai/__init__.py",
  REPO,
);
sh(`git commit -m "Release ${tag}"`, REPO);
sh(`git tag -a ${tag} -m "Release ${tag}"`, REPO);

// ---- 6. Push commit + tag to remote -------------------------------------

try {
  sh("git push --follow-tags", REPO);
} catch {
  console.error(
    `\n[release] !! git push failed. Local commit + tag created but not pushed.\n` +
      `   Run manually:  git push --follow-tags`,
  );
  process.exit(1);
}

console.log(
  `\n[release] ✅ Release ${tag} published to GitHub and pushed.\n` +
    `   https://github.com/bauzonkid/Baru-AI/releases/tag/${tag}\n`,
);
