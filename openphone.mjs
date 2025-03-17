import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

// Load from environment variables
const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_FROM_NUMBER = process.env.OPENPHONE_FROM_NUMBER;
const OPENPHONE_API_URL = 'https://api.openphone.com/v1/messages';

// Validate environment variables
if (!OPENPHONE_API_KEY) throw new Error('OPENPHONE_API_KEY is required');
if (!OPENPHONE_FROM_NUMBER) throw new Error('OPENPHONE_FROM_NUMBER is required');

function validatePhoneNumber(number) {
  // Remove any non-digit characters except +
  const cleaned = number.replace(/[^\d+]/g, '');
  
  // Must start with + and have 11-15 digits
  if (!/^\+\d{11,15}$/.test(cleaned)) {
    throw new Error(`Invalid phone number format: ${number}`);
  }
  
  return cleaned;
}

export async function sendTextMessage(message, toNumber) {
  try {
    // Validate message
    if (!message || typeof message !== 'string') {
      throw new Error('Message is required and must be a string');
    }
    
    // Validate and format phone numbers
    const formattedToNumber = validatePhoneNumber(toNumber);
    const formattedFromNumber = validatePhoneNumber(OPENPHONE_FROM_NUMBER);

    // Log request details for debugging
    console.log('\nSending OpenPhone request:');
    console.log('URL:', OPENPHONE_API_URL);
    console.log('From:', formattedFromNumber);
    console.log('To:', formattedToNumber);
    console.log('Message length:', message.length);

    const response = await fetch(OPENPHONE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': OPENPHONE_API_KEY // Remove 'Bearer ' prefix as it might not be needed
      },
      body: JSON.stringify({
        content: message,
        from: formattedFromNumber,
        to: [formattedToNumber],
        setInboxStatus: 'done'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('OpenPhone API Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        error: errorData
      });
      throw new Error(`OpenPhone API error: ${response.status} ${response.statusText} ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error sending text message:', error);
    throw error;
  }
}

export function formatServiceTicketMessage(ticket) {
  if (!ticket || ticket.type !== 'service_request') {
    return null;
  }

  const urgencyEmojis = {
    emergency: '🚨',
    high: '❗',
    medium: '⚠️',
    low: '📝'
  };

  const systemEmojis = {
    heating: '🔥',
    cooling: '❄️',
    plumbing: '🚰',
    other: '🔧'
  };

  const parts = [];

  // Add urgency header
  parts.push(`${urgencyEmojis[ticket.urgency] || ''} New Service Request`);
  parts.push(''); // Empty line

  // Add source if available
  if (ticket.source) {
    parts.push(`Source: ${ticket.source}`);
    parts.push(''); // Empty line
  }

  // Add customer info
  if (ticket.customer_name) {
    parts.push(`Customer: ${ticket.customer_name}`);
  }

  // Add location
  if (ticket.location) {
    const location = [
      ticket.location.street_address,
      ticket.location.city,
      ticket.location.state,
      ticket.location.zip
    ].filter(Boolean).join(', ');
    if (location) parts.push(`Location: ${location}`);
  }

  // Add system info
  if (ticket.system_type) {
    parts.push(`System: ${systemEmojis[ticket.system_type]} ${ticket.system_type}`);
  }

  // Add description
  if (ticket.description) {
    parts.push('');
    parts.push(`Issue: ${ticket.description}`);
  }

  // Add date and contact
  if (ticket.requested_date) {
    parts.push('');
    parts.push(`Requested Date: ${ticket.requested_date}`);
  }

  if (ticket.contact_phone) {
    parts.push(`Contact: ${ticket.contact_phone}`);
  }

  // Add notes
  if (ticket.notes) {
    parts.push('');
    parts.push(`Notes: ${ticket.notes}`);
  }

  // Add link
  if (ticket.ticket_link) {
    parts.push('');
    parts.push(ticket.ticket_link);
  }

  return parts.join('\n');
} 