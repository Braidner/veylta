"use client";

import type { VeyltaVaultManifest } from "@veylta/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  type DirectoryHandleLike,
  enqueueAgentScan,
  initializeDirectoryVault,
  readVaultManifest,
} from "../vault/directory-vault";
import {
  clearVaultDirectoryHandle,
  loadVaultDirectoryHandle,
  saveVaultDirectoryHandle,
} from "../vault/vault-handle-store";

type VaultConnectionState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "permission"; handle: DirectoryHandleLike }
  | { kind: "connected"; handle: DirectoryHandleLike; manifest: VeyltaVaultManifest }
  | { kind: "error"; message: string };

interface DirectoryPickerOptions {
  readonly id?: string;
  readonly mode?: "read" | "readwrite";
  readonly startIn?: "documents";
}

function directoryPicker():
  | ((options?: DirectoryPickerOptions) => Promise<DirectoryHandleLike>)
  | undefined {
  return (
    window as unknown as {
      showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
}

async function permissionState(handle: DirectoryHandleLike): Promise<PermissionState> {
  return (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
}

async function requestPermission(handle: DirectoryHandleLike): Promise<PermissionState> {
  if ((await permissionState(handle)) === "granted") return "granted";
  return (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
}

function safeVaultError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Выбор папки отменён. Никакие файлы не изменены.";
  }
  return "Не удалось открыть Veylta Vault. Проверьте доступ и файл vault.json; существующие данные не изменены.";
}

export function VaultConnection() {
  const [state, setState] = useState<VaultConnectionState>({ kind: "loading" });
  const [agentRequest, setAgentRequest] = useState<"idle" | "saving" | "queued" | "error">("idle");

  const openHandle = useCallback(async (handle: DirectoryHandleLike, askPermission: boolean) => {
    setState({ kind: "connecting" });
    try {
      const permission = askPermission
        ? await requestPermission(handle)
        : await permissionState(handle);
      if (permission !== "granted") {
        setState({ kind: "permission", handle });
        return;
      }
      const manifest = askPermission
        ? await initializeDirectoryVault(handle)
        : await readVaultManifest(handle);
      if (manifest === null) {
        setState({ kind: "permission", handle });
        return;
      }
      await saveVaultDirectoryHandle(handle);
      setState({ kind: "connected", handle, manifest });
    } catch (error) {
      setState({ kind: "error", message: safeVaultError(error) });
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (directoryPicker() === undefined) {
      setState({ kind: "unsupported" });
      return;
    }
    loadVaultDirectoryHandle()
      .then((handle) => {
        if (!active) return;
        if (handle === null) {
          setState({ kind: "disconnected" });
          return;
        }
        void openHandle(handle, false);
      })
      .catch(() => {
        if (active) setState({ kind: "disconnected" });
      });
    return () => {
      active = false;
    };
  }, [openHandle]);

  async function chooseDirectory(): Promise<void> {
    const picker = directoryPicker();
    if (picker === undefined) {
      setState({ kind: "unsupported" });
      return;
    }
    try {
      const handle = await picker({ id: "veylta-vault", mode: "readwrite", startIn: "documents" });
      await openHandle(handle, true);
    } catch (error) {
      setState({ kind: "error", message: safeVaultError(error) });
    }
  }

  async function forgetDirectory(): Promise<void> {
    await clearVaultDirectoryHandle();
    setState({ kind: "disconnected" });
  }

  async function requestAgentScan(): Promise<void> {
    if (state.kind !== "connected") return;
    setAgentRequest("saving");
    try {
      await enqueueAgentScan(state.handle, state.manifest);
      setAgentRequest("queued");
    } catch {
      setAgentRequest("error");
    }
  }

  return (
    <section className="vault-connect" aria-labelledby="vault-connect-title" aria-live="polite">
      <div className="vault-connect__heading">
        <div className="vault-connect__mark" aria-hidden="true">
          V
        </div>
        <div>
          <p>Новая архитектура</p>
          <h2 id="vault-connect-title">
            {state.kind === "connected" ? "Личная папка подключена" : "Подключите личную папку"}
          </h2>
        </div>
      </div>

      {state.kind === "connected" ? (
        <>
          <p className="vault-connect__copy">
            <strong>{state.handle.name}</strong> — источник истины. Veylta читает и пишет только
            внутри этой папки; синхронизацией управляет ваш облачный диск.
          </p>
          <dl className="vault-connect__facts">
            <div>
              <dt>Формат</dt>
              <dd>{state.manifest.contractVersion}</dd>
            </div>
            <div>
              <dt>Vault ID</dt>
              <dd title={state.manifest.vaultId}>{state.manifest.vaultId.slice(0, 8)}…</dd>
            </div>
          </dl>
          <div className="vault-connect__agent">
            <p>
              Агент получает только явный запрос из этой папки. Исходники не меняются, а результат
              остаётся черновиком до вашей проверки.
            </p>
            <p className="vault-connect__agent-disclosure">
              Этот запрос лишь ищет manifest необработанных документов и ничего не отправляет
              модели. Перед анализом источника агент отдельно назовёт файл и предупредит о передаче
              в Codex.
            </p>
            <button
              className="button button--primary button--wide"
              type="button"
              disabled={agentRequest === "saving" || agentRequest === "queued"}
              onClick={() => void requestAgentScan()}
            >
              {agentRequest === "saving"
                ? "Сохраняем запрос…"
                : agentRequest === "queued"
                  ? "Запрос сохранён в Vault"
                  : "Позвать агента"}
            </button>
            {agentRequest === "queued" ? (
              <p className="vault-connect__agent-status" role="status">
                Когда локальный Veylta Agent будет запущен, он заберёт необработанные документы.
              </p>
            ) : null}
            {agentRequest === "error" ? (
              <p className="form-error" role="alert">
                Не удалось сохранить запрос. Данные Vault не изменены.
              </p>
            ) : null}
          </div>
          <button className="text-button" type="button" onClick={() => void forgetDirectory()}>
            Забыть папку на этом устройстве
          </button>
        </>
      ) : (
        <>
          <p className="vault-connect__copy">
            Выберите отдельную папку Veylta внутри iCloud Drive, Google Drive, Dropbox или на
            компьютере. Мы не получим доступ к остальным файлам и не загрузим её на наш сервер.
          </p>
          {state.kind === "unsupported" ? (
            <p className="vault-connect__notice" role="status">
              Этот браузер пока не умеет надёжно записывать выбранную папку. Используйте desktop
              Chromium; скрытого fallback в browser cache нет.
            </p>
          ) : null}
          {state.kind === "error" ? (
            <p className="form-error" role="alert">
              {state.message}
            </p>
          ) : null}
          {state.kind === "permission" ? (
            <button
              className="button button--primary button--wide"
              type="button"
              onClick={() => void openHandle(state.handle, true)}
            >
              Вернуть доступ к папке
            </button>
          ) : null}
          {state.kind !== "unsupported" && state.kind !== "permission" ? (
            <button
              className="button button--primary button--wide"
              type="button"
              disabled={state.kind === "loading" || state.kind === "connecting"}
              onClick={() => void chooseDirectory()}
            >
              {state.kind === "loading" || state.kind === "connecting"
                ? "Проверяем папку…"
                : "Выбрать Veylta Vault"}
            </button>
          ) : null}
          <p className="vault-connect__fineprint">
            В portable vault не сохраняются OAuth-токены, API-ключи, Codex credentials или
            абсолютные пути.
          </p>
        </>
      )}
    </section>
  );
}
