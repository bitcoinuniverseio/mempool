// Setup that runs BEFORE setupFiles
// This ensures MEMPOOL_CONFIG_FILE is set before any modules are loaded
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

const defaultConfigFile = path.join(__dirname, 'mempool-config.test.json');

// Helper to get docker compose command (v1 or v2)
function getDockerComposeCmd(): string {
  try {
    execSync('docker compose version', { stdio: 'pipe' });
    return 'docker compose';
  } catch {
    try {
      execSync('docker-compose version', { stdio: 'pipe' });
      return 'docker-compose';
    } catch {
      throw new Error('Neither "docker compose" nor "docker-compose" is available');
    }
  }
}

function setUniqueComposeProject(): string {
  if (!process.env.COMPOSE_PROJECT_NAME) {
    process.env.COMPOSE_PROJECT_NAME = `mempool-integration-${process.pid}-${Date.now()}`;
  }
  if (!process.env.MEMPOOL_TEST_DB_PORT) {
    process.env.MEMPOOL_TEST_DB_PORT = '0';
  }
  return process.env.COMPOSE_PROJECT_NAME;
}

function getPublishedDatabasePort(dockerComposeCmd: string, composeFile: string): number {
  const publishedAddress = execSync(
    `${dockerComposeCmd} -f "${composeFile}" port db-test 3306`,
    { cwd: __dirname, encoding: 'utf8' },
  ).trim();
  const match = publishedAddress.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Could not determine the test database port from "${publishedAddress}"`);
  }

  return port;
}

function writeRuntimeConfig(port: number, composeProject: string): void {
  const sourceConfigFile = process.env.MEMPOOL_TEST_BASE_CONFIG_FILE
    || (!process.env.MEMPOOL_TEST_RUNTIME_CONFIG_FILE && process.env.MEMPOOL_CONFIG_FILE)
    || defaultConfigFile;
  const runtimeConfigFile = process.env.MEMPOOL_TEST_RUNTIME_CONFIG_FILE
    || path.join(os.tmpdir(), `${composeProject}-config.json`);
  const runtimeConfig = JSON.parse(fs.readFileSync(sourceConfigFile, 'utf8'));

  runtimeConfig.DATABASE.PORT = port;
  fs.writeFileSync(runtimeConfigFile, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  process.env.MEMPOOL_TEST_DB_PORT = String(port);
  process.env.MEMPOOL_CONFIG_FILE = runtimeConfigFile;
}

// Start the Docker test database container
module.exports = async () => {
  // Skip if SKIP_DB_SETUP is set (e.g., when test-with-db.sh manages the database)
  if (process.env.SKIP_DB_SETUP) {
    console.log('Skipping database setup (managed externally)');
    return;
  }

  const composeFile = path.join(__dirname, 'docker-compose.test.yml');
  const dockerComposeCmd = getDockerComposeCmd();
  const composeProject = setUniqueComposeProject();

  console.log('Starting test database container...');
  try {
    // A container left running by an earlier run is not the container this run
    // asked for: compose reports it as already up and never recreates it, so a
    // change of image or of engine is silently ignored and the tests measure
    // whatever was there before. Tear it down, volumes included, first.
    try {
      execSync(`${dockerComposeCmd} -f "${composeFile}" down -v --remove-orphans`, {
        stdio: 'inherit',
        cwd: __dirname
      });
    } catch {
      // Nothing to remove on a clean machine, which is the normal case.
    }

    execSync(`${dockerComposeCmd} -f "${composeFile}" up -d --force-recreate`, {
      stdio: 'inherit',
      cwd: __dirname
    });
    writeRuntimeConfig(getPublishedDatabasePort(dockerComposeCmd, composeFile), composeProject);

    // Wait for database to be ready
    console.log('Waiting for database to be ready...');
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      try {
        // MariaDB renamed its client binaries; either name may be the one this
        // image ships, so a probe that only knows one of them reports a
        // healthy server as a database that never started.
        execSync(
          `${dockerComposeCmd} -f "${composeFile}" exec -T db-test sh -c ` +
            `"mariadb-admin ping -h localhost -u mempool_test -pmempool_test --silent ` +
            `|| mysqladmin ping -h localhost -u mempool_test -pmempool_test --silent"`,
          { cwd: __dirname, stdio: 'pipe' },
        );
        console.log('Database is ready!');
        break;
      } catch (e) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('Database did not start in time');
        }
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    try {
      execSync(`${dockerComposeCmd} -f "${composeFile}" down -v --remove-orphans`, {
        stdio: 'inherit',
        cwd: __dirname
      });
    } catch {
      // Preserve the startup error when cleanup also fails.
    }
    console.error('Failed to start test database:', error instanceof Error ? error.message : error);
    throw error;
  }
};

