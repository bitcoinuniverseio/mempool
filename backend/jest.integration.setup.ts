// Setup that runs BEFORE setupFiles
// This ensures MEMPOOL_CONFIG_FILE is set before any modules are loaded
import * as path from 'path';
import { execSync } from 'child_process';

// Set the config file path if not already set
if (!process.env.MEMPOOL_CONFIG_FILE) {
  process.env.MEMPOOL_CONFIG_FILE = path.join(__dirname, 'mempool-config.test.json');
}

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

// Start the Docker test database container
module.exports = async () => {
  // Skip if SKIP_DB_SETUP is set (e.g., when test-with-db.sh manages the database)
  if (process.env.SKIP_DB_SETUP) {
    console.log('Skipping database setup (managed externally)');
    return;
  }

  console.log('Starting test database container...');
  try {
    const composeFile = path.join(__dirname, 'docker-compose.test.yml');
    const dockerComposeCmd = getDockerComposeCmd();

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

    // `down` only removes what compose owns. A container left behind under the
    // same name by anything else still holds the name, and `up` fails on the
    // conflict rather than starting the database.
    try {
      execSync('docker rm -f backend-db-test-1', { stdio: 'pipe' });
    } catch {
      // No such container, which is the normal case.
    }

    execSync(`${dockerComposeCmd} -f "${composeFile}" up -d --force-recreate`, {
      stdio: 'inherit',
      cwd: __dirname
    });

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
    console.error('Failed to start test database:', error instanceof Error ? error.message : error);
    throw error;
  }
};

