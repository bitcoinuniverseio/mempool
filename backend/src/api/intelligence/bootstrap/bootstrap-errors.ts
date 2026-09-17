export class BootstrapEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503
  ) {
    super(message);
  }
}

export const unavailable = (code: string, prerequisite: string): never => {
  throw new BootstrapEvidenceError(
    code,
    'Bootstrap evidence is unavailable. ' + prerequisite
  );
};
