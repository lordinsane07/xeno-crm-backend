import { query } from './index';
import { v4 as uuid } from 'uuid';

// ─── Realistic data pools ────────────────────────────────────────

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
const CHANNELS: Array<'email' | 'sms' | 'whatsapp' | 'rcs'> = ['email', 'sms', 'whatsapp', 'rcs'];

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

// ─── Helpers ─────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgoMin: number, daysAgoMax: number): Date {
  const daysAgo = randomBetween(daysAgoMin, daysAgoMax);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function generatePhone(): string {
  const prefixes = ['98', '97', '96', '95', '94', '93', '91', '90', '88', '87'];
  return `+91${pick(prefixes)}${randomBetween(10000000, 99999999)}`;
}

// ─── Seed logic ──────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding Drape CRM database...\n');

  // Clear existing data
  await query('DELETE FROM communication_events');
  await query('DELETE FROM communications');
  await query('DELETE FROM campaigns');
  await query('DELETE FROM segments');
  await query('DELETE FROM orders');
  await query('DELETE FROM customers');
  console.log('  🗑️  Cleared existing data');

  // ── Generate 50 customers ──
  const customers: Array<{ id: string; email: string; phone: string; city: string; channel: string }> = [];

  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const firstName = FIRST_NAMES[i];
    const lastName = pick(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomBetween(1, 99)}@gmail.com`;
    const phone = generatePhone();
    const city = pick(CITIES);
    const channel = pick(CHANNELS);

    // Tag distribution: 30% vip, 25% churned, 20% new, rest untagged
    let tags: string[] = [];
    const roll = Math.random();
    if (roll < 0.30) tags = ['vip'];
    else if (roll < 0.55) tags = ['churned'];
    else if (roll < 0.75) tags = ['new'];

    await query(
      `INSERT INTO customers (id, name, email, phone, channel_preference, city, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, email, phone, channel, city, tags]
    );

    customers.push({ id, email, phone, city, channel });
  }
  console.log(`  👥 Created ${customers.length} customers`);

  // ── Generate 200 orders ──
  // Distribution: some customers get many orders (VIPs), some get 1-2, some get 0
  // This creates natural cohorts for segmentation
  let orderCount = 0;

  // VIP customers (first 15) get 5-10 orders each
  for (let i = 0; i < 15; i++) {
    const numOrders = randomBetween(5, 10);
    for (let j = 0; j < numOrders && orderCount < 200; j++) {
      await insertOrder(customers[i].id, randomDate(7, 540));
      orderCount++;
    }
  }

  // Churned customers (next 12) get 2-4 orders, all OLD (90+ days ago)
  for (let i = 15; i < 27; i++) {
    const numOrders = randomBetween(2, 4);
    for (let j = 0; j < numOrders && orderCount < 200; j++) {
      await insertOrder(customers[i].id, randomDate(90, 540));
      orderCount++;
    }
  }

  // New customers (next 10) get 1-2 RECENT orders
  for (let i = 27; i < 37; i++) {
    const numOrders = randomBetween(1, 2);
    for (let j = 0; j < numOrders && orderCount < 200; j++) {
      await insertOrder(customers[i].id, randomDate(1, 30));
      orderCount++;
    }
  }

  // Remaining customers get 0-2 random orders
  for (let i = 37; i < 50 && orderCount < 200; i++) {
    const numOrders = randomBetween(0, 2);
    for (let j = 0; j < numOrders && orderCount < 200; j++) {
      await insertOrder(customers[i].id, randomDate(1, 540));
      orderCount++;
    }
  }

  // Fill remaining orders randomly
  while (orderCount < 200) {
    await insertOrder(pick(customers).id, randomDate(1, 540));
    orderCount++;
  }

  console.log(`  📦 Created ${orderCount} orders`);

  // ── Pre-built segments for demo ──
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
    await query(
      `INSERT INTO segments (name, description, rules, customer_count, created_by)
       VALUES ($1, $2, $3, 0, 'manual')`,
      [seg.name, seg.description, JSON.stringify(seg.rules)]
    );
  }
  console.log(`  🎯 Created ${segments.length} demo segments`);

  console.log('\n✅ Seed complete! Database ready for demo.\n');
  process.exit(0);
}

async function insertOrder(customerId: string, date: Date) {
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

  await query(
    `INSERT INTO orders (customer_id, amount, items, status, ordered_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [customerId, totalAmount, JSON.stringify(items), status, date.toISOString()]
  );
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
