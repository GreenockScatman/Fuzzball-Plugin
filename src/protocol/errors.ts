export const ERROR_CODES = ['not_connected', 'extension_disabled', 'protocol_mismatch', 'unsupported_capability', 'unsupported_browser', 'permission_required', 'restricted_page', 'no_active_tab', 'no_match', 'ambiguous_match', 'stale_document', 'element_disappeared', 'element_not_interactable', 'navigation_changed', 'timeout', 'malformed_response', 'internal_error'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export class ControlError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
export function errorCode(error: unknown): ErrorCode { return error instanceof ControlError ? error.code : 'internal_error'; }
export function requireCondition(condition: unknown, code: ErrorCode): asserts condition {
  if (!condition) throw new ControlError(code);
}
