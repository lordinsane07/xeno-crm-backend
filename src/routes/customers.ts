import { Router, Request, Response } from 'express';
import { query } from '../db';
import { parse } from 'csv-parse';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/customers — List with search, filter, paginate
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      search,
      city,
      tag,
      channel,
      page = '1',
      limit = '20',
    } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(c.name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (city) {
      conditions.push(`c.city = $${paramIdx}`);
      params.push(city);
      paramIdx++;
    }

    if (tag) {
      conditions.push(`$${paramIdx} = ANY(c.tags)`);
      params.push(tag);
      paramIdx++;
    }

    if (channel) {
      conditions.push(`c.channel_preference = $${paramIdx}`);
      params.push(channel);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM customers c ${whereClause}`,
      params
    );

    // Get paginated results with order stats
    const result = await query(
      `SELECT c.*,
              COALESCE(stats.total_orders, 0) AS total_orders,
              COALESCE(stats.total_spend, 0) AS total_spend,
              stats.last_order_date
       FROM customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*)::int AS total_orders,
                SUM(amount)::numeric AS total_spend,
                MAX(ordered_at) AS last_order_date
         FROM orders
         WHERE status = 'completed'
         GROUP BY customer_id
       ) stats ON stats.customer_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit as string, 10), offset]
    );

    res.json({
      customers: result.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/customers/:id — Detail with orders + communications
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const customerResult = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const ordersResult = await query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY ordered_at DESC',
      [id]
    );

    const commsResult = await query(
      `SELECT co.*, ca.name AS campaign_name
       FROM communications co
       JOIN campaigns ca ON ca.id = co.campaign_id
       WHERE co.customer_id = $1
       ORDER BY co.created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      customer: customerResult.rows[0],
      orders: ordersResult.rows,
      communications: commsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST /api/customers/import — CSV bulk import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const records: unknown[][] = [];
    const errors: string[] = [];

    const parser = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for await (const record of parser) {
      const row = record as Record<string, string>;
      if (!row.name) {
        errors.push(`Row missing name: ${JSON.stringify(row)}`);
        continue;
      }

      const id = uuid();
      const tags = row.tags ? row.tags.split(',').map((t: string) => t.trim()) : [];

      try {
        await query(
          `INSERT INTO customers (id, name, email, phone, channel_preference, city, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             channel_preference = EXCLUDED.channel_preference,
             city = EXCLUDED.city,
             tags = EXCLUDED.tags`,
          [id, row.name, row.email || null, row.phone || null,
           row.channel_preference || 'email', row.city || null, tags]
        );
        records.push([id]);
      } catch (err) {
        errors.push(`Failed to import: ${row.name} — ${(err as Error).message}`);
      }
    }

    res.json({
      imported: records.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10), // First 10 errors only
    });
  } catch (error) {
    console.error('Error importing customers:', error);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

export default router;
