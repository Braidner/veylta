export interface AdminSetupFields {
  username: string;
  displayName: string;
  password: string;
  passwordConfirmation: string;
}

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/i;

export function validateAdminSetup(fields: AdminSetupFields): string | null {
  if (!usernamePattern.test(fields.username.trim())) {
    return "Логин: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.";
  }
  const displayName = fields.displayName.trim();
  if (displayName.length === 0) {
    return "Укажите имя, которое будет видно в интерфейсе.";
  }
  if (displayName.length > 120) {
    return "Имя должно содержать не более 120 символов.";
  }
  if (fields.password.length < 12 || fields.password.length > 128) {
    return "Пароль должен содержать от 12 до 128 символов.";
  }
  if (new TextEncoder().encode(fields.password).byteLength > 256) {
    return "Пароль слишком велик в кодировке UTF-8. Используйте не более 256 байт.";
  }
  if (fields.password !== fields.passwordConfirmation) {
    return "Пароли не совпадают.";
  }
  return null;
}

export function adminSetupError(status: number, _code: string | null): string {
  if (status === 400 || status === 422) {
    return "Проверьте логин, имя и пароль по подсказкам в форме.";
  }
  if (status === 403) {
    return "Откройте Veylta по адресу сервера из WEB_ORIGIN и повторите попытку.";
  }
  if (status === 409) {
    return "Администратор уже создан. Обновите страницу и войдите в систему.";
  }
  return "Сервер не смог создать администратора. Данные не сохранены; повторите попытку.";
}
