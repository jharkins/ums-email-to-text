// Load environment variables for local development only
if (process.env.NODE_ENV !== 'production') {
  const { dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { default: dotenv } = await import('dotenv');
  
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: `${__dirname}/.env` });
}

// Other imports after environment variables are loaded
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { parseEmail } from './emailParser.mjs';

// Required environment variables
const requiredEnvVars = [
  'S3_BUCKET_NAME',
  'OPENAI_API_KEY',
  'OPENPHONE_API_KEY',
  'OPENPHONE_FROM_NUMBER',
  'DEFAULT_NOTIFICATION_NUMBERS'
];

// Validate all required environment variables
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`${varName} environment variable is required`);
  }
});

const bucketName = process.env.S3_BUCKET_NAME;

export const handler = async (event, context) => {
  try {
    const client = new S3Client();
    const params = {
      Bucket: bucketName,
      Prefix: 'incoming/utah_mechanical_systems/'
    };

    const response = await client.send(new ListObjectsV2Command(params));
    console.log(`Found ${response.KeyCount} emails to process`);

    // Process emails in parallel batches
    const results = await Promise.all(response.Contents.map(async (record) => {
      try {
        console.log(`Processing email: ${record.Key}`);
        const email = await client.send(new GetObjectCommand({
          Bucket: bucketName,
          Key: record.Key
        }));

        const emailContent = await email.Body.transformToString();
        const parsedEmail = await parseEmail(emailContent, record.Key);
        console.log(`Successfully parsed email: ${record.Key}`);
        return {
          key: record.Key,
          status: 'success',
          result: parsedEmail
        };
      } catch (err) {
        console.error(`Error processing email ${record.Key}:`, err);
        return {
          key: record.Key,
          status: 'error',
          error: err.message
        };
      }
    }));

    const successfulResults = results.filter(result => result.status === 'success');
    const failedResults = results.filter(result => result.status === 'error');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully processed ${successfulResults.length} out of ${response.KeyCount} emails`,
        successful: successfulResults.length,
        failed: failedResults.length,
        results: {
          successful: successfulResults,
          failed: failedResults.map(r => ({ key: r.key, error: r.error }))
        }
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing emails',
        error: error.message
      })
    };
  }
};