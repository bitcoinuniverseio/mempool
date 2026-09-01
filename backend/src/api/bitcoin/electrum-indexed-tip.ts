import logger from '../../logger';

/** The Electrum call that answers with the server's own tip header. */
export const INDEXED_TIP_METHOD = 'blockchain.headers.subscribe';

/**
 * Reads the height the Electrum server has indexed.
 *
 * Issued as a raw request with an explicitly empty parameter list rather
 * than through the client library's `blockchainHeaders_subscribe`
 * convenience method. That method sends one argument, and Fulcrum answers
 * `Expected at most 0 parameters for blockchain.headers.subscribe, got 1
 * instead` and refuses. The throw was swallowed into a null height, a null
 * height made the address index look unreachable, and an unreachable
 * address index fails the release gate.
 *
 * Takes the request function rather than a client so the wire call it makes
 * can be asserted without constructing the backend's circular API graph.
 */
export async function readIndexedTip(
  request: (method: string, params: unknown[]) => Promise<unknown>
): Promise<number | null> {
  try {
    const header = (await request(INDEXED_TIP_METHOD, [])) as
      | { height?: unknown; block_height?: unknown }
      | null
      | undefined;
    const height = header?.height ?? header?.block_height;
    return Number.isInteger(height) ? (height as number) : null;
  } catch (e) {
    // Warn, not debug. This decides whether the address index looks
    // reachable, and a release gate refuses to ship when it does not.
    logger.warn(
      'Electrum did not report its indexed height: ' +
        (e instanceof Error ? e.message : e)
    );
    return null;
  }
}
