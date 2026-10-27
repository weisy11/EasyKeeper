#!/usr/bin/env node
/**
 * Pre-release sanity check.
 *
 *   pnpm release:check
 *
 * Catches the mistakes that are easy to make and hard to notice once a tag
 * is already pushed:
 *
 *   - the version drifting apart between the four places it is declared
 *   - a signing key or notarization credential getting committed
 *   - bundle config that would make `tauri build` fail or ship a broken app
 *   - signing/notarization credentials missing from the environment
 *
 * Read-only: it never writes, commits, tags or publishes anything.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "apps/desktop/src-tauri");

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function note(message) {
  notes.push(message);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// --- 1. the version must be identical everywhere ---------------------------

const versions = new Map();
versions.set("package.json", readJson(path.join(root, "package.json")).version);
versions.set(
  "apps/desktop/package.json",
  readJson(path.join(root, "apps/desktop/package.json")).version,
);

const tauriConfig = readJson(path.join(srcTauri, "tauri.conf.json"));
versions.set("apps/desktop/src-tauri/tauri.conf.json", tauriConfig.version);

const cargoToml = readFileSync(path.join(srcTauri, "Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
versions.set("apps/desktop/src-tauri/Cargo.toml", cargoVersion ?? "(missing)");

const distinct = new Set(versions.values());
if (distinct.size > 1) {
  fail(
    `Version mismatch:\n${[...versions]
      .map(([file, v]) => `      ${file.padEnd(42)} ${v}`)
      .join("\n")}`,
  );
} else {
  note(`Version ${[...distinct][0]} is consistent across ${versions.size} files.`);
}

// --- 2. no signing material may be tracked by git --------------------------

const tracked = git(["ls-files"]).split("\n");
const secretPattern = /\.(p8|p12|pem|key|cer|mobileprovision)$|(^|\/)private_keys\//i;
const leaked = tracked.filter((file) => secretPattern.test(file));
if (leaked.length > 0) {
  fail(`Signing material is tracked by git:\n${leaked.map((f) => `      ${f}`).join("\n")}`);
} else {
  note("No signing material tracked by git.");
}

// --- 3. bundle config has to be shippable ---------------------------------

if (tauriConfig.bundle?.active !== true) {
  fail('bundle.active is not true — `tauri build` would skip packaging.');
}

if (!tauriConfig.bundle?.icon?.length) {
  fail("bundle.icon is empty.");
}

if (!tauriConfig.productName || !tauriConfig.identifier) {
  fail("productName or identifier is missing.");
}

// Entitlements are resolved relative to the tauri config directory.
const entitlements = tauriConfig.bundle?.macOS?.entitlements;
if (entitlements) {
  const resolved = path.resolve(srcTauri, entitlements);
  if (!existsSync(resolved)) {
    fail(`bundle.macOS.entitlements points at a missing file: ${resolved}`);
  } else {
    note(`Entitlements found: ${path.relative(root, resolved)}`);
  }
}

if (tauriConfig.bundle?.createUpdaterArtifacts) {
  fail(
    "bundle.createUpdaterArtifacts is enabled but no updater plugin is installed — " +
      "the build would demand updater signing keys.",
  );
}

// --- 4. signing and notarization credentials -------------------------------

const signingVars = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY"];
const notarizationVars = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
const apiKeyVars = ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"];

const present = (vars) => vars.filter((name) => process.env[name]);
const hasSigning = present(signingVars).length > 0;
const hasAppleId = present(notarizationVars).length === notarizationVars.length;
const hasApiKey = present(apiKeyVars).length === apiKeyVars.length;

if (hasSigning) {
  note(`Signing credentials present (${present(signingVars).join(", ")}).`);
} else {
  note("No signing credentials in the environment — the build will be unsigned.");
}

if (hasAppleId || hasApiKey) {
  note(
    hasAppleId
      ? "Notarization via Apple ID credentials."
      : "Notarization via App Store Connect API key.",
  );
} else {
  note("No notarization credentials in the environment — the build will not be notarized.");
}

// --- 4b. the macOS keychain has to be able to build the signing chain -------
//
// This is the failure that bites right before the first release: the Developer
// ID Application certificate is imported, `find-identity` lists it, and yet
// `codesign` still refuses with "unable to build chain to self-signed root".
//
// The cause is the intermediate CA. macOS ships the *old* "Developer ID
// Certification Authority" (OU=Apple Certification Authority, expiring
// 2027-02-01), but certificates issued since 2026-09-18 are signed by the
// *G2* authority (OU=G2). Without that intermediate in the keychain the chain
// cannot reach "Apple Root CA" and the identity never validates.
//
// Only meaningful on macOS; other platforms skip this block entirely.

if (process.platform === "darwin") {
  const security = (args) =>
    execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  let identities = "";
  try {
    identities = security(["find-identity", "-v", "-p", "codesigning"]);
  } catch {
    fail("`security find-identity` failed — the login keychain may be locked.");
  }

  const identityCount = (identities.match(/\)\s/g) ?? []).length;
  if (identityCount === 0) {
    fail(
      "No valid codesigning identity in the keychain. If the certificate is imported but " +
        "still invisible, the G2 intermediate CA is missing — see `~/DeveloperID/import-cert.sh`.",
    );
  } else {
    const line = identities.split("\n").find((l) => /\)\s+[0-9A-F]{40}/.test(l));
    note(`Codesigning identity available${line ? `: ${line.trim()}` : "."}`);
  }

  // The G2 intermediate must be present too, otherwise the count above is 0.
  let g2Found = false;
  try {
    const loginKeychain = path.join(
      os.homedir(),
      "Library",
      "Keychains",
      "login.keychain-db",
    );
    const pem = security([
      "find-certificate",
      "-a",
      "-c",
      "Developer ID Certification Authority",
      "-p",
      loginKeychain,
    ]);
    // The PEM block itself carries no readable subject, so every certificate
    // has to be decoded before its OU can be compared.
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    for (const block of blocks) {
      const subject = execFileSync(
        "openssl",
        ["x509", "-noout", "-subject", "-nameopt", "RFC2253"],
        { input: block, encoding: "utf8" },
      );
      if (/OU=G2\b/.test(subject)) {
        g2Found = true;
        break;
      }
    }
  } catch {
    // no certificate in the login keychain yet
  }
  if (!g2Found) {
    fail(
      "The G2 intermediate CA (OU=G2) is not in the login keychain. " +
        "Codesign will fail with 'unable to build chain to self-signed root'. " +
        "Run `bash ~/DeveloperID/import-cert.sh`.",
    );
  } else {
    note("G2 intermediate CA present in the login keychain.");
  }
}

// --- 5. where would the tag land ------------------------------------------

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  note(`Current branch is "${branch}". Tags must be cut on "main".`);
} else {
  note("On main — a tag cut now would include the bundle config.");
}

// --- report ---------------------------------------------------------------

for (const message of notes) {
  console.log(`  ok  ${message}`);
}
if (problems.length > 0) {
  console.error("");
  for (const message of problems) {
    console.error(`FAIL  ${message}`);
  }
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log("\nRelease checks passed.");
