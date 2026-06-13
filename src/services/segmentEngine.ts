import { query } from '../db';
import type { SegmentRules, SegmentCondition } from '../types';

/**
 * Segment Engine — The Heart of the CRM
 * 
 * Converts a declarative rule JSON into parameterized SQL.
 * Supports relative dates, array fields, aggregation queries.
 * 
 * Flow: Natural Language → (AI) → Rule JSON → (this engine) → SQL → Results
 * 
 * NEVER uses string interpolation for values — always parameterized.
 */

interface BuiltQuery {
  sql: string;
  params: unknown[];
}

// Fields that require aggregation over the orders table
const AGGREGATE_FIELDS = ['last_order_date', 'first_order_date', 'total_orders', 'total_spend', 'avg_order_value'];

export function buildSegmentQuery(rules: SegmentRules): BuiltQuery {
  const params: unknown[] = [];
  let paramIndex = 1;

  const conditions = rules.conditions.map((condition) => {
    const result = buildCondition(condition, paramIndex);
    paramIndex += result.params.length;
    params.push(...result.params);
    return result.sql;
  });

  const joiner = rules.operator === 'OR' ? ' OR ' : ' AND ';
  const whereClause = conditions.length > 0 ? conditions.join(joiner) : 'TRUE';

  // Check if any conditions need aggregation
  const needsAggregation = rules.conditions.some(c => AGGREGATE_FIELDS.includes(c.field));

  let sql: string;

  if (needsAggregation) {
    // Build a CTE that computes per-customer order aggregates
    sql = `
      WITH customer_stats AS (
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.channel_preference,
          c.city,
          c.tags,
          c.created_at,
          COALESCE(MAX(o.ordered_at), '1970-01-01'::timestamptz) AS last_order_date,
          COALESCE(MIN(o.ordered_at), '1970-01-01'::timestamptz) AS first_order_date,
          COALESCE(COUNT(o.id), 0)::int AS total_orders,
          COALESCE(SUM(o.amount), 0)::numeric AS total_spend,
          COALESCE(AVG(o.amount), 0)::numeric AS avg_order_value
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'completed'
        GROUP BY c.id
      )
      SELECT id, name, email, phone, channel_preference, city, tags, created_at,
             total_orders, total_spend, avg_order_value, last_order_date
      FROM customer_stats
      WHERE ${whereClause}
      ORDER BY name ASC
    `;
  } else {
    // Simple query — no aggregation needed
    sql = `
      SELECT id, name, email, phone, channel_preference, city, tags, created_at
      FROM customers c
      WHERE ${whereClause}
      ORDER BY name ASC
    `;
  }

  return { sql, params };
}

function buildCondition(condition: SegmentCondition, startParam: number): { sql: string; params: unknown[] } {
  const { field, op, value } = condition;
  const params: unknown[] = [];
  let paramIdx = startParam;

  // ── Customer direct fields ──
  if (field === 'city') {
    if (op === 'eq') {
      params.push(value);
      return { sql: `c.city = $${paramIdx}`, params };
    }
    if (op === 'in' && Array.isArray(value)) {
      const placeholders = value.map((_, i) => `$${paramIdx + i}`);
      params.push(...value);
      return { sql: `c.city IN (${placeholders.join(', ')})`, params };
    }
  }

  if (field === 'channel_preference') {
    if (op === 'eq') {
      params.push(value);
      return { sql: `c.channel_preference = $${paramIdx}`, params };
    }
  }

  if (field === 'tags') {
    if (op === 'contains') {
      params.push(value);
      return { sql: `$${paramIdx} = ANY(c.tags)`, params };
    }
    if (op === 'not_contains') {
      params.push(value);
      return { sql: `NOT ($${paramIdx} = ANY(c.tags))`, params };
    }
  }

  // ── Aggregate fields (require CTE) ──
  if (field === 'last_order_date') {
    const dateValue = resolveRelativeDate(value);
    params.push(dateValue);
    return { sql: `last_order_date ${sqlOperator(op)} $${paramIdx}`, params };
  }

  if (field === 'first_order_date') {
    const dateValue = resolveRelativeDate(value);
    params.push(dateValue);
    return { sql: `first_order_date ${sqlOperator(op)} $${paramIdx}`, params };
  }

  if (field === 'total_orders') {
    params.push(Number(value));
    return { sql: `total_orders ${sqlOperator(op)} $${paramIdx}`, params };
  }

  if (field === 'total_spend') {
    params.push(Number(value));
    return { sql: `total_spend ${sqlOperator(op)} $${paramIdx}`, params };
  }

  if (field === 'avg_order_value') {
    params.push(Number(value));
    return { sql: `avg_order_value ${sqlOperator(op)} $${paramIdx}`, params };
  }

  throw new Error(`Unsupported segment field: ${field}`);
}

function sqlOperator(op: string): string {
  const ops: Record<string, string> = {
    lt: '<',
    gt: '>',
    gte: '>=',
    lte: '<=',
    eq: '=',
  };
  if (!ops[op]) throw new Error(`Unsupported operator: ${op}`);
  return ops[op];
}

/**
 * Resolves relative date strings like "90_days_ago" into actual timestamps.
 * If the value is already an ISO date string, returns it as-is.
 */
function resolveRelativeDate(value: unknown): string {
  if (typeof value === 'string' && value.endsWith('_days_ago')) {
    const days = parseInt(value.replace('_days_ago', ''), 10);
    if (isNaN(days)) throw new Error(`Invalid relative date: ${value}`);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }
  // Assume it's already an ISO date string
  return String(value);
}

// ─── Public API ──────────────────────────────────────────────────
import { useMockDb } from '../db';
import { mockCustomers, mockOrders, evaluateRules } from '../db/mockDb';

export async function previewSegment(rules: SegmentRules): Promise<{ count: number; sample: unknown[] }> {
  if (useMockDb) {
    const matched = mockCustomers.filter(c => evaluateRules(c, mockOrders, rules));
    return {
      count: matched.length,
      sample: matched.slice(0, 5),
    };
  }

  const { sql, params } = buildSegmentQuery(rules);

  // Get full count
  const countResult = await query(`SELECT COUNT(*) as count FROM (${sql}) AS seg`, params);
  const count = parseInt(countResult.rows[0].count, 10);

  // Get sample of 5
  const sampleResult = await query(`${sql} LIMIT 5`, params);

  return { count, sample: sampleResult.rows };
}

export async function getSegmentCustomerIds(rules: SegmentRules): Promise<string[]> {
  if (useMockDb) {
    const matched = mockCustomers.filter(c => evaluateRules(c, mockOrders, rules));
    return matched.map(c => c.id);
  }

  const { sql, params } = buildSegmentQuery(rules);
  const result = await query<{ id: string }>(`SELECT id FROM (${sql}) AS seg`, params);
  return result.rows.map(r => r.id);
}

export async function getSegmentCustomers(rules: SegmentRules): Promise<unknown[]> {
  if (useMockDb) {
    const matched = mockCustomers.filter(c => evaluateRules(c, mockOrders, rules));
    return matched;
  }

  const { sql, params } = buildSegmentQuery(rules);
  const result = await query(sql, params);
  return result.rows;
}

