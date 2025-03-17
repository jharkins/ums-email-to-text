import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { parseEmail } from './emailParser.mjs';

// Load environment variables from .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

const bucketName = process.env.S3_BUCKET_NAME;
const prefix = 'incoming/utah_mechanical_systems/';

async function listEmails() {
  const client = new S3Client();
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix
  });

  try {
    const response = await client.send(command);
    console.log(`📥 Found ${response.KeyCount} emails to process:\n`);
    response.Contents.forEach((item, index) => {
      console.log(`${index + 1}. ${item.Key.split('/').pop()}`);
      console.log(`   📅 ${item.LastModified.toLocaleDateString()} ${item.LastModified.toLocaleTimeString()}`);
      console.log(`   📊 ${(item.Size / 1024).toFixed(1)} KB\n`);
    });
  } catch (error) {
    console.error('❌ Error listing emails:', error);
  }
}

async function testEmailParser(emailKey) {
  try {
    const client = new S3Client();
    
    // Fetch email from S3
    console.log(`📧 Processing: ${emailKey.split('/').pop()}`);
    const email = await client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: emailKey
    }));

    const emailContent = await email.Body.transformToString();
    const parsedEmail = await parseEmail(emailContent, emailKey);
    
    // Print results
    console.log('\n📨 Email Details:');
    console.log('Subject:', parsedEmail.subject);
    console.log('From:', parsedEmail.from?.text);
    console.log('Date:', parsedEmail.date.toLocaleString());
    
    const ticket = parsedEmail.parsed_content;
    if (ticket.type === 'service_request') {
      console.log('\n🔧 Service Request Details:');
      if (ticket.customer_name) console.log('Customer:', ticket.customer_name);
      if (ticket.location) {
        const location = [
          ticket.location.street_address,
          ticket.location.city,
          ticket.location.state,
          ticket.location.zip
        ].filter(Boolean).join(', ');
        if (location) console.log('Location:', location);
      }
      if (ticket.system_type) console.log('System:', ticket.system_type);
      if (ticket.urgency) console.log('Urgency:', ticket.urgency.toUpperCase());
      if (ticket.description) console.log('Issue:', ticket.description);
      if (ticket.requested_date) console.log('Date Requested:', ticket.requested_date);
      if (ticket.contact_phone) console.log('Contact:', ticket.contact_phone);
      if (ticket.notes) console.log('Notes:', ticket.notes);
    } else {
      console.log('\n❌ Not a Service Request');
    }
    
  } catch (error) {
    if (error.Code === 'NoSuchKey') {
      console.error('❌ Email not found - it may have been processed already');
    } else {
      console.error('❌ Error:', error.message || error);
    }
  }
}

// Get email key from command line argument if provided
const emailKey = process.argv[2];

if (emailKey) {
  testEmailParser(emailKey);
} else {
  listEmails();
} 