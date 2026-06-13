import { Router, Request, Response } from 'express';
import { query } from '../db';
import { previewSegment } from '../services/segmentEngine';
import type { SegmentRules } from '../types';

const router = Router();

// GET /api/segments — List all segments
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM segments ORDER BY created_at DESC`
    );
    res.json({ segments: result.rows });
  } catch (error) {
    console.error('Error fetching segments:', error);
    res.status(500).json({ error: 'Failed to fetch segments' });
  }
});

// GET /api/segments/:id — Segment detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM segments WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    // Also get the actual matching customers
    const segment = result.rows[0];
    const preview = await previewSegment(segment.rules as SegmentRules);

    res.json({
      segment,
      preview: {
        count: preview.count,
        sample: preview.sample,
      },
    });
  } catch (error) {
    console.error('Error fetching segment:', error);
    res.status(500).json({ error: 'Failed to fetch segment' });
  }
});

// POST /api/segments — Create a new segment
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, rules, created_by = 'manual' } = req.body;

    if (!name || !rules) {
      return res.status(400).json({ error: 'name and rules are required' });
    }

    // Validate rules by running a preview
    const preview = await previewSegment(rules as SegmentRules);

    const result = await query(
      `INSERT INTO segments (name, description, rules, customer_count, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || null, JSON.stringify(rules), preview.count, created_by]
    );

    res.status(201).json({
      segment: result.rows[0],
      preview: {
        count: preview.count,
        sample: preview.sample,
      },
    });
  } catch (error) {
    console.error('Error creating segment:', error);
    res.status(500).json({ error: 'Failed to create segment' });
  }
});

// POST /api/segments/preview — Preview segment match count without saving
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { rules } = req.body;

    if (!rules) {
      return res.status(400).json({ error: 'rules are required' });
    }

    const preview = await previewSegment(rules as SegmentRules);
    res.json(preview);
  } catch (error) {
    console.error('Error previewing segment:', error);
    res.status(500).json({ error: 'Failed to preview segment' });
  }
});

// DELETE /api/segments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM segments WHERE id = $1', [id]);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting segment:', error);
    res.status(500).json({ error: 'Failed to delete segment' });
  }
});

export default router;
