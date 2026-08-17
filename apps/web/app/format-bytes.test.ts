import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes } from "./format-bytes";

test("byte counts read in the unit that fits", () => {
  assert.equal(formatBytes(512), "512 Б");
  assert.equal(formatBytes(12_595), "12,3 КБ");
  assert.equal(formatBytes(2_516_582), "2,40 МБ");
});
