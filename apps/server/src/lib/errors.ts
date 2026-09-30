/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, message);
export const notFound = (what = 'Not found'): HttpError => new HttpError(404, what);
export const conflict = (message: string): HttpError => new HttpError(409, message);
