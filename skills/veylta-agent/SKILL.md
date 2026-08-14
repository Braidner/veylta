---
name: veylta-agent
description: Подключает Codex к выбранному пользователем Veylta Vault через защищённый локальный bridge, ждёт явные команды из PWA и разбирает только выбранные необработанные документы. Используй, когда пользователь просит запустить Veylta Agent, подключить агента к личному health vault, найти необработанные документы или выполнить checksum-bound анализ источника.
---

# Veylta Agent

Подключайся к пользовательскому Vault только после явного запроса. Считай файлы в
Vault источником истины, а SQLite/IndexedDB — производными индексами.

## Подключение

1. Узнай абсолютный путь к уже созданной папке Veylta Vault. Не угадывай путь и
   не сканируй домашний каталог.
2. Запусти bridge в фоновой exec-сессии:

   ```bash
   node skills/veylta-agent/scripts/bridge.mjs start --vault "/absolute/path/to/Veylta Vault"
   ```

3. Убедись, что вывод содержит `"status":"listening"`. Bridge слушает только
   `127.0.0.1`; токен хранится вне Vault.
4. Жди одну команду длинным опросом:

   ```bash
   node skills/veylta-agent/scripts/poll.mjs --worker codex-veylta --wait 30000
   ```

5. Ответ `{"type":"timeout"}` не является ошибкой. Если пользователь просил
   продолжать слушать, запусти poll снова.

## Обработка команды

Перед работой прочитай [references/protocol.md](references/protocol.md).

- Для `scan_unprocessed` перечисли только manifest-файлы внутри `profiles/`,
  проверь версии формата и найди документы без успешного immutable run. Не читай
  исходник, пока нет отдельной `analyze_document` команды.
- Для `analyze_document` заново найди manifest по UUID, проверь SHA-256
  контролируемого byte snapshot и работай только с этим source version.
- Вывод модели сохраняй как новый immutable proposal/run. Не подтверждай факт за
  пользователя и не давай диагнозов или лечения.
- Если документ будет передан облачной модели Codex, сначала явно скажи об этом
  пользователю. User-owned storage не означает local-only inference.

Заверши текущую lease:

```bash
VEYLTA_AGENT_WORKER=codex-veylta node skills/veylta-agent/scripts/poll.mjs --complete <command-id> <lease-token>
```

При безопасно классифицированной ошибке:

```bash
VEYLTA_AGENT_WORKER=codex-veylta node skills/veylta-agent/scripts/poll.mjs --fail <command-id> <lease-token> SOURCE_CHECKSUM_MISMATCH
```

Не помещай в failure code или queue JSON медицинские значения, имена файлов,
prompt/model output, пути, credentials и stack trace.

## Границы

- Выполняй только `scan_unprocessed` и `analyze_document`.
- Никогда не принимай произвольный путь из команды.
- Не изменяй originals, прежние runs, review decisions или confirmed
  observations.
- Не сохраняй OAuth/Codex/API/bridge tokens и абсолютные пути в Vault.
- Не запускай bridge на `0.0.0.0`, LAN-интерфейсе или публичном URL.
- Не считай lease успехом: только терминальная запись после сохранённого результата
  завершает команду.
