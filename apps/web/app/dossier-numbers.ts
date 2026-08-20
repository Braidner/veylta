/** Number reading and delta printing shared by the dossier's series and the passport's measurements. */
import { numberOf } from "@veylta/contracts";

export { numberOf };

export interface PrintedBounds {
  readonly low: number | null;
  readonly high: number | null;
  /** The bounds as the source spelled them, for the labels under a scale. */
  readonly lowText: string | null;
  readonly highText: string | null;
}

const noBounds: PrintedBounds = { low: null, high: null, lowText: null, highText: null };

/**
 * The two bounds printed in a reference sentence («0,4 – 4,0», «5.0–8.0 мЕд/л»). Whatever follows
 * them is the unit, never a third bound. A one-sided or worded reference («< 5,0», «до 4,0») names
 * no pair to place a value between, and the caller draws no scale rather than inventing one.
 */
const boundsPattern = /^([+-]?[\d.,]+)\s*[–—-]\s*([+-]?[\d.,]+)(?:\s|$)/;

export function rangeBounds(range: string | null | undefined): PrintedBounds {
  if (range === null || range === undefined) return noBounds;
  const match = boundsPattern.exec(range.trim());
  if (match === null) return noBounds;
  const [lowText, highText] = [match[1] ?? null, match[2] ?? null];
  const [low, high] = [numberOf(lowText), numberOf(highText)];
  if (low === null || high === null) return noBounds;
  return { low, high, lowText, highText };
}

export interface PrintedDelta {
  readonly value: string;
  readonly direction: "increased" | "decreased" | "unchanged";
}

const decimalsOf = (printed: string): number => {
  const fraction = printed.trim().split(/[.,]/)[1];
  return fraction === undefined ? 0 : fraction.length;
};

/** The change between two printed numbers, printed the way the latest one is («+2,1», «−0.4»). */
export function printedDelta(
  latest: { readonly printed: string; readonly value: number },
  previous: { readonly printed: string; readonly value: number },
): PrintedDelta {
  const decimals = Math.max(decimalsOf(latest.printed), decimalsOf(previous.printed));
  const difference = Number((latest.value - previous.value).toFixed(decimals));
  const separator = latest.printed.includes(",") ? "," : ".";
  const magnitude = Math.abs(difference).toFixed(decimals).replace(".", separator);
  if (difference === 0) return { value: magnitude, direction: "unchanged" };
  return {
    value: `${difference > 0 ? "+" : "−"}${magnitude}`,
    direction: difference > 0 ? "increased" : "decreased",
  };
}
