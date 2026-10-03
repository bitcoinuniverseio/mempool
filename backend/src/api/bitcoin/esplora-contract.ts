/**
 * The shape of the address answers this explorer is built on.
 *
 * There is one copy of these rules and everything judges by it: the readiness
 * probe that decides whether the deployment may call address lookup ready, the
 * contract test that runs them against a recorded fixture, and the same test
 * run against the live index before a release. That is the point. A fixture
 * that is judged by different rules from the real provider is not a test of
 * the real provider, it is a test of the fixture, and it passes forever while
 * production disagrees with it.
 *
 * Each function returns the problems it found, so a failure says which field
 * was wrong rather than only that something was.
 */

/** A count or an amount in satoshis. Never a string, never a float. */
/* IMPLEMENTATION-HANDOFF [WP-BE-003]
 * Defect BE-003; coverage COV-BE-003.address-amounts, utxo-input-contract.
 * Reproduction: backend-reproduce.cjs passes 9007199254740992 as funded sum
 * and UTXO value, and 4294967296 as vout; both public contract helpers return
 * no problems. Number.isInteger does not establish exact integer identity.
 * 1. Separate bounded counts, uint32 indexes, individual Bitcoin amounts and
 *    cumulative address sums. Reject non-finite/unsafe numeric provider
 *    values before readiness or downstream calculations. A single Bitcoin
 *    output must also obey MAX_MONEY; aggregate historical turnover must not
 *    be capped to the live coin supply because coins may circulate again.
 * 2. Trace owned Esplora/Electrum/RPC amounts through esplora-api.interface,
 *    address-index, gateway and frontend address/portfolio consumers. Where
 *    cumulative values can exceed safe integers, preserve exact base-10
 *    strings from the producer and use bigint arithmetic behind a versioned
 *    response contract. Already-rounded JSON numbers cannot be recovered.
 * 3. Extend esplora-contract.test.ts with safe-boundary +/-1, MAX_MONEY,
 *    fractional, negative, Infinity, string and uint32-boundary fixtures.
 *    Test exact cumulative subtraction with distinct integers that collapse
 *    as Number, and reject invalid history/UTXO status identities as needed.
 * 4. Verify owned-source responses and the Signet address/UTXO page, CSV and
 *    portfolio consumers under the accepted contract; preserve legitimate
 *    high-volume addresses and explicit source-unavailable states.
 * Source: R-BE-ECMA for safe integer semantics; Bitcoin amount limits must be
 * checked against the pinned Core amount.h source in R-BE-MONEY.
 * Acceptance: no lost atomic unit and no malformed numeric answer reported
 * ready. Rollback: version producer/consumer changes together and retain the
 * old API until compatible clients are deployed; keep invalid inputs rejected.
 * Preparation only; no validation or wire format is changed here.
 */
function isWholeNumber(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isTxid(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

const STAT_FIELDS = [
  'funded_txo_count',
  'funded_txo_sum',
  'spent_txo_count',
  'spent_txo_sum',
  'tx_count',
] as const;

/**
 * `GET /address/:address`
 *
 * The page reads five numbers out of each of two sections and subtracts them
 * to show a balance. Every one of those has to be a whole number of satoshis:
 * an amount that arrives as a string concatenates instead of subtracting, and
 * an amount that arrives as a float loses precision above 2^53 satoshis in a
 * way nothing downstream can detect.
 */
export function addressSummaryProblems(body: unknown, address: string): string[] {
  const problems: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['the address summary is not an object'];
  }
  const document = body as Record<string, unknown>;
  if (document.address !== address) {
    problems.push(`the summary is about ${JSON.stringify(document.address)} rather than ${address}`);
  }
  for (const section of ['chain_stats', 'mempool_stats']) {
    const stats = document[section];
    if (!stats || typeof stats !== 'object') {
      problems.push(`${section} is missing`);
      continue;
    }
    for (const field of STAT_FIELDS) {
      const value = (stats as Record<string, unknown>)[field];
      if (!isWholeNumber(value)) {
        problems.push(`${section}.${field} is ${JSON.stringify(value)} rather than a whole number`);
      }
    }
  }
  return problems;
}

/**
 * `GET /address/:address/txs`
 *
 * A page of transactions, bounded by the index rather than by the caller. The
 * bound is the contract: a provider that answered with an address's entire
 * confirmed history would put millions of transactions through a browser, and
 * that is the failure the old "stronger backend" warning grew out of.
 */
export function addressHistoryProblems(body: unknown, maxPageSize = 100): string[] {
  if (!Array.isArray(body)) {
    return ['the address history is not a list'];
  }
  const problems: string[] = [];
  if (body.length > maxPageSize) {
    problems.push(`the history page holds ${body.length} transactions, past the ${maxPageSize} a page may carry`);
  }
  for (const transaction of body) {
    if (!isTxid(transaction?.txid)) {
      problems.push(`a history entry names ${JSON.stringify(transaction?.txid)} rather than a transaction`);
      break;
    }
    if (!Array.isArray(transaction.vin) || !Array.isArray(transaction.vout)) {
      problems.push(`transaction ${transaction.txid} carries no inputs or outputs`);
      break;
    }
    const status = transaction.status;
    if (!status || typeof status.confirmed !== 'boolean') {
      problems.push(`transaction ${transaction.txid} does not say whether it is confirmed`);
      break;
    }
    // A confirmed transaction has to name its block. Without that the page
    // cannot order the history or show an age, and an unconfirmed one must not
    // claim a height it does not have.
    if (status.confirmed && !isWholeNumber(status.block_height)) {
      problems.push(`transaction ${transaction.txid} is confirmed without a block height`);
      break;
    }
  }
  return problems;
}

/**
 * `GET /address/:address/utxo`
 *
 * The index refuses an address with more unspent outputs than its configured
 * limit rather than answering with all of them, so a list that comes back is
 * a list the page can render.
 */
export function utxoListProblems(body: unknown, utxosLimit = 500): string[] {
  if (!Array.isArray(body)) {
    return ['the UTXO answer is not a list'];
  }
  const problems: string[] = [];
  if (body.length > utxosLimit) {
    problems.push(`the UTXO list holds ${body.length} outputs, past the configured limit of ${utxosLimit}`);
  }
  for (const utxo of body) {
    if (!isTxid(utxo?.txid)) {
      problems.push(`a UTXO names ${JSON.stringify(utxo?.txid)} rather than a transaction`);
      break;
    }
    if (!isWholeNumber(utxo.vout)) {
      problems.push(`UTXO ${utxo.txid} has output index ${JSON.stringify(utxo.vout)}`);
      break;
    }
    if (!isWholeNumber(utxo.value)) {
      problems.push(`UTXO ${utxo.txid} has value ${JSON.stringify(utxo.value)} rather than a whole number of satoshis`);
      break;
    }
  }
  return problems;
}
