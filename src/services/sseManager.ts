import { Response } from 'express';

/**
 * SSE Manager — Manages Server-Sent Event connections for live dashboard updates.
 * When campaign callbacks arrive, we broadcast to all connected clients
 * so delivery stats update in real time without polling.
 */

interface SSEClient {
  id: string;
  res: Response;
}

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Send heartbeat every 30s to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('heartbeat', { timestamp: new Date().toISOString() });
    }, 30000);
  }

  addClient(id: string, res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);

    this.clients.set(id, { id, res });

    // Remove client on disconnect
    res.on('close', () => {
      this.clients.delete(id);
    });
  }

  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.res.end();
      this.clients.delete(id);
    }
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach((client) => {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected, remove it
        this.clients.delete(client.id);
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client) => client.res.end());
    this.clients.clear();
  }
}

// Singleton
export const sseManager = new SSEManager();
