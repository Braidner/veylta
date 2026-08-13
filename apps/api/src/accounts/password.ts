import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const algorithm = "scrypt-v1";
const cost = 16_384;
const blockSize = 8;
const parallelization = 1;
const saltBytes = 16;
const derivedKeyBytes = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      derivedKeyBytes,
      { N: cost, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error !== null) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt);
  return [
    algorithm,
    String(cost),
    String(blockSize),
    String(parallelization),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, encodedCost, encodedBlockSize, encodedParallelization, saltText, keyText] =
    encoded.split("$");
  if (
    version !== algorithm ||
    encodedCost !== String(cost) ||
    encodedBlockSize !== String(blockSize) ||
    encodedParallelization !== String(parallelization) ||
    saltText === undefined ||
    keyText === undefined
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    if (salt.length !== saltBytes || expected.length !== derivedKeyBytes) return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
