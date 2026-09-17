import { CandidateStore } from './candidate-store';
import { scan, elements } from './element-scanner';
import { execute } from './action-executor';
import { isInteractable, visibleRect, parentElement } from './visibility';
import { concise } from './accessible-name';
import { record, boundedString } from '../protocol/validation';
import { ControlError, errorCode } from '../protocol/errors';
import type { ClickAction } from '../protocol/messages';

const context = globalThis as typeof globalThis & { __fuzzballInstalled?: boolean };
if (!context.__fuzzballInstalled) {
  context.__fuzzballInstalled = true;
  const store = new CandidateStore();
  addEventListener('pagehide', () => store.refreshDocument(true));
  addEventListener('pageshow', event => { if (event.persisted) store.refreshDocument(true); });
  addEventListener('popstate', () => store.refreshDocument(true));
  addEventListener('hashchange', () => store.refreshDocument(true));
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !record(message) || message.channel !== 'fuzzball-content') return;
    const handle = async (): Promise<unknown> => {
      store.refreshDocument();
      switch (message.command) {
        case 'invalidate': store.refreshDocument(true); return true;
        case 'identity': return { document_id: store.documentId, url: location.href };
        case 'snapshot': {
          if (!Number.isInteger(message.max) || Number(message.max) < 1 || Number(message.max) > 200) throw new ControlError('malformed_response');
          const candidates = scan(store, Number(message.max));
          const url = new URL(location.href);
          return { document_id: store.documentId, url: `${url.origin}${url.pathname}`.slice(0, 2048), title: concise(document.title, 500), elements: candidates };
        }
        case 'frame-visible': {
          if (!boundedString(message.url, 2048)) return false;
          const frames = Array.from(elements(document)).filter((node): node is HTMLIFrameElement => node instanceof HTMLIFrameElement && node.src === message.url);
          // Ambiguous, navigated, opaque or hidden embeddings are skipped safely.
          if (frames.length !== 1 || !isInteractable(frames[0])) return false;
          const frame = frames[0], rect = frame.getBoundingClientRect(), visible = visibleRect(frame);
          for (let ancestor: Element | null = frame; ancestor; ancestor = parentElement(ancestor)) {
            const transform = getComputedStyle(ancestor).transform;
            if (transform && transform !== 'none') return false;
          }
          // Cropped frames cannot prove that a child's local viewport is visible.
          return !!visible && Math.abs(visible.width - rect.width) < 1 && Math.abs(visible.height - rect.height) < 1;
        }
        case 'activate': {
          if (!boundedString(message.documentId) || !boundedString(message.authorization) || typeof message.deadline !== 'number' || !record(message.action) || message.action.kind !== 'click' || !boundedString(message.action.element_id) || typeof message.action.open_in_new_tab !== 'boolean') throw new ControlError('malformed_response');
          const permission = await chrome.runtime.sendMessage({ channel: 'fuzzball-authorize', authorization: message.authorization });
          if (!record(permission) || permission.ok !== true) throw new ControlError(record(permission) && permission.code === 'extension_disabled' ? 'extension_disabled' : 'navigation_changed');
          if (Date.now() >= message.deadline) throw new ControlError('timeout');
          return execute(store, message.documentId, message.action as unknown as ClickAction);
        }
        default: throw new ControlError('unsupported_capability');
      }
    };
    void handle().then(value => respond({ ok: true, value }), error => respond({ ok: false, error_code: errorCode(error) }));
    return true;
  });
}
