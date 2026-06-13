// ─── Core Domain Types ───────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  channel_preference: 'email' | 'sms' | 'whatsapp' | 'rcs';
  city: string | null;
  tags: string[];
  created_at: Date;
}

export interface Order {
  id: string;
  customer_id: string;
  amount: number;
  items: OrderItem[];
  status: 'completed' | 'returned' | 'cancelled';
  ordered_at: Date;
  created_at: Date;
}

export interface OrderItem {
  name: string;
  category: string;
  price: number;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  rules: SegmentRules;
  customer_count: number;
  created_by: 'ai' | 'manual';
  created_at: Date;
}

export interface SegmentRules {
  operator: 'AND' | 'OR';
  conditions: SegmentCondition[];
}

export interface SegmentCondition {
  field: string;
  op: 'lt' | 'gt' | 'gte' | 'lte' | 'eq' | 'in' | 'contains' | 'not_contains';
  value: string | number | string[];
}

export interface Campaign {
  id: string;
  name: string;
  segment_id: string;
  message_template: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'rcs';
  status: 'draft' | 'sending' | 'sent' | 'completed';
  created_by: 'ai' | 'manual';
  sent_at: Date | null;
  created_at: Date;
}

export interface Communication {
  id: string;
  campaign_id: string;
  customer_id: string;
  channel: string;
  message: string;
  status: CommunicationStatus;
  sent_at: Date | null;
  delivered_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
}

export type CommunicationStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'opened' | 'clicked';

export interface CommunicationEvent {
  id: string;
  communication_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

// ─── API Types ───────────────────────────────────────────────────

export interface ReceiptPayload {
  communication_id: string;
  event: CommunicationStatus;
  occurred_at: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendPayload {
  communications: Array<{
    communication_id: string;
    recipient: { email?: string; phone?: string };
    channel: string;
    message: string;
  }>;
  callback_url: string;
}

export interface CampaignStats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
  delivery_rate: number;
  open_rate: number;
  click_rate: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Status transition validation ────────────────────────────────

const STATUS_ORDER: Record<CommunicationStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  failed: 2,   // same level as delivered — terminal negative
  opened: 3,
  clicked: 4,
};

export function isValidTransition(current: CommunicationStatus, next: CommunicationStatus): boolean {
  // Failed is terminal — nothing can follow it
  if (current === 'failed') return false;
  // Clicked is terminal — nothing can follow it
  if (current === 'clicked') return false;
  // Can't go backwards
  return STATUS_ORDER[next] > STATUS_ORDER[current];
}
