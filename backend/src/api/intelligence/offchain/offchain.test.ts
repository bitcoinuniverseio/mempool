import offchainService from './offchain.service';

describe('OffchainService', () => {
  it('should return overview with operators and public offers', () => {
    const overview = offchainService.getOverview();
    expect(overview.total_operators).toBeGreaterThanOrEqual(2);
    expect(overview.active_statechains_count).toBeGreaterThan(0);
    expect(overview.public_offers.length).toBeGreaterThanOrEqual(1);
  });

  it('should list and retrieve statechain and coinswap operators', () => {
    const ops = offchainService.listOperators();
    expect(ops.length).toBeGreaterThanOrEqual(2);

    const first = ops[0];
    const retrieved = offchainService.getOperator(first.operator_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.operator_public_key).toBe(first.operator_public_key);
  });

  it('should verify statechain transfer packages and detect locktime violations', () => {
    const valid = offchainService.verifyTransferPackage({
      statechain_id: 'sc-test-01',
      deposit_amount_sats: 1000000,
      backup_transactions: [
        {
          statechain_id: 'sc-test-01',
          iteration: 1,
          locktime: 865000,
          txid: '01'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig1',
          is_valid_locktime_decrement: true,
        },
        {
          statechain_id: 'sc-test-01',
          iteration: 2,
          locktime: 864000,
          txid: '02'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig2',
          is_valid_locktime_decrement: true,
        },
      ],
      server_signature_count: 2,
      current_height: 860500,
    });
    expect(valid.is_valid).toBe(true);
    expect(valid.signatures_reconciled).toBe(true);
    expect(valid.recoverable_state).toBe('recoverable_after_height');

    const locktimeViolation = offchainService.verifyTransferPackage({
      statechain_id: 'sc-test-02',
      deposit_amount_sats: 1000000,
      backup_transactions: [
        {
          statechain_id: 'sc-test-02',
          iteration: 1,
          locktime: 864000,
          txid: '01'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig1',
          is_valid_locktime_decrement: true,
        },
        {
          statechain_id: 'sc-test-02',
          iteration: 2,
          locktime: 865000, // Invalid: increased locktime
          txid: '02'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig2',
          is_valid_locktime_decrement: false,
        },
      ],
      server_signature_count: 2,
      current_height: 860500,
    });
    expect(locktimeViolation.is_valid).toBe(false);
    expect(locktimeViolation.errors.length).toBeGreaterThan(0);
  });

  it('should verify coinswap timelock ordering and detect reversed locks', () => {
    const valid = offchainService.verifyCoinswapPackage({
      package_id: 'pkg-swap-01',
      maker_id: 'op-teleport-beta',
      swap_amount_sats: 500000,
      contracts: [
        {
          role: 'forward_contract',
          txid: '11'.repeat(32),
          timelock: 861000,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: true,
        },
        {
          role: 'backward_contract',
          txid: '22'.repeat(32),
          timelock: 860800,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: true,
        },
      ],
    });
    expect(valid.is_valid).toBe(true);

    const reversed = offchainService.verifyCoinswapPackage({
      package_id: 'pkg-swap-02',
      maker_id: 'op-teleport-beta',
      swap_amount_sats: 500000,
      contracts: [
        {
          role: 'forward_contract',
          txid: '11'.repeat(32),
          timelock: 860500,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: false,
        },
        {
          role: 'backward_contract',
          txid: '22'.repeat(32),
          timelock: 860900, // Invalid: backward has larger timelock than forward
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: false,
        },
      ],
    });
    expect(reversed.is_valid).toBe(false);
    expect(reversed.errors).toContain(
      'Forward contract timelock must be strictly greater than backward contract timelock for safe recovery'
    );
  });

  it('should generate actionable recovery plans with PSBT export guidance', () => {
    const plan = offchainService.generateRecoveryPlan({
      protocol: 'statechain',
      entity_id: 'sc-test-01',
      current_stage: 'locktime_expired',
      target_locktime: 860000,
      current_height: 860500,
    });
    expect(plan.recovery_state).toBe('recoverable_now');
    expect(plan.requires_fee_bump).toBe(true);
    expect(plan.unsigned_psbt_hex.length).toBeGreaterThan(0);
  });
});
