import { Request, Response } from 'express';

export const FIRST_PARTY_DATA_UNAVAILABLE = 'first-party-data-unavailable';

const UNAVAILABLE_MESSAGE =
  'Authoritative first-party data is not configured for this capability.';
const REQUEST_FAILED_MESSAGE = 'The request could not be served.';

export class FirstPartyDataUnavailableError extends Error {
  public readonly code = FIRST_PARTY_DATA_UNAVAILABLE;
  public readonly statusCode = 503;

  constructor(public readonly capability: string) {
    super(FIRST_PARTY_DATA_UNAVAILABLE);
    this.name = 'FirstPartyDataUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function throwFirstPartyDataUnavailable(capability: string): never {
  throw new FirstPartyDataUnavailableError(capability);
}

export function handleFailClosedError(
  req: Request,
  res: Response,
  requestedStatusCode: number,
  error: unknown
): void {
  void req;
  void requestedStatusCode;

  if (
    error instanceof FirstPartyDataUnavailableError ||
    error === FIRST_PARTY_DATA_UNAVAILABLE
  ) {
    res.status(503).json({
      status: 'unavailable',
      error: {
        code: FIRST_PARTY_DATA_UNAVAILABLE,
        message: UNAVAILABLE_MESSAGE,
        retryable: false,
      },
    });
    return;
  }

  res.status(500).json({
    status: 'error',
    error: {
      code: 'request-failed',
      message: REQUEST_FAILED_MESSAGE,
      retryable: false,
    },
  });
}
