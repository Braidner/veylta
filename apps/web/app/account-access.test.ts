import assert from "node:assert/strict";
import test from "node:test";
import { adminSetupError, validateAdminSetup } from "./account-access.js";

test("administrator setup validates every documented field before the request", () => {
  assert.equal(
    validateAdminSetup({
      username: "home-admin",
      displayName: "Домашний администратор",
      password: "correct horse battery staple",
      passwordConfirmation: "correct horse battery staple",
    }),
    null,
  );
  assert.equal(
    validateAdminSetup({
      username: "админ",
      displayName: "Домашний администратор",
      password: "correct horse battery staple",
      passwordConfirmation: "correct horse battery staple",
    }),
    "Логин: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.",
  );
  assert.equal(
    validateAdminSetup({
      username: "home-admin",
      displayName: "   ",
      password: "correct horse battery staple",
      passwordConfirmation: "correct horse battery staple",
    }),
    "Укажите имя, которое будет видно в интерфейсе.",
  );
  assert.equal(
    validateAdminSetup({
      username: "home-admin",
      displayName: "Домашний администратор",
      password: "короткий",
      passwordConfirmation: "короткий",
    }),
    "Пароль должен содержать от 12 до 128 символов.",
  );
  assert.equal(
    validateAdminSetup({
      username: "home-admin",
      displayName: "Домашний администратор",
      password: "€".repeat(100),
      passwordConfirmation: "€".repeat(100),
    }),
    "Пароль слишком велик в кодировке UTF-8. Используйте не более 256 байт.",
  );
  assert.equal(
    validateAdminSetup({
      username: "home-admin",
      displayName: "Домашний администратор",
      password: "correct horse battery staple",
      passwordConfirmation: "correct horse battery staples",
    }),
    "Пароли не совпадают.",
  );
});

test("administrator setup maps safe server failures without hiding the next action", () => {
  assert.equal(
    adminSetupError(400, "VALIDATION_ERROR"),
    "Проверьте логин, имя и пароль по подсказкам в форме.",
  );
  assert.equal(
    adminSetupError(422, "DOMAIN_VALIDATION_ERROR"),
    "Проверьте логин, имя и пароль по подсказкам в форме.",
  );
  assert.equal(
    adminSetupError(403, "ORIGIN_NOT_ALLOWED"),
    "Откройте Veylta по одному из адресов WEB_ORIGINS и повторите попытку.",
  );
  assert.equal(
    adminSetupError(409, "CONFLICT"),
    "Администратор уже создан. Обновите страницу и войдите в систему.",
  );
  assert.equal(
    adminSetupError(500, "INTERNAL_ERROR"),
    "Сервер не смог создать администратора. Данные не сохранены; повторите попытку.",
  );
});
