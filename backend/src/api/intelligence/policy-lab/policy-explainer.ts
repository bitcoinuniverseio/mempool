export interface RemediationOption {
  action: 'cpfp' | 'rbf' | 'adjust_fee' | 'wait_locktime' | 'split_package' | 'fix_script';
  title: string;
  description: string;
  tradeoffs: string;
  estimated_cost_sats?: number;
}

export interface PolicyExplanation {
  txid: string;
  reject_code: string;
  plain_language_reason: string;
  scope: 'consensus' | 'local_policy' | 'package_policy' | 'insufficient_information';
  technical_details: string;
  remediations: RemediationOption[];
}

export class PolicyExplainer {
  public static explainVerdict(
    txid: string,
    rejectCode: string | null,
    rawReason: string | null
  ): PolicyExplanation | null {
    if (!rejectCode && !rawReason) {
      return null;
    }

    const code = (rejectCode || rawReason || 'unknown').toLowerCase();

    if (code.includes('bad-txns-inputs-missingorspent') || code.includes('missing-inputs')) {
      return {
        txid,
        reject_code: 'bad-txns-inputs-missingorspent',
        plain_language_reason: 'One or more inputs spent by this transaction do not exist or were already spent in the blockchain or mempool.',
        scope: 'consensus',
        technical_details: 'The transaction references an outpoint that is not present in the current UTXO set and is not created by an ancestor in this package.',
        remediations: [
          {
            action: 'fix_script',
            title: 'Verify input transaction status',
            description: 'Check whether the funding transaction was reorganized or double-spent, and reconstruct the transaction using confirmed UTXOs.',
            tradeoffs: 'Requires generating a new signed transaction.',
          },
        ],
      };
    }

    if (code.includes('insufficient fee') || code.includes('min-relay-fee-not-met')) {
      return {
        txid,
        reject_code: 'insufficient-fee',
        plain_language_reason: 'The transaction feerate is below the minimum relay feerate configured by this node.',
        scope: 'local_policy',
        technical_details: 'The fee rate does not meet the node minrelaytxfee threshold (typically 1.0 sat/vB).',
        remediations: [
          {
            action: 'cpfp',
            title: 'Child-Pays-For-Parent (CPFP)',
            description: 'Attach a child transaction with a higher fee spending an output of this transaction to lift the effective package feerate.',
            tradeoffs: 'Consumes an additional transaction output and slightly increases total virtual size.',
            estimated_cost_sats: 1500,
          },
          {
            action: 'rbf',
            title: 'Replace-By-Fee (RBF)',
            description: 'Broadcast a replacement transaction with a higher fee spending at least one of the same inputs if RBF was signaled.',
            tradeoffs: 'Invalidates the original transaction hash and requires re-signing.',
            estimated_cost_sats: 1000,
          },
        ],
      };
    }

    if (code.includes('txn-mempool-conflict') || code.includes('bip125-replacement-disallowed')) {
      return {
        txid,
        reject_code: 'txn-mempool-conflict',
        plain_language_reason: 'This transaction conflicts with an unconfirmed transaction already residing in the node mempool.',
        scope: 'local_policy',
        technical_details: 'An input spent by this transaction is already spent by an existing mempool transaction, and the replacement rules (BIP125 or Full-RBF fee delta) were not satisfied.',
        remediations: [
          {
            action: 'rbf',
            title: 'Increase replacement fee',
            description: 'Provide an incremental fee higher than the sum of fees paid by all directly and indirectly evicted transactions.',
            tradeoffs: 'Requires allocating additional satoshis to satisfy relay bandwidth rules.',
          },
        ],
      };
    }

    if (code.includes('dust')) {
      return {
        txid,
        reject_code: 'dust',
        plain_language_reason: 'An output value is lower than the economical spend threshold (dust limit).',
        scope: 'local_policy',
        technical_details: 'Spending this output would cost more in fees than the value of the output itself under standard relay rates (less than 546 satoshis for standard legacy/SegWit outputs or 330 satoshis for Taproot).',
        remediations: [
          {
            action: 'adjust_fee',
            title: 'Increase output value or consolidate',
            description: 'Increase the output value above the dust threshold or fold the value into network fees or change outputs.',
            tradeoffs: 'Requires amending the transaction outputs and re-signing.',
          },
        ],
      };
    }

    if (code.includes('bad-txns-nonfinal') || code.includes('non-final')) {
      return {
        txid,
        reject_code: 'bad-txns-nonfinal',
        plain_language_reason: 'The transaction locktime or sequence lock has not yet matured.',
        scope: 'consensus',
        technical_details: 'Either nLockTime exceeds the current block height/MTP or nSequence relative locktime requirements have not been satisfied.',
        remediations: [
          {
            action: 'wait_locktime',
            title: 'Wait for target block height or timestamp',
            description: 'Hold the transaction and submit once the blockchain reaches the specified block height or median time past.',
            tradeoffs: 'Requires delaying broadcast until the consensus condition is reached.',
          },
        ],
      };
    }

    // Default fallback explanation
    return {
      txid,
      reject_code: rejectCode || 'unspecified-rejection',
      plain_language_reason: rawReason || 'Transaction rejected by node policy or consensus check.',
      scope: 'local_policy',
      technical_details: rawReason || 'Check node logs and transaction decoding for specific script or limit diagnostics.',
      remediations: [
        {
          action: 'adjust_fee',
          title: 'Review transaction format and fees',
          description: 'Verify all script flags, standardness requirements, and fee allocations.',
          tradeoffs: 'May require regenerating inputs or outputs.',
        },
      ],
    };
  }
}
