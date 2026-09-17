import {
  diagnosisInput,
  submissionInput,
  tokenInput,
  txidInput,
  SubmissionInputError,
} from './submission-input';
import { Application, Request, Response } from 'express';
import privateSubmissionService, {
  SubmissionEvidenceError,
} from './private-submission.service';
import { PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER } from './private-submission.models';
import { PrivateRelayUnavailableError } from './private-relay.submissions';
import {
  PrivateSubmissionAuthorizationError,
  PrivateSubmissionNotFoundError,
} from './private-relay.types';

/**
 * Turns an absent integration into a 503 that names it, and anything else into
 * a 500. A read with no source behind it is a service state, not a result, so
 * it never reaches a caller as a 200 body.
 */
function fail(res: Response, err: unknown): Response {
  if (err instanceof SubmissionInputError)
    return res.status(400).json({ stage: 'invalid-input', error: err.message });
  if (err instanceof SubmissionEvidenceError) {
    return res.status(err.status).json({ stage: err.code, error: err.message });
  }
  return res
    .status(500)
    .json({ error: (err as Error)?.message || 'Internal error' });
}

/**
 * The private relay routes add three answers to fail(): 403 when the owner
 * token does not match the record, 404 for an unknown submission id, and 503
 * named after the missing store or relay.
 */
function failPrivate(res: Response, err: unknown): Response {
  if (err instanceof PrivateSubmissionAuthorizationError)
    return res.status(403).json({ stage: err.code, error: err.message });
  if (err instanceof PrivateSubmissionNotFoundError)
    return res.status(404).json({ stage: err.code, error: err.message });
  if (err instanceof PrivateRelayUnavailableError)
    return res.status(503).json({ stage: err.code, error: err.message });
  return fail(res, err);
}

/**
 * The owner token is read from the X-Submission-Owner-Token header or, on the
 * abort POST, from the owner_token body field. It is never taken from the URL.
 */
function ownerTokenInput(req: Request, allowBody: boolean): string | undefined {
  const header = req.get(PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER);
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (allowBody && req.body && typeof req.body === 'object' && typeof req.body.owner_token === 'string')
    return req.body.owner_token.trim();
  return undefined;
}

class PrivateSubmissionRoutes {
  public initRoutes(app: Application): void {
    app.get(
      '/api/v1/intelligence/submission/overview',
      async (_req: Request, res: Response) => {
        try {
          res.json(await privateSubmissionService.getOverview());
        } catch (err) {
          failPrivate(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/submission/capabilities',
      async (_req: Request, res: Response) => {
        try {
          res.json(await privateSubmissionService.getCapabilities());
        } catch (err) {
          failPrivate(res, err);
        }
      }
    );

    app.post(
      '/api/v1/intelligence/submission/diagnose',
      (req: Request, res: Response) => {
        try {
          const rawTx = diagnosisInput(req.body);
          res.json(privateSubmissionService.diagnoseTransaction(rawTx));
        } catch (err) {
          fail(res, err);
        }
      }
    );

    app.post(
      '/api/v1/intelligence/submission/private',
      async (req: Request, res: Response) => {
        try {
          const record = await privateSubmissionService.submitPrivate(
            submissionInput(req.body)
          );
          res.status(record.duplicate ? 200 : 201).json(record);
        } catch (err) {
          failPrivate(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/submission/private/:submissionToken',
      async (req: Request, res: Response) => {
        try {
          res.json(
            await privateSubmissionService.getPrivateSubmission(
              tokenInput(req.params.submissionToken),
              ownerTokenInput(req, false)
            )
          );
        } catch (err) {
          failPrivate(res, err);
        }
      }
    );

    app.post(
      '/api/v1/intelligence/submission/private/:submissionToken/abort',
      async (req: Request, res: Response) => {
        try {
          res.json(
            await privateSubmissionService.abortPrivateSubmission(
              tokenInput(req.params.submissionToken),
              ownerTokenInput(req, true)
            )
          );
        } catch (err) {
          failPrivate(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/accelerators/providers',
      (_req: Request, res: Response) => {
        try {
          res.json(privateSubmissionService.listAcceleratorProviders());
        } catch (err) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/accelerators/providers/:providerId',
      (req: Request, res: Response) => {
        try {
          res.json(
            privateSubmissionService.getAcceleratorProvider(
              tokenInput(req.params.providerId)
            )
          );
        } catch (err) {
          fail(res, err);
        }
      }
    );

    // A malformed, altered, expired or wrong-network receipt is the caller's
    // 400; a replay is a 409; an absent directory or unknown key is a 503.
    app.post(
      '/api/v1/intelligence/accelerators/receipts/verify',
      (req: Request, res: Response) => {
        try {
          const result = privateSubmissionService.verifyAcceleratorReceipt(
            req.body || {}
          );
          const status = result.verified ? 200 : result.stage === 'duplicate' ? 409 : result.stage === 'unavailable-trust' ? 503 : 400;
          res.status(status).json(result);
        } catch (err) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/ordering/transactions/:txid',
      (req: Request, res: Response) => {
        try {
          res.json(
            privateSubmissionService.getTransactionOrdering(
              txidInput(req.params.txid)
            )
          );
        } catch (err) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/ordering/blocks/:blockHash',
      (req: Request, res: Response) => {
        try {
          res.json(
            privateSubmissionService.getBlockOrdering(
              txidInput(req.params.blockHash)
            )
          );
        } catch (err) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/ordering/findings',
      (_req: Request, res: Response) => {
        try {
          res.json(privateSubmissionService.listOrderingFindings());
        } catch (err) {
          fail(res, err);
        }
      }
    );
  }
}

export default new PrivateSubmissionRoutes();
