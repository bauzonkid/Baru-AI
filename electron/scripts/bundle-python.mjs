#!/usr/bin/env node
/**
 * Bundle a self-contained Python environment for production.
 *
 * Downloads the official Windows embeddable Python distribution, enables
 * ``site.py`` (otherwise pip can't find third-party packages), bootstraps
 * pip, then installs Baru-Pixelle's runtime dependencies into
 * ``Lib/site-packages``.
 *
 * Output layout (relative to repo root):
 *
 *   electron/build/python/
 *   ├── python.exe                 ← entry point
 *   ├── python311.zip              ← stdlib (zipped)
 *   ├── python311._pth             ← edited to enable site
 *   ├── Lib/site-packages/         ← all third-party deps
 *   └── ...
 *
 * electron-builder later copies this whole tree into the installed app
 * under ``resources/python/`` via ``extraResources`` config in
 * ``package.json``. ``main/fastapi.ts`` then spawns ``resources/python/
 * python.exe -m uvicorn baru_api.main:app`` at runtime.
 *
 * Re-run this script whenever you bump Python version or change the dep
 * list. It's idempotent — if the python/ dir already exists it skips
 * download + extract; pass ``--clean`` to force a fresh build.
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Config -------------------------------------------------------------

const PYTHON_VERSION = "3.11.9";
const EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

// Keep this list in sync with ``pyproject.toml``'s ``[project] dependencies``.
const DEPS = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "pydantic>=2.0.0",
  "loguru>=0.7.0",
  "httpx>=0.28.1",
  "python-multipart>=0.0.12",
  "pyyaml>=6.0.0",
  "certifi>=2025.10.5",
  "openai>=2.6.0",
  "google-genai>=0.3.0",
  "edge-tts==7.2.7",
  "comfykit>=0.1.12",
  "ffmpeg-python>=0.2.0",
  "pillow>=10.0.0,<12",
  "playwright>=1.58.0",
  "beautifulsoup4>=4.14.2",
  "aiohttp>=3.10.0",
  "sse-starlette>=2.1.0",
];

// --- Paths --------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ELECTRON_DIR, "build");
const PY_DIR = path.join(BUILD_DIR, "python");
const ZIP_PATH = path.join(BUILD_DIR, "python-embed.zip");
const GET_PIP_PATH = path.join(BUILD_DIR, "get-pip.py");

// --- Helpers ------------------------------------------------------------

const FORCE_CLEAN = process.argv.includes("--clean");

function log(msg) {
  console.log(`[bundle-python] ${msg}`);
}

function powershell(script) {
  execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
    stdio: "inherit",
  });
}

function run(cmd, args, cwd = PY_DIR) {
  log(`exec: ${cmd} ${args.join(" ")}`);
  execSync(`"${cmd}" ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: "inherit",
    cwd,
  });
}

// --- Reusable per-env builder -------------------------------------------

/**
 * Build a single Python embedded environment in ``targetDir``.
 *
 * Self-contained copy of CPython 3.11 embed + pip + the given dependency
 * list.
 */
function buildEnv(targetDir, deps, sanityImport, label) {
  const pyExe = path.join(targetDir, "python.exe");
  const pthFile = path.join(targetDir, "python311._pth");
  const sitePackages = path.join(targetDir, "Lib", "site-packages");

  log(`[${label}] target: ${targetDir}`);

  if (!existsSync(pyExe)) {
    log(`[${label}] extracting embed to ${targetDir}`);
    powershell(
      `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${targetDir}' -Force`,
    );
  } else {
    log(`[${label}] python.exe present, skipping extract`);
  }

  // Rewrite _pth to enable site + project root + site-packages so any
  // subprocess the env spawns can import baru_api / baru_pixelle.
  if (existsSync(pthFile)) {
    log(`[${label}] rewriting python311._pth`);
    const fixed = [
      "python311.zip",
      ".",
      "..",
      "Lib\\site-packages",
      "",
      "# Uncomment to run site.main() automatically",
      "import site",
      "",
    ].join("\r\n");
    writeFileSync(pthFile, fixed, "utf8");
  } else {
    throw new Error(`[${label}] expected ${pthFile} after extract`);
  }

  if (!existsSync(path.join(sitePackages, "pip"))) {
    if (!existsSync(GET_PIP_PATH)) {
      log(`[${label}] downloading get-pip.py`);
      powershell(
        `Invoke-WebRequest -Uri '${GET_PIP_URL}' -OutFile '${GET_PIP_PATH}' -UseBasicParsing`,
      );
    }
    log(`[${label}] bootstrapping pip`);
    run(pyExe, [GET_PIP_PATH, "--no-warn-script-location"], targetDir);
  } else {
    log(`[${label}] pip already installed`);
  }

  log(`[${label}] pip install ${deps.length} packages...`);
  run(
    pyExe,
    ["-m", "pip", "install", "--no-warn-script-location", "--upgrade", ...deps],
    targetDir,
  );

  // Bundle Playwright's Chromium INSIDE the env so the installer ships
  // it instead of downloading ~150MB on first launch. ``PLAYWRIGHT_BROWSERS_PATH=0``
  // = use the driver dir inside site-packages, which extraResources then
  // copies along with the rest of python/.
  if (deps.some((d) => d.startsWith("playwright"))) {
    log(`[${label}] installing playwright chromium into bundle...`);
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" };
    execSync(
      `"${pyExe}" -m playwright install chromium`,
      { stdio: "inherit", cwd: targetDir, env },
    );
  }

  log(`[${label}] smoke test: ${sanityImport}`);
  run(pyExe, ["-c", sanityImport], targetDir);

  log(`[${label}] done. size:`);
  powershell(
    `(Get-ChildItem '${targetDir}' -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB | ForEach-Object { '{0:N1} MB' -f $_ }`,
  );
}

// --- Steps --------------------------------------------------------------

async function main() {
  if (FORCE_CLEAN) {
    if (existsSync(PY_DIR)) {
      log("--clean: removing existing python/");
      rmSync(PY_DIR, { recursive: true, force: true });
    }
  }

  if (!existsSync(BUILD_DIR)) {
    log(`creating ${BUILD_DIR}`);
    powershell(`New-Item -ItemType Directory -Force -Path '${BUILD_DIR}' | Out-Null`);
  }

  if (!existsSync(ZIP_PATH)) {
    log(`downloading ${EMBED_URL}`);
    powershell(
      `Invoke-WebRequest -Uri '${EMBED_URL}' -OutFile '${ZIP_PATH}' -UseBasicParsing`,
    );
  } else {
    log(`zip cached at ${ZIP_PATH}`);
  }

  buildEnv(
    PY_DIR,
    DEPS,
    "import fastapi, uvicorn, openai, edge_tts, comfykit, playwright; "
      + "from google import genai; "
      + "print('OK', fastapi.__version__)",
    "main",
  );
}

main().catch((err) => {
  console.error("[bundle-python] FAILED:", err);
  process.exit(1);
});
