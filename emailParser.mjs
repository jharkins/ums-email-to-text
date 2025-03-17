import { simpleParser } from 'mailparser';
import OpenAI from 'openai';
import { z } from 'zod';
import { sendTextMessage, formatServiceTicketMessage } from './openphone.mjs';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Load from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_NOTIFICATION_NUMBERS = (process.env.DEFAULT_NOTIFICATION_NUMBERS || '').split(',').filter(Boolean);
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'bitbot-emails';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Validate environment variables
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
if (!DEFAULT_NOTIFICATION_NUMBERS.length) throw new Error('DEFAULT_NOTIFICATION_NUMBERS is required');

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const s3Client = new S3Client();

// Define the schema for service tickets
const Location = z.object({
  street_address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
}).nullable().optional();

const ServiceTicket = z.object({
  type: z.enum(['service_request', 'not_service_request']),
  customer_name: z.string().nullable().optional(),
  location: Location,
  description: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  ticket_link: z.string().nullable().optional(),
  urgency: z.enum(['low', 'medium', 'high', 'emergency']).nullable().optional(),
  system_type: z.enum(['heating', 'cooling', 'plumbing', 'other']).nullable().optional(),
  requested_date: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function moveToProcessed(sourceKey, isServiceRequest, ticket) {
  try {
    const date = new Date();
    const monthDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const requestType = isServiceRequest ? 'service_requests' : 'non_service_requests';
    
    let filename;
    if (isServiceRequest && ticket) {
      const location = ticket.location ? 
        [ticket.location.city, ticket.location.state].filter(Boolean).join('_') : 
        'unknown_location';
      
      const systemType = ticket.system_type || 'general';
      const urgency = ticket.urgency || 'normal';
      const timestamp = date.toISOString().split('T')[0];
      
      filename = `${timestamp}_${location}_${systemType}_${urgency}_${sourceKey.split('/').pop()}`;
    } else {
      filename = `${date.toISOString().split('T')[0]}_${sourceKey.split('/').pop()}`;
    }
    
    filename = filename.toLowerCase()
      .replace(/[^a-z0-9-_\.]/g, '_')
      .replace(/_+/g, '_');
    
    const newKey = `processed/utah_mechanical_systems/${requestType}/${monthDir}/${filename}`;
    
    // Copy first, only delete if copy succeeds
    await s3Client.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${sourceKey}`,
      Key: newKey
    }));

    // Delete original after successful copy
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: sourceKey
    }));

    return newKey;
  } catch (error) {
    console.error('Error moving email to processed folder:', error);
    // Move to error folder instead
    const errorKey = `errors/${sourceKey.split('/').pop()}_${Date.now()}`;
    await s3Client.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${sourceKey}`,
      Key: errorKey
    }));
    throw error;
  }
}

async function retryOperation(operation, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        await sleep(RETRY_DELAY * Math.pow(2, i)); // Exponential backoff
        console.log(`Retrying operation, attempt ${i + 2}/${maxRetries}`);
      }
    }
  }
  throw lastError;
}

export async function parseEmail(emailContent, sourceKey, notificationNumbers = DEFAULT_NOTIFICATION_NUMBERS) {
  const startTime = Date.now();
  let processingStatus = 'started';
  
  try {
    // Basic input validation
    if (!emailContent) throw new Error('Email content is required');
    if (!sourceKey) throw new Error('Source key is required');
    
    const parsedMail = await simpleParser(emailContent);
    processingStatus = 'parsed';

    const completion = await retryOperation(async () => client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: "system",
          content: `You are a service coordinator for Utah Mechanical Systems. Your job is to parse emails and determine if they contain service requests.
          Extract the information and return it in JSON format matching this schema:
          {
            "type": "service_request" or "not_service_request",
            "customer_name": "string (optional)",
            "location": {
              "street_address": "string (optional)",
              "city": "string (optional)",
              "state": "string (optional)",
              "zip": "string (optional)"
            },
            "source": "string (optional)",
            "description": "string (optional)",
            "urgency": "low" | "medium" | "high" | "emergency" (optional),
            "system_type": "heating" | "cooling" | "plumbing" | "other" (optional),
            "requested_date": "string (optional)",
            "contact_phone": "string (optional)",
            "notes": "string (optional)",
            "ticket_link": "string (optional)"
          }

          For urgency levels:
          - emergency: No heat/AC in extreme weather, flooding, gas leaks
          - high: System not working but weather is mild
          - medium: System working poorly
          - low: Maintenance or future scheduling

          Return ONLY valid JSON without any additional text or explanation.
          For any optional fields that don't apply, use null instead of omitting them.`
        },
        {
          role: "user",
          content: parsedMail.text
        }
      ],
      response_format: { type: "json_object" }
    }));

    const parsed = JSON.parse(completion.choices[0].message.content);
    const validatedData = ServiceTicket.parse(parsed);
    processingStatus = 'analyzed';

    let newLocation = null;
    let messageDeliveryStatus = [];
    
    // If this is a service request, send text messages
    if (validatedData.type === 'service_request') {
      const message = formatServiceTicketMessage(validatedData);
      if (message) {
        console.log('\n📱 Sending notifications to:', notificationNumbers.join(', '));
        
        // Send to all numbers in parallel
        const deliveryPromises = notificationNumbers.map(async number => {
          try {
            await retryOperation(async () => {
              await sendTextMessage(message, number);
              console.log(`✅ Message delivered successfully to ${number}`);
              return { number, success: true };
            });
          } catch (error) {
            console.error(`❌ Failed to deliver message to ${number}:`, error.message);
            return { number, success: false, error: error.message };
          }
        });

        messageDeliveryStatus = await Promise.all(deliveryPromises);
      }
    }

    // Only move to processed after attempting all notifications
    newLocation = await moveToProcessed(sourceKey, validatedData.type === 'service_request', validatedData);
    processingStatus = 'completed';
    console.log(`📁 Email archived: ${newLocation.split('/').slice(-3).join('/')}`);

    // Log processing metrics
    const processingTime = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'email_processed',
      processing_time_ms: processingTime,
      status: processingStatus,
      type: validatedData.type,
      message_delivery_status: messageDeliveryStatus,
      source_key: sourceKey,
      destination_key: newLocation
    }));

    return {
      subject: parsedMail.subject,
      from: parsedMail.from,
      to: parsedMail.to,
      parsed_content: validatedData,
      text: parsedMail.text,
      html: parsedMail.html,
      attachments: parsedMail.attachments,
      date: parsedMail.date,
      processed_location: newLocation,
      processing_time_ms: processingTime,
      message_delivery_status: messageDeliveryStatus
    };
  } catch (error) {
    // Log error metrics
    console.error(JSON.stringify({
      event: 'email_processing_error',
      error: error.message,
      status: processingStatus,
      processing_time_ms: Date.now() - startTime,
      source_key: sourceKey
    }));
    throw error;
  }
} 