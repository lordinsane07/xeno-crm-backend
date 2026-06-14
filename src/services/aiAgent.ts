import { query } from '../db';
import { previewSegment, getSegmentCustomerIds } from './segmentEngine';
import { launchCampaign } from './campaignEngine';
import type { SegmentRules } from '../types';

/**
 * AI Agent — The Brain of Drape CRM
 * 
 * This is the Groq and Google Gemini tool-use orchestration engine. When a marketer
 * sends a message, we pass it to the active LLM with OpenAI-compatible tool definitions.
 * The LLM decides which tools to call. We execute them and loop
 * until the LLM produces a final text response.
 * 
 * Architecture:
 *   User message → LLM (with tools) → tool_use → execute → tool_result
 *   → LLM again → maybe more tools → final text response
 * 
 * This two-step approach (NL → structured filter → SQL) is more
 * reliable than asking the LLM to write raw SQL directly.
 */

const SYSTEM_PROMPT = `You are Commander, an AI campaign manager for Drape — a D2C fashion retail brand.
You help marketers segment customers, compose personalised messages, launch campaigns, and review results — all through conversation.

You have access to tools. When the marketer asks you to do something, USE the tools. Don't describe what you'd do — actually do it.

IMPORTANT RULES:
- Always confirm before launching a campaign. Show the segment size, a sample message, and ask for explicit approval.
- When building segments, use preview_segment first to show the count before creating.
- Be concise. Marketers are busy. One paragraph max per response unless showing data.
- Present numbers cleanly with proper formatting (use ₹ for currency).
- When a campaign is launched, describe what's happening in present tense ("Sending to 47 customers now...").
- Be warm and fashion-forward in tone. You work for a fashion brand.
- If you're unsure what the user wants, ask for clarification rather than guessing wrong.

Available segment rule fields:
- last_order_date: when the customer last ordered (use "X_days_ago" format, e.g. "90_days_ago")
- first_order_date: when they first ordered
- total_orders: total number of completed orders
- total_spend: total amount spent (in ₹)
- avg_order_value: average order value
- tags: customer tags (vip, churned, new)
- city: customer's city (Mumbai, Delhi, Bangalore, Chennai, Hyderabad, Pune, Kolkata, Jaipur, Ahmedabad, Lucknow)
- channel_preference: preferred channel (email, sms, whatsapp, rcs)

Operators: lt, gt, gte, lte, eq, in, contains, not_contains
Date format for relative dates: "90_days_ago", "30_days_ago", etc.`;

const TOOLS: any[] = [
  {
    name: 'preview_segment',
    description: 'Preview how many customers match a set of rules. Call this BEFORE creating a segment to show the user what they\'d be targeting. Returns count and sample customer names.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rules: {
          type: 'object',
          description: 'Segment rule object with operator (AND/OR) and conditions array. Each condition has field, op, and value.',
          properties: {
            operator: { type: 'string', enum: ['AND', 'OR'] },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  op: { type: 'string' },
                  value: {}
                },
                required: ['field', 'op', 'value']
              }
            }
          },
          required: ['operator', 'conditions']
        }
      },
      required: ['rules']
    }
  },
  {
    name: 'create_segment',
    description: 'Save a customer segment with its rules. Only call AFTER the user has seen and approved the preview.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'A descriptive name for the segment' },
        description: { type: 'string', description: 'Brief description of the segment' },
        rules: {
          type: 'object',
          description: 'Same rule format as preview_segment',
          properties: {
            operator: { type: 'string', enum: ['AND', 'OR'] },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  op: { type: 'string' },
                  value: {}
                },
                required: ['field', 'op', 'value']
              }
            }
          },
          required: ['operator', 'conditions']
        }
      },
      required: ['name', 'rules']
    }
  },
  {
    name: 'create_campaign',
    description: 'Create a campaign draft (does NOT send). Use personalization tokens like {{customer.name}} in the message.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        segment_id: { type: 'string', description: 'ID of the segment to target' },
        channel: { type: 'string', enum: ['email', 'sms', 'whatsapp', 'rcs'], description: 'Channel to send through' },
        message_template: { type: 'string', description: 'Message template with {{customer.name}} tokens' }
      },
      required: ['name', 'segment_id', 'channel', 'message_template']
    }
  },
  {
    name: 'launch_campaign',
    description: 'Send a campaign to its segment. ONLY call this after the user has explicitly confirmed they want to send. This cannot be undone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'ID of the campaign to launch' }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'get_campaign_stats',
    description: 'Get delivery and engagement stats for a campaign (sent, delivered, failed, opened, clicked rates).',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID. If not known, use list_campaigns first.' }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'query_customers',
    description: 'Query customers with filters. Use for answering questions about the audience or finding specific customers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by name or email' },
        city: { type: 'string', description: 'Filter by city' },
        tag: { type: 'string', description: 'Filter by tag (vip, churned, new)' },
        limit: { type: 'number', description: 'Max results to return (default 10)' }
      }
    }
  },
  {
    name: 'list_campaigns',
    description: 'List recent campaigns with their status and top-level stats.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Number of campaigns to return (default 5)' }
      }
    }
  }
];

// ─── Tool Execution ──────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'preview_segment': {
        const rules = input.rules as SegmentRules;
        const result = await previewSegment(rules);
        return JSON.stringify({
          count: result.count,
          sample_customers: result.sample.map((c: any) => ({
            name: c.name,
            email: c.email,
            city: c.city,
            tags: c.tags,
          })),
        });
      }

      case 'create_segment': {
        const rules = input.rules as SegmentRules;
        const preview = await previewSegment(rules);

        const result = await query(
          `INSERT INTO segments (name, description, rules, customer_count, created_by)
           VALUES ($1, $2, $3, $4, 'ai')
           RETURNING id, name, customer_count`,
          [input.name, input.description || null, JSON.stringify(rules), preview.count]
        );

        return JSON.stringify({
          segment_id: result.rows[0].id,
          name: result.rows[0].name,
          customer_count: result.rows[0].customer_count,
          message: `Segment "${input.name}" created with ${preview.count} customers.`,
        });
      }

      case 'create_campaign': {
        let sid = String(input.segment_id);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sid)) {
          const segLookup = await query('SELECT id FROM segments WHERE name ILIKE $1 LIMIT 1', [`%${sid}%`]);
          if (segLookup.rows.length > 0) {
            sid = segLookup.rows[0].id;
          } else {
            throw new Error(`Could not find a segment named "${sid}". Please create the segment first.`);
          }
        }

        const result = await query(
          `INSERT INTO campaigns (name, segment_id, message_template, channel, status, created_by)
           VALUES ($1, $2, $3, $4, 'draft', 'ai')
           RETURNING id, name, status`,
          [input.name, sid, input.message_template, input.channel]
        );

        // Get segment info for context
        const segResult = await query(
          'SELECT name, customer_count FROM segments WHERE id = $1',
          [sid]
        );

        return JSON.stringify({
          campaign_id: result.rows[0].id,
          name: result.rows[0].name,
          status: 'draft',
          segment: segResult.rows[0]?.name || 'Unknown',
          audience_size: segResult.rows[0]?.customer_count || 0,
          channel: input.channel,
          message_preview: String(input.message_template).substring(0, 200),
        });
      }

      case 'launch_campaign': {
        let cid = String(input.campaign_id);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(cid)) {
          const campLookup = await query('SELECT id FROM campaigns WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1', [`%${cid}%`]);
          if (campLookup.rows.length > 0) {
            cid = campLookup.rows[0].id;
          } else {
            throw new Error(`Could not find a campaign named "${cid}".`);
          }
        }

        const result = await launchCampaign(cid);
        return JSON.stringify({
          success: true,
          campaign_id: result.campaignId,
          communications_sent: result.communicationCount,
          message: `Campaign launched! Sending to ${result.communicationCount} customers now.`,
        });
      }

      case 'get_campaign_stats': {
        let cid = String(input.campaign_id);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(cid)) {
          const campLookup = await query('SELECT id FROM campaigns WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1', [`%${cid}%`]);
          if (campLookup.rows.length > 0) {
            cid = campLookup.rows[0].id;
          } else {
            throw new Error(`Could not find a campaign named "${cid}".`);
          }
        }

        const statsResult = await query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
             COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
             COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked'))::int AS delivered,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
             COUNT(*) FILTER (WHERE status IN ('opened','clicked'))::int AS opened,
             COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked
           FROM communications
           WHERE campaign_id = $1`,
          [cid]
        );

        const s = statsResult.rows[0];
        const total = s.total || 1;

        return JSON.stringify({
          total: s.total,
          delivered: s.delivered,
          failed: s.failed,
          opened: s.opened,
          clicked: s.clicked,
          delivery_rate: `${Math.round((s.delivered / total) * 100)}%`,
          open_rate: s.delivered > 0 ? `${Math.round((s.opened / s.delivered) * 100)}%` : '0%',
          click_rate: s.opened > 0 ? `${Math.round((s.clicked / s.opened) * 100)}%` : '0%',
        });
      }

      case 'query_customers': {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (input.search) {
          conditions.push(`(c.name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
          params.push(`%${input.search}%`);
          paramIdx++;
        }
        if (input.city) {
          conditions.push(`c.city = $${paramIdx}`);
          params.push(input.city);
          paramIdx++;
        }
        if (input.tag) {
          conditions.push(`$${paramIdx} = ANY(c.tags)`);
          params.push(input.tag);
          paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Number(input.limit) || 10;

        const result = await query(
          `SELECT c.name, c.email, c.city, c.tags, c.channel_preference,
                  COALESCE(stats.total_orders, 0)::int AS total_orders,
                  COALESCE(stats.total_spend, 0)::numeric AS total_spend
           FROM customers c
           LEFT JOIN (
             SELECT customer_id, COUNT(*)::int AS total_orders, SUM(amount)::numeric AS total_spend
             FROM orders WHERE status = 'completed' GROUP BY customer_id
           ) stats ON stats.customer_id = c.id
           ${where}
           ORDER BY c.name
           LIMIT $${paramIdx}`,
          [...params, limit]
        );

        return JSON.stringify({
          count: result.rows.length,
          customers: result.rows,
        });
      }

      case 'list_campaigns': {
        const limit = Number(input.limit) || 5;
        const result = await query(
          `SELECT c.id, c.name, c.channel, c.status, c.created_at,
                  s.name AS segment_name,
                  COALESCE(stats.total, 0)::int AS recipients,
                  COALESCE(stats.delivered, 0)::int AS delivered
           FROM campaigns c
           LEFT JOIN segments s ON s.id = c.segment_id
           LEFT JOIN (
             SELECT campaign_id, COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked'))::int AS delivered
             FROM communications GROUP BY campaign_id
           ) stats ON stats.campaign_id = c.id
           ORDER BY c.created_at DESC
           LIMIT $1`,
          [limit]
        );

        return JSON.stringify({ campaigns: result.rows });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    return JSON.stringify({ error: (error as Error).message });
  }
}

// ─── Main Agent Function ─────────────────────────────────────────

export interface AgentResponse {
  text: string;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result: string;
  }>;
}

async function runDemoAgent(
  messages: any[],
  onStream?: (chunk: string) => void
): Promise<AgentResponse> {
  const toolCalls: AgentResponse['toolCalls'] = [];
  
  // Find last user message
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const userText = lastUserMessage && typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content.toLowerCase()
    : '';

  let finalText = '';

  const streamText = (text: string) => {
    finalText = text;
    if (onStream) {
      // Stream in small chunks to simulate typing
      const chunks = text.match(/.{1,4}/g) || [text];
      for (const chunk of chunks) {
        onStream(chunk);
      }
    }
  };

  try {
    // 1. Mumbai segment Shoppers
    if (userText.includes('mumbai')) {
      const input = {
        name: 'Mumbai Shoppers',
        description: 'Customers based in Mumbai (Demo Mode)',
        rules: { operator: 'AND', conditions: [{ field: 'city', op: 'eq', value: 'Mumbai' }] }
      };
      const result = await executeTool('create_segment', input);
      const resObj = JSON.parse(result);
      
      toolCalls.push({ name: 'create_segment', input, result });
      
      streamText(`✨ **[Demo Mode Active]** I have parsed your request and created a segment for Mumbai Shoppers. 

I generated a rule matching customers whose **City is equal to "Mumbai"**. The segment contains **${resObj.customer_count} customers**. You can now launch campaigns to this segment!`);
      return { text: finalText, toolCalls };
    }

    // 2. VIP Segment
    if (userText.includes('vip') || userText.includes('very important')) {
      const input = {
        name: 'VIP Cohort',
        description: 'High value customers (Demo Mode)',
        rules: { operator: 'AND', conditions: [{ field: 'tags', op: 'contains', value: 'vip' }] }
      };
      const result = await executeTool('create_segment', input);
      const resObj = JSON.parse(result);
      
      toolCalls.push({ name: 'create_segment', input, result });
      
      streamText(`✨ **[Demo Mode Active]** I have created the segment **"VIP Cohort"** for you.

This segment filters customers who have the tag **"vip"**. It matches **${resObj.customer_count} customers**. Ready to send them an exclusive offer?`);
      return { text: finalText, toolCalls };
    }

    // 3. High spenders
    if (userText.includes('spend') || userText.includes('high spender') || userText.includes('money')) {
      const input = {
        name: 'High Spenders',
        description: 'Customers who spent over ₹10,000 (Demo Mode)',
        rules: { operator: 'AND', conditions: [{ field: 'total_spend', op: 'gte', value: 10000 }] }
      };
      const result = await executeTool('create_segment', input);
      const resObj = JSON.parse(result);
      
      toolCalls.push({ name: 'create_segment', input, result });
      
      streamText(`✨ **[Demo Mode Active]** I have built a segment for **High Spenders** who have spent ₹10,000 or more.

It contains **${resObj.customer_count} customers**. Would you like to create a campaign targeting them?`);
      return { text: finalText, toolCalls };
    }

    // 4. Show/Query customers
    if (userText.includes('customer') || userText.includes('list customer') || userText.includes('show customer')) {
      const input = { limit: 10 };
      const result = await executeTool('query_customers', input);
      
      toolCalls.push({ name: 'query_customers', input, result });
      
      streamText(`✨ **[Demo Mode Active]** Here is a list of 10 customers from the database. You currently have a total of 50 customers seeded. You can search, filter, or view their touchpoint history in the side drawer!`);
      return { text: finalText, toolCalls };
    }

    // 5. List/Show campaigns
    if (userText.includes('campaign') && (userText.includes('list') || userText.includes('show') || userText.includes('recent'))) {
      const input = { limit: 5 };
      const result = await executeTool('list_campaigns', input);
      
      toolCalls.push({ name: 'list_campaigns', input, result });
      
      streamText(`✨ **[Demo Mode Active]** Here are your 5 most recent campaigns and their live delivery metrics. Open the Campaigns tab in the sidebar to see detailed timelines!`);
      return { text: finalText, toolCalls };
    }

    // 6. Launch/Send campaign
    if (userText.includes('launch') || userText.includes('send') || userText.includes('dispatch')) {
      const segsResult = await query('SELECT id, name, customer_count FROM segments LIMIT 1');
      let segmentId = uuid();
      let segmentName = 'All Customers';
      let audienceSize = 50;
      
      if (segsResult.rows.length > 0) {
        segmentId = segsResult.rows[0].id;
        segmentName = segsResult.rows[0].name;
        audienceSize = segsResult.rows[0].customer_count;
      }

      // Create Campaign
      const createInput = {
        name: `Festive Promo for ${segmentName}`,
        segment_id: segmentId,
        message_template: 'Hey {{name}}, special 20% discount just for you! Code: FESTIVE20',
        channel: 'whatsapp'
      };
      const createResult = await executeTool('create_campaign', createInput);
      const campaign = JSON.parse(createResult);

      toolCalls.push({ name: 'create_campaign', input: createInput, result: createResult });

      // Launch Campaign
      const launchInput = { campaign_id: campaign.campaign_id };
      const launchResult = await executeTool('launch_campaign', launchInput);
      
      toolCalls.push({ name: 'launch_campaign', input: launchInput, result: launchResult });

      streamText(`🚀 **[Demo Mode Active]** I have successfully created and launched a campaign for you!
      
1. **Created Campaign:** "Festive Promo for ${segmentName}" (WhatsApp)
2. **Target Audience:** ${segmentName} (${audienceSize} recipients)
3. **Launched:** Dispatched to the Channel Simulator queue.

You will see the delivery statistics update live in the dashboard as callbacks are simulated!`);
      return { text: finalText, toolCalls };
    }

    // Default welcome/instructions
    streamText(`✨ **Welcome to Drape CRM!** 

I am currently running in **resilient offline Demo Mode** because the Anthropic API key is not configured in your backend \`.env\` file. 

However, you can still test all of my AI tool integrations! Type any of these commands to see them run:
1. 💻 **"Create a segment for Mumbai shoppers"** (Interacts with the segment builder)
2. 👥 **"Show me my customers"** (Interacts with the customer grid)
3. 📊 **"List my recent campaigns"** (Displays active campaigns)
4. 🚀 **"Launch a campaign to VIP customers"** (Dispatches a simulated campaign and fires live SSE updates)

*To enable full AI natural language processing, please add a valid \`ANTHROPIC_API_KEY\` to your \`crm-backend/.env\` and restart the server.*`);
    return { text: finalText, toolCalls };
  } catch (err: any) {
    console.error('Error running demo agent:', err);
    streamText(`❌ Demo Mode encountered an error: ${err.message}`);
    return { text: finalText, toolCalls };
  }
}

async function callLLM(apiMessages: any[]): Promise<any> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const openAITools = TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema
    }
  }));

  // 1. Try Groq (Primary)
  if (groqKey && !groqKey.includes('YOUR_GROQ_KEY') && groqKey !== '') {
    try {
      console.log('📡 [AI Agent] Calling Groq API...');
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: apiMessages,
          tools: openAITools,
          tool_choice: 'auto',
          temperature: 0.1
        })
      });

      if (response.ok) {
        const data = await response.json() as any;
        return data.choices[0].message;
      } else {
        const errText = await response.text();
        console.warn(`⚠️ [AI Agent] Groq call failed (${response.status}): ${errText}`);
      }
    } catch (err: any) {
      console.warn('⚠️ [AI Agent] Groq connection failed:', err.message);
    }
  }

  // 2. Try Gemini (Fallback)
  if (geminiKey && !geminiKey.includes('YOUR_GEMINI_KEY') && geminiKey !== '') {
    try {
      console.log('📡 [AI Agent] Groq unavailable. Calling Gemini API...');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${geminiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: apiMessages,
          tools: openAITools,
          tool_choice: 'auto',
          temperature: 0.1
        })
      });

      if (response.ok) {
        const data = await response.json() as any;
        return data.choices[0].message;
      } else {
        const errText = await response.text();
        console.warn(`⚠️ [AI Agent] Gemini call failed (${response.status}): ${errText}`);
      }
    } catch (err: any) {
      console.warn('⚠️ [AI Agent] Gemini connection failed:', err.message);
    }
  }

  throw new Error('No valid AI LLM provider is available or connected.');
}

import { v4 as uuid } from 'uuid';

export async function runAgent(
  messages: any[],
  onStream?: (chunk: string) => void
): Promise<AgentResponse> {
  const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
  const isDemoMode = !apiKey || apiKey.includes('YOUR_KEY') || apiKey === '';

  if (isDemoMode) {
    return runDemoAgent(messages, onStream);
  }

  const toolCalls: AgentResponse['toolCalls'] = [];
  let currentMessages = [...messages];
  let finalText = '';

  // Tool execution loop — keep calling LLM until no more tool calls
  while (true) {
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...currentMessages
    ];

    let messageResponse;
    try {
      messageResponse = await callLLM(apiMessages);
    } catch (err) {
      console.error('❌ [AI Agent] AI provider execution error. Falling back to Demo Mode:', err);
      return runDemoAgent(messages, onStream);
    }

    // Process response text if present
    if (messageResponse.content) {
      finalText += messageResponse.content;
      if (onStream) onStream(messageResponse.content);
    }

    // Process tool calls if present
    if (messageResponse.tool_calls && messageResponse.tool_calls.length > 0) {
      // Add assistant's message with tool calls to history
      currentMessages.push(messageResponse);

      // Loop over and execute each tool call
      for (const tc of messageResponse.tool_calls) {
        const toolName = tc.function.name;
        let toolInput = {};
        try {
          toolInput = JSON.parse(tc.function.arguments);
        } catch (e) {
          console.error('Error parsing tool call arguments:', tc.function.arguments);
        }

        console.log(`🛠️ [AI Agent] Executing tool "${toolName}" with input:`, toolInput);
        const result = await executeTool(toolName, toolInput as Record<string, unknown>);

        // Track for frontend
        toolCalls.push({
          name: toolName,
          input: toolInput as Record<string, unknown>,
          result,
        });

        // Add tool response to history
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: result
        });
      }

      // Reset finalText since we are continuing the loop for the next assistant turn
      finalText = '';
      continue;
    }

    // No tool calls — we have the final response
    break;
  }

  return { text: finalText, toolCalls };
}
