import assert from "node:assert/strict";
import test from "node:test";
import { trustedDevHostnames } from "./next-config-helpers.js";

test("Next dev assets trust the hostnames from the browser origin allowlist", () => {
  assert.deepEqual(
    trustedDevHostnames(
      "http://127.0.0.1:4300, http://192.168.2.186:4300, http://192.168.2.186:4300",
    ),
    ["127.0.0.1", "192.168.2.186"],
  );
});

test("Next dev assets retain the loopback default and reject non-origin values", () => {
  assert.deepEqual(trustedDevHostnames(undefined), ["127.0.0.1"]);
  assert.throws(() => trustedDevHostnames("http://192.168.2.0/24"), /WEB_ORIGINS/);
  assert.throws(() => trustedDevHostnames("http://127.0.0.1:4300,"), /WEB_ORIGINS/);
});
