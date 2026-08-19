import { type ProfileTab, parseProfileTabSegment } from "./paths";
import type { SettingsSection } from "./settings-sections";

/** What one `/<handle>/…` URL asks the app for — the props the shell is rendered with. */
export interface VeyltaAppRouteProps {
  readonly requestedHandle: string;
  readonly requestedTab?: ProfileTab;
  /** An old `?tab=` on the overview; the shell replaces the URL with the tab's own segment. */
  readonly legacyTab?: string;
  readonly requestedCanonicalCode?: string;
  readonly requestedDocumentId?: string;
  readonly requestedAssistantId?: string;
  readonly requestedConversationId?: string;
  readonly requestedAssistantAsk?: string;
  readonly requestedSettings?: boolean;
  readonly requestedSettingsSection?: SettingsSection;
}

/** The path after the handle; the handle itself is read from the route, already decoded. */
function segmentsAfterHandle(pathname: string): readonly (string | undefined)[] {
  return pathname
    .split("/")
    .filter((part) => part.length > 0)
    .slice(1)
    .map((part) => {
      // A malformed escape (a lone `%`) must not throw during a client layout render — the raw
      // segment flows on instead.
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * One URL of a person as the shell's props, so `/<handle>` and all its tabs are one mounted app:
 * a click changes these props, never the component. Pure — the layout supplies the router's read.
 */
export function parseProfileRoute(
  handle: string,
  pathname: string,
  search: URLSearchParams,
): VeyltaAppRouteProps {
  const [section, detail] = segmentsAfterHandle(pathname);
  const handleProps = { requestedHandle: handle };
  const value = (name: string) => search.get(name) ?? undefined;

  if (section === "settings") {
    return {
      ...handleProps,
      requestedSettings: true,
      requestedSettingsSection: detail === "app" ? "app" : "user",
    };
  }
  if (section === "assistants" && detail !== undefined) {
    const conversationId = value("conversationId");
    const ask = value("ask");
    return {
      ...handleProps,
      requestedAssistantId: detail,
      ...(conversationId === undefined ? {} : { requestedConversationId: conversationId }),
      ...(ask === undefined ? {} : { requestedAssistantAsk: ask }),
    };
  }
  if (section === "docs" && detail !== undefined) {
    return { ...handleProps, requestedDocumentId: detail };
  }

  const requestedTab = parseProfileTabSegment(section);
  if (requestedTab === "history") {
    const code = value("code") ?? value("canonicalCode");
    return {
      ...handleProps,
      requestedTab,
      ...(code === undefined ? {} : { requestedCanonicalCode: code }),
    };
  }
  if (requestedTab !== "overview") return { ...handleProps, requestedTab };

  const legacyTab = value("tab");
  const canonicalCode = value("canonicalCode");
  return {
    ...handleProps,
    requestedTab,
    ...(legacyTab === undefined ? {} : { legacyTab }),
    ...(canonicalCode === undefined ? {} : { requestedCanonicalCode: canonicalCode }),
  };
}
