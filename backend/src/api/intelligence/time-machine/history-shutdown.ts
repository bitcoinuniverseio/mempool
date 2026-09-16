/** A stuck disk must not prevent service termination indefinitely. */
export async function boundedHistoryFlush(flush: () => Promise<void>, timeoutMs = 5000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(flush).then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
