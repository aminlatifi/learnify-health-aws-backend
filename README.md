# Learnify Health AWS Backend - Multi-Step Weather Pipeline

A serverless backend application built with AWS Lambda, API Gateway, and AWS CDK featuring a multi-step asynchronous processing pipeline for city weather data with OpenAI integration.

## 🏗️ Architecture

This project implements a sophisticated multi-step processing pipeline:

### Pipeline Flow:

1. **HTTP Request** → API Gateway receives city name
2. **City Processing** → Lambda creates task and puts in SQS queue
3. **Weather Processing** → Lambda fetches weather data from OpenWeather API
4. **LLM Processing** → Lambda generates description using OpenAI
5. **Data Storage** → Final results saved to DynamoDB

### AWS Services Used:

- **API Gateway**: RESTful API endpoints
- **Lambda Functions**: Serverless compute for each processing step
- **SQS Queues**: Asynchronous message processing with dead letter queues
- **DynamoDB**: Data storage with timestamps
- **SNS**: Notifications for pipeline events
- **EventBridge**: Triggers between pipeline stages
- **CloudWatch**: Logging and monitoring

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally
- OpenWeather API key
- OpenAI API key

### Installation

1. **Install dependencies:**

   ```bash
   bun install
   cd lambda && bun install
   ```

2. **Set up environment variables:**

   Create a `.env` file in the root directory:

   ```bash
   # OpenWeather API Configuration
   OPENWEATHER_API_KEY=your_openweather_api_key_here

   # OpenAI API Configuration (for LLM processing)
   OPENAI_API_KEY=your_openai_api_key_here

   # AWS Configuration (if needed)
   AWS_REGION=us-east-1
   ```

   **Important**: Replace `your_openweather_api_key_here` and `your_openai_api_key_here` with your actual API keys.

3. **Bootstrap CDK (first time only):**

   ```bash
   npm run bootstrap --qualifier lh-backend
   ```

4. **Deploy the infrastructure:**

   **Option 1: Using the deployment script (recommended):**

   ```bash
   ./deploy.sh
   ```

   **Option 2: Manual deployment:**

   ```bash
   bun run lambda:build
   bun run deploy
   ```

5. **Build and test Lambda functions:**
   ```bash
   npm run lambda:build
   npm run lambda:test
   ```

## 📁 Project Structure

```
├── bin/                          # CDK app entry point
│   └── app.ts
├── lib/                          # CDK stack definitions
│   └── learnify-health-backend-stack.ts
├── lambda/                       # Lambda function code
│   ├── src/
│   │   ├── city-processor.ts     # Initial city processing
│   │   ├── weather-processor.ts  # Weather API integration
│   │   ├── llm-processor.ts      # OpenAI integration
│   │   └── __tests__/
│   │       └── index.test.ts     # Lambda tests
│   ├── package.json
│   ├── tsconfig.json
│   └── jest.config.js
├── package.json                  # Root package.json
├── tsconfig.json                # TypeScript config
├── cdk.json                     # CDK configuration
└── README.md
```

## 🔧 Available Scripts

### Root Level

- `npm run build` - Build the CDK TypeScript code
- `npm run watch` - Watch for changes and rebuild
- `npm run test` - Run CDK tests
- `npm run cdk` - Run CDK commands
- `npm run deploy` - Deploy the stack
- `npm run destroy` - Destroy the stack
- `npm run diff` - Show differences between deployed and local stack
- `npm run synth` - Synthesize CloudFormation template
- `npm run bootstrap --qualifier lh-backend` - Bootstrap CDK environment

### Lambda Level

- `npm run lambda:build` - Build Lambda function
- `npm run lambda:test` - Test Lambda function

## 🌐 API Endpoints

Once deployed, the following endpoints will be available:

### POST /cities

Submit a city for weather processing:

```json
{
  "cityName": "New York",
  "countryCode": "US"
}
```

**Response:**

```json
{
  "message": "City processing started",
  "cityId": "new-york-1703123456789",
  "cityName": "New York",
  "status": "pending",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "statusUrl": "/status/new-york-1703123456789"
}
```

### GET /status/{cityId}

Check the processing status of a city:

```json
{
  "cityId": "new-york-1703123456789",
  "cityName": "New York",
  "status": "completed",
  "timestamp": "2024-01-01T12:05:00.000Z",
  "weatherData": {
    "temperature": 15.5,
    "humidity": 65,
    "description": "scattered clouds",
    "windSpeed": 3.2,
    "pressure": 1013,
    "visibility": 10000,
    "sunrise": "2024-01-01T07:15:00.000Z",
    "sunset": "2024-01-01T16:45:00.000Z"
  },
  "llmDescription": "New York is currently experiencing pleasant weather with scattered clouds and a comfortable temperature of 15.5°C. The humidity is moderate at 65%, and there's a gentle breeze at 3.2 m/s, making it ideal for outdoor activities."
}
```

### GET /health

Health check endpoint:

```json
{
  "message": "Weather Processing Service is healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "status": "OK",
  "uptime": 3600,
  "environment": "production"
}
```

## 🔄 Multi-Step Pipeline Details

### Step 1: City Processing

- **Trigger**: HTTP POST request to `/cities`
- **Action**: Creates unique city ID, saves initial data to DynamoDB
- **Output**: Sends message to city processing queue

### Step 2: Weather Processing

- **Trigger**: Message in city processing queue
- **Action**: Fetches weather data from OpenWeather API
- **Output**: Sends message to LLM processing queue

### Step 3: LLM Processing

- **Trigger**: Message in weather processing queue
- **Action**: Generates description using OpenAI GPT-3.5-turbo
- **Output**: Saves completed data to DynamoDB

### Error Handling

- Each step has its own dead letter queue
- Failed messages are retried up to 3 times
- Error notifications sent via SNS
- Processing status updated in DynamoDB

## 🛠️ Development

### Local Development

1. **Start development mode:**

   ```bash
   npm run watch
   ```

2. **Test Lambda function locally:**

   ```bash
   cd lambda
   npm run dev
   ```

3. **Run tests:**
   ```bash
   npm test
   cd lambda && npm test
   ```

### Adding New Processing Steps

1. Create new Lambda function in `lambda/src/`
2. Add SQS queue in CDK stack
3. Update IAM permissions
4. Add EventBridge rule for triggering
5. Update processing data interface

### Monitoring and Debugging

- **CloudWatch Logs**: Each Lambda function has its own log group
- **SNS Notifications**: Real-time updates on pipeline events
- **DynamoDB**: Complete audit trail of all processing steps
- **SQS Dead Letter Queues**: Failed message inspection

## 🔐 Security

- IAM roles with least privilege access
- API keys stored as environment variables
- CORS configuration for API Gateway
- Secure artifact storage in S3
- CloudWatch logging enabled

## 📊 Monitoring

- CloudWatch Logs for all Lambda functions
- API Gateway access logs
- SQS queue metrics
- DynamoDB table metrics
- SNS delivery status

## 🧹 Cleanup

To remove all resources:

```bash
npm run destroy
```

## 📝 Environment Variables

The following environment variables are required:

- `OPENWEATHER_API_KEY` - OpenWeather API key
- `OPENAI_API_KEY` - OpenAI API key
- `TABLE_NAME` - DynamoDB table name
- `CITY_QUEUE_URL` - City processing queue URL
- `WEATHER_QUEUE_URL` - Weather processing queue URL
<!-- - `LLM_QUEUE_URL` - LLM processing queue URL -->
- `NOTIFICATION_TOPIC_ARN` - SNS topic ARN

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Troubleshooting

### Common Issues

1. **API Key Errors**: Ensure OpenWeather and OpenAI API keys are set
2. **Queue Processing Delays**: Check SQS queue metrics and dead letter queues
3. **Lambda Timeouts**: Increase timeout values for API calls
4. **Permission Errors**: Verify IAM roles have necessary permissions

### Useful Commands

- `cdk diff` - See what changes will be deployed
- `cdk doctor` - Check CDK environment
- `aws logs tail /aws/lambda/[function-name]` - Tail Lambda logs
- `aws sqs get-queue-attributes --queue-url [queue-url]` - Check queue status

### Testing the Pipeline

1. **Submit a city request:**

   ```bash
   curl -X POST https://your-api-gateway-url/cities \
     -H "Content-Type: application/json" \
     -d '{"cityName": "London", "countryCode": "GB"}'
   ```

2. **Check processing status:**

   ```bash
   curl https://your-api-gateway-url/status/[city-id]
   ```

3. **Monitor logs:**
   ```bash
   aws logs tail /aws/lambda/CityProcessorFunction --follow
   ```
