import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultHandle,
  handleFromName,
  handleFromUsername,
  transliterate,
  withSuffix,
} from "./profile-handle.js";

test("names transliterate to lower-case latin and keep only the first word", () => {
  assert.equal(transliterate("Анна Иванова"), "anna ivanova");
  assert.equal(transliterate("Щука Ёжик"), "shchuka yozhik");
  assert.equal(handleFromName("Анна Иванова"), "anna");
  assert.equal(handleFromName("Маша"), "masha");
  assert.equal(handleFromName("Jean-Luc Picard"), "jean-luc");
  assert.equal(handleFromName("  Ю  "), "profile", "too short falls back");
  assert.equal(handleFromName("!!!"), "profile");
  assert.equal(
    handleFromName("Оченьдлинноеимясовсембезпробеловиконца"),
    "ochendlinnoeimyasovsembezprobe",
  );
});

test("a username becomes a handle in the handle alphabet", () => {
  assert.equal(handleFromUsername("braidner"), "braidner");
  assert.equal(handleFromUsername("home.admin_2"), "home-admin-2");
  assert.equal(handleFromUsername("a.b"), "a-b");
  assert.equal(
    handleFromUsername("x.y.z.very.long.username.here.ok"),
    "x-y-z-very-long-username-here",
  );
});

test("the default rule prefers the username, then the name, never a reserved word", () => {
  assert.equal(defaultHandle({ username: "braidner", displayName: "Владелец" }), "braidner");
  assert.equal(defaultHandle({ username: null, displayName: "Анна Иванова" }), "anna");
  assert.equal(defaultHandle({ username: "login", displayName: "Кто-то" }), "login-2");
  assert.equal(defaultHandle({ username: null, displayName: "Docs" }), "docs-2");
});

test("a taken handle gets the next free suffix within the length bound", () => {
  const taken = new Set(["anna", "anna-2"]);
  assert.equal(
    withSuffix("anna", (candidate) => taken.has(candidate)),
    "anna-3",
  );
  assert.equal(
    withSuffix("olga", (candidate) => taken.has(candidate)),
    "olga",
  );
  const long = "a".repeat(30);
  const result = withSuffix(long, (candidate) => candidate === long);
  assert.equal(result.length, 30);
  assert.equal(result, `${"a".repeat(28)}-2`);
});

test("a base with no free suffix at all refuses rather than returning a taken handle", () => {
  assert.throws(() => withSuffix("x", () => true), /No free profile handle/);
});
