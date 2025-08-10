import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";

export class LearnifyHealthBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for storing city weather data
    const weatherDataTable = new dynamodb.Table(this, "WeatherDataTable", {
      tableName: "city-weather-data",
      partitionKey: { name: "cityId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SQS Queue for processing city requests
    const cityProcessingQueue = new sqs.Queue(this, "CityProcessingQueue", {
      queueName: "city-processing-queue",
      visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: new sqs.Queue(this, "CityProcessingDLQ", {
          queueName: "city-processing-dlq",
        }),
        maxReceiveCount: 3,
      },
    });

    // SQS Queue for weather processing
    // It will have records from the city processor lambda function that will be processed by the weather processor lambda function
    const weatherProcessingQueue = new sqs.Queue(
      this,
      "WeatherProcessingQueue",
      {
        queueName: "weather-processing-queue",
        visibilityTimeout: cdk.Duration.seconds(300),
        retentionPeriod: cdk.Duration.days(14),
        deadLetterQueue: {
          queue: new sqs.Queue(this, "WeatherProcessingDLQ", {
            queueName: "weather-processing-dlq",
          }),
          maxReceiveCount: 3,
        },
      }
    );

    // // SQS Queue for LLM processing

    // const llmProcessingQueue = new sqs.Queue(this, "LLMProcessingQueue", {
    //   queueName: "llm-processing-queue",
    //   visibilityTimeout: cdk.Duration.seconds(300),
    //   retentionPeriod: cdk.Duration.days(14),
    //   deadLetterQueue: {
    //     queue: new sqs.Queue(this, "LLMProcessingDLQ", {
    //       queueName: "llm-processing-dlq",
    //     }),
    //     maxReceiveCount: 3,
    //   },
    // });

    // SNS Topic for notifications
    const notificationTopic = new sns.Topic(this, "WeatherProcessingTopic", {
      topicName: "weather-processing-notifications",
    });

    // IAM role for Lambda functions
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    // Add permissions for SQS, DynamoDB, and SNS
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ],
        resources: [
          cityProcessingQueue.queueArn,
          weatherProcessingQueue.queueArn,
          // llmProcessingQueue.queueArn,
        ],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        resources: [weatherDataTable.tableArn],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: [notificationTopic.topicArn],
      })
    );

    // Lambda function for initial city processing
    const cityProcessorFunction = new lambda.Function(
      this,
      "CityProcessorFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "city-processor.handler",
        code: lambda.Code.fromAsset("lambda/build"),
        environment: {
          CITY_QUEUE_URL: cityProcessingQueue.queueUrl,
          WEATHER_QUEUE_URL: weatherProcessingQueue.queueUrl,
          TABLE_NAME: weatherDataTable.tableName,
          NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        },
        role: lambdaRole,
        timeout: cdk.Duration.seconds(30),
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // Lambda function for weather API processing
    const weatherProcessorFunction = new lambda.Function(
      this,
      "WeatherProcessorFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "weather-processor.handler",
        code: lambda.Code.fromAsset("lambda/build"),
        environment: {
          CITY_QUEUE_URL: cityProcessingQueue.queueUrl,
          // LLM_QUEUE_URL: llmProcessingQueue.queueUrl,
          TABLE_NAME: weatherDataTable.tableName,
          NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
          OPENWEATHER_API_KEY:
            process.env.OPENWEATHER_API_KEY || "YOUR_OPENWEATHER_API_KEY", // Set via environment variable
        },
        role: lambdaRole,
        timeout: cdk.Duration.seconds(60),
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // Lambda function for LLM processing
    const llmProcessorFunction = new lambda.Function(
      this,
      "LLMProcessorFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "llm-processor.handler",
        code: lambda.Code.fromAsset("lambda/build"),
        environment: {
          // LLM_QUEUE_URL: llmProcessingQueue.queueUrl,
          TABLE_NAME: weatherDataTable.tableName,
          NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
          OPENAI_API_KEY: "YOUR_OPENAI_API_KEY", // Set via environment variable
        },
        role: lambdaRole,
        timeout: cdk.Duration.seconds(60),
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // SQS Event Source Mapping for weather processor
    const weatherEventSource = new lambda.EventSourceMapping(
      this,
      "WeatherEventSource",
      {
        target: weatherProcessorFunction,
        eventSourceArn: cityProcessingQueue.queueArn,
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }
    );

    // SQS Event Source Mapping for LLM processor
    const llmEventSource = new lambda.EventSourceMapping(
      this,
      "LLMEventSource",
      {
        target: llmProcessorFunction,
        eventSourceArn: weatherProcessingQueue.queueArn,
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }
    );

    // API Gateway
    const api = new apigateway.RestApi(this, "WeatherProcessingApi", {
      restApiName: "Weather Processing API",
      description:
        "API for processing city weather data through multi-step pipeline",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
      },
    });

    // API Gateway integration
    const cityProcessorIntegration = new apigateway.LambdaIntegration(
      cityProcessorFunction
    );

    // API Gateway resources and methods
    const citiesResource = api.root.addResource("cities");
    citiesResource.addMethod("POST", cityProcessorIntegration, {
      requestModels: {
        "application/json": new apigateway.Model(this, "CityRequestModel", {
          restApi: api,
          contentType: "application/json",
          modelName: "CityRequest",
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              cityName: { type: apigateway.JsonSchemaType.STRING },
              countryCode: { type: apigateway.JsonSchemaType.STRING },
            },
            required: ["cityName"],
          },
        }),
      },
    });

    // Status endpoint to check processing status
    const statusResource = api.root.addResource("status");
    const statusIdResource = statusResource.addResource("{cityId}");
    statusIdResource.addMethod("GET", cityProcessorIntegration);

    // Health check endpoint
    const healthResource = api.root.addResource("health");
    healthResource.addMethod("GET", cityProcessorIntegration);

    // SNS subscription for email notifications (optional)
    // Uncomment and configure if you want email notifications
    // notificationTopic.addSubscription(new subscriptions.EmailSubscription('your-email@example.com'));

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "Weather Processing API URL",
    });

    new cdk.CfnOutput(this, "CityProcessingQueueUrl", {
      value: cityProcessingQueue.queueUrl,
      description: "City Processing Queue URL",
    });

    new cdk.CfnOutput(this, "WeatherDataTableName", {
      value: weatherDataTable.tableName,
      description: "Weather Data DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "NotificationTopicArn", {
      value: notificationTopic.topicArn,
      description: "SNS Notification Topic ARN",
    });
  }
}
