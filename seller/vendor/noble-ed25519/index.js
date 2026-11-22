"use strict";

/**
 * CommonJS shim for @noble/ed25519, backed by Node's built-in Ed25519
 * support (node:crypto). Only the surface @selfxyz/agent-sdk touches is
 * implemented:
 *   - `hashes` (the SDK installs its own sha512 into it at load)
 *   - `getPublicKey(seed)`           — sync, as in noble v3
 *   - `signAsync(message, seed)`     — used by the SDK's Ed25519Agent
 *   - `verifyAsync(sig, msg, pub)`   — used by SelfAgentVerifier
 * Raw 32-byte seeds / public keys and 64-byte signatures, byte-compatible
 * with the real @noble/ed25519 (verified against a test vector produced
 * by the real package).
 */
const {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign: nodeSign,
  verify: nodeVerify,
} = require("node:crypto");

// DER prefixes for Ed25519 keys (RFC 8410): PKCS#8 around a 32-byte seed,
// SPKI around a 32-byte raw public key.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const buf = (bytes) => Buffer.from(bytes);

function privateKeyFromSeed(seed) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, buf(seed)]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeyFromRaw(raw) {
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, buf(raw)]),
    format: "der",
    type: "spki",
  });
}

function getPublicKey(seed) {
  const der = createPublicKey(privateKeyFromSeed(seed)).export({
    format: "der",
    type: "spki",
  });
  return new Uint8Array(der.subarray(der.length - 32));
}

async function getPublicKeyAsync(seed) {
  return getPublicKey(seed);
}

function sign(message, seed) {
  return new Uint8Array(nodeSign(null, buf(message), privateKeyFromSeed(seed)));
}

async function signAsync(message, seed) {
  return sign(message, seed);
}

function verify(signature, message, publicKey) {
  try {
    return nodeVerify(null, buf(message), publicKeyFromRaw(publicKey), buf(signature));
  } catch {
    return false;
  }
}

async function verifyAsync(signature, message, publicKey) {
  return verify(signature, message, publicKey);
}

const hashes = {
  sha512: undefined,
  sha512Async: async (message) =>
    new Uint8Array(createHash("sha512").update(buf(message)).digest()),
};

module.exports = {
  hashes,
  getPublicKey,
  getPublicKeyAsync,
  sign,
  signAsync,
  verify,
  verifyAsync,
};
