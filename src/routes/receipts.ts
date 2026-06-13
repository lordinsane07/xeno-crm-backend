import { Router, Request, Response } from 'express';
import { query } from '../db';
import { isValidTransition } from '../types';
import type { CommunicationStatus } from '../types';
import { sseManager } from '../services/sseManager';

const router = Router();

/**
 * POST /api/receipts — Receives delivery callbacks from the channel stub.
 * 
 * This is the CRM's webhook endpoint. The channel stub calls this
 * for every delivery event (sent, delivered, failed, opened, clicked).
 * 
 * Key behaviors:
 * - State machine: only valid forward transitions are applied
 * - Idempotent: duplicate communication_id + event_type is silently ignored
 * - Append-only: every event is logged in communication_events
 * - Real-time: broadcasts updates via SSE for live dashboard
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { communication_id, event, occurred_at, metadata = {} } = req.body;

    if (!communication_id || !event) {
      return res.status(422).json({ error: 'communication_id and event are required' });
    }

    // 1. Fetch current communication status
    const commResult = await query(
      'SELECT id, status, campaign_id FROM communications WHERE id = $1',
      [communication_id]
    );

    if (commResult.rows.length === 0) {
      return res.status(404).json({ error: 'Communication not found' });
    }

    const comm = commResult.rows[0];
    const currentStatus = comm.status as CommunicationStatus;
    const newStatus = event as CommunicationStatus;

    // 2. Validate state transition
    if (!isValidTransition(currentStatus, newStatus)) {
      // Silently accept but don't apply — this handles duplicate/out-of-order callbacks
      return res.json({ accepted: true, applied: false, reason: 'invalid_transition' });
    }

    // 3. Append to communication_events (idempotent via UNIQUE constraint)
    try {
      await query(
        `INSERT INTO communication_events (communication_id, event_type, metadata, occurred_at)
         VALUES ($1, $2, $3, $4)`,
        [communication_id, event, JSON.stringify(metadata), occurred_at || new Date().toISOString()]
      );
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      // Unique violation = duplicate event, silently ignore
      if (error.code === '23505') {
        return res.json({ accepted: true, applied: false, reason: 'duplicate_event' });
      }
      throw error;
    }

    // 4. Update communication status + timestamp
    const timestampField = `${newStatus}_at`;
    await query(
      `UPDATE communications SET status = $1, ${timestampField} = $2 WHERE id = $3`,
      [newStatus, occurred_at || new Date().toISOString(), communication_id]
    );

    // 5. Check if all communications for this campaign are in terminal state
    // If so, mark campaign as completed
    const pendingResult = await query(
      `SELECT COUNT(*) as pending FROM communications
       WHERE campaign_id = $1 AND status NOT IN ('delivered', 'failed', 'opened', 'clicked')`,
      [comm.campaign_id]
    );

    if (parseInt(pendingResult.rows[0].pending, 10) === 0) {
      await query(
        `UPDATE campaigns SET status = 'completed' WHERE id = $1 AND status != 'completed'`,
        [comm.campaign_id]
      );
    }

    // 6. Broadcast via SSE for live dashboard updates
    sseManager.broadcast('delivery_update', {
      communication_id,
      campaign_id: comm.campaign_id,
      event: newStatus,
      occurred_at: occurred_at || new Date().toISOString(),
    });

    res.json({ accepted: true, applied: true });
  } catch (error) {
    console.error('Error processing receipt:', error);
    res.status(500).json({ error: 'Failed to process receipt' });
  }
});

export default router;
