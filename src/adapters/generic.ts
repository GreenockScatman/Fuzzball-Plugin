import type { Role, Scope } from '../protocol/messages';
import { closestComposed } from '../content/visibility';
export interface Metadata { role: Role; scope: Scope; semantic_kind: string; name?: string; skip?: boolean; priority?: number }
export function roleOf(element: Element): Role {
  const role = element.getAttribute('role');
  if (role === 'link' || role === 'button' || role === 'menuitem' || role === 'tab') return role;
  if (element.matches('a[href], area[href]')) return 'link';
  if (element.matches('button, summary, input[type=button], input[type=submit], input[type=reset], input[type=image]')) return 'button';
  return 'other';
}
export function riskKind(name: string, element: Element): string | undefined {
  if (element.hasAttribute('download') || /\b(download|install)\b/i.test(name)) return 'download';
  if (/\b(buy|purchase|place order|checkout|payment)\b/i.test(name)) return 'purchase';
  if (/\b(delete|remove)\b/i.test(name)) return 'delete';
  if (/\b(send|submit)\b/i.test(name) || element.matches('input[type=submit]') || element instanceof HTMLButtonElement && element.type === 'submit' && !!element.form) return 'submit';
  if (/\b(grant access|allow access|password|security|account settings)\b/i.test(name)) return 'permission';
  return undefined;
}
export function generic(element: Element): Metadata {
  const role = roleOf(element);
  const chrome = closestComposed(element, 'nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]');
  const main = closestComposed(element, 'main, [role=main]');
  return { role, scope: !chrome && main ? 'main_content' : 'any', semantic_kind: role };
}
