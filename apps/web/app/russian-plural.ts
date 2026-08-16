/**
 * Russian counts agree with their nouns: 1 значение, 2 значения, 5 значений; 21 значение, but
 * 11 значений. One rule for every count the interface prints, so no surface conjugates by hand.
 */
export function pluralForm(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** "1 значение", "2 значения", "5 значений". */
export function countCopy(count: number, forms: readonly [string, string, string]): string {
  return `${count} ${pluralForm(count, forms)}`;
}
