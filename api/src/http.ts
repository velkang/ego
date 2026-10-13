export class ApiError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
  ) {
    super(code);
  }
}
export const requireConfig = (value: string | undefined, name: string) => {
  if (!value) throw new ApiError(`${name}_NOT_CONFIGURED`, 503);
  return value;
};
