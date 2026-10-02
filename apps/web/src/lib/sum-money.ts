/** Exact decimal aggregation for a fully loaded, locally filtered report. */
export function sumMoney(values: (string | null | undefined)[]): string {
  const parts = values.map((value) => {
    const text = value ?? '0';
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid money value');
    const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
    return { negative: text.startsWith('-'), whole, fraction };
  });
  const scale = Math.max(0, ...parts.map((part) => part.fraction.length));
  const total = parts.reduce((sum, part) => {
    const amount = BigInt(part.whole + part.fraction.padEnd(scale, '0'));
    return sum + (part.negative ? -amount : amount);
  }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
  return (total < 0n ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}
