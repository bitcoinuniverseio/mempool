import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputFile =
  "docs/acceptance/protocol-authority-traceability-2026-09-21.json";
const manifestFile = "docs/protocols/PROTOCOL-COVERAGE.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  return JSON.stringify(value);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonBytes(file) {
  const bytes = readFileSync(file);
  return { bytes, document: JSON.parse(bytes.toString("utf8")) };
}

function normalizeTraceability(rows) {
  assert(Array.isArray(rows), "Protocol traceability input must be an array");
  return rows.map((row) => ({
    protocol: row.protocol,
    authority: row.authority,
    operations: [...row.operations],
    owningRepositoryRevision: row.owningRepositoryRevision,
    owningDocumentationCandidates: [...row.owningDocumentationCandidates],
    status: row.status,
    remainingRequirement: row.remainingRequirement,
    nextAction: row.nextAction,
  }));
}

function normalizeSourceRegister(document) {
  assert(Array.isArray(document.sources), "Source register has no sources");
  return document.sources.map((source) => ({
    id: source.id ?? null,
    repository: source.repository ?? null,
    file: source.file ?? null,
    revision: source.revision,
    url: source.url,
    accessedAt: source.accessedAt,
    sha256: source.sha256,
    bytes: source.bytes,
    status: source.status,
    classification: source.classification,
  }));
}

function normalizeAuthorityInventory(rows) {
  assert(Array.isArray(rows), "Authority-source inventory must be an array");
  return rows.map((row) => ({
    repository: row.repository,
    revision: row.revision,
    branch: row.branch,
    concurrentDirty: row.concurrentDirty,
    candidateFileCount: row.candidateFiles.length,
    candidateFilesSha256: sha256(Buffer.from(stable(row.candidateFiles))),
  }));
}

function inputSnapshotsFromExisting(existing) {
  assert(
    existing.inputSnapshots,
    "Traceability artifact has no input snapshots",
  );
  return {
    traceabilityRows: normalizeTraceability(
      existing.inputSnapshots.traceabilityRows,
    ),
    sourceRegisterEntries: existing.inputSnapshots.sourceRegisterEntries,
    authorityInventoryEntries:
      existing.inputSnapshots.authorityInventoryEntries,
    sourceRegisterAccessDate: existing.inputSnapshots.sourceRegisterAccessDate,
  };
}

function loadInputs(inputPaths) {
  if (inputPaths) {
    const traceability = readJsonBytes(inputPaths.traceability);
    const sourceRegister = readJsonBytes(inputPaths.sourceRegister);
    const authorityFiles = readJsonBytes(inputPaths.authorityFiles);
    return {
      traceabilityRows: normalizeTraceability(traceability.document),
      sourceRegisterEntries: normalizeSourceRegister(sourceRegister.document),
      authorityInventoryEntries: normalizeAuthorityInventory(
        authorityFiles.document,
      ),
      sourceRegisterAccessDate: sourceRegister.document.accessDate,
      inputDigests: {
        traceability: {
          artifact: inputPaths.traceabilityLabel,
          sha256: sha256(traceability.bytes),
        },
        sourceRegister: {
          artifact: inputPaths.sourceRegisterLabel,
          sha256: sha256(sourceRegister.bytes),
        },
        authorityFiles: {
          artifact: inputPaths.authorityFilesLabel,
          sha256: sha256(authorityFiles.bytes),
        },
      },
    };
  }

  const existingPath = path.resolve(root, outputFile);
  assert(
    existsSync(existingPath),
    `Missing ${outputFile}; supply all three source inputs`,
  );
  const existing = readJson(existingPath);
  const snapshots = inputSnapshotsFromExisting(existing);
  return {
    ...snapshots,
    inputDigests: existing.inputDigests,
  };
}

function manifestSnapshot(document, bytes) {
  assert(
    Array.isArray(document.protocols),
    "Protocol manifest has no protocols",
  );
  return {
    schemaVersion: document.schemaVersion,
    registryVersion: document.registryVersion,
    sourceRepository: document.sourceRepository,
    sourceSha: document.sourceSha,
    sha256: sha256(bytes),
    protocols: document.protocols.map((protocol) => ({
      id: protocol.id,
      chain: protocol.chain,
      networks: [...protocol.networks],
      operations: protocol.readOperationDescriptors.map((descriptor) => ({
        id: descriptor.id,
        method: descriptor.method,
        route: descriptor.route,
        authorityPath: descriptor.authorityPath,
        evidence: descriptor.evidence,
        acceptance: descriptor.acceptance,
      })),
    })),
  };
}

export function buildTraceability({
  traceabilityPath,
  sourceRegisterPath,
  authorityFilesPath,
} = {}) {
  const inputPaths =
    traceabilityPath && sourceRegisterPath && authorityFilesPath
      ? {
          traceability: traceabilityPath,
          traceabilityLabel: "research/protocol-traceability.json",
          sourceRegister: sourceRegisterPath,
          sourceRegisterLabel: "research/source-register.json",
          authorityFiles: authorityFilesPath,
          authorityFilesLabel: "inventory/authority-source-files.json",
        }
      : null;
  const inputs = loadInputs(inputPaths);
  const manifestPath = path.resolve(root, manifestFile);
  const manifestInput = readJsonBytes(manifestPath);
  const manifest = manifestSnapshot(
    manifestInput.document,
    manifestInput.bytes,
  );

  const traceabilityByProtocol = new Map(
    inputs.traceabilityRows.map((row) => [row.protocol, row]),
  );
  const inventoryByAuthority = new Map(
    inputs.authorityInventoryEntries.map((row) => [row.repository, row]),
  );
  const sourceRegisterByAuthority = new Map();
  for (const source of inputs.sourceRegisterEntries) {
    if (typeof source.repository !== "string") continue;
    const authority = source.repository.split("/").at(-1);
    const entries = sourceRegisterByAuthority.get(authority) ?? [];
    entries.push(source);
    sourceRegisterByAuthority.set(authority, entries);
  }

  const protocolIds = manifest.protocols.map((protocol) => protocol.id);
  assert.equal(
    new Set(protocolIds).size,
    protocolIds.length,
    "Manifest protocol IDs are duplicated",
  );
  assert.equal(
    inputs.traceabilityRows.length,
    protocolIds.length,
    "Traceability protocol count differs from manifest",
  );
  assert.deepEqual(
    [...traceabilityByProtocol.keys()].sort(),
    [...protocolIds].sort(),
    "Traceability protocols do not match the current manifest",
  );
  assert.equal(
    new Set(inputs.traceabilityRows.flatMap((row) => row.operations)).size,
    inputs.traceabilityRows.flatMap((row) => row.operations).length,
    "Traceability operation IDs are duplicated",
  );
  assert.equal(
    inputs.traceabilityRows.reduce(
      (count, row) => count + row.operations.length,
      0,
    ),
    manifest.protocols.reduce((count, row) => count + row.operations.length, 0),
    "Traceability operation count differs from manifest",
  );

  const protocols = manifest.protocols.map((manifestProtocol) => {
    const traced = traceabilityByProtocol.get(manifestProtocol.id);
    const authorityInventory = inventoryByAuthority.get(traced.authority);
    assert(
      authorityInventory,
      `No authority inventory row for ${traced.authority}`,
    );
    const sourceRegisterMatches =
      sourceRegisterByAuthority.get(traced.authority) ?? [];
    const descriptorsById = new Map(
      manifestProtocol.operations.map((operation) => [operation.id, operation]),
    );
    return {
      id: manifestProtocol.id,
      chain: manifestProtocol.chain,
      networks: manifestProtocol.networks,
      authority: {
        id: traced.authority,
        owningRepositoryRevision: traced.owningRepositoryRevision,
        checkout: authorityInventory,
        sourceRegisterMatches,
        sourceRegisterMatchStatus: sourceRegisterMatches.length
          ? "REFERENCE-FOUND"
          : "REFERENCE-MISSING",
      },
      governingDocumentationCandidates: traced.owningDocumentationCandidates,
      operations: traced.operations.map((operationId) => {
        const descriptorId = operationId.startsWith(
          `PROTO/${manifestProtocol.id}/`,
        )
          ? operationId.slice(`PROTO/${manifestProtocol.id}/`.length)
          : operationId;
        const descriptor = descriptorsById.get(descriptorId);
        assert(
          descriptor,
          `${manifestProtocol.id}/${operationId} is absent from the manifest`,
        );
        return {
          id: operationId,
          contract: descriptor,
          status: "BLOCKED",
          acceptance: "NOT TESTED",
          authorityContract: "UNVERIFIED",
          requiredEvidence: [
            "Normative or reference source at a pinned revision",
            "Exact deployed authority build and supported network",
            "Executable reader assertions with authoritative readback",
            "Consumer result, checkpoint and recovery assertions where applicable",
          ],
          remainingRequirement: traced.remainingRequirement,
          nextAction: traced.nextAction,
        };
      }),
      status: "BLOCKED",
      blockingReasons: [
        "The deployed authority build and network support are not verified.",
        "Operation-level conformance, authoritative readback and consumer evidence are absent.",
      ],
    };
  });

  const operationCount = protocols.reduce(
    (count, protocol) => count + protocol.operations.length,
    0,
  );
  const protocolsWithSourceReferences = protocols.filter(
    (protocol) => protocol.authority.sourceRegisterMatches.length > 0,
  ).length;

  return {
    schemaVersion: "universe-protocol-authority-traceability-v1",
    status: "BLOCKED / AUTHORITY-GROUNDING-UNVERIFIED",
    policy:
      "Source references and local authority checkouts are traceability inputs only. They do not prove deployed authority identity, network support, protocol semantics or functional acceptance.",
    inputDigests: inputs.inputDigests,
    inputSnapshots: {
      traceabilityRows: inputs.traceabilityRows,
      sourceRegisterEntries: inputs.sourceRegisterEntries,
      authorityInventoryEntries: inputs.authorityInventoryEntries,
      sourceRegisterAccessDate: inputs.sourceRegisterAccessDate,
    },
    currentManifest: manifest,
    summary: {
      protocolCount: protocols.length,
      operationCount,
      authorityCount: new Set(
        protocols.map((protocol) => protocol.authority.id),
      ).size,
      protocolsWithSourceReferences,
      qualifiedProtocols: 0,
      blockedProtocols: protocols.length,
      status: "BLOCKED",
    },
    protocols,
  };
}

export function validateTraceability(document, currentManifestBytes) {
  assert.equal(
    document.schemaVersion,
    "universe-protocol-authority-traceability-v1",
  );
  assert.equal(document.status, "BLOCKED / AUTHORITY-GROUNDING-UNVERIFIED");
  assert(document.inputDigests?.traceability?.sha256?.match(/^[0-9a-f]{64}$/));
  assert(
    document.inputDigests?.sourceRegister?.sha256?.match(/^[0-9a-f]{64}$/),
  );
  assert(
    document.inputDigests?.authorityFiles?.sha256?.match(/^[0-9a-f]{64}$/),
  );
  assert.equal(document.currentManifest.sha256, sha256(currentManifestBytes));
  assert.equal(document.summary.protocolCount, 39);
  assert.equal(document.summary.operationCount, 123);
  assert.equal(document.summary.qualifiedProtocols, 0);
  assert.equal(document.summary.blockedProtocols, 39);
  assert.equal(document.protocols.length, 39);
  assert.equal(document.inputSnapshots.traceabilityRows.length, 39);
  assert.equal(document.inputSnapshots.authorityInventoryEntries.length, 29);
  const protocolIds = document.protocols.map((protocol) => protocol.id);
  assert.equal(new Set(protocolIds).size, protocolIds.length);
  const operationIds = document.protocols.flatMap((protocol) =>
    protocol.operations.map((operation) => `${protocol.id}/${operation.id}`),
  );
  assert.equal(operationIds.length, 123);
  assert.equal(new Set(operationIds).size, operationIds.length);
  for (const protocol of document.protocols) {
    assert.equal(protocol.status, "BLOCKED");
    for (const operation of protocol.operations) {
      assert.equal(operation.status, "BLOCKED");
      assert.equal(operation.acceptance, "NOT TESTED");
      assert.equal(operation.authorityContract, "UNVERIFIED");
      assert(operation.requiredEvidence.length >= 4);
    }
  }
  return true;
}

function parseArgs(args) {
  const result = {
    check: false,
    traceabilityPath: null,
    sourceRegisterPath: null,
    authorityFilesPath: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") result.check = true;
    else if (arg === "--traceability")
      result.traceabilityPath = path.resolve(args[++index] ?? "");
    else if (arg === "--source-register")
      result.sourceRegisterPath = path.resolve(args[++index] ?? "");
    else if (arg === "--authority-files")
      result.authorityFilesPath = path.resolve(args[++index] ?? "");
    else
      assert.fail(
        "Usage: protocol-authority-traceability.mjs [--check] [--traceability path --source-register path --authority-files path]",
      );
  }
  if (!result.check) {
    assert(
      result.traceabilityPath,
      "--traceability is required when generating the artifact",
    );
    assert(
      result.sourceRegisterPath,
      "--source-register is required when generating the artifact",
    );
    assert(
      result.authorityFilesPath,
      "--authority-files is required when generating the artifact",
    );
  }
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = parseArgs(process.argv.slice(2));
  const document = buildTraceability(args);
  const manifestBytes = readFileSync(path.resolve(root, manifestFile));
  if (args.check) {
    const stored = readJson(path.resolve(root, outputFile));
    validateTraceability(stored, manifestBytes);
    assert.deepEqual(
      stored,
      document,
      "Protocol authority traceability is stale; regenerate it",
    );
  } else {
    validateTraceability(document, manifestBytes);
    writeFileSync(
      path.resolve(root, outputFile),
      `${JSON.stringify(document, null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify(
      {
        artifact: outputFile,
        protocols: document.summary.protocolCount,
        operations: document.summary.operationCount,
        qualified: document.summary.qualifiedProtocols,
        blocked: document.summary.blockedProtocols,
        protocolsWithSourceReferences:
          document.summary.protocolsWithSourceReferences,
      },
      null,
      2,
    ),
  );
}
