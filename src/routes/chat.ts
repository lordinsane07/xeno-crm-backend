import { Router, Request, Response } from 'express';
import { runAgent } from '../services/aiAgent';

const router = Router();

/**
 * POST /api/chat — AI Chat endpoint
 * 
 * Accepts conversation history, runs the AI agent with tool-call loop,
 * and returns the final response with any tool calls that were made.
 * 
 * The frontend sends the full conversation history each time.
 * We don't store sessions server-side at this scope.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Convert frontend messages to expected agent format
    const agentMessages = messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })
    );

    // Run the agent (with tool-call loop)
    const response = await runAgent(agentMessages);

    res.json({
      response: response.text,
      toolCalls: response.toolCalls,
    });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({
      error: 'AI agent encountered an error',
      details: (error as Error).message,
    });
  }
});

export default router;
