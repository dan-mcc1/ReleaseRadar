export class TrackingLimitError extends Error {
  readonly code = "tracking_limit_reached";
  readonly limit: number;
  readonly current: number;

  constructor(limit: number, current: number) {
    super("Free accounts can track up to 30 titles.");
    this.limit = limit;
    this.current = current;
  }
}

export class PremiumRequiredError extends Error {
  readonly code = "premium_required";
  constructor() {
    super("This feature requires a Premium subscription.");
  }
}

/** A non-ok API response. The message is for logs; show people PageState's wording. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, path: string) {
    super(`API error ${status}: ${path}`);
    this.name = "ApiError";
    this.status = status;
  }
}
