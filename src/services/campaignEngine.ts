import { query, withTransaction } from '../db';
import type { SegmentRules, ChannelSendPayload } from '../types';
import { getSegmentCustomerIds } from './segmentEngine';
import { v4 as uuid } from 'uuid';

/**
 * Campaign Engine — Orchestrates the full campaign send flow.
 * 
 * 1. Load campaign + segment rules
 * 2. Run segment query → matching customer IDs
 * 3. Personalise messages per customer
 * 4. Bulk insert communication records
 * 5. Call channel stub /send with batch
 * 6. Update campaign status
 */

export async function launchCampaign(campaignId: string): Promise<{
  communicationCount: number;
  campaignId: string;
}> {
  // 1. Load campaign
  const campaignResult = await query(
    `SELECT c.*, s.rules FROM campaigns c
     JOIN segments s ON s.id = c.segment_id
     WHERE c.id = $1`,
    [campaignId]
  );

  if (campaignResult.rows.length === 0) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  const campaign = campaignResult.rows[0];

  if (campaign.status !== 'draft') {
    throw new Error(`Campaign is already ${campaign.status}, cannot launch`);
  }

  // 2. Get matching customer IDs from segment
  const rules = campaign.rules as SegmentRules;
  const customerIds = await getSegmentCustomerIds(rules);

  if (customerIds.length === 0) {
    throw new Error('Segment has no matching customers');
  }

  // 3. Load customer details for personalisation
  const customersResult = await query(
    `SELECT id, name, email, phone FROM customers WHERE id = ANY($1)`,
    [customerIds]
  );
  const customers = customersResult.rows;

  // 4. Create communication records and collect batch for channel stub
  const communications: ChannelSendPayload['communications'] = [];

  await withTransaction(async (txQuery) => {
    // Update campaign status
    await txQuery(
      `UPDATE campaigns SET status = 'sending', sent_at = NOW() WHERE id = $1`,
      [campaignId]
    );

    // Bulk insert communications
    for (const customer of customers) {
      const commId = uuid();
      const personalizedMessage = personaliseMessage(campaign.message_template, customer);

      await txQuery(
        `INSERT INTO communications (id, campaign_id, customer_id, channel, message, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')`,
        [commId, campaignId, customer.id, campaign.channel, personalizedMessage]
      );

      communications.push({
        communication_id: commId,
        recipient: {
          email: customer.email,
          phone: customer.phone,
        },
        channel: campaign.channel,
        message: personalizedMessage,
      });
    }

    // Update segment customer count
    await txQuery(
      `UPDATE segments SET customer_count = $1 WHERE id = $2`,
      [customerIds.length, campaign.segment_id]
    );
  });

  // 5. Call channel stub
  const channelServiceUrl = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3002';
  const callbackUrl = process.env.CRM_RECEIPT_URL || 'http://localhost:3001/api/receipts';

  try {
    const response = await fetch(`${channelServiceUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communications,
        callback_url: callbackUrl,
      }),
    });

    if (!response.ok) {
      console.error('Channel stub returned error:', await response.text());
      // Don't fail the campaign — mark as sent, callbacks may still arrive
    }
  } catch (error) {
    console.error('Failed to call channel stub:', error);
    // Campaign is already marked as sending — the stub might be down temporarily
  }

  // 6. Update campaign to 'sent'
  await query(
    `UPDATE campaigns SET status = 'sent' WHERE id = $1`,
    [campaignId]
  );

  return {
    communicationCount: communications.length,
    campaignId,
  };
}

function personaliseMessage(template: string, customer: Record<string, unknown>): string {
  return template
    .replace(/\{\{customer\.name\}\}/g, String(customer.name || 'there'))
    .replace(/\{\{customer\.email\}\}/g, String(customer.email || ''))
    .replace(/\{\{customer\.phone\}\}/g, String(customer.phone || ''));
}
