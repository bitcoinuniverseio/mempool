/** Decimal URL integer; no partial parsing, signs, fractions or unsafe values. */
export function readUnsignedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== 'string' || !/^[0-9]{1,16}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

export function sourceNotFound(error: any): boolean {
  return error?.response?.status === 404 || error?.code === -5
    || /^(Block not found|No such mempool or blockchain transaction)/i.test(error?.message || '');
}
