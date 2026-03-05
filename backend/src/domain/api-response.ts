export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiSuccess<T = unknown> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: ApiError;
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;

export function success<T>(data: T): ApiSuccess<T> {
  return {
    ok: true,
    data,
  };
}

export function failure(code: string, message: string, details?: unknown): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}
