let _restricted = false;
let _onBanDetected: (() => void) | null = null;

export function setAccountRestricted(value: boolean) {
  _restricted = value;
}

export function isAccountRestricted(): boolean {
  return _restricted;
}

export function onBanDetected(cb: () => void): void {
  _onBanDetected = cb;
}

export function triggerBanDetected(): void {
  _restricted = true;
  _onBanDetected?.();
}
