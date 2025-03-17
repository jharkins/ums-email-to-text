import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { parseEmail } from './emailParser.mjs';

const bucketName = 'bitbot-emails';

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
        const parsedEmail = await parseEmail(emailContent);
        console.log(`Successfully parsed email: ${record.Key}`);
        return parsedEmail;
      } catch (err) {
        console.error(`Error processing email ${record.Key}:`, err);
        return null;
      }
    }));

    const successfulResults = results.filter(result => result !== null);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully processed ${successfulResults.length} out of ${response.KeyCount} emails`,
        results: successfulResults
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