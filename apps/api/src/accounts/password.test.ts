import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("scrypt password hashes verify only the original secret", async () => {
  const password = "correct horse battery staple";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt-v1\$16384\$8\$1\$/);
  assert.doesNotMatch(encoded, /correct horse/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("a different password", encoded), false);
});

test("password verification fails closed for malformed or unsupported hashes", async () => {
  assert.equal(await verifyPassword("anything", ""), false);
  assert.equal(await verifyPassword("anything", "scrypt-v2$16384$8$1$salt$key"), false);
  assert.equal(await verifyPassword("anything", "scrypt-v1$16384$8$1$%%%$%%%"), false);
});
