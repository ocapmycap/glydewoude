/**
 * Load `server/.env` into `process.env`, if the file exists.
 *
 * `npm` does not read `.env`, and `loadConfig()` reads straight from
 * `process.env`, so without this the documented `cp .env.example .env &&
 * npm start` flow fails with "DATABASE_URL is not set". Every entry point
 * (the server and the two CLIs) imports this first, for its side effect,
 * before anything reads config.
 *
 * The path is resolved relative to this file, not the process working
 * directory, so the same `server/.env` loads whether the command is run from
 * the repo root or the server directory. A missing file is not an error: CI
 * and production set the environment directly and ship no `.env`.
 */

import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

try {
  // Available since Node 20.12. On an older runtime the call throws and we
  // fall through to whatever the real environment already provides.
  process.loadEnvFile(envPath);
} catch {
  // No .env at that path (CI, production, or simply not created yet) — the
  // environment is expected to be set some other way. loadConfig() still
  // enforces that DATABASE_URL ends up present.
}
