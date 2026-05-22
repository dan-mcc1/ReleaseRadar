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
