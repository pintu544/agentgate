/**
 * QA regression probes for the vendored @noble/ed25519 shim
 * (vendor/noble-ed25519/index.js), W1: the shim must enforce the real
 * package's input-length contract. Behaviour asserted here was verified
 * byte-for-byte against real @noble/ed25519 3.2.0 (19/19 parity checks,
 * including exact RangeError messages).
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

interface Ed25519Shim {
  getPublicKey(seed: Uint8Array): Uint8Array;
  getPublicKeyAsync(seed: Uint8Array): Promise<Uint8Array>;
  sign(message: Uint8Array, seed: Uint8Array): Uint8Array;
  signAsync(message: Uint8Array, seed: Uint8Array): Promise<Uint8Array>;
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
  verifyAsync(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean>;
}

const require = createRequire(import.meta.url);
const ed = require("../vendor/noble-ed25519/index.js") as Ed25519Shim;

const hex = (s: string) =>
  new Uint8Array(Buffer.from(s.replace(/\s/g, ""), "hex"));

// RFC 8032 test vector 1 (empty message).
const SEED = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const PUB = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
const SIG_EMPTY = hex(
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
    "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
);
const EMPTY = new Uint8Array(0);

describe("QA shim: honest operations match noble (RFC 8032 vector)", () => {
  it("getPublicKey derives the vector public key", () => {
    expect(Buffer.from(ed.getPublicKey(SEED)).toString("hex")).toBe(
      Buffer.from(PUB).toString("hex"),
    );
  });

  it("sign reproduces the vector signature; verify accepts it", async () => {
    const sig = await ed.signAsync(EMPTY, SEED);
    expect(Buffer.from(sig).toString("hex")).toBe(Buffer.from(SIG_EMPTY).toString("hex"));
    expect(ed.verify(SIG_EMPTY, EMPTY, PUB)).toBe(true);
    expect(await ed.verifyAsync(SIG_EMPTY, EMPTY, PUB)).toBe(true);
  });

  it("well-formed-length but invalid signature/key verifies to false, not a throw", async () => {
    expect(ed.verify(new Uint8Array(64).fill(9), EMPTY, PUB)).toBe(false);
    expect(ed.verify(SIG_EMPTY, EMPTY, new Uint8Array(32).fill(3))).toBe(false);
    expect(await ed.verifyAsync(new Uint8Array(64).fill(9), EMPTY, PUB)).toBe(false);
  });
});

describe("QA shim: W1 length contract (throws RangeError, exactly like noble 3.x)", () => {
  it("getPublicKey rejects 31- and 33-byte seeds", () => {
    expect(() => ed.getPublicKey(SEED.slice(0, 31))).toThrowError(RangeError);
    expect(() => ed.getPublicKey(new Uint8Array(33))).toThrowError(
      '"secretKey" expected Uint8Array of length 32, got length=33',
    );
  });

  it("getPublicKeyAsync / sign / signAsync reject wrong-length seeds", async () => {
    await expect(ed.getPublicKeyAsync(SEED.slice(0, 31))).rejects.toThrowError(RangeError);
    expect(() => ed.sign(EMPTY, SEED.slice(0, 31))).toThrowError(RangeError);
    await expect(ed.signAsync(EMPTY, new Uint8Array(33))).rejects.toThrowError(RangeError);
  });

  it("verify rejects 63- and 65-byte signatures", () => {
    expect(() => ed.verify(SIG_EMPTY.slice(0, 63), EMPTY, PUB)).toThrowError(
      '"signature" expected Uint8Array of length 64, got length=63',
    );
    expect(() => ed.verify(new Uint8Array(65), EMPTY, PUB)).toThrowError(RangeError);
  });

  it("verify rejects 31- and 33-byte public keys — no silent truncation", async () => {
    expect(() => ed.verify(SIG_EMPTY, EMPTY, PUB.slice(0, 31))).toThrowError(
      '"publicKey" expected Uint8Array of length 32, got length=31',
    );
    // The original W1 bug: a 33-byte key (valid key + one byte) verified
    // against the first 32 bytes. It must now throw, like real noble.
    const overLong = new Uint8Array(33);
    overLong.set(PUB);
    expect(() => ed.verify(SIG_EMPTY, EMPTY, overLong)).toThrowError(RangeError);
    await expect(ed.verifyAsync(SIG_EMPTY, EMPTY, overLong)).rejects.toThrowError(RangeError);
    await expect(ed.verifyAsync(SIG_EMPTY.slice(0, 63), EMPTY, PUB)).rejects.toThrowError(
      RangeError,
    );
  });
});
