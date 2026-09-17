import { CANDIDATE_TTL_MS } from '../shared/constants';
import { ControlError } from '../protocol/errors';
import { accessibleName } from './accessible-name';
export interface StoredCandidate { element: HTMLElement; expires: number; documentId: string; name: string; originalName: string; href: string | null }
export class CandidateStore {
  private entries = new Map<string, StoredCandidate>();
  private timer?: ReturnType<typeof setTimeout>;
  documentId = crypto.randomUUID() as string;
  private url = location.href;
  private root = document.documentElement;
  refreshDocument(force = false): void {
    if (force || this.url !== location.href || this.root !== document.documentElement) {
      this.clear(); this.documentId = crypto.randomUUID(); this.url = location.href; this.root = document.documentElement;
    }
  }
  clear(): void { this.entries.clear(); clearTimeout(this.timer); }
  begin(): void { this.refreshDocument(); this.clear(); this.timer = setTimeout(() => this.clear(), CANDIDATE_TTL_MS); }
  add(element: HTMLElement, name: string): string {
    const id = crypto.randomUUID();
    this.entries.set(id, { element, name, originalName: accessibleName(element), documentId: this.documentId, expires: Date.now() + CANDIDATE_TTL_MS, href: element instanceof HTMLAnchorElement ? element.href : null });
    return id;
  }
  get(id: string, documentId: string): StoredCandidate {
    this.refreshDocument();
    if (documentId !== this.documentId) throw new ControlError('stale_document');
    const entry = this.entries.get(id);
    if (!entry || entry.expires <= Date.now()) { this.entries.delete(id); throw new ControlError('element_disappeared'); }
    if (!entry.element.isConnected) throw new ControlError('element_disappeared');
    if (entry.href !== (entry.element instanceof HTMLAnchorElement ? entry.element.href : null)) throw new ControlError('navigation_changed');
    if (accessibleName(entry.element) !== entry.originalName) throw new ControlError('element_not_interactable');
    return entry;
  }
  consume(id: string): void { this.entries.delete(id); }
}
