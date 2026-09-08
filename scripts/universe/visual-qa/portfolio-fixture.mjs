/**
 * Encrypted local Portfolio state used only by browser QA.
 *
 * The application receives the same IndexedDB records it writes itself. A
 * saved-account route must still initialize the vault, request the passphrase,
 * unlock through the production worker, and return to the original deep URL.
 */

export const QA_PORTFOLIO_ID = "qa-portfolio-001";
export const QA_PORTFOLIO_PASSPHRASE = "universe-qa-only";

const DB_NAME = "universe-portfolio-vault";
const DB_VERSION = 1;
const CREATED_AT = "2026-09-03T00:00:00.000Z";
const KDF_ITERATIONS = 10_000;
const QA_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

const portfolio = Object.freeze({
  id: QA_PORTFOLIO_ID,
  name: "QA watch-only portfolio",
  accounts: [
    {
      id: "qa-account-001",
      name: "Public Bitcoin address",
      chain: "bitcoin",
      network: "mainnet",
      kind: "address",
      addresses: [QA_ADDRESS],
      tags: ["qa"],
      createdAt: CREATED_AT,
    },
  ],
  groups: [],
  manualEntries: [],
  tags: ["qa"],
  quoteCurrency: "USD",
  privacy: { hideValues: false, relockWhenHiddenMinutes: 0 },
  snapshotPolicy: { autoAfterCompleteRefresh: true, intervalMinutes: 60 },
  alertRules: [],
  savedViews: [],
  dashboard: [],
  pinnedAssetKeys: [],
  hiddenAssetKeys: [],
  annotations: {},
  utxoProtections: {},
  defaultAccountId: "qa-account-001",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  archived: false,
});

function needsVault(routes) {
  return routes.some((route) => route.requiresPortfolioVault === true);
}

/** Seeds one browser context without exposing any hook in the application. */
export async function seedPortfolioVault(context, base, routes) {
  if (!needsVault(routes)) return;
  const seedUrl = new URL("/__universe-qa__/portfolio-vault", base).toString();
  const handler = (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Portfolio QA seed</title></head><body></body></html>",
    });
  await context.route(seedUrl, handler);
  const page = await context.newPage();
  try {
    await page.goto(seedUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      async ({
        dbName,
        dbVersion,
        passphrase,
        iterations,
        createdAt,
        portfolioValue,
      }) => {
        const encode = (bytes) => {
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary);
        };
        const salt = Uint8Array.from([
          81, 65, 45, 112, 111, 114, 116, 102, 111, 108, 105, 111, 45, 118, 49,
          33,
        ]);
        const material = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(passphrase),
          "PBKDF2",
          false,
          ["deriveBits"],
        );
        const bits = await crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt, iterations },
          material,
          256,
        );
        const key = await crypto.subtle.importKey(
          "raw",
          bits,
          "AES-GCM",
          false,
          ["encrypt"],
        );
        let nonceIndex = 1;
        const encrypt = async (value) => {
          const nonce = new Uint8Array(12);
          nonce.fill(nonceIndex++);
          const plaintext =
            typeof value === "string" ? value : JSON.stringify(value);
          const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce },
            key,
            new TextEncoder().encode(plaintext),
          );
          return {
            nonceB64: encode(nonce),
            ctB64: encode(new Uint8Array(ciphertext)),
          };
        };

        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () =>
            reject(new Error("Portfolio QA database deletion was blocked."));
        });
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onupgradeneeded = () => {
            request.result.createObjectStore("meta");
            request.result.createObjectStore("records", { keyPath: "id" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        const verifier = await encrypt("universe-portfolio-vault-verifier-v1");
        const records = [
          {
            id: portfolioValue.id,
            type: "portfolio",
            envelope: await encrypt(portfolioValue),
            updatedAt: createdAt,
          },
          {
            id: "preferences",
            type: "preferences",
            envelope: await encrypt({
              autoLockMinutes: 15,
              relockWhenHidden: false,
              activePortfolioId: portfolioValue.id,
            }),
            updatedAt: createdAt,
          },
        ];
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(["meta", "records"], "readwrite");
          transaction.objectStore("meta").put(
            {
              version: 1,
              kdf: "pbkdf2",
              kdfParams: { iterations },
              saltB64: encode(salt),
              verifier,
              createdAt,
              updatedAt: createdAt,
            },
            "vault",
          );
          for (const record of records)
            transaction.objectStore("records").put(record);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
        db.close();
      },
      {
        dbName: DB_NAME,
        dbVersion: DB_VERSION,
        passphrase: QA_PORTFOLIO_PASSPHRASE,
        iterations: KDF_ITERATIONS,
        createdAt: CREATED_AT,
        portfolioValue: portfolio,
      },
    );
  } finally {
    await page.close();
    await context.unroute(seedUrl, handler);
  }
}

/** Unlocks a cold saved-account route and verifies its original destination. */
export async function unlockPortfolioRoute(page, route) {
  if (route.requiresPortfolioVault !== true) return;
  const expected = (route.redirectTo || route.path).replace(/\/+$/, "") || "/";
  const passphrase = page.locator('input[name="passphrase"]');
  await passphrase.waitFor({ state: "visible", timeout: 20_000 });
  await passphrase.fill(QA_PORTFOLIO_PASSPHRASE);
  await passphrase.press("Enter");
  await page.waitForFunction(
    ({ expectedPath, allowPrefix }) => {
      const landed = window.location.pathname.replace(/\/+$/, "") || "/";
      return (
        landed === expectedPath ||
        (allowPrefix && landed.startsWith(`${expectedPath}/`)) ||
        document.querySelector(".locked .error") !== null
      );
    },
    { expectedPath: expected, allowPrefix: Boolean(route.redirectTo) },
    { timeout: 30_000 },
  );
  const unlockError = await page
    .locator(".locked .error")
    .textContent()
    .catch(() => null);
  if (unlockError) {
    throw new Error(`Portfolio QA vault did not unlock: ${unlockError.trim()}`);
  }
  await page
    .locator("app-portfolio-shell")
    .waitFor({ state: "visible", timeout: 20_000 });
}
