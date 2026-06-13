import { Router, Request, Response } from 'express';
import { query } from '../db';
import { launchCampaign } from '../services/campaignEngine';

const router = Router();

// GET /api/campaigns — List all campaigns
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT c.*,
             s.name AS segment_name,
             s.customer_count AS segment_size,
             COALESCE(stats.total, 0) AS total_sent,
             COALESCE(stats.delivered, 0) AS total_delivered,
             COALESCE(stats.failed, 0) AS total_failed,
             COALESCE(stats.opened, 0) AS total_opened,
             COALESCE(stats.clicked, 0) AS total_clicked
      FROM campaigns c
      LEFT JOIN segments s ON s.id = c.segment_id
      LEFT JOIN (
        SELECT campaign_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked'))::int AS delivered,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE status IN ('opened', 'clicked'))::int AS opened,
               COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked
        FROM communications
        GROUP BY campaign_id
      ) stats ON stats.campaign_id = c.id
    `;

    const params: unknown[] = [];
    if (status) {
      sql += ` WHERE c.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY c.created_at DESC`;

    const result = await query(sql, params);
    res.json({ campaigns: result.rows });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// GET /api/campaigns/:id — Campaign detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT c.*, s.name AS segment_name, s.rules AS segment_rules
       FROM campaigns c
       LEFT JOIN segments s ON s.id = c.segment_id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ campaign: result.rows[0] });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// POST /api/campaigns — Create campaign draft
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, segment_id, message_template, channel, created_by = 'manual' } = req.body;

    if (!name || !segment_id || !message_template || !channel) {
      return res.status(400).json({
        error: 'name, segment_id, message_template, and channel are required',
      });
    }

    // Verify segment exists
    const segResult = await query('SELECT id FROM segments WHERE id = $1', [segment_id]);
    if (segResult.rows.length === 0) {
      return res.status(400).json({ error: 'Segment not found' });
    }

    const result = await query(
      `INSERT INTO campaigns (name, segment_id, message_template, channel, status, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING *`,
      [name, segment_id, message_template, channel, created_by]
    );

    res.status(201).json({ campaign: result.rows[0] });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// POST /api/campaigns/:id/launch — Send the campaign
router.post('/:id/launch', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await launchCampaign(id as string);

    res.json({
      success: true,
      message: `Campaign launched! Sending to ${result.communicationCount} customers.`,
      ...result,
    });
  } catch (error) {
    console.error('Error launching campaign:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to launch campaign' });
  }
});

// GET /api/campaigns/:id/stats — Campaign delivery + engagement stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Aggregate stats
    const statsResult = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked'))::int AS delivered,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status IN ('opened', 'clicked'))::int AS opened,
         COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked
       FROM communications
       WHERE campaign_id = $1`,
      [id]
    );

    const stats = statsResult.rows[0];
    const total = stats.total || 1; // prevent division by zero

    // Event timeline (last 50 events)
    const timelineResult = await query(
      `SELECT event_type, occurred_at
       FROM communication_events ce
       JOIN communications co ON co.id = ce.communication_id
       WHERE co.campaign_id = $1
       ORDER BY ce.occurred_at DESC
       LIMIT 50`,
      [id]
    );

    res.json({
      stats: {
        ...stats,
        delivery_rate: Math.round((stats.delivered / total) * 100 * 10) / 10,
        open_rate: stats.delivered > 0
          ? Math.round((stats.opened / stats.delivered) * 100 * 10) / 10
          : 0,
        click_rate: stats.opened > 0
          ? Math.round((stats.clicked / stats.opened) * 100 * 10) / 10
          : 0,
      },
      timeline: timelineResult.rows,
    });
  } catch (error) {
    console.error('Error fetching campaign stats:', error);
    res.status(500).json({ error: 'Failed to fetch campaign stats' });
  }
});

export default router;
