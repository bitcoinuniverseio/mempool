/** Resolve one intercepted API request without any network access. */
export function matchFixtureRequest({ path, method = 'GET', table, overrides = {} }) {
  if (overrides['**']?.hang) return { kind: 'hang' };

  const override = overrides[path] ?? Object.entries(overrides)
    .filter(([key]) => key !== '**' && (
      path === key || path.startsWith(key.endsWith('/') ? key : `${key}/`)
    ))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1];

  if (override) {
    if (override.hang) return { kind: 'hang' };
    if (override.status) {
      return {
        kind: 'response',
        status: override.status,
        contentType: 'text/plain',
        body: 'fixture error',
        expectedFailure: true,
      };
    }
    return {
      kind: 'response',
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(override.body),
      expectedFailure: false,
    };
  }

  if (Object.hasOwn(table, path)) {
    const fixtureResponse = table[path]?.__qaHttpResponse;
    if (fixtureResponse && Number.isInteger(fixtureResponse.status)) {
      const body = fixtureResponse.body ?? { error: 'qa-fixture-response' };
      return {
        kind: 'response',
        status: fixtureResponse.status,
        contentType: fixtureResponse.contentType ?? 'application/json',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        expectedFailure: fixtureResponse.status >= 400,
      };
    }
    return {
      kind: 'response',
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(table[path]),
      expectedFailure: false,
    };
  }

  const invalidParameter = path.split('/').some((part) => {
    try {
      return decodeURIComponent(part).startsWith('qa-invalid-');
    } catch {
      return false;
    }
  });
  if (invalidParameter) {
    return {
      kind: 'response',
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'qa-invalid-parameter' }),
      expectedFailure: true,
    };
  }

  const request = `${method} ${path}`;
  return {
    kind: 'missing',
    status: 501,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'qa-fixture-missing', request }),
    request,
    expectedFailure: false,
  };
}
