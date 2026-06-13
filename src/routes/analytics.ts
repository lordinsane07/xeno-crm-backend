import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/analytics/overview — Aggregate stats for the dashboard
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    // Total customers
    const customersResult = await query('SELECT COUNT(*)::int AS total FROM customers');

    // Total campaigns + active this week
    const campaignsResult = await query(`
      SELECT
        COUNT(*)::int AS total_campaigns,
        COUNT(*) FILTER (WHERE status IN ('sending', 'sent') AND created_at > NOW() - INTERVAL '7 days')::int AS active_this_week,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
      FROM campaigns
    `);

    // Messages stats
    const messagesResult = await query(`
      SELECT
        COUNT(*)::int AS total_messages,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS messages_this_week,
        COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked'))::int AS delivered,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status IN ('opened', 'clicked'))::int AS opened,
        COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked
      FROM communications
    `);

    const msgs = messagesResult.rows[0];
    const totalDeliverable = (msgs.delivered || 0) + (msgs.failed || 0);
    const avgDeliveryRate = totalDeliverable > 0
      ? Math.round((msgs.delivered / totalDeliverable) * 100 * 10) / 10
      : 0;

    // Recent campaigns with stats
    const recentResult = await query(`
      SELECT c.id, c.name, c.channel, c.status, c.sent_at, c.created_at,
             s.name AS segment_name,
             COALESCE(stats.total, 0)::int AS recipients,
             COALESCE(stats.delivered, 0)::int AS delivered,
             COALESCE(stats.opened, 0)::int AS opened
      FROM campaigns c
      LEFT JOIN segments s ON s.id = c.segment_id
      LEFT JOIN (
        SELECT campaign_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked'))::int AS delivered,
               COUNT(*) FILTER (WHERE status IN ('opened','clicked'))::int AS opened
        FROM communications
        GROUP BY campaign_id
      ) stats ON stats.campaign_id = c.id
      ORDER BY c.created_at DESC
      LIMIT 5
    `);

    res.json({
      total_customers: customersResult.rows[0].total,
      total_campaigns: campaignsResult.rows[0].total_campaigns,
      active_campaigns: campaignsResult.rows[0].active_this_week,
      completed_campaigns: campaignsResult.rows[0].completed,
      total_messages: msgs.total_messages,
      messages_this_week: msgs.messages_this_week,
      avg_delivery_rate: avgDeliveryRate,
      recent_campaigns: recentResult.rows,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;
