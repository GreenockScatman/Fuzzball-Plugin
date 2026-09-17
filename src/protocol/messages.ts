import type { ErrorCode } from './errors';
import type { Capability } from '../shared/constants';
export interface Envelope { type: string; protocol_version: 1 }
export interface SnapshotRequest extends Envelope { type: 'page_snapshot_request'; request_id: string; max_elements: number }
export interface ClickAction { kind: 'click'; element_id: string; open_in_new_tab: boolean }
export interface ActionRequest extends Envelope { type: 'perform_action'; request_id: string; tab_id: number; document_id: string; action: ClickAction }
export type Request = SnapshotRequest | ActionRequest;
export interface HelloAck extends Envelope { type: 'hello_ack'; session_id: string; heartbeat_interval_ms: number }
export interface ProtocolError extends Envelope { type: 'error'; request_id?: string; error_code: ErrorCode; message: string }
export type Incoming = Request | HelloAck | ProtocolError | (Envelope & { type: 'heartbeat_ack' });
export type Role = 'link' | 'button' | 'menuitem' | 'tab' | 'other';
export type Scope = 'any' | 'main_content' | 'search_results';
export interface Candidate {
  id: string; role: Role; name: string; text: string; semantic_kind: string;
  scope: Scope; ordinal: number; visible: true; enabled: true;
}
export interface ActiveTab { tab_id: number; window_id: number; window_focused: boolean }
export interface Hello extends Envelope { type: 'hello'; auth_token: string; extension_version: string; instance_id: string; browser: { name: 'chrome'; version: string }; enabled: boolean; capabilities: readonly Capability[] }
export interface Heartbeat extends Envelope { type: 'heartbeat'; active_tab: ActiveTab | null }
export interface PageInfo extends ActiveTab { document_id: string; url: string; title: string; permission: 'granted'; restricted: false }
export interface Snapshot extends Envelope { type: 'page_snapshot'; request_id: string; page: PageInfo; elements: Candidate[] }
export interface ActionResult extends Envelope { type: 'action_result'; request_id: string; ok: boolean; error_code: ErrorCode | null; message: string }
export type Response = Snapshot | ActionResult | ProtocolError;
export type Outgoing = Hello | Heartbeat | Response;
export interface FrameSnapshot { document_id: string; url: string; title: string; elements: Candidate[] }
export type ContentReply<T> = { ok: true; value: T } | { ok: false; error_code: ErrorCode };
