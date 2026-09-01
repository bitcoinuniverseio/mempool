import DB from '../database';
import config from '../config';
import { setupTestDatabase, waitForDatabase, getTestDatabaseConfig } from './test-helpers';
import { RowDataPacket } from 'mysql2';

interface JsonStringRow extends RowDataPacket {
  document: string;
}

describe('Database Connection Integration Tests', () => {
  beforeAll(async () => {
    // Wait for database to be ready
    await waitForDatabase();
  }, 60000);

  test('should connect to the test database', async () => {
    const dbConfig = getTestDatabaseConfig();
    expect(dbConfig.enabled).toBe(true);
    expect(dbConfig.database).toBe('mempool_test');
    expect(dbConfig.port).toBe(Number(process.env.MEMPOOL_TEST_DB_PORT));
  });

  test('should execute a simple query', async () => {
    const [result] = await DB.query<any>('SELECT 1 as value');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(1);
  });

  test('should execute a query with parameters', async () => {
    const [result] = await DB.query<any>('SELECT ? as sum', [42]);
    expect(result).toHaveLength(1);
    expect(result[0].sum).toBe(42);
  });

  test('should return JSON columns as strings for repository parsing', async () => {
    const table = 'json_strings_contract_test';
    await DB.query(`DROP TABLE IF EXISTS ${table}`);
    try {
      await DB.query(`CREATE TABLE ${table} (document JSON NOT NULL)`);
      await DB.query(`INSERT INTO ${table} (document) VALUES (?)`, [JSON.stringify([1, 2])]);
      const [result] = await DB.query<JsonStringRow[]>(`SELECT document FROM ${table}`);
      expect(typeof result[0].document).toBe('string');
      expect(JSON.parse(result[0].document)).toEqual([1, 2]);
    } finally {
      await DB.query(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  test('should check database connection', async () => {
    await expect(DB.checkDbConnection()).resolves.not.toThrow();
  });

  test('should handle query timeout configuration', async () => {
    expect(config.DATABASE.TIMEOUT).toBeGreaterThan(0);
  });

  test('should have correct database configuration', () => {
    expect(config.DATABASE.HOST).toBe('127.0.0.1');
    expect(config.DATABASE.USERNAME).toBe('mempool_test');
    expect(config.DATABASE.PASSWORD).toBe('mempool_test');
    expect(config.DATABASE.DATABASE).toBe('mempool_test');
  });
});

