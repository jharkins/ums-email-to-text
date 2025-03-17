# UMS Email Parser

An automated service request parser and notification system for Utah Mechanical Systems. This system monitors an S3 bucket for incoming emails, parses them using GPT-4, identifies service requests, and sends text notifications via OpenPhone.

## Features

- 📧 Automated email parsing using GPT-4
- 🔍 Intelligent service request identification
- 📱 SMS notifications via OpenPhone
- 📁 Organized file management in S3
- ♻️ Retry mechanism with exponential backoff
- 🚨 Error handling and dead letter queue
- 📊 Processing metrics and logging

## Prerequisites

- Node.js 18+
- AWS credentials configured
- OpenPhone API access
- OpenAI API access
- S3 bucket set up with appropriate permissions

## AWS Lambda Configuration

### Environment Variables

Configure these in your Lambda function's configuration under "Configuration > Environment variables":

```
OPENAI_API_KEY=your-openai-key
OPENPHONE_API_KEY=your-openphone-key
OPENPHONE_FROM_NUMBER=+18015131966
DEFAULT_NOTIFICATION_NUMBER=+18012006060
S3_BUCKET_NAME=bitbot-emails
```

### Lambda Settings

1. **Runtime**: Node.js 18.x
2. **Memory**: 256 MB (minimum recommended)
3. **Timeout**: 30 seconds (adjust based on email processing needs)
4. **Trigger**: S3 bucket event on `incoming/utah_mechanical_systems/`
5. **IAM Role Permissions**:
   - `s3:GetObject` - Read emails
   - `s3:PutObject` - Store processed emails
   - `s3:DeleteObject` - Remove processed emails
   - `logs:CreateLogGroup`
   - `logs:CreateLogStream`
   - `logs:PutLogEvents`

### Deployment Package

1. Create deployment package:

```bash
npm install
zip -r function.zip . -x "*.git*" "test/*" "README.md"
```

2. Upload to Lambda:

```bash
aws lambda update-function-code --function-name ums-email-parser --zip-file fileb://function.zip
```

Or upload through AWS Console:

- Go to Lambda function
- Click "Upload from" > ".zip file"
- Upload `function.zip`

## Local Development

For local testing, create a `.env` file in the project root:

```bash
# .env
OPENAI_API_KEY=your-openai-key
OPENPHONE_API_KEY=your-openphone-key
OPENPHONE_FROM_NUMBER=+18015131966
DEFAULT_NOTIFICATION_NUMBER=+18012006060
S3_BUCKET_NAME=bitbot-emails
```

The test script will automatically load these environment variables when running:

```bash
npm run test incoming/utah_mechanical_systems/[email-id]
```

Note: The `.env` file is ignored by git for security. Make sure to keep your API keys secure and never commit them to version control.

## Usage

### Testing Email Processing

Process a specific email:

```bash
npm run test incoming/utah_mechanical_systems/[email-id]
```

List available emails:

```bash
npm run test
```

### S3 Bucket Structure

```
bitbot-emails/
├── incoming/
│   └── utah_mechanical_systems/
│       └── [incoming emails]
├── processed/
│   └── utah_mechanical_systems/
│       ├── service_requests/
│       │   └── YYYY-MM/
│       │       └── [processed service requests]
│       └── non_service_requests/
│           └── YYYY-MM/
│               └── [processed non-service requests]
└── errors/
    └── [failed processing attempts]
```

### File Naming Convention

Service requests are named using the pattern:

```
YYYY-MM-DD_location_system-type_urgency_original-id
```

Example:

```
2024-03-20_salt-lake-city_ut_heating_high_695mhc4su63aq94p6chtqmb1
```

## Service Request Schema

```typescript
{
  type: "service_request" | "not_service_request",
  customer_name?: string | null,
  location?: {
    street_address?: string | null,
    city?: string | null,
    state?: string | null,
    zip?: string | null
  } | null,
  description?: string | null,
  source?: string | null,
  ticket_link?: string | null,
  urgency?: "low" | "medium" | "high" | "emergency" | null,
  system_type?: "heating" | "cooling" | "plumbing" | "other" | null,
  requested_date?: string | null,
  contact_phone?: string | null,
  notes?: string | null
}
```

## Text Message Format

Service requests are formatted as text messages with:

- Urgency indicator emoji (🚨, ❗, ⚠️, 📝)
- System type emoji (🔥, ❄️, 🚰, 🔧)
- Customer and location details
- Issue description
- Contact information
- Ticket link (if available)

## Error Handling

The system includes:

- Automatic retries with exponential backoff
- Error folder for failed processing attempts
- Structured error logging
- Phone number validation
- Input validation

## Monitoring

Each processed email includes metrics:

- Processing time
- Status tracking
- Message delivery confirmation
- Error reporting

## Development

### Adding New Features

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

### Running Tests

```bash
npm test
```

## Troubleshooting

### Common Issues

1. **Invalid Phone Number Format**

   - Ensure phone numbers include country code (+1)
   - Format: +1XXXXXXXXXX

2. **OpenPhone API Errors**

   - Verify API key is correct
   - Check phone number formatting
   - Ensure message content is valid

3. **S3 Access Issues**
   - Verify AWS credentials
   - Check S3 bucket permissions
   - Ensure correct bucket name

### Logs

Processing metrics are logged in JSON format:

```json
{
  "event": "email_processed",
  "processing_time_ms": 1234,
  "status": "completed",
  "type": "service_request",
  "message_delivered": true,
  "source_key": "incoming/...",
  "destination_key": "processed/..."
}
```

## License

MIT

## Support

For support, please contact joe@bitstormtech.com.
