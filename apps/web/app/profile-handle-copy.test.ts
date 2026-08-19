import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api-client";
import { handleFieldError, handleSaveErrorCopy } from "./profile-handle-copy";

test("the field explains the rule before the server has to", () => {
  assert.equal(handleFieldError("anna"), null);
  assert.equal(handleFieldError("Anna"), null, "case is folded, not refused");
  assert.match(handleFieldError("an") ?? "", /от 3 до 30/);
  assert.match(handleFieldError("анна") ?? "", /латиница/);
  assert.match(handleFieldError("anna-") ?? "", /дефис/i);
  assert.match(handleFieldError("login") ?? "", /занято системой/);
});

test("the server's answers read as sentences", () => {
  assert.match(handleSaveErrorCopy(new ApiError(409, "CONFLICT")), /уже занят/);
  assert.match(handleSaveErrorCopy(new ApiError(422, "VALIDATION")), /не подходит/);
  assert.match(handleSaveErrorCopy(new Error("network")), /соединение/);
});
