import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';
import { sseManager } from './services/sseManager';

// Load environment variables
dotenv.config({ override: true });

// Import routes
import customersRouter from './routes/customers';
import segmentsRouter from './routes/segments';
import campaignsRouter from './routes/campaigns';
import receiptsRouter from './routes/receipts';
import analyticsRouter from './routes/analytics';
import chatRouter from './routes/chat';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Request logging (lightweight)
app.use((req, _res, next) => {
  if (req.path !== '/health' && req.path !== '/api/events') {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

// ─── Health Check ────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'drape-crm-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── SSE Endpoint for Live Dashboard Updates ─────────────────────

app.get('/api/events', (req, res) => {
  const clientId = uuid();
  sseManager.addClient(clientId, res);

  req.on('close', () => {
    sseManager.removeClient(clientId);
  });
});

// ─── API Routes ──────────────────────────────────────────────────

app.use('/api/customers', customersRouter);
app.use('/api/segments', segmentsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/chat', chatRouter);

// ─── Error Handling ──────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ─── Start Server ────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🧵 Drape CRM Backend                    ║
  ║   Running on http://localhost:${PORT}        ║
  ║   Health: http://localhost:${PORT}/health    ║
  ╚═══════════════════════════════════════════╝
  `);
});

export default app;
