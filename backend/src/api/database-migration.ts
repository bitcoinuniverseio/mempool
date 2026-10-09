import config from '../config';
import DB from '../database';
import logger from '../logger';
import { Common } from './common';
import blocksRepository from '../repositories/BlocksRepository';
import cpfpRepository from '../repositories/CpfpRepository';
import { RowDataPacket } from 'mysql2';

class DatabaseMigration {
  private static currentVersion = 113;
  private targetMigrationVersion = DatabaseMigration.currentVersion;
  private queryTimeout = 3600_000;
  private statisticsAddedIndexed = false;
  private explicitNullDefaultsAreText = false;
  private uniqueLogs: string[] = [];

  private blocksTruncatedMessage = `'blocks' table has been truncated.`;
  private hashratesTruncatedMessage = `'hashrates' table has been truncated.`;

  /**
   * Avoid printing multiple time the same message
   */
  private uniqueLog(loggerFunction: any, msg: string) {
    if (this.uniqueLogs.includes(msg)) {
      return;
    }
    this.uniqueLogs.push(msg);
    loggerFunction(msg);
  }

  /**
   * Entry point
   * @asyncUnsafe
   */
  /* IMPLEMENTATION-HANDOFF [WP-BE-002]
   * Defect BE-002; coverage COV-BE-002.migration-upgrade, restart, readiness.
   * Reproduction: backend-reproduce.cjs starts at schema 103, injects failure
   * in the later blocks primary-key migration, observes schema_version=112,
   * a resolved initializer and a subsequent startup that skips the repair.
   * $createMissingTablesAndIndexes publishes later markers before the older
   * data/key work; this method then swallows that work's failure. The Liquid
   * pre-106 repair also writes 106 after 112, creating an interruption window.
   * Required invariant: the durable version represents completed, verified
   * steps, and public startup never proceeds with an incomplete migration.
   * 1. Replace the two-phase version advancement with ordered, recorded,
   *    idempotent migration steps. Record a step complete only after its
   *    schema and data postconditions pass. Recover already-drifted versions
   *    by inspecting actual keys/columns; never blindly replay destructive DDL.
   * 2. Propagate migration failure through index.ts before workers/listeners
   *    start. Include an operator-readable failed step without secrets.
   * 3. For transactional DML, hold one dedicated database connection for
   *    BEGIN, all statements, COMMIT/ROLLBACK and release. DDL such as ALTER
   *    TABLE implicitly commits on MySQL/MariaDB; ordinary ROLLBACK does not
   *    undo it. Use explicit restart checkpoints and backup/restore for DDL.
   * 4. Add real-database upgrade fixtures at 103, 105, 106, 109, 110 and 111
   *    plus fresh setup. Kill/restart after each marker and DDL; inject a
   *    key-migration error; test mainnet, Signet and Liquid schema profiles.
   *    Assert exact latest schema/keys, monotonic completed markers, no
   *    duplicate-column restart, and startup failure while work is incomplete.
   * Dependencies: database.ts, index.ts, integration database helpers,
   * owner/bootstrap/private-relay tables and the production migration runner.
   * Sources: R-BE-MYSQL (official implicit-commit rules). Existing table-
   * existence integration checks alone do not cover crash or upgrade safety.
   * Acceptance: the reproduced failure cannot be marked current or serving;
   * every supported upgrade resumes safely and validates its postconditions.
   * Rollback: take/verify a DB backup before DDL, stop writers, restore the
   * matching code/schema snapshot on failed rollout; preserve owner records.
   * Preparation only; this block does not implement the migration repair.
   */
  public async $initializeOrMigrateDatabase(): Promise<void> {
    logger.debug('MIGRATIONS: Running migrations');

    await this.$printDatabaseVersion();

    // First of all, if the `state` database does not exist, create it so we can track migration version
    if (!await this.$checkIfTableExists('state')) {
      logger.debug('MIGRATIONS: `state` table does not exist. Creating it.');
      try {
        await this.$createMigrationStateTable();
      } catch (e) {
        logger.err('MIGRATIONS: Unable to create `state` table, aborting in 10 seconds. ' + e);
        await Common.sleep$(10000);
        process.exit(-1);
      }
      logger.debug('MIGRATIONS: `state` table initialized.');
    }

    let databaseSchemaVersion = 0;
    try {
      databaseSchemaVersion = await this.$getSchemaVersionFromDatabase();
    } catch (e) {
      logger.err('MIGRATIONS: Unable to get current database migration version, aborting in 10 seconds. ' + e);
      await Common.sleep$(10000);
      process.exit(-1);
    }

    if (databaseSchemaVersion === 0) {
      logger.info('Initializing database (first run, clean install)');
    }

    if (databaseSchemaVersion <= 2) {
      // Disable some spam logs when they're not relevant
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      this.uniqueLog(logger.notice, this.hashratesTruncatedMessage);
    }

    logger.debug('MIGRATIONS: Current state.schema_version ' + databaseSchemaVersion);
    logger.debug('MIGRATIONS: Latest DatabaseMigration.version is ' + DatabaseMigration.currentVersion);
    if (!Number.isSafeInteger(databaseSchemaVersion) || databaseSchemaVersion < 0 || databaseSchemaVersion > DatabaseMigration.currentVersion) {
      throw new Error('Unsupported database schema version');
    }
    // Repair falsely advanced markers before publishing any newer version.
    if (databaseSchemaVersion >= 104) await this.$ensureBlockKeys();
    if (databaseSchemaVersion >= 113) await this.$ensureNotificationSequence();
    for (let step = databaseSchemaVersion + 1; step <= DatabaseMigration.currentVersion; step++) {
      this.targetMigrationVersion = step;
      try {
        await this.$createMissingTablesAndIndexes(step - 1);
        await this.$migrateTableSchemaFromVersion(step - 1);
        if (config.MEMPOOL.NETWORK === 'liquid' && (step === 105 || step === 106)) {
          await DB.$transaction(connection => this.$migrateLiquidData(step, connection));
        }
        await this.$executeQuery(`UPDATE state SET number = ${step} WHERE name = 'schema_version';`);
      } catch {
        throw new Error(`Database migration step ${step} failed; startup is blocked`);
      }
    }

  }
  /**
   * Create all missing tables
   * @asyncUnsafe
   */
  private async $createMissingTablesAndIndexes(databaseSchemaVersion: number) {
    await this.$setStatisticsAddedIndexedFlag(databaseSchemaVersion);

    const isBitcoin = ['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK);

    await this.$executeQuery(this.getCreateElementsTableQuery(), await this.$checkIfTableExists('elements_pegs'));
    await this.$executeQuery(this.getCreateStatisticsQuery(), await this.$checkIfTableExists('statistics'));
    if (databaseSchemaVersion < 2 && this.targetMigrationVersion >= 2 && this.statisticsAddedIndexed === false) {
      await this.$executeQuery(`CREATE INDEX added ON statistics (added);`);
    }
    if (databaseSchemaVersion < 3 && this.targetMigrationVersion >= 3) {
      await this.$executeQuery(this.getCreatePoolsTableQuery(), await this.$checkIfTableExists('pools'));
    }
    if (databaseSchemaVersion < 4 && this.targetMigrationVersion >= 4) {
      await this.$executeQuery('DROP table IF EXISTS blocks;');
      await this.$executeQuery(this.getCreateBlocksTableQuery(), await this.$checkIfTableExists('blocks'));
    }
    if (databaseSchemaVersion < 5 && this.targetMigrationVersion >= 5 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('TRUNCATE blocks;'); // Need to re-index
      await this.$executeQuery('ALTER TABLE blocks ADD `reward` double unsigned NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 6 && this.targetMigrationVersion >= 6 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('TRUNCATE blocks;');  // Need to re-index
      // Cleanup original blocks fields type
      await this.$executeQuery('ALTER TABLE blocks MODIFY `height` integer unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `tx_count` smallint unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `size` integer unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `weight` integer unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `difficulty` double NOT NULL DEFAULT "0"');
      // We also fix the pools.id type so we need to drop/re-create the foreign key
      await this.$dropBlocksPoolForeignKey();
      await this.$executeQuery('ALTER TABLE pools MODIFY `id` smallint unsigned AUTO_INCREMENT');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `pool_id` smallint unsigned NULL');
      await this.$executeQuery('ALTER TABLE blocks ADD FOREIGN KEY (`pool_id`) REFERENCES `pools` (`id`)');
      // Add new block indexing fields
      await this.$executeQuery('ALTER TABLE blocks ADD `version` integer unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks ADD `bits` integer unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks ADD `nonce` bigint unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks ADD `merkle_root` varchar(65) NOT NULL DEFAULT ""');
      await this.$executeQuery('ALTER TABLE blocks ADD `previous_block_hash` varchar(65) NULL');
    }

    if (databaseSchemaVersion < 7 && this.targetMigrationVersion >= 7 && isBitcoin === true) {
      await this.$executeQuery('DROP table IF EXISTS hashrates;');
      await this.$executeQuery(this.getCreateDailyStatsTableQuery(), await this.$checkIfTableExists('hashrates'));
    }

    if (databaseSchemaVersion < 8 && this.targetMigrationVersion >= 8 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('TRUNCATE hashrates;'); // Need to re-index
      await this.$executeQuery('ALTER TABLE `hashrates` DROP INDEX `PRIMARY`');
      await this.$executeQuery('ALTER TABLE `hashrates` ADD `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST');
      await this.$executeQuery('ALTER TABLE `hashrates` ADD `share` float NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `hashrates` ADD `type` enum("daily", "weekly") DEFAULT "daily"');
    }

    if (databaseSchemaVersion < 9 && this.targetMigrationVersion >= 9 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.hashratesTruncatedMessage);
      await this.$executeQuery('TRUNCATE hashrates;'); // Need to re-index
      await this.$executeQuery('ALTER TABLE `state` CHANGE `name` `name` varchar(100)');
      await this.$executeQuery('ALTER TABLE `hashrates` ADD UNIQUE `hashrate_timestamp_pool_id` (`hashrate_timestamp`, `pool_id`)');
    }

    if (databaseSchemaVersion < 10 && this.targetMigrationVersion >= 10 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `blockTimestamp` (`blockTimestamp`)');
    }

    if (databaseSchemaVersion < 11 && this.targetMigrationVersion >= 11 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('TRUNCATE blocks;'); // Need to re-index
      await this.$executeQuery(`ALTER TABLE blocks
        ADD avg_fee INT UNSIGNED NULL,
        ADD avg_fee_rate INT UNSIGNED NULL
      `);
      await this.$executeQuery('ALTER TABLE blocks MODIFY `reward` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `median_fee` INT UNSIGNED NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `fees` INT UNSIGNED NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 12 && this.targetMigrationVersion >= 12 && isBitcoin === true) {
      // No need to re-index because the new data type can contain larger values
      await this.$executeQuery('ALTER TABLE blocks MODIFY `fees` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 13 && this.targetMigrationVersion >= 13 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE blocks MODIFY `difficulty` DOUBLE UNSIGNED NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `median_fee` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `avg_fee` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE blocks MODIFY `avg_fee_rate` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 14 && this.targetMigrationVersion >= 14 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.hashratesTruncatedMessage);
      await this.$executeQuery('TRUNCATE hashrates;'); // Need to re-index
      await this.$executeQuery('ALTER TABLE `hashrates` DROP FOREIGN KEY `hashrates_ibfk_1`');
      await this.$executeQuery('ALTER TABLE `hashrates` MODIFY `pool_id` SMALLINT UNSIGNED NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 16 && this.targetMigrationVersion >= 16 && isBitcoin === true) {
      this.uniqueLog(logger.notice, this.hashratesTruncatedMessage);
      await this.$executeQuery('TRUNCATE hashrates;'); // Need to re-index because we changed timestamps
    }

    if (databaseSchemaVersion < 17 && this.targetMigrationVersion >= 17 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `pools` ADD `slug` CHAR(50) NULL');
    }

    if (databaseSchemaVersion < 18 && this.targetMigrationVersion >= 18 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `hash` (`hash`);');
    }

    if (databaseSchemaVersion < 19 && this.targetMigrationVersion >= 19) {
      await this.$executeQuery(this.getCreateRatesTableQuery(), await this.$checkIfTableExists('rates'));
    }

    if (databaseSchemaVersion < 20 && this.targetMigrationVersion >= 20 && isBitcoin === true) {
      await this.$executeQuery(this.getCreateBlocksSummariesTableQuery(), await this.$checkIfTableExists('blocks_summaries'));
    }

    if (databaseSchemaVersion < 21 && this.targetMigrationVersion >= 21) {
      await this.$executeQuery('DROP TABLE IF EXISTS `rates`');
      await this.$executeQuery(this.getCreatePricesTableQuery(), await this.$checkIfTableExists('prices'));
    }

    if (databaseSchemaVersion < 22 && this.targetMigrationVersion >= 22 && isBitcoin === true) {
      await this.$executeQuery('DROP TABLE IF EXISTS `difficulty_adjustments`');
      await this.$executeQuery(this.getCreateDifficultyAdjustmentsTableQuery(), await this.$checkIfTableExists('difficulty_adjustments'));
    }

    if (databaseSchemaVersion < 23 && this.targetMigrationVersion >= 23) {
      await this.$executeQuery('TRUNCATE `prices`');
      await this.$executeQuery('ALTER TABLE `prices` DROP `avg_prices`');
      await this.$executeQuery('ALTER TABLE `prices` ADD `USD` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `EUR` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `GBP` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `CAD` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `CHF` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `AUD` float DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `JPY` float DEFAULT "0"');
    }

    if (databaseSchemaVersion < 24 && this.targetMigrationVersion >= 24 && isBitcoin == true) {
      await this.$executeQuery('DROP TABLE IF EXISTS `blocks_audits`');
      await this.$executeQuery(this.getCreateBlocksAuditsTableQuery(), await this.$checkIfTableExists('blocks_audits'));
    }

    if (databaseSchemaVersion < 25 && this.targetMigrationVersion >= 25 && isBitcoin === true) {
      await this.$executeQuery(this.getCreateLightningStatisticsQuery(), await this.$checkIfTableExists('lightning_stats'));
      await this.$executeQuery(this.getCreateNodesQuery(), await this.$checkIfTableExists('nodes'));
      await this.$executeQuery(this.getCreateChannelsQuery(), await this.$checkIfTableExists('channels'));
      await this.$executeQuery(this.getCreateNodesStatsQuery(), await this.$checkIfTableExists('node_stats'));
    }

    if (databaseSchemaVersion < 26 && this.targetMigrationVersion >= 26 && isBitcoin === true) {
      if (config.LIGHTNING.ENABLED) {
        this.uniqueLog(logger.notice, `'lightning_stats' table has been truncated.`);
      }
      await this.$executeQuery(`TRUNCATE lightning_stats`);
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD tor_nodes int(11) NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD clearnet_nodes int(11) NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD unannounced_nodes int(11) NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 27 && this.targetMigrationVersion >= 27 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_capacity bigint(20) unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_fee_rate int(11) unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_base_fee_mtokens bigint(20) unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_capacity bigint(20) unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_fee_rate int(11) unsigned NOT NULL DEFAULT "0"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_base_fee_mtokens bigint(20) unsigned NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 28 && this.targetMigrationVersion >= 28 && isBitcoin === true) {
      if (config.LIGHTNING.ENABLED) {
        this.uniqueLog(logger.notice, `'lightning_stats' and 'node_stats' tables have been truncated.`);
      }
      await this.$executeQuery(`TRUNCATE lightning_stats`);
      await this.$executeQuery(`TRUNCATE node_stats`);
      await this.$executeQuery(`ALTER TABLE lightning_stats MODIFY added DATE`);
    }

    if (databaseSchemaVersion < 29 && this.targetMigrationVersion >= 29 && isBitcoin === true) {
      await this.$ensureStep29Schema();
    }

    if (databaseSchemaVersion < 30 && this.targetMigrationVersion >= 30 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `geo_names` CHANGE `type` `type` enum("city","country","division","continent","as_organization") NOT NULL');
    }

    if (databaseSchemaVersion < 31 && this.targetMigrationVersion >= 31 && isBitcoin == true) { // Link blocks to prices
      await this.$executeQuery('ALTER TABLE `prices` ADD `id` int NULL AUTO_INCREMENT UNIQUE');
      await this.$executeQuery('DROP TABLE IF EXISTS `blocks_prices`');
      await this.$executeQuery(this.getCreateBlocksPricesTableQuery(), await this.$checkIfTableExists('blocks_prices'));
    }

    if (databaseSchemaVersion < 32 && this.targetMigrationVersion >= 32 && isBitcoin == true) {
      await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD `template` JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 33 && this.targetMigrationVersion >= 33 && isBitcoin == true) {
      await this.$executeQuery('ALTER TABLE `geo_names` CHANGE `type` `type` enum("city","country","division","continent","as_organization", "country_iso_code") NOT NULL');
    }

    if (databaseSchemaVersion < 34 && this.targetMigrationVersion >= 34 && isBitcoin == true) {
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD clearnet_tor_nodes int(11) NOT NULL DEFAULT "0"');
    }

    if (databaseSchemaVersion < 35 && this.targetMigrationVersion >= 35 && isBitcoin == true) {
      await this.$executeQuery('DELETE from `lightning_stats` WHERE added > "2021-09-19"');
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD CONSTRAINT added_unique UNIQUE (added);');
    }

    if (databaseSchemaVersion < 36 && this.targetMigrationVersion >= 36 && isBitcoin == true) {
      await this.$executeQuery('ALTER TABLE `nodes` ADD status TINYINT NOT NULL DEFAULT "1"');
    }

    if (databaseSchemaVersion < 37 && this.targetMigrationVersion >= 37 && isBitcoin == true) {
      await this.$executeQuery(this.getCreateLNNodesSocketsTableQuery(), await this.$checkIfTableExists('nodes_sockets'));
    }

    if (databaseSchemaVersion < 38 && this.targetMigrationVersion >= 38 && isBitcoin == true) {
      if (config.LIGHTNING.ENABLED) {
        this.uniqueLog(logger.notice, `'lightning_stats' and 'node_stats' tables have been truncated.`);
      }
      await this.$executeQuery(`TRUNCATE lightning_stats`);
      await this.$executeQuery(`TRUNCATE node_stats`);
      await this.$executeQuery('ALTER TABLE `lightning_stats` CHANGE `added` `added` timestamp NULL');
      await this.$executeQuery('ALTER TABLE `node_stats` CHANGE `added` `added` timestamp NULL');
    }

    if (databaseSchemaVersion < 39 && this.targetMigrationVersion >= 39 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `nodes` ADD alias_search TEXT NULL DEFAULT NULL AFTER `alias`');
      await this.$executeQuery('ALTER TABLE nodes ADD FULLTEXT(alias_search)');
    }

    if (databaseSchemaVersion < 40 && this.targetMigrationVersion >= 40 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `nodes` ADD capacity bigint(20) unsigned DEFAULT NULL');
      await this.$executeQuery('ALTER TABLE `nodes` ADD channels int(11) unsigned DEFAULT NULL');
      await this.$executeQuery('ALTER TABLE `nodes` ADD INDEX `capacity` (`capacity`);');
    }

    if (databaseSchemaVersion < 41 && this.targetMigrationVersion >= 41 && isBitcoin === true) {
      await this.$executeQuery('UPDATE channels SET closing_reason = NULL WHERE closing_reason = 1');
    }

    if (databaseSchemaVersion < 42 && this.targetMigrationVersion >= 42 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `channels` ADD closing_resolved tinyint(1) DEFAULT 0');
    }

    if (databaseSchemaVersion < 43 && this.targetMigrationVersion >= 43 && isBitcoin === true) {
      await this.$executeQuery(this.getCreateLNNodeRecordsTableQuery(), await this.$checkIfTableExists('nodes_records'));
    }

    if (databaseSchemaVersion < 44 && this.targetMigrationVersion >= 44 && isBitcoin === true) {
      await this.$executeQuery('UPDATE blocks_summaries SET template = NULL');
    }

    if (databaseSchemaVersion < 45 && this.targetMigrationVersion >= 45 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD fresh_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 46 && this.targetMigrationVersion >= 46) {
      await this.$executeQuery(`ALTER TABLE blocks MODIFY blockTimestamp timestamp NOT NULL`);
    }

    if (databaseSchemaVersion < 47 && this.targetMigrationVersion >= 47) {
      await this.$ensureCfpIndexedColumn();
      await this.$executeQuery(this.getCreateCPFPTableQuery(), await this.$checkIfTableExists('cpfp_clusters'));
      await this.$executeQuery(this.getCreateTransactionsTableQuery(), await this.$checkIfTableExists('transactions'));
    }

    if (databaseSchemaVersion < 48 && this.targetMigrationVersion >= 48 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `channels` ADD source_checked tinyint(1) DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD closing_fee bigint(20) unsigned DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD node1_funding_balance bigint(20) unsigned DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD node2_funding_balance bigint(20) unsigned DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD node1_closing_balance bigint(20) unsigned DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD node2_closing_balance bigint(20) unsigned DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD funding_ratio float unsigned DEFAULT NULL');
      await this.$executeQuery('ALTER TABLE `channels` ADD closed_by varchar(66) DEFAULT NULL');
      await this.$executeQuery('ALTER TABLE `channels` ADD single_funded tinyint(1) DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `channels` ADD outputs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 49 && this.targetMigrationVersion >= 49 && isBitcoin === true) {
      await this.$executeQuery('TRUNCATE TABLE `blocks_audits`');
    }

    if (databaseSchemaVersion < 50 && this.targetMigrationVersion >= 50) {
      await this.$executeQuery('ALTER TABLE `blocks` DROP COLUMN `cpfp_indexed`');
    }

    if (databaseSchemaVersion < 51 && this.targetMigrationVersion >= 51) {
      await this.$executeQuery('ALTER TABLE `cpfp_clusters` ADD INDEX `height` (`height`)');
    }

    if (databaseSchemaVersion < 52 && this.targetMigrationVersion >= 52) {
      await this.$executeQuery(this.getCreateCompactCPFPTableQuery(), await this.$checkIfTableExists('compact_cpfp_clusters'));
      await this.$executeQuery(this.getCreateCompactTransactionsTableQuery(), await this.$checkIfTableExists('compact_transactions'));
      try {
        await this.$convertCompactCpfpTables();
        await this.$executeQuery('DROP TABLE IF EXISTS `transactions`');
        await this.$executeQuery('DROP TABLE IF EXISTS `cpfp_clusters`');
      } catch (e) {
        logger.warn('' + (e instanceof Error ? e.message : e));
      }
    }

    if (databaseSchemaVersion < 53 && this.targetMigrationVersion >= 53) {
      await this.$executeQuery('ALTER TABLE statistics MODIFY mempool_byte_weight bigint(20) UNSIGNED NOT NULL');
    }

    if (databaseSchemaVersion < 54 && this.targetMigrationVersion >= 54) {
      this.uniqueLog(logger.notice, `'prices' table has been truncated`);
      await this.$executeQuery(`TRUNCATE prices`);
      if (isBitcoin === true) {
        this.uniqueLog(logger.notice, `'blocks_prices' table has been truncated`);
        await this.$executeQuery(`TRUNCATE blocks_prices`);
      }
    }

    if (databaseSchemaVersion < 55 && this.targetMigrationVersion >= 55) {
      await this.$executeQuery(this.getAdditionalBlocksDataQuery());
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('TRUNCATE blocks;'); // Need to re-index
    }

    if (databaseSchemaVersion < 56 && this.targetMigrationVersion >= 56) {
      await this.$executeQuery('ALTER TABLE pools ADD unique_id int NOT NULL DEFAULT -1');
      await this.$executeQuery('TRUNCATE TABLE `blocks`');
      this.uniqueLog(logger.notice, this.blocksTruncatedMessage);
      await this.$executeQuery('DELETE FROM `pools`');
      await this.$executeQuery('ALTER TABLE pools AUTO_INCREMENT = 1');
      await this.$executeQuery(`UPDATE state SET string = NULL WHERE name = 'pools_json_sha'`);
      this.uniqueLog(logger.notice, '`pools` table has been truncated`');
    }

    if (databaseSchemaVersion < 57 && this.targetMigrationVersion >= 57 && isBitcoin === true) {
      await this.$executeQuery(`ALTER TABLE nodes MODIFY updated_at datetime NULL`);
    }

    if (databaseSchemaVersion < 58 && this.targetMigrationVersion >= 58) {
      // We only run some migration queries for this version
    }

    if (databaseSchemaVersion < 59 && this.targetMigrationVersion >= 59 && (config.MEMPOOL.NETWORK === 'signet' || config.MEMPOOL.NETWORK === 'testnet')) {
      // https://github.com/mempool/mempool/issues/3360
      await this.$executeQuery(`TRUNCATE prices`);
    }

    if (databaseSchemaVersion < 60 && this.targetMigrationVersion >= 60 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD sigop_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 61 && this.targetMigrationVersion >= 61 && isBitcoin === true) {
      // Break block templates into their own table
      if (! await this.$checkIfTableExists('blocks_templates')) {
        await this.$executeQuery('CREATE TABLE blocks_templates AS SELECT id, template FROM blocks_summaries WHERE template != "[]"');
      }
      await this.$executeQuery('ALTER TABLE blocks_templates MODIFY template JSON DEFAULT (JSON_ARRAY())');
      await this.$executeQuery('ALTER TABLE blocks_templates ADD PRIMARY KEY (id)');
      await this.$executeQuery('ALTER TABLE blocks_summaries DROP COLUMN template');
    }

    if (databaseSchemaVersion < 62 && this.targetMigrationVersion >= 62 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD expected_fees BIGINT UNSIGNED DEFAULT NULL');
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD expected_weight BIGINT UNSIGNED DEFAULT NULL');
    }

    if (databaseSchemaVersion < 63 && this.targetMigrationVersion >= 63 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD fullrbf_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 64 && this.targetMigrationVersion >= 64 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `nodes` ADD features text NULL');
    }

    if (databaseSchemaVersion < 65 && this.targetMigrationVersion >= 65 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD accelerated_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 66 && this.targetMigrationVersion >= 66) {
      await this.$executeQuery('ALTER TABLE `statistics` ADD min_fee FLOAT UNSIGNED DEFAULT NULL');
    }

    if (databaseSchemaVersion < 67 && this.targetMigrationVersion >= 67  && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD version INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD INDEX `version` (`version`)');
      await this.$executeQuery('ALTER TABLE `blocks_templates` ADD version INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `blocks_templates` ADD INDEX `version` (`version`)');
    }

    if (databaseSchemaVersion < 68 && this.targetMigrationVersion >= 68 && config.MEMPOOL.NETWORK === 'liquid') {
      await this.$executeQuery('TRUNCATE TABLE elements_pegs');
      await this.$executeQuery('ALTER TABLE elements_pegs ADD PRIMARY KEY (txid, txindex);');
      await this.$executeQuery(`UPDATE state SET number = 0 WHERE name = 'last_elements_block';`);
      // Create the federation_addresses table and add the two Liquid Federation change addresses in
      await this.$executeQuery(this.getCreateFederationAddressesTableQuery(), await this.$checkIfTableExists('federation_addresses'));
      await this.$executeQuery(`INSERT INTO federation_addresses (bitcoinaddress) VALUES ('bc1qxvay4an52gcghxq5lavact7r6qe9l4laedsazz8fj2ee2cy47tlqff4aj4')`); // Federation change address
      await this.$executeQuery(`INSERT INTO federation_addresses (bitcoinaddress) VALUES ('3EiAcrzq1cELXScc98KeCswGWZaPGceT1d')`); // Federation change address
      // Create the federation_txos table that uses the federation_addresses table as a foreign key
      await this.$executeQuery(this.getCreateFederationTxosTableQuery(), await this.$checkIfTableExists('federation_txos'));
      await this.$executeQuery(`INSERT INTO state VALUES('last_bitcoin_block_audit', 0, NULL);`);
    }

    if (databaseSchemaVersion < 69 && this.targetMigrationVersion >= 69 && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$executeQuery(this.getCreateAccelerationsTableQuery(), await this.$checkIfTableExists('accelerations'));
    }

    if (databaseSchemaVersion < 70 && this.targetMigrationVersion >= 70 && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$executeQuery('ALTER TABLE accelerations MODIFY COLUMN added DATETIME;');
    }

    if (databaseSchemaVersion < 71 && this.targetMigrationVersion >= 71 && config.MEMPOOL.NETWORK === 'liquid') {
      await this.$executeQuery('TRUNCATE TABLE elements_pegs');
      await this.$executeQuery('TRUNCATE TABLE federation_txos');
      await this.$executeQuery('SET FOREIGN_KEY_CHECKS = 0');
      await this.$executeQuery('TRUNCATE TABLE federation_addresses');
      await this.$executeQuery('SET FOREIGN_KEY_CHECKS = 1');
      await this.$executeQuery(`INSERT INTO federation_addresses (bitcoinaddress) VALUES ('bc1qxvay4an52gcghxq5lavact7r6qe9l4laedsazz8fj2ee2cy47tlqff4aj4')`); // Federation change address
      await this.$executeQuery(`INSERT INTO federation_addresses (bitcoinaddress) VALUES ('3EiAcrzq1cELXScc98KeCswGWZaPGceT1d')`); // Federation change address
      await this.$executeQuery(`UPDATE state SET number = 0 WHERE name = 'last_elements_block';`);
      await this.$executeQuery(`UPDATE state SET number = 0 WHERE name = 'last_bitcoin_block_audit';`);
      await this.$executeQuery('ALTER TABLE `federation_txos` ADD timelock INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `federation_txos` ADD expiredAt INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `federation_txos` ADD emergencyKey TINYINT NOT NULL DEFAULT 0');
    }

    if (databaseSchemaVersion < 72 && this.targetMigrationVersion >= 72 && isBitcoin === true) {
      // reindex Goggles flags for mined block templates above height 832000
      await this.$executeQuery('UPDATE blocks_summaries SET version = 0 WHERE height >= 832000;');
    }

    if (databaseSchemaVersion < 73 && this.targetMigrationVersion >= 73 && config.MEMPOOL.NETWORK === 'mainnet') {
      // Clear bad data
      await this.$executeQuery(`TRUNCATE accelerations`);
      this.uniqueLog(logger.notice, `'accelerations' table has been truncated`);
    }

    if (databaseSchemaVersion < 74 && this.targetMigrationVersion >= 74 && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$executeQuery(`INSERT INTO state(name, number) VALUE ('last_acceleration_block', 0);`);
    }

    if (databaseSchemaVersion < 75 && this.targetMigrationVersion >= 75) {
      await this.$executeQuery('ALTER TABLE `prices` ADD `BGN` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `BRL` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `CNY` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `CZK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `DKK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `HKD` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `HRK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `HUF` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `IDR` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `ILS` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `INR` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `ISK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `KRW` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `MXN` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `MYR` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `NOK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `NZD` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `PHP` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `PLN` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `RON` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `RUB` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `SEK` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `SGD` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `THB` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `TRY` float DEFAULT "-1"');
      await this.$executeQuery('ALTER TABLE `prices` ADD `ZAR` float DEFAULT "-1"');

      if (isBitcoin === true) {
        await this.$executeQuery('TRUNCATE hashrates');
        await this.$executeQuery('TRUNCATE difficulty_adjustments');
        await this.$executeQuery(`UPDATE state SET string = NULL WHERE name = 'pools_json_sha'`);
      }
    }

    if (databaseSchemaVersion < 76 && this.targetMigrationVersion >= 76 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD prioritized_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 77 && this.targetMigrationVersion >= 77 && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$executeQuery('ALTER TABLE `accelerations` ADD requested datetime DEFAULT NULL');
    }

    if (databaseSchemaVersion < 78 && this.targetMigrationVersion >= 78) {
      await this.$executeQuery('ALTER TABLE `prices` CHANGE `time` `time` datetime NOT NULL');
    }

    if (databaseSchemaVersion < 79 && this.targetMigrationVersion >= 79 && config.MEMPOOL.NETWORK === 'mainnet') {
      // Clear bad data
      await this.$executeQuery(`TRUNCATE accelerations`);
      this.uniqueLog(logger.notice, `'accelerations' table has been truncated`);
      await this.$executeQuery(`
        UPDATE state
        SET number = 0
        WHERE name = 'last_acceleration_block'
      `);
    }

    if (databaseSchemaVersion < 80 && this.targetMigrationVersion >= 80) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD coinbase_addresses JSON DEFAULT NULL');
    }

    if (databaseSchemaVersion < 81 && this.targetMigrationVersion >= 81 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD version INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD INDEX `version` (`version`)');
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD unseen_txs JSON DEFAULT (JSON_ARRAY())');
    }

    if (databaseSchemaVersion < 82 && this.targetMigrationVersion >= 82 && isBitcoin === true && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$fixBadV1AuditBlocks();
    }

    if (databaseSchemaVersion < 83 && this.targetMigrationVersion >= 83 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD first_seen datetime(6) DEFAULT NULL');
    }

    // add new pools indexes
    if (databaseSchemaVersion < 84 && this.targetMigrationVersion >= 84 && isBitcoin === true) {
      await this.$executeQuery(`
        ALTER TABLE \`pools\`
          ADD INDEX \`slug\` (\`slug\`),
          ADD INDEX \`unique_id\` (\`unique_id\`)
      `);
    }

    // lightning channels indexes
    if (databaseSchemaVersion < 85 && this.targetMigrationVersion >= 85 && isBitcoin === true) {
      await this.$executeQuery(`
        ALTER TABLE \`channels\`
          ADD INDEX \`created\` (\`created\`),
          ADD INDEX \`capacity\` (\`capacity\`),
          ADD INDEX \`closing_reason\` (\`closing_reason\`),
          ADD INDEX \`closing_resolved\` (\`closing_resolved\`)
      `);
    }

    // lightning nodes indexes
    if (databaseSchemaVersion < 86 && this.targetMigrationVersion >= 86 && isBitcoin === true) {
      await this.$executeQuery(`
        ALTER TABLE \`nodes\`
          ADD INDEX \`status\` (\`status\`),
          ADD INDEX \`channels\` (\`channels\`),
          ADD INDEX \`country_id\` (\`country_id\`),
          ADD INDEX \`as_number\` (\`as_number\`),
          ADD INDEX \`first_seen\` (\`first_seen\`)
      `);
    }

    // lightning node sockets indexes
    if (databaseSchemaVersion < 87 && this.targetMigrationVersion >= 87 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `nodes_sockets` ADD INDEX `type` (`type`)');
    }

    // lightning stats indexes
    if (databaseSchemaVersion < 88 && this.targetMigrationVersion >= 88 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `lightning_stats` ADD INDEX `added` (`added`)');
    }

    // geo names indexes
    if (databaseSchemaVersion < 89 && this.targetMigrationVersion >= 89 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `geo_names` ADD INDEX `names` (`names`(191))');
    }

    // hashrates indexes
    if (databaseSchemaVersion < 90 && this.targetMigrationVersion >= 90 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `hashrates` ADD INDEX `type` (`type`)');
    }

    // block audits indexes
    if (databaseSchemaVersion < 91 && this.targetMigrationVersion >= 91 && isBitcoin === true) {
      await this.$executeQuery('ALTER TABLE `blocks_audits` ADD INDEX `time` (`time`)');
    }

    // elements_pegs indexes
    if (databaseSchemaVersion < 92 && this.targetMigrationVersion >= 92 && config.MEMPOOL.NETWORK === 'liquid') {
      await this.$executeQuery(`
        ALTER TABLE \`elements_pegs\`
          ADD INDEX \`block\` (\`block\`),
          ADD INDEX \`datetime\` (\`datetime\`),
          ADD INDEX \`amount\` (\`amount\`),
          ADD INDEX \`bitcoinaddress\` (\`bitcoinaddress\`),
          ADD INDEX \`bitcointxid\` (\`bitcointxid\`)
      `);
    }

    // federation_txos indexes
    if (databaseSchemaVersion < 93 && this.targetMigrationVersion >= 93 && config.MEMPOOL.NETWORK === 'liquid') {
      await this.$executeQuery(`
        ALTER TABLE \`federation_txos\`
          ADD INDEX \`unspent\` (\`unspent\`),
          ADD INDEX \`lastblockupdate\` (\`lastblockupdate\`),
          ADD INDEX \`blocktime\` (\`blocktime\`),
          ADD INDEX \`emergencyKey\` (\`emergencyKey\`),
          ADD INDEX \`expiredAt\` (\`expiredAt\`)
      `);
    }

    // Unify database schema for all mempool netwoks
    // versions above 94 should not use network-specific flags
    if (databaseSchemaVersion < 94 && this.targetMigrationVersion >= 94) {

      if (!isBitcoin) {
        // Apply all the bitcoin specific migrations to non-bitcoin networks: liquid, liquidtestnet and testnet4 (!)
        // Version 5
        await this.$executeQuery('ALTER TABLE blocks ADD `reward` double unsigned NOT NULL DEFAULT "0"');

        // Version 6
        await this.$executeQuery('ALTER TABLE blocks MODIFY `height` integer unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `tx_count` smallint unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `size` integer unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `weight` integer unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `difficulty` double NOT NULL DEFAULT "0"');
        await this.$dropBlocksPoolForeignKey();
        await this.$executeQuery('ALTER TABLE pools MODIFY `id` smallint unsigned AUTO_INCREMENT');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `pool_id` smallint unsigned NULL');
        await this.$executeQuery('ALTER TABLE blocks ADD FOREIGN KEY (`pool_id`) REFERENCES `pools` (`id`)');
        await this.$executeQuery('ALTER TABLE blocks ADD `version` integer unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks ADD `bits` integer unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks ADD `nonce` bigint unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks ADD `merkle_root` varchar(65) NOT NULL DEFAULT ""');
        await this.$executeQuery('ALTER TABLE blocks ADD `previous_block_hash` varchar(65) NULL');

        // Version 7
        await this.$executeQuery('DROP table IF EXISTS hashrates;');
        await this.$executeQuery(this.getCreateDailyStatsTableQuery(), await this.$checkIfTableExists('hashrates'));

        // Version 8
        await this.$executeQuery('ALTER TABLE `hashrates` DROP INDEX `PRIMARY`');
        await this.$executeQuery('ALTER TABLE `hashrates` ADD `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST');
        await this.$executeQuery('ALTER TABLE `hashrates` ADD `share` float NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `hashrates` ADD `type` enum("daily", "weekly") DEFAULT "daily"');

        // Version 9
        await this.$executeQuery('ALTER TABLE `state` CHANGE `name` `name` varchar(100)');
        await this.$executeQuery('ALTER TABLE `hashrates` ADD UNIQUE `hashrate_timestamp_pool_id` (`hashrate_timestamp`, `pool_id`)');

        // Version 10
        await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `blockTimestamp` (`blockTimestamp`)');

        // Version 11
        await this.$executeQuery(`ALTER TABLE blocks
          ADD avg_fee INT UNSIGNED NULL,
          ADD avg_fee_rate INT UNSIGNED NULL
        `);
        await this.$executeQuery('ALTER TABLE blocks MODIFY `reward` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `median_fee` INT UNSIGNED NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `fees` INT UNSIGNED NOT NULL DEFAULT "0"');

        // Version 12
        await this.$executeQuery('ALTER TABLE blocks MODIFY `fees` BIGINT UNSIGNED NOT NULL DEFAULT "0"');

        // Version 13
        await this.$executeQuery('ALTER TABLE blocks MODIFY `difficulty` DOUBLE UNSIGNED NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `median_fee` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `avg_fee` BIGINT UNSIGNED NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE blocks MODIFY `avg_fee_rate` BIGINT UNSIGNED NOT NULL DEFAULT "0"');

        // Version 14
        await this.$executeQuery('ALTER TABLE `hashrates` DROP FOREIGN KEY `hashrates_ibfk_1`');
        await this.$executeQuery('ALTER TABLE `hashrates` MODIFY `pool_id` SMALLINT UNSIGNED NOT NULL DEFAULT "0"');

        // Version 17
        await this.$executeQuery('ALTER TABLE `pools` ADD `slug` CHAR(50) NULL');

        // Version 18
        await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `hash` (`hash`);');

        // Version 20
        await this.$executeQuery(this.getCreateBlocksSummariesTableQuery(), await this.$checkIfTableExists('blocks_summaries'));

        // Version 22
        await this.$executeQuery('DROP TABLE IF EXISTS `difficulty_adjustments`');
        await this.$executeQuery(this.getCreateDifficultyAdjustmentsTableQuery(), await this.$checkIfTableExists('difficulty_adjustments'));

        // Version 24
        await this.$executeQuery('DROP TABLE IF EXISTS `blocks_audits`');
        await this.$executeQuery(this.getCreateBlocksAuditsTableQuery(), await this.$checkIfTableExists('blocks_audits'));

        // Version 25
        await this.$executeQuery(this.getCreateLightningStatisticsQuery(), await this.$checkIfTableExists('lightning_stats'));
        await this.$executeQuery(this.getCreateNodesQuery(), await this.$checkIfTableExists('nodes'));
        await this.$executeQuery(this.getCreateChannelsQuery(), await this.$checkIfTableExists('channels'));
        await this.$executeQuery(this.getCreateNodesStatsQuery(), await this.$checkIfTableExists('node_stats'));

        // Version 26
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD tor_nodes int(11) NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD clearnet_nodes int(11) NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD unannounced_nodes int(11) NOT NULL DEFAULT "0"');

        // Version 27
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_capacity bigint(20) unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_fee_rate int(11) unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD avg_base_fee_mtokens bigint(20) unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_capacity bigint(20) unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_fee_rate int(11) unsigned NOT NULL DEFAULT "0"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD med_base_fee_mtokens bigint(20) unsigned NOT NULL DEFAULT "0"');

        // Version 28
        await this.$executeQuery(`ALTER TABLE lightning_stats MODIFY added DATE`);

        // Version 29
        await this.$executeQuery(this.getCreateGeoNamesTableQuery(), await this.$checkIfTableExists('geo_names'));
        await this.$executeQuery('ALTER TABLE `nodes` ADD as_number int(11) unsigned NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD city_id int(11) unsigned NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD country_id int(11) unsigned NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD accuracy_radius int(11) unsigned NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD subdivision_id int(11) unsigned NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD longitude double NULL DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD latitude double NULL DEFAULT NULL');

        // Version 30
        await this.$executeQuery('ALTER TABLE `geo_names` CHANGE `type` `type` enum("city","country","division","continent","as_organization") NOT NULL');

        // Version 31
        await this.$executeQuery('ALTER TABLE `prices` ADD `id` int NULL AUTO_INCREMENT UNIQUE');
        await this.$executeQuery('DROP TABLE IF EXISTS `blocks_prices`');
        await this.$executeQuery(this.getCreateBlocksPricesTableQuery(), await this.$checkIfTableExists('blocks_prices'));

        // Version 32
        await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD `template` JSON DEFAULT (JSON_ARRAY())');

        // Version 33
        await this.$executeQuery('ALTER TABLE `geo_names` CHANGE `type` `type` enum("city","country","division","continent","as_organization", "country_iso_code") NOT NULL');

        // Version 34
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD clearnet_tor_nodes int(11) NOT NULL DEFAULT "0"');

        // Version 35
        await this.$executeQuery('DELETE from `lightning_stats` WHERE added > "2021-09-19"');
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD CONSTRAINT added_unique UNIQUE (added);');

        // Version 36
        await this.$executeQuery('ALTER TABLE `nodes` ADD status TINYINT NOT NULL DEFAULT "1"');

        // Version 37
        await this.$executeQuery(this.getCreateLNNodesSocketsTableQuery(), await this.$checkIfTableExists('nodes_sockets'));

        // Version 38
        await this.$executeQuery(`TRUNCATE lightning_stats`);
        await this.$executeQuery(`TRUNCATE node_stats`);
        await this.$executeQuery('ALTER TABLE `lightning_stats` CHANGE `added` `added` timestamp NULL');
        await this.$executeQuery('ALTER TABLE `node_stats` CHANGE `added` `added` timestamp NULL');

        // Version 39
        await this.$executeQuery('ALTER TABLE `nodes` ADD alias_search TEXT NULL DEFAULT NULL AFTER `alias`');
        await this.$executeQuery('ALTER TABLE nodes ADD FULLTEXT(alias_search)');

        // Version 40
        await this.$executeQuery('ALTER TABLE `nodes` ADD capacity bigint(20) unsigned DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD channels int(11) unsigned DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `nodes` ADD INDEX `capacity` (`capacity`);');

        // Version 41
        await this.$executeQuery('UPDATE channels SET closing_reason = NULL WHERE closing_reason = 1');

        // Version 42
        await this.$executeQuery('ALTER TABLE `channels` ADD closing_resolved tinyint(1) DEFAULT 0');

        // Version 43
        await this.$executeQuery(this.getCreateLNNodeRecordsTableQuery(), await this.$checkIfTableExists('nodes_records'));

        // Version 44
        await this.$executeQuery('UPDATE blocks_summaries SET template = NULL');

        // Version 45
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD fresh_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 48
        await this.$executeQuery('ALTER TABLE `channels` ADD source_checked tinyint(1) DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD closing_fee bigint(20) unsigned DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD node1_funding_balance bigint(20) unsigned DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD node2_funding_balance bigint(20) unsigned DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD node1_closing_balance bigint(20) unsigned DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD node2_closing_balance bigint(20) unsigned DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD funding_ratio float unsigned DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `channels` ADD closed_by varchar(66) DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `channels` ADD single_funded tinyint(1) DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `channels` ADD outputs JSON DEFAULT (JSON_ARRAY())');

        // Version 57
        await this.$executeQuery(`ALTER TABLE nodes MODIFY updated_at datetime NULL`);

        // Version 60
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD sigop_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 61
        if (! await this.$checkIfTableExists('blocks_templates')) {
          await this.$executeQuery('CREATE TABLE blocks_templates AS SELECT id, template FROM blocks_summaries WHERE template != "[]"');
        }
        await this.$executeQuery('ALTER TABLE blocks_templates MODIFY template JSON DEFAULT (JSON_ARRAY())');
        await this.$executeQuery('ALTER TABLE blocks_templates ADD PRIMARY KEY (id)');
        await this.$executeQuery('ALTER TABLE blocks_summaries DROP COLUMN template');

        // Version 62
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD expected_fees BIGINT UNSIGNED DEFAULT NULL');
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD expected_weight BIGINT UNSIGNED DEFAULT NULL');

        // Version 63
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD fullrbf_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 64
        await this.$executeQuery('ALTER TABLE `nodes` ADD features text NULL');

        // Version 65
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD accelerated_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 67
        await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD version INT NOT NULL DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `blocks_summaries` ADD INDEX `version` (`version`)');
        await this.$executeQuery('ALTER TABLE `blocks_templates` ADD version INT NOT NULL DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `blocks_templates` ADD INDEX `version` (`version`)');

        // Version 76
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD prioritized_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 81
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD version INT NOT NULL DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD INDEX `version` (`version`)');
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD unseen_txs JSON DEFAULT (JSON_ARRAY())');

        // Version 83
        await this.$executeQuery('ALTER TABLE `blocks` ADD first_seen datetime(6) DEFAULT NULL');

        // Version 84
        await this.$executeQuery(`
          ALTER TABLE \`pools\`
            ADD INDEX \`slug\` (\`slug\`),
            ADD INDEX \`unique_id\` (\`unique_id\`)
        `);

        // Version 85
        await this.$executeQuery(`
          ALTER TABLE \`channels\`
            ADD INDEX \`created\` (\`created\`),
            ADD INDEX \`capacity\` (\`capacity\`),
            ADD INDEX \`closing_reason\` (\`closing_reason\`),
            ADD INDEX \`closing_resolved\` (\`closing_resolved\`)
        `);

        // Version 86
        await this.$executeQuery(`
          ALTER TABLE \`nodes\`
            ADD INDEX \`status\` (\`status\`),
            ADD INDEX \`channels\` (\`channels\`),
            ADD INDEX \`country_id\` (\`country_id\`),
            ADD INDEX \`as_number\` (\`as_number\`),
            ADD INDEX \`first_seen\` (\`first_seen\`)
        `);

        // Version 87
        await this.$executeQuery('ALTER TABLE `nodes_sockets` ADD INDEX `type` (`type`)');

        // Version 88
        await this.$executeQuery('ALTER TABLE `lightning_stats` ADD INDEX `added` (`added`)');

        // Version 89
        await this.$executeQuery('ALTER TABLE `geo_names` ADD INDEX `names` (`names`(191))');

        // Version 90
        await this.$executeQuery('ALTER TABLE `hashrates` ADD INDEX `type` (`type`)');

        // Version 91
        await this.$executeQuery('ALTER TABLE `blocks_audits` ADD INDEX `time` (`time`)');
      }

      if (config.MEMPOOL.NETWORK !== 'liquid') {
        // Apply all the liquid specific migrations to all other networks
        // Version 68
        await this.$executeQuery('ALTER TABLE elements_pegs ADD PRIMARY KEY (txid, txindex);');
        await this.$executeQuery(this.getCreateFederationAddressesTableQuery(), await this.$checkIfTableExists('federation_addresses'));
        await this.$executeQuery(this.getCreateFederationTxosTableQuery(), await this.$checkIfTableExists('federation_txos'));

        // Version 71
        await this.$executeQuery('ALTER TABLE `federation_txos` ADD timelock INT NOT NULL DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `federation_txos` ADD expiredAt INT NOT NULL DEFAULT 0');
        await this.$executeQuery('ALTER TABLE `federation_txos` ADD emergencyKey TINYINT NOT NULL DEFAULT 0');

        // Version 92
        await this.$executeQuery(`
          ALTER TABLE \`elements_pegs\`
            ADD INDEX \`block\` (\`block\`),
            ADD INDEX \`datetime\` (\`datetime\`),
            ADD INDEX \`amount\` (\`amount\`),
            ADD INDEX \`bitcoinaddress\` (\`bitcoinaddress\`),
            ADD INDEX \`bitcointxid\` (\`bitcointxid\`)
        `);

        // Version 93
        await this.$executeQuery(`
          ALTER TABLE \`federation_txos\`
            ADD INDEX \`unspent\` (\`unspent\`),
            ADD INDEX \`lastblockupdate\` (\`lastblockupdate\`),
            ADD INDEX \`blocktime\` (\`blocktime\`),
            ADD INDEX \`emergencyKey\` (\`emergencyKey\`),
            ADD INDEX \`expiredAt\` (\`expiredAt\`)
        `);
      }

      if (config.MEMPOOL.NETWORK !== 'mainnet') {
        // Apply all the mainnet specific migrations to all other networks
        // Version 69
        await this.$executeQuery(this.getCreateAccelerationsTableQuery(), await this.$checkIfTableExists('accelerations'));

        // Version 70
        await this.$executeQuery('ALTER TABLE accelerations MODIFY COLUMN added DATETIME;');

        // Version 77
        await this.$executeQuery('ALTER TABLE `accelerations` ADD requested datetime DEFAULT NULL');
      }
    }

    // blocks pools-v2.json hash
    if (databaseSchemaVersion < 95 && this.targetMigrationVersion >= 95) {
      let poolJsonSha = 'f737d86571d190cf1a1a3cf5fd86b33ba9624254'; // https://github.com/mempool/mining-pools/commit/f737d86571d190cf1a1a3cf5fd86b33ba9624254
      const [poolJsonShaDb]: any[] = await DB.query(`SELECT string FROM state WHERE name = 'pools_json_sha'`);
      if (poolJsonShaDb?.length > 0) {
        poolJsonSha = poolJsonShaDb[0].string;
      }
      await this.$executeQuery(`ALTER TABLE blocks ADD definition_hash varchar(255) NOT NULL DEFAULT "${poolJsonSha}"`);
      await this.$executeQuery('ALTER TABLE blocks ADD INDEX `definition_hash` (`definition_hash`)');
    }

    if (databaseSchemaVersion < 96 && this.targetMigrationVersion >= 96) {
      await this.$executeQuery(`ALTER TABLE blocks_audits MODIFY time timestamp NOT NULL`);
    }

    // Make definition_hash nullable
    if (databaseSchemaVersion < 97 && this.targetMigrationVersion >= 97) {
      let poolJsonSha = '895cf0903e771beb647d0c1356bb4b8f4f123af7'; // https://github.com/mempool/mining-pools/commit/895cf0903e771beb647d0c1356bb4b8f4f123af7
      const [poolJsonShaDb]: any[] = await DB.query(`SELECT string FROM state WHERE name = 'pools_json_sha'`);
      if (poolJsonShaDb?.length > 0) {
        poolJsonSha = poolJsonShaDb[0].string;
      }
      await this.$executeQuery(`ALTER TABLE blocks MODIFY COLUMN definition_hash varchar(255) NULL DEFAULT "${poolJsonSha}"`);
    }

    // reindex mainnet Goggles flags for mined block templates above height 896070
    // (since the first annex transaction at height 896071)
    // (safe to make this conditional on the network since it doesn't change the database schema)
    if (databaseSchemaVersion < 98 && this.targetMigrationVersion >= 98 && config.MEMPOOL.NETWORK === 'mainnet') {
      await this.$executeQuery('UPDATE blocks_summaries SET version = 0 WHERE height >= 896070;');
    }

    // Add vsize_0 to statistics table
    if (databaseSchemaVersion < 99 && this.targetMigrationVersion >= 99) {
      await this.$executeQuery('ALTER TABLE statistics ADD COLUMN vsize_0 int(11) NOT NULL DEFAULT 0');
    }

    // Add "block indexed at version" index_version column to the blocks table
    // to be used for lazy migrations & reindexing tasks
    if (databaseSchemaVersion < 100 && this.targetMigrationVersion >= 100) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD index_version INT NOT NULL DEFAULT 0');
      await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `index_version` (`index_version`)');
    }

    if (databaseSchemaVersion < 102 && this.targetMigrationVersion >= 102) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD stale BOOL NOT NULL DEFAULT 0');
    }

    if (databaseSchemaVersion < 103 && this.targetMigrationVersion >= 103) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD INDEX `stale` (`stale`)');
    }

    // reindex liquid federation addresses and txos when needed, and add hardcoded federation addresses
    // (safe to make this conditional on the network since it doesn't change the database schema)


    // another liquid failure, fix bad timelocks on federation txos
    // (safe to make this conditional on the network since it doesn't change the database schema)
    // Durable operation runs for the private Control Center adapter.
    //
    // The Control Center starts an operation here and polls for its outcome,
    // so a run has to survive a restart. A run whose lease expires without
    // reaching a terminal state is moved to NEEDS_REVIEW rather than being
    // reported as success or failure, since neither can be proven.
    if (databaseSchemaVersion < 107 && this.targetMigrationVersion >= 107) {
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS admin_adapter_runs (
        run_id CHAR(36) NOT NULL,
        operation_id VARCHAR(160) NOT NULL,
        operation_version VARCHAR(32) NOT NULL,
        state VARCHAR(24) NOT NULL,
        target VARCHAR(300) NOT NULL,
        correlation_id VARCHAR(128) NOT NULL,
        idempotency_key VARCHAR(200) NULL,
        actor VARCHAR(200) NOT NULL,
        reason VARCHAR(500) NULL,
        queued_at DATETIME(3) NOT NULL,
        started_at DATETIME(3) NULL,
        updated_at DATETIME(3) NOT NULL,
        finished_at DATETIME(3) NULL,
        heartbeat_at DATETIME(3) NULL,
        lease_expires_at DATETIME(3) NULL,
        progress_percent SMALLINT UNSIGNED NULL,
        cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
        document JSON NOT NULL,
        PRIMARY KEY (run_id),
        UNIQUE KEY uq_admin_adapter_runs_idempotency (operation_id, idempotency_key),
        INDEX admin_adapter_runs_state (state, updated_at),
        INDEX admin_adapter_runs_queued (queued_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS admin_adapter_locks (
        lock_key VARCHAR(200) NOT NULL,
        run_id CHAR(36) NOT NULL,
        acquired_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (lock_key),
        INDEX admin_adapter_locks_expiry (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (databaseSchemaVersion < 108 && this.targetMigrationVersion >= 108) {
      // Every digest stamped through the OpenTimestamps surface, with the proof
      // the calendars returned and what the upgrade found afterwards. The
      // document carries the record; the columns exist for the reads.
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS universe_timestamp_records (
        record_id CHAR(36) NOT NULL,
        digest_hex CHAR(64) NOT NULL,
        network VARCHAR(16) NOT NULL,
        commitment_hex CHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL,
        submitted_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        anchor_block_height INT UNSIGNED NULL,
        document JSON NOT NULL,
        PRIMARY KEY (record_id),
        INDEX universe_timestamp_records_digest (digest_hex, network),
        INDEX universe_timestamp_records_status (status, submitted_at),
        INDEX universe_timestamp_records_anchor (anchor_block_height)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
    if (databaseSchemaVersion < 109 && this.targetMigrationVersion >= 109) {
      // Owner-scoped intelligence state: developer API keys and webhooks,
      // watchlists with their entities and rules, saved queries, matcher
      // notifications with their delivery outbox, and the matcher checkpoint.
      // Every tenant row carries owner_id and network; the network is the
      // backend's own, never chosen by the caller. Secrets are never stored in
      // clear: keys as a peppered hash, webhook signing secrets encrypted.
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_settings (
        name VARCHAR(64) NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_api_keys (
        key_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        key_hash CHAR(64) NOT NULL,
        hash_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
        name VARCHAR(128) NOT NULL,
        scopes_json JSON NOT NULL,
        rate_limit INT UNSIGNED NOT NULL,
        expires_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        last_used_at DATETIME(3) NULL,
        revoked_at DATETIME(3) NULL,
        PRIMARY KEY (key_id),
        UNIQUE INDEX intelligence_api_keys_hash (key_hash),
        INDEX intelligence_api_keys_owner (owner_id, network, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_webhooks (
        webhook_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        url VARCHAR(2048) NOT NULL,
        secret_ciphertext VARCHAR(512) NOT NULL,
        key_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
        event_filters_json JSON NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (webhook_id),
        INDEX intelligence_webhooks_owner (owner_id, network, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_watchlists (
        watchlist_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        name VARCHAR(128) NOT NULL,
        privacy_mode VARCHAR(16) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        PRIMARY KEY (watchlist_id),
        INDEX intelligence_watchlists_owner (owner_id, network, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_watchlist_entities (
        entity_id CHAR(36) NOT NULL,
        watchlist_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        entity_type VARCHAR(24) NOT NULL,
        blinded_hash CHAR(64) NOT NULL,
        label VARCHAR(128) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (entity_id),
        UNIQUE INDEX intelligence_watchlist_entities_identity (watchlist_id, entity_type, blinded_hash),
        INDEX intelligence_watchlist_entities_hash (network, entity_type, blinded_hash),
        CONSTRAINT intelligence_watchlist_entities_watchlist FOREIGN KEY (watchlist_id) REFERENCES intelligence_watchlists (watchlist_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_watchlist_rules (
        rule_id CHAR(36) NOT NULL,
        watchlist_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        condition_type VARCHAR(24) NOT NULL,
        threshold_value DOUBLE NULL,
        delivery_channel VARCHAR(16) NOT NULL,
        webhook_id CHAR(36) NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        rate_limit_per_hour INT UNSIGNED NOT NULL DEFAULT 20,
        created_at DATETIME(3) NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        PRIMARY KEY (rule_id),
        INDEX intelligence_watchlist_rules_watchlist (watchlist_id),
        INDEX intelligence_watchlist_rules_active (network, enabled, condition_type),
        CONSTRAINT intelligence_watchlist_rules_watchlist FOREIGN KEY (watchlist_id) REFERENCES intelligence_watchlists (watchlist_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_saved_queries (
        query_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        title VARCHAR(128) NOT NULL,
        sql_text TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (query_id),
        INDEX intelligence_saved_queries_owner (owner_id, network, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_graph_cases (
        case_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        document JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (case_id),
        INDEX intelligence_graph_cases_owner (owner_id, network, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_matcher_checkpoints (
        consumer_id VARCHAR(64) NOT NULL,
        network VARCHAR(16) NOT NULL,
        block_height INT UNSIGNED NOT NULL,
        block_hash CHAR(64) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (consumer_id, network)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_notifications (
        notification_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        watchlist_id CHAR(36) NOT NULL,
        rule_id CHAR(36) NOT NULL,
        event_id VARCHAR(160) NOT NULL,
        title VARCHAR(160) NOT NULL,
        message VARCHAR(1024) NOT NULL,
        severity VARCHAR(16) NOT NULL,
        entity_type VARCHAR(24) NOT NULL,
        blinded_hash CHAR(64) NOT NULL,
        block_height INT UNSIGNED NULL,
        block_hash CHAR(64) NULL,
        state VARCHAR(16) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        acknowledged_at DATETIME(3) NULL,
        PRIMARY KEY (notification_id),
        UNIQUE INDEX intelligence_notifications_event (rule_id, event_id),
        INDEX intelligence_notifications_owner (owner_id, network, watchlist_id, created_at),
        INDEX intelligence_notifications_block (network, block_height)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_delivery_outbox (
        outbox_id CHAR(36) NOT NULL,
        notification_id CHAR(36) NOT NULL,
        webhook_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        state VARCHAR(16) NOT NULL,
        attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
        next_attempt_at DATETIME(3) NOT NULL,
        lease_until DATETIME(3) NULL,
        lease_token CHAR(36) NULL,
        last_error VARCHAR(512) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (outbox_id),
        UNIQUE INDEX intelligence_delivery_outbox_target (notification_id, webhook_id),
        INDEX intelligence_delivery_outbox_due (network, state, next_attempt_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_webhook_attempts (
        attempt_id CHAR(36) NOT NULL,
        outbox_id CHAR(36) NOT NULL,
        webhook_id CHAR(36) NOT NULL,
        event_id VARCHAR(160) NOT NULL,
        attempt_number INT UNSIGNED NOT NULL,
        started_at DATETIME(3) NOT NULL,
        finished_at DATETIME(3) NOT NULL,
        status_code INT UNSIGNED NULL,
        success TINYINT(1) NOT NULL,
        response_digest CHAR(64) NULL,
        error_code VARCHAR(64) NULL,
        PRIMARY KEY (attempt_id),
        UNIQUE INDEX intelligence_webhook_attempts_number (outbox_id, attempt_number),
        INDEX intelligence_webhook_attempts_webhook (webhook_id, started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_knowledge_labels (
        label_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        entity_type VARCHAR(16) NOT NULL,
        entity_id VARCHAR(160) NOT NULL,
        status VARCHAR(16) NOT NULL,
        document JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (label_id),
        INDEX intelligence_knowledge_labels_entity (network, entity_type, entity_id),
        INDEX intelligence_knowledge_labels_owner (owner_id, network, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_knowledge_audit (
        audit_id CHAR(36) NOT NULL,
        label_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        action VARCHAR(16) NOT NULL,
        actor_owner_id CHAR(36) NOT NULL,
        summary VARCHAR(1024) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (audit_id),
        INDEX intelligence_knowledge_audit_network (network, created_at),
        INDEX intelligence_knowledge_audit_label (label_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (databaseSchemaVersion < 110 && this.targetMigrationVersion >= 110) {
      // Admin adapter: a token so only the executor that owns a run can renew
      // or finish it, and one row per claimed request nonce shared by every
      // backend worker so a signed request cannot replay against another
      // process. Both additive; existing runs keep working with a NULL token.
      await this.$executeQuery('ALTER TABLE admin_adapter_runs ADD owner_token CHAR(36) NULL');
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS admin_nonces (
        scope VARCHAR(160) NOT NULL,
        nonce VARCHAR(128) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (scope, nonce),
        INDEX admin_nonces_expiry (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (databaseSchemaVersion < 111 && this.targetMigrationVersion >= 111) {
      // Private relay submissions: every raw transaction handed to an owned
      // Tor or I2P endpoint, with the lease the worker holds while relaying,
      // the attempt count and the hash of the owner token that authorizes
      // readback and abort. The raw hex stays here because a retry needs it;
      // the token itself is never stored.
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_private_relay_submissions (
        submission_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        txid CHAR(64) NOT NULL,
        raw_tx MEDIUMTEXT NOT NULL,
        method VARCHAR(32) NOT NULL,
        state VARCHAR(16) NOT NULL,
        relay_endpoint_id VARCHAR(64) NULL,
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        lease_until DATETIME(3) NULL,
        lease_owner VARCHAR(64) NULL,
        owner_token_hash CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        relayed_at DATETIME(3) NULL,
        confirmed_block_height INT UNSIGNED NULL,
        last_error VARCHAR(512) NULL,
        PRIMARY KEY (submission_id),
        UNIQUE INDEX intelligence_private_relay_txid (network, txid),
        INDEX intelligence_private_relay_claim (network, state, lease_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (databaseSchemaVersion < 112 && this.targetMigrationVersion >= 112) {
      // Bootstrap (AssumeUTXO) verification runs and operator jobs. Each row
      // carries the backend's own network; the JSON document is the record.
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS universe_bootstrap_verifications (
        verification_id CHAR(36) NOT NULL,
        snapshot_id VARCHAR(128) NOT NULL,
        network VARCHAR(16) NOT NULL,
        state VARCHAR(16) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        document JSON NOT NULL,
        PRIMARY KEY (verification_id),
        INDEX universe_bootstrap_verifications_snapshot (snapshot_id, network, created_at),
        INDEX universe_bootstrap_verifications_state (network, state, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS universe_bootstrap_jobs (
        job_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        node_id VARCHAR(64) NOT NULL,
        job_type VARCHAR(32) NOT NULL,
        idempotency_key VARCHAR(128) NOT NULL,
        state VARCHAR(16) NOT NULL,
        lease_owner VARCHAR(128) NULL,
        lease_expires_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        document JSON NOT NULL,
        PRIMARY KEY (job_id),
        UNIQUE INDEX universe_bootstrap_jobs_idempotency (network, idempotency_key),
        INDEX universe_bootstrap_jobs_claim (network, state, lease_expires_at, created_at),
        INDEX universe_bootstrap_jobs_node (network, node_id, state)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }

    if (databaseSchemaVersion < 113 && this.targetMigrationVersion >= 113) {
      await this.$executeQuery(`CREATE TABLE IF NOT EXISTS intelligence_watchlist_entity_scripts (
        entity_id CHAR(36) NOT NULL,
        owner_id CHAR(36) NOT NULL,
        network VARCHAR(16) NOT NULL,
        script_hash CHAR(64) NOT NULL,
        derivation_index INT UNSIGNED NOT NULL,
        PRIMARY KEY (entity_id, derivation_index),
        INDEX intelligence_watchlist_scripts_lookup (network, script_hash),
        CONSTRAINT intelligence_watchlist_scripts_entity FOREIGN KEY (entity_id)
          REFERENCES intelligence_watchlist_entities(entity_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.$ensureNotificationSequence();
    }

  }


  /** @asyncUnsafe */
  private async $migrateLiquidData(step: number, connection): Promise<void> {
    const execute = (sql: string) => DB.query({sql, timeout: this.queryTimeout}, undefined, 'debug', connection);
    if (step === 105) {
      // Hardcoded federation addresses
      await execute(`INSERT IGNORE INTO federation_addresses (bitcoinaddress) VALUES ('3G6neksSBMp51kHJ2if8SeDUrzT8iVETWT')`);
      await execute(`INSERT IGNORE INTO federation_addresses (bitcoinaddress) VALUES ('bc1qwnevjp8nsq7adu3hxlvdvslrf242q4vuavfg0y929jp2zntp3vgq7cq6z2')`);

      // Rollback only on up to date instances
      const [stateRows]: any[] = await execute(`SELECT name, number FROM state WHERE name IN ('last_elements_block', 'last_bitcoin_block_audit')`);
      const lastElementsBlock = Number(stateRows?.find((row: any) => row.name === 'last_elements_block')?.number ?? 0);
      const lastBlockAudit = Number(stateRows?.find((row: any) => row.name === 'last_bitcoin_block_audit')?.number ?? 0);
      if (lastElementsBlock > 3686608 && lastBlockAudit > 929700) {
        await execute('DELETE FROM elements_pegs WHERE block > 3686608');
        await execute('DELETE FROM federation_txos WHERE blocknumber > 929701');
        await execute(`UPDATE federation_txos SET lastblockupdate = 929700 WHERE unspent = 1;`);
        await execute(`UPDATE state SET number = 3686608 WHERE name = 'last_elements_block';`);
        await execute(`UPDATE state SET number = 929700 WHERE name = 'last_bitcoin_block_audit';`);
      }
    }
    if (step === 106) {
      await execute(`UPDATE federation_txos SET timelock = 4032 WHERE bitcoinaddress = '3G6neksSBMp51kHJ2if8SeDUrzT8iVETWT';`);
      // In a specific setup it's possible that 3G6neksSBMp51kHJ2if8SeDUrzT8iVETWT and bc1qwnevjp8nsq7adu3hxlvdvslrf242q4vuavfg0y929jp2zntp3vgq7cq6z2
      // were set with a timelock of 2016 instead of 4032
      // This rollbacks the tables to before bc1qwnevjp8nsq7adu3hxlvdvslrf242q4vuavfg0y929jp2zntp3vgq7cq6z2 is used, and
      // manually fixes the timelock for 3G6neksSBMp51kHJ2if8SeDUrzT8iVETWT
      const [stateRows]: any[] = await execute(`SELECT name, number FROM state WHERE name IN ('last_elements_block', 'last_bitcoin_block_audit')`);
      const lastElementsBlock = Number(stateRows?.find((row: any) => row.name === 'last_elements_block')?.number ?? 0);
      const lastBlockAudit = Number(stateRows?.find((row: any) => row.name === 'last_bitcoin_block_audit')?.number ?? 0);
      if (lastElementsBlock > 3686608 && lastBlockAudit > 929700) {
        await execute('DELETE FROM elements_pegs WHERE block > 3686608');
        await execute('DELETE FROM federation_txos WHERE blocknumber > 929701');
        await execute(`UPDATE federation_txos SET lastblockupdate = 929700 WHERE unspent = 1;`);

        await execute(`UPDATE state SET number = 3686608 WHERE name = 'last_elements_block';`);
        await execute(`UPDATE state SET number = 929700 WHERE name = 'last_bitcoin_block_audit';`);
      }
    }
  }
  /**
   * Special case here for the `statistics` table - It appeared that somehow some dbs already had the `added` field indexed
   * while it does not appear in previous schemas. The mariadb command "CREATE INDEX IF NOT EXISTS" is not supported on
   * older mariadb version. Therefore we set a flag here in order to know if the index needs to be created or not before
   * running the migration process
   */
  private async $setStatisticsAddedIndexedFlag(databaseSchemaVersion: number) {
    if (databaseSchemaVersion >= 2) {
      this.statisticsAddedIndexed = true;
      return;
    }

    try {
      // We don't use "CREATE INDEX IF NOT EXISTS" because it is not supported on old mariadb version 5.X
      const query = `SELECT COUNT(1) hasIndex FROM INFORMATION_SCHEMA.STATISTICS
        WHERE table_schema=DATABASE() AND table_name='statistics' AND index_name='added';`;
      const [rows] = await this.$executeQuery(query, true);
      if (rows[0].hasIndex === 0) {
        logger.debug('MIGRATIONS: `statistics.added` is not indexed');
        this.statisticsAddedIndexed = false;
      } else if (rows[0].hasIndex === 1) {
        logger.debug('MIGRATIONS: `statistics.added` is already indexed');
        this.statisticsAddedIndexed = true;
      }
    } catch (e) {
      logger.err('MIGRATIONS: Unable to verify the statistics.added index; startup is blocked.');
      throw e;
    }
  }

  /**
   * Small query execution wrapper to log all executed queries
   */
  private async $executeQuery(query: string, silent = false): Promise<any> {
    if (!silent) {
      logger.debug('MIGRATIONS: Execute query:\n' + query);
    }
    return DB.query({ sql: query, timeout: this.queryTimeout });
  }

  /**
   * Check if 'table' exists in the database
   * @asyncUnsafe
   */
  private async $checkIfTableExists(table: string): Promise<boolean> {
    const query = `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${config.DATABASE.DATABASE}' AND TABLE_NAME = '${table}'`;
    const [rows] = await DB.query({ sql: query, timeout: this.queryTimeout });
    return rows[0]['COUNT(*)'] === 1;
  }

  /**
   * Get current database version
   * @asyncUnsafe
   */
  private async $getSchemaVersionFromDatabase(): Promise<number> {
    const query = `SELECT number FROM state WHERE name = 'schema_version';`;
    const [rows] = await this.$executeQuery(query, true);
    return rows[0]['number'];
  }

  /**
   * Create the `state` table
   * @asyncUnsafe
   */
  private async $createMigrationStateTable(): Promise<void> {
    const query = `CREATE TABLE IF NOT EXISTS state (
      name varchar(25) NOT NULL,
      number int(11) NULL,
      string varchar(100) NULL,
      CONSTRAINT name_unique UNIQUE (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
    await this.$executeQuery(query);

    // Set initial values
    await this.$executeQuery(`INSERT INTO state VALUES('schema_version', 0, NULL);`);
    await this.$executeQuery(`INSERT INTO state VALUES('last_elements_block', 0, NULL);`);
  }

  /**
   * We actually execute the migrations queries here
   * @asyncUnsafe
   */
  private async $migrateTableSchemaFromVersion(version: number): Promise<void> {
    if (this.targetMigrationVersion === 104) await this.$ensureBlockKeys();
    const queries = this.getMigrationQueriesFromVersion(version);
    if (queries.length) {
      await DB.$transaction(async connection => {
        try {
          for (const query of queries) await DB.query({sql: query, timeout: this.queryTimeout}, undefined, 'debug', connection);
        } catch (error) { throw error; }
      });
    }
  }

  /** @asyncUnsafe */
  private async $ensureStep29Schema(): Promise<void> {
    // CREATE/ALTER implicitly commit. A crash before marker 29 must resume
    // from verified schema, not from table existence or a swallowed DDL error.
    if (!await this.$checkIfTableExists('geo_names')) {
      await this.$executeQuery(this.getCreateGeoNamesTableQuery());
    }
    const [geoColumns]: any[] = await this.$executeQuery(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME
      FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='geo_names'`, true);
    const expectedGeo = {
      id: { type: /^int(?:\(11\))? unsigned$/, nullable: 'NO', charset: null },
      type: { type: /^enum\('city','country','division','continent'\)$/, nullable: 'NO', charset: 'utf8mb3' },
      names: { type: /^text$/, nullable: 'YES', charset: 'utf8mb3' },
    };
    if (geoColumns.length !== 3 || !geoColumns.every(column => {
      const expected = expectedGeo[column.COLUMN_NAME];
      return expected && expected.type.test(column.COLUMN_TYPE) && column.IS_NULLABLE === expected.nullable &&
        this.isSqlNullDefault(column.COLUMN_DEFAULT) && column.EXTRA === '' && column.CHARACTER_SET_NAME === expected.charset;
    })) throw new Error('Interrupted migration 29 geo_names columns do not match the required schema');
    const [geoIndexes]: any[] = await this.$executeQuery(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE, SUB_PART
      FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='geo_names'`, true);
    // Historical CREATE has a composite UNIQUE key, not a PRIMARY key.
    const expectedIndexes = ['id:1:id:0', 'id:2:type:0', 'id_2:1:id:1'];
    const observedIndexes = geoIndexes.map(index => `${index.INDEX_NAME}:${index.SEQ_IN_INDEX}:${index.COLUMN_NAME}:${index.NON_UNIQUE}`);
    if (geoIndexes.length !== expectedIndexes.length || geoIndexes.some(index => index.SUB_PART !== null) ||
      !expectedIndexes.every(index => observedIndexes.includes(index))) {
      throw new Error('Interrupted migration 29 geo_names keys do not match the required schema');
    }
    const additions: Record<string, string> = {
      as_number: 'int(11) unsigned', city_id: 'int(11) unsigned', country_id: 'int(11) unsigned',
      accuracy_radius: 'int(11) unsigned', subdivision_id: 'int(11) unsigned', longitude: 'double', latitude: 'double',
    };
    const readNodes = /** @asyncUnsafe */ async (): Promise<any[]> => {
      const [columns]: any[] = await this.$executeQuery(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
        FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nodes'`, true);
      return columns;
    };
    const before = await readNodes();
    if (!before.filter(column => Object.prototype.hasOwnProperty.call(additions, column.COLUMN_NAME)).every(column =>
      column.COLUMN_TYPE.replace('(11)', '') === additions[column.COLUMN_NAME].replace('(11)', '') &&
      column.IS_NULLABLE === 'YES' && this.isSqlNullDefault(column.COLUMN_DEFAULT) && column.EXTRA === '')) {
      throw new Error('Interrupted migration 29 existing nodes columns do not match the required schema');
    }
    for (const [name, type] of Object.entries(additions)) {
      if (!before.some(column => column.COLUMN_NAME === name)) {
        await this.$executeQuery(`ALTER TABLE nodes ADD ${name} ${type} NULL DEFAULT NULL`);
      }
    }
    const after = await readNodes();
    if (!Object.entries(additions).every(([name, type]) => {
      const columns = after.filter(column => column.COLUMN_NAME === name);
      const expected = type.replace('(11)', '');
      return columns.length === 1 && columns[0].COLUMN_TYPE.replace('(11)', '') === expected &&
        columns[0].IS_NULLABLE === 'YES' && this.isSqlNullDefault(columns[0].COLUMN_DEFAULT) && columns[0].EXTRA === '';
    })) throw new Error('Interrupted migration 29 nodes columns do not match the required schema');
  }

  /** @asyncUnsafe */
  private async $ensureCfpIndexedColumn(): Promise<void> {
    const read = /** @asyncUnsafe */ async (): Promise<any[]> => {
      const [columns]: any[] = await this.$executeQuery(`SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
        FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='blocks' AND COLUMN_NAME='cpfp_indexed'`, true);
      return columns;
    };
    const matches = (columns: any[]): boolean => columns.length === 1 &&
      /^tinyint(?:\(\d+\))?$/.test(columns[0].COLUMN_TYPE) && columns[0].IS_NULLABLE === 'YES' &&
      String(columns[0].COLUMN_DEFAULT) === '0' && columns[0].EXTRA === '';
    const before = await read();
    if (!before.length) {
      await this.$executeQuery('ALTER TABLE `blocks` ADD cpfp_indexed tinyint(1) DEFAULT 0');
    } else if (!matches(before)) {
      throw new Error('Interrupted migration 47 cpfp_indexed column does not match the required schema');
    }
    // MySQL DDL commits before the step marker; inspect its durable result on
    // both a fresh execution and a restart rather than swallowing duplicates.
    if (!matches(await read())) {
      throw new Error('Migration 47 cpfp_indexed column postcondition failed');
    }
  }

  /** @asyncUnsafe */
  private async $dropBlocksPoolForeignKey(): Promise<void> {
    const [rows]: any[] = await this.$executeQuery(`SELECT CONSTRAINT_NAME FROM information_schema.table_constraints
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='blocks' AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME='blocks_ibfk_1'`, true);
    if (rows.length) await this.$executeQuery('ALTER TABLE blocks DROP FOREIGN KEY `blocks_ibfk_1`');
  }

  /** @asyncUnsafe */
  private async $ensureNotificationSequence(): Promise<void> {
    const [columns]: any[] = await this.$executeQuery(`SELECT COLUMN_TYPE, EXTRA FROM information_schema.columns
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='intelligence_notifications' AND COLUMN_NAME='notification_sequence'`, true);
    if (!columns.length) {
      await this.$executeQuery(`ALTER TABLE intelligence_notifications
        ADD COLUMN notification_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ADD UNIQUE KEY intelligence_notifications_sequence (notification_sequence)`);
      return;
    }
    const [indexes]: any[] = await this.$executeQuery(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE FROM information_schema.statistics
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='intelligence_notifications'`, true);
    if (columns.length !== 1 || !/^bigint(?:\(\d+\))? unsigned$/.test(columns[0].COLUMN_TYPE) || !columns[0].EXTRA.includes('auto_increment') ||
        !indexes.some(index => index.COLUMN_NAME === 'notification_sequence' && index.SEQ_IN_INDEX === 1 && Number(index.NON_UNIQUE) === 0 && indexes.filter(peer => peer.INDEX_NAME === index.INDEX_NAME).length === 1)) {
      throw new Error('Notification ordering column or unique index does not satisfy schema 113');
    }
  }

  /** @asyncUnsafe */
  private async $ensureBlockKeys(): Promise<void> {
    const [rows]: any[] = await this.$executeQuery(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='blocks'`, true);
    const primary = rows.filter(row => row.INDEX_NAME === 'PRIMARY').sort((a, b) => a.SEQ_IN_INDEX - b.SEQ_IN_INDEX);
    if (primary.length !== 1 || primary[0].COLUMN_NAME !== 'hash') {
      await this.$executeQuery(`ALTER TABLE blocks ${primary.length ? 'DROP PRIMARY KEY, ' : ''}ADD PRIMARY KEY (hash)`);
    }
    if (!rows.some(row => row.INDEX_NAME !== 'PRIMARY' && row.COLUMN_NAME === 'height' && row.SEQ_IN_INDEX === 1)) {
      await this.$executeQuery('ALTER TABLE blocks ADD INDEX (height)');
    }
  }
  /**
   * Generate migration queries based on schema version
   */
  private getMigrationQueriesFromVersion(version: number): string[] {
    const queries: string[] = [];
    const isBitcoin = ['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK);

    if (version < 1 && this.targetMigrationVersion >= 1) {
      if (config.MEMPOOL.NETWORK !== 'liquid' && config.MEMPOOL.NETWORK !== 'liquidtestnet') {
        if (version > 0) {
          logger.notice(`MIGRATIONS: Migrating (shifting) statistics table data`);
        }
        queries.push(this.getShiftStatisticsQuery());
      }
    }

    if (version < 7 && this.targetMigrationVersion >= 7 && isBitcoin === true) {
      queries.push(`INSERT INTO state(name, number, string) VALUES ('last_hashrates_indexing', 0, NULL)`);
    }

    if (version < 9 && this.targetMigrationVersion >= 9 && isBitcoin === true) {
      queries.push(`INSERT INTO state(name, number, string) VALUES ('last_weekly_hashrates_indexing', 0, NULL)`);
    }

    if (version < 58 && this.targetMigrationVersion >= 58) {
      queries.push(`DELETE FROM state WHERE name = 'last_hashrates_indexing'`);
      queries.push(`DELETE FROM state WHERE name = 'last_weekly_hashrates_indexing'`);
    }

    if (version < 101 && this.targetMigrationVersion >= 101) {
      queries.push(`DELETE FROM prices WHERE USD = -1`);
    }


    return queries;
  }


  /**
   * Print current database version
   */
  private async $printDatabaseVersion() {
    this.explicitNullDefaultsAreText = false;
    try {
      const [rows] = await this.$executeQuery('SELECT VERSION() as version;', true);
      const version = typeof rows[0]?.version === 'string' ? rows[0].version : '';
      const maria = version.match(/^(\d+)\.(\d+)\.(\d+)-MariaDB(?:-|$)/);
      // MariaDB >=10.2.7 returns expression text NULL and quotes a literal
      // 'NULL'. MySQL returns SQL null for the expression and unquoted text
      // for the literal, so only a verified MariaDB engine may normalize it.
      this.explicitNullDefaultsAreText = !!maria &&
        (Number(maria[1]) > 10 || Number(maria[1]) === 10 &&
          (Number(maria[2]) > 2 || Number(maria[2]) === 2 && Number(maria[3]) >= 7));
      logger.debug(`MIGRATIONS: Database engine version '${rows[0].version}'`);
    } catch (e) {
      logger.debug(`MIGRATIONS: Could not fetch database engine version. ` + e);
    }
  }

  private isSqlNullDefault(value: unknown): boolean {
    return value === null || this.explicitNullDefaultsAreText && value === 'NULL';
  }

  // Couple of wrappers to clean the main logic
  private getShiftStatisticsQuery(): string {
    return `UPDATE statistics SET
      vsize_1 = vsize_1 + vsize_2, vsize_2 = vsize_3,
      vsize_3 = vsize_4, vsize_4 = vsize_5,
      vsize_5 = vsize_6, vsize_6 = vsize_8,
      vsize_8 = vsize_10, vsize_10 = vsize_12,
      vsize_12 = vsize_15, vsize_15 = vsize_20,
      vsize_20 = vsize_30, vsize_30 = vsize_40,
      vsize_40 = vsize_50, vsize_50 = vsize_60,
      vsize_60 = vsize_70, vsize_70 = vsize_80,
      vsize_80 = vsize_90, vsize_90 = vsize_100,
      vsize_100 = vsize_125, vsize_125 = vsize_150,
      vsize_150 = vsize_175, vsize_175 = vsize_200,
      vsize_200 = vsize_250, vsize_250 = vsize_300,
      vsize_300 = vsize_350, vsize_350 = vsize_400,
      vsize_400 = vsize_500, vsize_500 = vsize_600,
      vsize_600 = vsize_700, vsize_700 = vsize_800,
      vsize_800 = vsize_900, vsize_900 = vsize_1000,
      vsize_1000 = vsize_1200, vsize_1200 = vsize_1400,
      vsize_1400 = vsize_1800, vsize_1800 = vsize_2000, vsize_2000 = 0;`;
  }

  private getCreateStatisticsQuery(): string {
    return `CREATE TABLE IF NOT EXISTS statistics (
      id int(11) NOT NULL AUTO_INCREMENT,
      added datetime NOT NULL,
      unconfirmed_transactions int(11) UNSIGNED NOT NULL,
      tx_per_second float UNSIGNED NOT NULL,
      vbytes_per_second int(10) UNSIGNED NOT NULL,
      mempool_byte_weight int(10) UNSIGNED NOT NULL,
      fee_data longtext NOT NULL,
      total_fee double UNSIGNED NOT NULL,
      vsize_1 int(11) NOT NULL,
      vsize_2 int(11) NOT NULL,
      vsize_3 int(11) NOT NULL,
      vsize_4 int(11) NOT NULL,
      vsize_5 int(11) NOT NULL,
      vsize_6 int(11) NOT NULL,
      vsize_8 int(11) NOT NULL,
      vsize_10 int(11) NOT NULL,
      vsize_12 int(11) NOT NULL,
      vsize_15 int(11) NOT NULL,
      vsize_20 int(11) NOT NULL,
      vsize_30 int(11) NOT NULL,
      vsize_40 int(11) NOT NULL,
      vsize_50 int(11) NOT NULL,
      vsize_60 int(11) NOT NULL,
      vsize_70 int(11) NOT NULL,
      vsize_80 int(11) NOT NULL,
      vsize_90 int(11) NOT NULL,
      vsize_100 int(11) NOT NULL,
      vsize_125 int(11) NOT NULL,
      vsize_150 int(11) NOT NULL,
      vsize_175 int(11) NOT NULL,
      vsize_200 int(11) NOT NULL,
      vsize_250 int(11) NOT NULL,
      vsize_300 int(11) NOT NULL,
      vsize_350 int(11) NOT NULL,
      vsize_400 int(11) NOT NULL,
      vsize_500 int(11) NOT NULL,
      vsize_600 int(11) NOT NULL,
      vsize_700 int(11) NOT NULL,
      vsize_800 int(11) NOT NULL,
      vsize_900 int(11) NOT NULL,
      vsize_1000 int(11) NOT NULL,
      vsize_1200 int(11) NOT NULL,
      vsize_1400 int(11) NOT NULL,
      vsize_1600 int(11) NOT NULL,
      vsize_1800 int(11) NOT NULL,
      vsize_2000 int(11) NOT NULL,
      CONSTRAINT PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateElementsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS elements_pegs (
      block int(11) NOT NULL,
      datetime int(11) NOT NULL,
      amount bigint(20) NOT NULL,
      txid varchar(65) NOT NULL,
      txindex int(11) NOT NULL,
      bitcoinaddress varchar(100) NOT NULL,
      bitcointxid varchar(65) NOT NULL,
      bitcoinindex int(11) NOT NULL,
      final_tx int(11) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateFederationAddressesTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS federation_addresses (
      bitcoinaddress varchar(100) NOT NULL,
      PRIMARY KEY (bitcoinaddress)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateFederationTxosTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS federation_txos (
      txid varchar(65) NOT NULL,
      txindex int(11) NOT NULL,
      bitcoinaddress varchar(100) NOT NULL,
      amount bigint(20) unsigned NOT NULL,
      blocknumber int(11) unsigned NOT NULL,
      blocktime int(11) unsigned NOT NULL,
      unspent tinyint(1) NOT NULL,
      lastblockupdate int(11) unsigned NOT NULL,
      lasttimeupdate int(11) unsigned NOT NULL,
      pegtxid varchar(65) NOT NULL,
      pegindex int(11) NOT NULL,
      pegblocktime int(11) unsigned NOT NULL,
      PRIMARY KEY (txid, txindex),
      FOREIGN KEY (bitcoinaddress) REFERENCES federation_addresses (bitcoinaddress)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreatePoolsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS pools (
      id int(11) NOT NULL AUTO_INCREMENT,
      name varchar(50) NOT NULL,
      link varchar(255) NOT NULL,
      addresses text NOT NULL,
      regexes text NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  }

  private getCreateBlocksTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS blocks (
      height int(11) unsigned NOT NULL,
      hash varchar(65) NOT NULL,
      blockTimestamp timestamp NOT NULL,
      size int(11) unsigned NOT NULL,
      weight int(11) unsigned NOT NULL,
      tx_count int(11) unsigned NOT NULL,
      coinbase_raw text,
      difficulty bigint(20) unsigned NOT NULL,
      pool_id int(11) DEFAULT -1,
      fees double unsigned NOT NULL,
      fee_span json NOT NULL,
      median_fee double unsigned NOT NULL,
      PRIMARY KEY (height),
      INDEX (pool_id),
      FOREIGN KEY (pool_id) REFERENCES pools (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getAdditionalBlocksDataQuery(): string {
    return `ALTER TABLE blocks
      ADD median_timestamp timestamp NOT NULL,
      ADD coinbase_address varchar(100) NULL,
      ADD coinbase_signature varchar(500) NULL,
      ADD coinbase_signature_ascii varchar(500) NULL,
      ADD avg_tx_size double unsigned NOT NULL,
      ADD total_inputs int unsigned NOT NULL,
      ADD total_outputs int unsigned NOT NULL,
      ADD total_output_amt bigint unsigned NOT NULL,
      ADD fee_percentiles longtext NULL,
      ADD median_fee_amt int unsigned NULL,
      ADD segwit_total_txs int unsigned NOT NULL,
      ADD segwit_total_size int unsigned NOT NULL,
      ADD segwit_total_weight int unsigned NOT NULL,
      ADD header varchar(160) NOT NULL,
      ADD utxoset_change int NOT NULL,
      ADD utxoset_size int unsigned NULL,
      ADD total_input_amt bigint unsigned NULL
    `;
  }

  private getCreateDailyStatsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS hashrates (
      hashrate_timestamp timestamp NOT NULL,
      avg_hashrate double unsigned DEFAULT '0',
      pool_id smallint unsigned NULL,
      PRIMARY KEY (hashrate_timestamp),
      INDEX (pool_id),
      FOREIGN KEY (pool_id) REFERENCES pools (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateRatesTableQuery(): string { // This table has been replaced by the prices table
    return `CREATE TABLE IF NOT EXISTS rates (
      height int(10) unsigned NOT NULL,
      bisq_rates JSON NOT NULL,
      PRIMARY KEY (height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateBlocksSummariesTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS blocks_summaries (
      height int(10) unsigned NOT NULL,
      id varchar(65) NOT NULL,
      transactions JSON NOT NULL,
      PRIMARY KEY (id),
      INDEX (height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreatePricesTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS prices (
      time timestamp NOT NULL,
      avg_prices JSON NOT NULL,
      PRIMARY KEY (time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateDifficultyAdjustmentsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS difficulty_adjustments (
      time timestamp NOT NULL,
      height int(10) unsigned NOT NULL,
      difficulty double unsigned NOT NULL,
      adjustment float NOT NULL,
      PRIMARY KEY (height),
      INDEX (time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateLightningStatisticsQuery(): string {
    return `CREATE TABLE IF NOT EXISTS lightning_stats (
      id int(11) NOT NULL AUTO_INCREMENT,
      added datetime NOT NULL,
      channel_count int(11) NOT NULL,
      node_count int(11) NOT NULL,
      total_capacity double unsigned NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateNodesQuery(): string {
    return `CREATE TABLE IF NOT EXISTS nodes (
      public_key varchar(66) NOT NULL,
      first_seen datetime NOT NULL,
      updated_at datetime NOT NULL,
      alias varchar(200) CHARACTER SET utf8mb4 NOT NULL,
      color varchar(200) NOT NULL,
      sockets text DEFAULT NULL,
      PRIMARY KEY (public_key),
      KEY alias (alias(10))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateChannelsQuery(): string {
    return `CREATE TABLE IF NOT EXISTS channels (
      id bigint(11) unsigned NOT NULL,
      short_id varchar(15) NOT NULL DEFAULT '',
      capacity bigint(20) unsigned NOT NULL,
      transaction_id varchar(64) NOT NULL,
      transaction_vout int(11) NOT NULL,
      updated_at datetime DEFAULT NULL,
      created datetime DEFAULT NULL,
      status int(11) NOT NULL DEFAULT 0,
      closing_transaction_id varchar(64) DEFAULT NULL,
      closing_date datetime DEFAULT NULL,
      closing_reason int(11) DEFAULT NULL,
      node1_public_key varchar(66) NOT NULL,
      node1_base_fee_mtokens bigint(20) unsigned DEFAULT NULL,
      node1_cltv_delta int(11) DEFAULT NULL,
      node1_fee_rate bigint(11) DEFAULT NULL,
      node1_is_disabled tinyint(1) DEFAULT NULL,
      node1_max_htlc_mtokens bigint(20) unsigned DEFAULT NULL,
      node1_min_htlc_mtokens bigint(20) DEFAULT NULL,
      node1_updated_at datetime DEFAULT NULL,
      node2_public_key varchar(66) NOT NULL,
      node2_base_fee_mtokens bigint(20) unsigned DEFAULT NULL,
      node2_cltv_delta int(11) DEFAULT NULL,
      node2_fee_rate bigint(11) DEFAULT NULL,
      node2_is_disabled tinyint(1) DEFAULT NULL,
      node2_max_htlc_mtokens bigint(20) unsigned DEFAULT NULL,
      node2_min_htlc_mtokens bigint(20) unsigned DEFAULT NULL,
      node2_updated_at datetime DEFAULT NULL,
      PRIMARY KEY (id),
      KEY node1_public_key (node1_public_key),
      KEY node2_public_key (node2_public_key),
      KEY status (status),
      KEY short_id (short_id),
      KEY transaction_id (transaction_id),
      KEY closing_transaction_id (closing_transaction_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateNodesStatsQuery(): string {
    return `CREATE TABLE IF NOT EXISTS node_stats (
      id int(11) unsigned NOT NULL AUTO_INCREMENT,
      public_key varchar(66) NOT NULL DEFAULT '',
      added date NOT NULL,
      capacity bigint(20) unsigned NOT NULL DEFAULT 0,
      channels int(11) unsigned NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY added (added,public_key),
      KEY public_key (public_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateBlocksAuditsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS blocks_audits (
      time timestamp NOT NULL,
      hash varchar(65) NOT NULL,
      height int(10) unsigned NOT NULL,
      missing_txs JSON NOT NULL,
      added_txs JSON NOT NULL,
      match_rate float unsigned NOT NULL,
      PRIMARY KEY (hash),
      INDEX (height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateGeoNamesTableQuery(): string {
    return `CREATE TABLE geo_names (
      id int(11) unsigned NOT NULL,
      type enum('city','country','division','continent') NOT NULL,
      names text DEFAULT NULL,
      UNIQUE KEY id (id,type),
      KEY id_2 (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateBlocksPricesTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS blocks_prices (
      height int(10) unsigned NOT NULL,
      price_id int(10) unsigned NOT NULL,
      PRIMARY KEY (height),
      INDEX (price_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateLNNodesSocketsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS nodes_sockets (
      public_key varchar(66) NOT NULL,
      socket varchar(100) NOT NULL,
      type enum('ipv4', 'ipv6', 'torv2', 'torv3', 'i2p', 'dns', 'websocket') NULL,
      UNIQUE KEY public_key_socket (public_key, socket),
      INDEX (public_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateLNNodeRecordsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS nodes_records (
      public_key varchar(66) NOT NULL,
      type int(10) unsigned NOT NULL,
      payload blob NOT NULL,
      UNIQUE KEY public_key_type (public_key, type),
      INDEX (public_key),
      FOREIGN KEY (public_key)
        REFERENCES nodes (public_key)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateCPFPTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS cpfp_clusters (
      root varchar(65) NOT NULL,
      height int(10) NOT NULL,
      txs JSON DEFAULT NULL,
      fee_rate double unsigned NOT NULL,
      PRIMARY KEY (root)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateTransactionsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS transactions (
      txid varchar(65) NOT NULL,
      cluster varchar(65) DEFAULT NULL,
      PRIMARY KEY (txid),
      FOREIGN KEY (cluster) REFERENCES cpfp_clusters (root) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateCompactCPFPTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS compact_cpfp_clusters (
      root binary(32) NOT NULL,
      height int(10) NOT NULL,
      txs BLOB DEFAULT NULL,
      fee_rate float unsigned,
      PRIMARY KEY (root),
      INDEX (height)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateCompactTransactionsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS compact_transactions (
      txid binary(32) NOT NULL,
      cluster binary(32) DEFAULT NULL,
      PRIMARY KEY (txid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  private getCreateAccelerationsTableQuery(): string {
    return `CREATE TABLE IF NOT EXISTS accelerations (
      txid varchar(65) NOT NULL,
      added datetime NOT NULL,
      height int(10) NOT NULL,
      pool smallint unsigned NULL,
      effective_vsize int(10) NOT NULL,
      effective_fee bigint(20) unsigned NOT NULL,
      boost_rate float unsigned,
      boost_cost bigint(20) unsigned NOT NULL,
      PRIMARY KEY (txid),
      INDEX (added),
      INDEX (height),
      INDEX (pool)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;`;
  }

  /** @asyncUnsafe */
  public async $blocksReindexingTruncate(): Promise<void> {
    logger.warn(`Truncating pools, blocks, hashrates and difficulty_adjustments tables for re-indexing (using '--reindex-blocks'). You can cancel this command within 5 seconds`);
    await Common.sleep$(5000);

    await this.$executeQuery(`TRUNCATE blocks`);
    await this.$executeQuery(`TRUNCATE hashrates`);
    await this.$executeQuery(`TRUNCATE difficulty_adjustments`);
    await this.$executeQuery('DELETE FROM `pools`');
    await this.$executeQuery('ALTER TABLE pools AUTO_INCREMENT = 1');
    await this.$executeQuery(`UPDATE state SET string = NULL WHERE name = 'pools_json_sha'`);
  }

  private async $convertCompactCpfpTables(): Promise<void> {
    try {
      const batchSize = 250;
      const maxHeight = await blocksRepository.$mostRecentBlockHeight() || 0;
      const [minHeightRows]: any = await DB.query(`SELECT MIN(height) AS minHeight from cpfp_clusters`);
      const minHeight = (minHeightRows.length && minHeightRows[0].minHeight != null) ? minHeightRows[0].minHeight : maxHeight;
      let height = maxHeight;

      // Logging
      let timer = new Date().getTime() / 1000;
      const startedAt = new Date().getTime() / 1000;

      while (height > minHeight) {
        const [rows] = await DB.query(
          `
            SELECT * from cpfp_clusters
            WHERE height <= ? AND height > ?
            ORDER BY height
          `,
          [height, height - batchSize]
        ) as RowDataPacket[][];
        if (rows?.length) {
          await cpfpRepository.$batchSaveClusters(rows.map(row => {
            return {
              root: row.root,
              height: row.height,
              txs: JSON.parse(row.txs),
              effectiveFeePerVsize: row.fee_rate,
            };
          }));
        }

        const elapsed = new Date().getTime() / 1000 - timer;
        const runningFor = new Date().getTime() / 1000 - startedAt;
        logger.debug(`Migrated cpfp data from block ${height} to ${height - batchSize} in ${elapsed.toFixed(2)} seconds | total elapsed: ${runningFor.toFixed(2)} seconds`);
        timer = new Date().getTime() / 1000;
        height -= batchSize;
      }
    } catch (e) {
      logger.warn(`Failed to migrate cpfp transaction data`);
    }
  }

  private async $fixBadV1AuditBlocks(): Promise<void> {
    const badBlocks = [
      '000000000000000000011ad49227fc8c9ba0ca96ad2ebce41a862f9a244478dc',
      '000000000000000000010ac1f68b3080153f2826ffddc87ceffdd68ed97d6960',
      '000000000000000000024cbdafeb2660ae8bd2947d166e7fe15d1689e86b2cf7',
      '00000000000000000002e1dbfbf6ae057f331992a058b822644b368034f87286',
      '0000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb',
    ];

    for (const hash of badBlocks) {
      try {
        await this.$executeQuery(`
          UPDATE blocks_audits
          SET prioritized_txs = '[]'
          WHERE hash = '${hash}'
        `, true);
      } catch (e) {
        continue;
      }
    }
  }
}

export default new DatabaseMigration();
