import { v4 as uuid } from 'uuid';
import type { QueryResult, QueryResultRow } from 'pg';
import type { SegmentRules, SegmentCondition } from '../types';

// In-memory collections
export let mockCustomers: any[] = [];
export let mockOrders: any[] = [];
export let mockSegments: any[] = [];
export let mockCampaigns: any[] = [];
export let mockCommunications: any[] = [];
export let mockEvents: any[] = [];

let isInitialized = false;

// Realistic data pools for seeding
const FIRST_NAMES = [
  'Priya', 'Ananya', 'Riya', 'Ishita', 'Neha', 'Pooja', 'Simran', 'Kavya',
  'Meera', 'Divya', 'Aisha', 'Tanvi', 'Nisha', 'Rhea', 'Sanya', 'Aditi',
  'Shreya', 'Kriti', 'Sakshi', 'Tara', 'Arjun', 'Rahul', 'Vikram', 'Rohan',
  'Aditya', 'Karan', 'Nikhil', 'Siddharth', 'Aman', 'Dev', 'Varun', 'Harsh',
  'Ankur', 'Raj', 'Sahil', 'Manish', 'Kunal', 'Vivek', 'Gaurav', 'Amit',
  'Zara', 'Kiara', 'Myra', 'Diya', 'Aarna', 'Saanvi', 'Ira', 'Anvi',
  'Pihu', 'Avni'
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Agarwal', 'Mehta', 'Joshi',
  'Reddy', 'Nair', 'Iyer', 'Desai', 'Shah', 'Malhotra', 'Kapoor', 'Verma',
  'Banerjee', 'Chopra', 'Khanna', 'Bhatia', 'Chauhan', 'Saxena', 'Mishra',
  'Pandey', 'Rao'
];

const CITIES = ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Jaipur', 'Ahmedabad', 'Lucknow'];
const CHANNELS = ['email', 'sms', 'whatsapp', 'rcs'];

const FASHION_ITEMS = [
  { name: 'Silk Saree', category: 'sarees', priceRange: [2500, 7500] },
  { name: 'Cotton Kurti', category: 'kurtis', priceRange: [800, 2500] },
  { name: 'Embroidered Lehenga', category: 'lehengas', priceRange: [4000, 8000] },
  { name: 'Designer Blouse', category: 'tops', priceRange: [1200, 3500] },
  { name: 'Palazzo Pants', category: 'bottoms', priceRange: [900, 2000] },
  { name: 'Anarkali Suit', category: 'suits', priceRange: [2000, 5000] },
  { name: 'Chanderi Dupatta', category: 'accessories', priceRange: [600, 1800] },
  { name: 'Printed Maxi Dress', category: 'dresses', priceRange: [1500, 3500] },
  { name: 'Denim Jacket', category: 'outerwear', priceRange: [1800, 4000] },
  { name: 'Kalamkari Stole', category: 'accessories', priceRange: [500, 1500] },
  { name: 'Block Print Top', category: 'tops', priceRange: [700, 1800] },
  { name: 'Georgette Saree', category: 'sarees', priceRange: [1800, 5000] },
  { name: 'Crop Top', category: 'tops', priceRange: [600, 1500] },
  { name: 'Sharara Set', category: 'suits', priceRange: [2500, 6000] },
  { name: 'Handloom Scarf', category: 'accessories', priceRange: [400, 1200] },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgoMin: number, daysAgoMax: number): string {
  const daysAgo = randomBetween(daysAgoMin, daysAgoMax);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function generatePhone(): string {
  const prefixes = ['98', '97', '96', '95', '94', '93', '91', '90', '88', '87'];
  return `+91${pick(prefixes)}${randomBetween(10000000, 99999999)}`;
}

// Seed mock database
export function initializeMockDb() {
  if (isInitialized) return;
  isInitialized = true;

  console.log('🔌 [Database] Initializing in-memory mock store with seed data...');

  // 1. Seed Customers
  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const firstName = FIRST_NAMES[i] || pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomBetween(1, 99)}@gmail.com`;
    const phone = generatePhone();
    const city = pick(CITIES);
    const channel = pick(CHANNELS);

    let tags: string[] = [];
    const roll = Math.random();
    if (roll < 0.30) tags = ['vip'];
    else if (roll < 0.55) tags = ['churned'];
    else if (roll < 0.75) tags = ['new'];

    mockCustomers.push({
      id,
      name,
      email,
      phone,
      channel_preference: channel,
      city,
      tags,
      created_at: randomDate(30, 365)
    });
  }

  // 2. Seed Orders (200 orders distributed)
  let orderCount = 0;
  
  const addMockOrder = (customerId: string, dateStr: string) => {
    const numItems = randomBetween(1, 3);
    const items = [];
    let totalAmount = 0;

    for (let i = 0; i < numItems; i++) {
      const item = pick(FASHION_ITEMS);
      const price = randomBetween(item.priceRange[0], item.priceRange[1]);
      items.push({ name: item.name, category: item.category, price });
      totalAmount += price;
    }

    const statusRoll = Math.random();
    const status = statusRoll < 0.85 ? 'completed' : statusRoll < 0.95 ? 'returned' : 'cancelled';

    mockOrders.push({
      id: uuid(),
      customer_id: customerId,
      amount: totalAmount,
      items,
      status,
      ordered_at: dateStr,
      created_at: dateStr
    });
  };

  // VIP customers (first 15) get 5-10 orders each
  for (let i = 0; i < 15; i++) {
    const numOrders = randomBetween(5, 10);
    for (let j = 0; j < numOrders; j++) {
      addMockOrder(mockCustomers[i].id, randomDate(7, 540));
      orderCount++;
    }
  }

  // Churned customers (next 12) get 2-4 orders, all OLD (90+ days ago)
  for (let i = 15; i < 27; i++) {
    const numOrders = randomBetween(2, 4);
    for (let j = 0; j < numOrders; j++) {
      addMockOrder(mockCustomers[i].id, randomDate(90, 540));
      orderCount++;
    }
  }

  // New customers (next 10) get 1-2 RECENT orders
  for (let i = 27; i < 37; i++) {
    const numOrders = randomBetween(1, 2);
    for (let j = 0; j < numOrders; j++) {
      addMockOrder(mockCustomers[i].id, randomDate(1, 30));
      orderCount++;
    }
  }

  // Fill remaining orders randomly up to 200
  while (orderCount < 200) {
    addMockOrder(pick(mockCustomers).id, randomDate(1, 540));
    orderCount++;
  }

  // 3. Seed Segments
  const segments = [
    {
      name: 'VIP Customers',
      description: 'Customers tagged as VIP — highest value cohort',
      rules: { operator: 'AND', conditions: [{ field: 'tags', op: 'contains', value: 'vip' }] },
    },
    {
      name: 'Lapsed 90 Days',
      description: 'Customers who haven\'t ordered in the last 90 days',
      rules: { operator: 'AND', conditions: [{ field: 'last_order_date', op: 'lt', value: '90_days_ago' }] },
    },
    {
      name: 'New Customers',
      description: 'Customers tagged as new — first-time buyers',
      rules: { operator: 'AND', conditions: [{ field: 'tags', op: 'contains', value: 'new' }] },
    },
    {
      name: 'High Spenders',
      description: 'Customers who have spent over ₹10,000 total',
      rules: { operator: 'AND', conditions: [{ field: 'total_spend', op: 'gte', value: 10000 }] },
    },
    {
      name: 'Mumbai Shoppers',
      description: 'All customers based in Mumbai',
      rules: { operator: 'AND', conditions: [{ field: 'city', op: 'eq', value: 'Mumbai' }] },
    },
  ];

  for (const seg of segments) {
    const matchCount = mockCustomers.filter(c => evaluateRules(c, mockOrders, seg.rules as SegmentRules)).length;
    mockSegments.push({
      id: uuid(),
      name: seg.name,
      description: seg.description,
      rules: seg.rules,
      customer_count: matchCount,
      created_by: 'manual',
      created_at: new Date().toISOString()
    });
  }

  console.log(`📡 [Database] Seeded ${mockCustomers.length} customers, ${mockOrders.length} orders, ${mockSegments.length} segments.`);
}

// Segment rule evaluator
export function evaluateRules(customer: any, orders: any[], rules: SegmentRules): boolean {
  if (!rules || !rules.conditions || rules.conditions.length === 0) return true;

  // Calculate stats for this customer
  const customerOrders = orders.filter(o => o.customer_id === customer.id && o.status === 'completed');
  const total_orders = customerOrders.length;
  const total_spend = customerOrders.reduce((sum, o) => sum + Number(o.amount), 0);
  const avg_order_value = total_orders > 0 ? total_spend / total_orders : 0;
  
  let last_order_date = '1970-01-01T00:00:00.000Z';
  let first_order_date = '1970-01-01T00:00:00.000Z';
  if (customerOrders.length > 0) {
    const sorted = [...customerOrders].sort((a, b) => new Date(a.ordered_at).getTime() - new Date(b.ordered_at).getTime());
    first_order_date = sorted[0].ordered_at;
    last_order_date = sorted[sorted.length - 1].ordered_at;
  }

  const stats = {
    total_orders,
    total_spend,
    avg_order_value,
    first_order_date,
    last_order_date
  };

  const results = rules.conditions.map(cond => {
    let val: any;
    if (['total_orders', 'total_spend', 'avg_order_value', 'first_order_date', 'last_order_date'].includes(cond.field)) {
      val = (stats as any)[cond.field];
    } else {
      val = (customer as any)[cond.field];
    }

    let condValue: any = cond.value;
    if (typeof condValue === 'string' && condValue.endsWith('_days_ago')) {
      const days = parseInt(condValue.replace('_days_ago', ''), 10);
      const d = new Date();
      d.setDate(d.getDate() - days);
      condValue = d.toISOString();
    }

    switch (cond.op) {
      case 'eq':
        return String(val).toLowerCase() === String(condValue).toLowerCase();
      case 'contains':
        return Array.isArray(val) ? val.includes(condValue) : String(val).toLowerCase().includes(String(condValue).toLowerCase());
      case 'not_contains':
        return Array.isArray(val) ? !val.includes(condValue) : !String(val).toLowerCase().includes(String(condValue).toLowerCase());
      case 'lt':
        return new Date(val).getTime() < new Date(condValue).getTime() || Number(val) < Number(condValue);
      case 'gt':
        return new Date(val).getTime() > new Date(condValue).getTime() || Number(val) > Number(condValue);
      case 'gte':
        return new Date(val).getTime() >= new Date(condValue).getTime() || Number(val) >= Number(condValue);
      case 'lte':
        return new Date(val).getTime() <= new Date(condValue).getTime() || Number(val) <= Number(condValue);
      default:
        return false;
    }
  });

  if (rules.operator === 'OR') {
    return results.some(r => r === true);
  } else {
    return results.every(r => r === true);
  }
}

// Generate return structure helper
function makeResult(rows: any[]): QueryResult<any> {
  return {
    rows,
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: []
  };
}

// Query dispatcher
export async function mockQuery(text: string, params: any[] = []): Promise<QueryResult<any>> {
  initializeMockDb();

  const queryClean = text.replace(/\s+/g, ' ').trim();

  // 1. SELECT COUNT(*)::int AS total FROM customers
  if (queryClean.includes('COUNT(*)::int AS total FROM customers') || queryClean.includes('COUNT(*) as total FROM customers c')) {
    // If there's a where clause, filter customers
    let filtered = mockCustomers;
    if (params.length > 0 && queryClean.includes('WHERE')) {
      // Basic param matching for search or city or tag
      if (queryClean.includes('c.name ILIKE') && params[0]) {
        const term = String(params[0]).replace(/%/g, '').toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term));
      }
      if (queryClean.includes('c.city =') && params[1]) {
        filtered = filtered.filter(c => c.city === params[1]);
      }
    }
    return makeResult([{ total: filtered.length, count: filtered.length }]);
  }

  // 2. Paginated customers SELECT c.*
  if (queryClean.includes('SELECT c.*') && queryClean.includes('FROM customers c')) {
    let filtered = [...mockCustomers];
    let limit = 10;
    let offset = 0;

    // Apply filters
    if (params.length > 0 && queryClean.includes('WHERE')) {
      let paramIdx = 0;
      if (queryClean.includes('c.name ILIKE')) {
        const term = String(params[paramIdx]).replace(/%/g, '').toLowerCase();
        filtered = filtered.filter(c => c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term));
        paramIdx++;
      }
      if (queryClean.includes('c.city =')) {
        filtered = filtered.filter(c => c.city === params[paramIdx]);
        paramIdx++;
      }
      if (queryClean.includes('ANY(c.tags)')) {
        filtered = filtered.filter(c => c.tags.includes(params[paramIdx]));
        paramIdx++;
      }
      if (queryClean.includes('c.channel_preference =')) {
        filtered = filtered.filter(c => c.channel_preference === params[paramIdx]);
        paramIdx++;
      }
      
      // Limit/offset are always the last params
      limit = Number(params[params.length - 2]) || 10;
      offset = Number(params[params.length - 1]) || 0;
    } else if (params.length > 0) {
      limit = Number(params[0]) || 10;
      offset = Number(params[1]) || 0;
    }

    // Sort by created_at DESC
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Join Stats
    const rows = filtered.map(c => {
      const custOrders = mockOrders.filter(o => o.customer_id === c.id && o.status === 'completed');
      const total_orders = custOrders.length;
      const total_spend = custOrders.reduce((sum, o) => sum + Number(o.amount), 0);
      const last_order_date = custOrders.length > 0
        ? [...custOrders].sort((a,b) => new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime())[0].ordered_at
        : null;

      return {
        ...c,
        total_orders,
        total_spend,
        last_order_date
      };
    });

    return makeResult(rows.slice(offset, offset + limit));
  }

  // 3. Single customer detail SELECT * FROM customers WHERE id = $1
  if (queryClean.startsWith('SELECT * FROM customers WHERE id = $1')) {
    const customer = mockCustomers.find(c => c.id === params[0]);
    return makeResult(customer ? [customer] : []);
  }

  // 4. Orders for single customer
  if (queryClean.includes('SELECT * FROM orders WHERE customer_id = $1')) {
    const orders = mockOrders.filter(o => o.customer_id === params[0]);
    // Sort recent first
    orders.sort((a, b) => new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime());
    return makeResult(orders);
  }

  // 5. Communications for single customer
  if (queryClean.includes('FROM communications') && queryClean.includes('customer_id = $1')) {
    const comms = mockCommunications.filter(c => c.customer_id === params[0]).map(c => {
      const camp = mockCampaigns.find(cam => cam.id === c.campaign_id);
      return {
        ...c,
        campaign_name: camp ? camp.name : 'Unknown Campaign'
      };
    });
    comms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return makeResult(comms);
  }

  // 6. SELECT COUNT(*)::int AS total_campaigns FROM campaigns
  if (queryClean.includes('COUNT(*)::int AS total_campaigns') && queryClean.includes('FROM campaigns')) {
    const total = mockCampaigns.length;
    const active = mockCampaigns.filter(c => ['sending', 'sent'].includes(c.status)).length;
    const completed = mockCampaigns.filter(c => c.status === 'completed').length;
    return makeResult([{ total_campaigns: total, active_this_week: active, completed }]);
  }

  // 7. SELECT COUNT(*)::int AS total_messages FROM communications
  if (queryClean.includes('COUNT(*)::int AS total_messages') && queryClean.includes('FROM communications')) {
    const total = mockCommunications.length;
    const delivered = mockCommunications.filter(c => ['delivered', 'opened', 'clicked'].includes(c.status)).length;
    const failed = mockCommunications.filter(c => c.status === 'failed').length;
    const opened = mockCommunications.filter(c => ['opened', 'clicked'].includes(c.status)).length;
    const clicked = mockCommunications.filter(c => c.status === 'clicked').length;
    return makeResult([{
      total_messages: total,
      messages_this_week: total,
      delivered,
      failed,
      opened,
      clicked
    }]);
  }

  // 8. Recent Campaigns list with stats
  if (queryClean.includes('s.name AS segment_name') && queryClean.includes('FROM campaigns c')) {
    const limit = queryClean.includes('LIMIT $') ? Number(params[params.length - 1]) : 5;
    const sorted = [...mockCampaigns].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    const rows = sorted.slice(0, limit).map(c => {
      const seg = mockSegments.find(s => s.id === c.segment_id);
      const campComms = mockCommunications.filter(co => co.campaign_id === c.id);
      const delivered = campComms.filter(co => ['delivered', 'opened', 'clicked'].includes(co.status)).length;
      const opened = campComms.filter(co => ['opened', 'clicked'].includes(co.status)).length;
      const clicked = campComms.filter(co => co.status === 'clicked').length;
      const failed = campComms.filter(co => co.status === 'failed').length;

      return {
        ...c,
        segment_name: seg ? seg.name : 'Unknown Segment',
        segment_size: seg ? seg.customer_count : 0,
        recipients: campComms.length,
        total_sent: campComms.length,
        total_delivered: delivered,
        total_failed: failed,
        total_opened: opened,
        total_clicked: clicked,
        delivered,
        opened
      };
    });
    return makeResult(rows);
  }

  // 9. SELECT * FROM segments
  if (queryClean.startsWith('SELECT * FROM segments ORDER BY created_at DESC') || queryClean === 'SELECT * FROM segments') {
    const sorted = [...mockSegments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return makeResult(sorted);
  }

  // 10. Single segment detail
  if (queryClean.startsWith('SELECT * FROM segments WHERE id = $1')) {
    const seg = mockSegments.find(s => s.id === params[0]);
    return makeResult(seg ? [seg] : []);
  }

  // 11. INSERT INTO segments
  if (queryClean.startsWith('INSERT INTO segments')) {
    const newSeg = {
      id: uuid(),
      name: params[0],
      description: params[1],
      rules: JSON.parse(params[2]),
      customer_count: Number(params[3]) || 0,
      created_by: params[4] || 'manual',
      created_at: new Date().toISOString()
    };
    mockSegments.push(newSeg);
    return makeResult([newSeg]);
  }

  // 12. DELETE FROM segments
  if (queryClean.startsWith('DELETE FROM segments WHERE id = $1')) {
    mockSegments = mockSegments.filter(s => s.id !== params[0]);
    return makeResult([]);
  }

  // 13. INSERT INTO campaigns
  if (queryClean.startsWith('INSERT INTO campaigns')) {
    const newCamp = {
      id: uuid(),
      name: params[0],
      segment_id: params[1],
      message_template: params[2],
      channel: params[3],
      status: 'draft',
      created_by: params[5] || 'manual',
      sent_at: null,
      created_at: new Date().toISOString()
    };
    mockCampaigns.push(newCamp);
    return makeResult([newCamp]);
  }

  // 14. Single campaign detail (with segment rules JOIN support)
  if (queryClean.includes('FROM campaigns c JOIN segments s') && queryClean.includes('c.id = $1')) {
    const campaign = mockCampaigns.find(c => c.id === params[0]);
    if (campaign) {
      const segment = mockSegments.find(s => s.id === campaign.segment_id);
      return makeResult([{
        ...campaign,
        rules: segment ? segment.rules : null
      }]);
    }
    return makeResult([]);
  }

  if (queryClean.startsWith('SELECT * FROM campaigns WHERE id = $1')) {
    const camp = mockCampaigns.find(c => c.id === params[0]);
    return makeResult(camp ? [camp] : []);
  }

  // 15. SELECT * FROM campaigns (All campaigns)
  if (queryClean.startsWith('SELECT * FROM campaigns') || queryClean.includes('FROM campaigns c LEFT JOIN')) {
    // If not matching recent campaign logic above, return simple campaigns
    return makeResult(mockCampaigns);
  }

  // Load customer details for segment matching / campaign personalization (ANY($1))
  if (queryClean.includes('FROM customers') && queryClean.includes('id = ANY($1)')) {
    const ids = params[0] as string[];
    const customers = mockCustomers.filter(c => ids.includes(c.id));
    return makeResult(customers);
  }

  // SELECT COUNT(*) as pending FROM communications WHERE campaign_id = $1 AND status NOT IN ...
  if (queryClean.includes('COUNT(*) as pending FROM communications') && queryClean.includes('campaign_id = $1')) {
    const campComms = mockCommunications.filter(c => c.campaign_id === params[0]);
    const pending = campComms.filter(c => !['delivered', 'failed', 'opened', 'clicked'].includes(c.status)).length;
    return makeResult([{ pending }]);
  }

  // 16. Campaign stats SELECT COUNT(*) FILTER ... FROM communications WHERE campaign_id = $1
  if (queryClean.includes('FROM communications WHERE campaign_id = $1')) {
    const campComms = mockCommunications.filter(c => c.campaign_id === params[0]);
    const total = campComms.length;
    const queued = campComms.filter(c => c.status === 'queued').length;
    const sent = campComms.filter(c => c.status === 'sent').length;
    const delivered = campComms.filter(c => ['delivered', 'opened', 'clicked'].includes(c.status)).length;
    const failed = campComms.filter(c => c.status === 'failed').length;
    const opened = campComms.filter(c => ['opened', 'clicked'].includes(c.status)).length;
    const clicked = campComms.filter(c => c.status === 'clicked').length;
    
    return makeResult([{
      total,
      queued,
      sent,
      delivered,
      failed,
      opened,
      clicked
    }]);
  }

  // 17. Timeline / events for campaign SELECT e.*, c.name FROM communication_events
  if (queryClean.includes('FROM communication_events') && queryClean.includes('campaign_id = $1')) {
    const campComms = mockCommunications.filter(c => c.campaign_id === params[0]);
    const commIds = campComms.map(c => c.id);
    const events = mockEvents.filter(e => commIds.includes(e.communication_id));
    events.sort((a,b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    return makeResult(events);
  }

  // 18. INSERT INTO customers
  if (queryClean.startsWith('INSERT INTO customers')) {
    const newCust = {
      id: params[0],
      name: params[1],
      email: params[2],
      phone: params[3],
      channel_preference: params[4],
      city: params[5],
      tags: params[6] || [],
      created_at: new Date().toISOString()
    };
    mockCustomers.push(newCust);
    return makeResult([newCust]);
  }

  // 19. INSERT INTO communications
  if (queryClean.startsWith('INSERT INTO communications')) {
    const newComm = {
      id: params[0],
      campaign_id: params[1],
      customer_id: params[2],
      channel: params[3],
      message: params[4],
      status: params[5] || 'queued',
      sent_at: params[6] || null,
      created_at: new Date().toISOString()
    };
    mockCommunications.push(newComm);
    return makeResult([newComm]);
  }

  // UPDATE communications
  if (queryClean.startsWith('UPDATE communications')) {
    const status = params[0];
    const timestamp = params[1];
    const commId = params[2];
    const commIdx = mockCommunications.findIndex(c => c.id === commId);
    if (commIdx !== -1) {
      mockCommunications[commIdx].status = status;
      const timestampField = `${status}_at`;
      mockCommunications[commIdx][timestampField] = timestamp;
    }
    return makeResult([]);
  }

  // 20. UPDATE campaigns status & metadata
  if (queryClean.startsWith('UPDATE campaigns')) {
    let campaignId = '';
    let status = '';
    let sentAt = new Date().toISOString();

    if (queryClean.includes("status = 'sending'")) {
      status = 'sending';
      campaignId = params[0] as string;
    } else if (queryClean.includes("status = 'sent'")) {
      status = 'sent';
      campaignId = params[0] as string;
    } else if (queryClean.includes('status = $1')) {
      status = params[0] as string;
      sentAt = params[1] as string;
      campaignId = params[2] as string;
    }

    const campIdx = mockCampaigns.findIndex(c => c.id === campaignId);
    if (campIdx !== -1) {
      mockCampaigns[campIdx].status = status;
      if (status === 'sending') {
        mockCampaigns[campIdx].sent_at = sentAt;
      }
    }
    return makeResult([]);
  }

  // UPDATE segments
  if (queryClean.startsWith('UPDATE segments')) {
    const segmentId = params[1];
    const count = Number(params[0]) || 0;
    const segIdx = mockSegments.findIndex(s => s.id === segmentId);
    if (segIdx !== -1) {
      mockSegments[segIdx].customer_count = count;
    }
    return makeResult([]);
  }

  // 21. SELECT * FROM communications WHERE id = $1
  if (queryClean.startsWith('SELECT * FROM communications WHERE id = $1') || queryClean.includes('FROM communications WHERE id = $1')) {
    const comm = mockCommunications.find(c => c.id === params[0]);
    return makeResult(comm ? [comm] : []);
  }

  // 22. INSERT INTO communication_events
  if (queryClean.startsWith('INSERT INTO communication_events')) {
    const newEvent = {
      id: uuid(),
      communication_id: params[0],
      event_type: params[1],
      metadata: JSON.parse(params[2] || '{}'),
      occurred_at: params[3] || new Date().toISOString()
    };
    mockEvents.push(newEvent);
    
    // Also update the communication status!
    const commIdx = mockCommunications.findIndex(c => c.id === params[0]);
    if (commIdx !== -1) {
      mockCommunications[commIdx].status = params[1];
      if (params[1] === 'delivered') mockCommunications[commIdx].delivered_at = params[3];
      if (params[1] === 'opened') mockCommunications[commIdx].opened_at = params[3];
      if (params[1] === 'clicked') mockCommunications[commIdx].clicked_at = params[3];
      if (params[1] === 'failed') {
        mockCommunications[commIdx].failed_at = params[3];
        mockCommunications[commIdx].failure_reason = newEvent.metadata.reason || 'unknown';
      }
    }

    return makeResult([newEvent]);
  }

  // Default fallback for unhandled mock query
  console.warn(`⚠️ [MockDb] Unhandled query pattern. Returning empty array: "${queryClean}"`);
  return makeResult([]);
}
