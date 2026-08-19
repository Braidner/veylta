/** Number reading and delta printing shared by the dossier's series and the passport's measurements. */
export { numberOf } from "@veylta/contracts";

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
