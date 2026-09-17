import type { ClickAction } from '../protocol/messages';
import { ControlError } from '../protocol/errors';
import { safeLink } from '../shared/permissions';
import { isInteractable } from './visibility';
import { CandidateStore } from './candidate-store';
export interface Activation { message: string; url?: string }
export function execute(store: CandidateStore, documentId: string, action: ClickAction): Activation {
  if (action.kind !== 'click') throw new ControlError('unsupported_capability');
  const { element } = store.get(action.element_id, documentId);
  if (!isInteractable(element)) throw new ControlError('element_not_interactable');
  if (element.hasAttribute('download')) throw new ControlError('unsupported_capability');
  const link = element instanceof HTMLAnchorElement ? safeLink(element.href) : null;
  if (element instanceof HTMLAnchorElement && !link) throw new ControlError('unsupported_capability');
  if (action.open_in_new_tab) {
    if (!link || !(element instanceof HTMLAnchorElement)) throw new ControlError('unsupported_capability');
    store.consume(action.element_id);
    return { url: link, message: 'Opened link in a new tab.' };
  }
  // Form submission and resets are outside the authoritative v1 contract.
  if (element.matches('input[type=submit], input[type=image], input[type=reset]') || element instanceof HTMLButtonElement && element.form && /^(submit|reset)$/.test(element.type)) throw new ControlError('unsupported_capability');
  element.focus({ preventScroll: true });
  store.get(action.element_id, documentId);
  if (!isInteractable(element)) throw new ControlError('element_not_interactable');
  store.consume(action.element_id);
  element.click();
  return { message: 'Activation attempted successfully.' };
}
