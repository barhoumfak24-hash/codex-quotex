import type { KdfConfig } from "./types";

const enc = new TextEncoder();
const dec = new TextDecoder();
export const DEFAULT_KDF_ITERS = 200_000;
const VERIFIER_TEXT = "quotex-connect-verifier-v1";

export function randomBase64(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function deriveKey(passphrase: string, kdf: KdfConfig): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(base64ToBytes(kdf.salt)),
      iterations: kdf.iters,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(ivBytes);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(ivBytes) },
    key,
    enc.encode(plaintext)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(ivBytes)
  };
}

export async function decryptString(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(iv)) },
    key,
    toArrayBuffer(base64ToBytes(ciphertext))
  );
  return dec.decode(plaintext);
}

export async function createVerifier(
  key: CryptoKey
): Promise<{ verifier: string; verifierIv: string }> {
  const encrypted = await encryptString(key, VERIFIER_TEXT);
  return {
    verifier: encrypted.ciphertext,
    verifierIv: encrypted.iv
  };
}

export async function verifyPassphrase(
  key: CryptoKey,
  verifier: string,
  verifierIv: string
): Promise<boolean> {
  try {
    const value = await decryptString(key, verifier, verifierIv);
    return value === VERIFIER_TEXT;
  } catch {
    return false;
  }
}
