import { Request, Response } from 'express';
import {
  FirstPartyDataUnavailableError,
  handleFailClosedError,
} from './first-party-data';

function responseDouble(): {
  response: Response;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return {
    response: { status, json } as unknown as Response,
    status,
    json,
  };
}

describe('first-party data failure contract', () => {
  it('returns a structured unavailable response for missing first-party data', () => {
    const { response, status, json } = responseDouble();

    const serviceError = new FirstPartyDataUnavailableError('ark');
    handleFailClosedError({} as Request, response, 500, serviceError.message);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      status: 'unavailable',
      error: {
        code: 'first-party-data-unavailable',
        message:
          'Authoritative first-party data is not configured for this capability.',
        retryable: false,
      },
    });
  });

  it('does not expose unexpected error details', () => {
    const { response, status, json } = responseDouble();

    handleFailClosedError(
      {} as Request,
      response,
      500,
      'private implementation detail'
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      status: 'error',
      error: {
        code: 'request-failed',
        message: 'The request could not be served.',
        retryable: false,
      },
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain(
      'private implementation detail'
    );
  });

  it('retains a typed internal error for service assertions', () => {
    expect(new FirstPartyDataUnavailableError('ark')).toMatchObject({
      name: 'FirstPartyDataUnavailableError',
      code: 'first-party-data-unavailable',
      statusCode: 503,
      capability: 'ark',
    });
  });
});
