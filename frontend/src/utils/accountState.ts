let _restricted = false;

export function setAccountRestricted(value: boolean) {
  _restricted = value;
}

export function isAccountRestricted(): boolean {
  return _restricted;
}
