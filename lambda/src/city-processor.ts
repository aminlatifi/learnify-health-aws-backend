import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const sqs = new SQSClient({});
const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

interface CityRequest {
  cityName: string;
  countryCode?: string;
}

interface ProcessingData {
  cityId: string;
  cityName: string;
  countryCode?: string;
  status:
    | "pending"
    | "weather_processing"
    | "llm_processing"
    | "completed"
    | "failed";
  timestamp: string;
  weatherData?: any;
  llmDescription?: string;
  error?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const { httpMethod, path, body } = event;
    const timestamp = new Date().toISOString();

    // Health check endpoint
    if (path === "/health" && httpMethod === "GET") {
      return createResponse(200, {
        message: "Weather Processing Service is healthy",
        timestamp,
        status: "OK",
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
      });
    }

    // Status check endpoint
    if (path.startsWith("/status/") && httpMethod === "GET") {
      const cityId = path.split("/")[2];
      return await getProcessingStatus(cityId);
    }

    // City processing endpoint
    if (path === "/cities" && httpMethod === "POST") {
      return await processCityRequest(body, timestamp);
    }

    return createResponse(404, {
      error: "Not Found",
      message: `Path ${path} not found`,
      timestamp,
      path,
      method: httpMethod,
    });
  } catch (error) {
    console.error("Error:", error);
    return createResponse(500, {
      error: "Internal Server Error",
      message: "An unexpected error occurred",
      timestamp: new Date().toISOString(),
    });
  }
};

async function processCityRequest(
  body: string | null,
  timestamp: string
): Promise<APIGatewayProxyResult> {
  if (!body) {
    return createResponse(400, {
      error: "Bad Request",
      message: "Request body is required",
      timestamp,
    });
  }

  try {
    const requestData: CityRequest = JSON.parse(body);

    if (!requestData.cityName) {
      return createResponse(400, {
        error: "Bad Request",
        message: "cityName is required",
        timestamp,
      });
    }

    // Generate unique city ID
    const cityId = `${requestData.cityName
      .toLowerCase()
      .replace(/\s+/g, "-")}-${Date.now()}`;

    // Create processing data
    const processingData: ProcessingData = {
      cityId,
      cityName: requestData.cityName,
      countryCode: requestData.countryCode,
      status: "pending",
      timestamp,
    };

    // Save initial data to DynamoDB
    await dynamodb.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(processingData),
      })
    );

    // Send message to city processing queue
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.CITY_QUEUE_URL,
        MessageBody: JSON.stringify(processingData),
        MessageAttributes: {
          cityId: {
            DataType: "String",
            StringValue: cityId,
          },
          cityName: {
            DataType: "String",
            StringValue: requestData.cityName,
          },
        },
      })
    );

    // Send notification
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
        Subject: "City Processing Started",
        Message: JSON.stringify({
          message: "City processing started",
          cityId,
          cityName: requestData.cityName,
          timestamp,
        }),
      })
    );

    return createResponse(202, {
      message: "City processing started",
      cityId,
      cityName: requestData.cityName,
      status: "pending",
      timestamp,
      statusUrl: `/status/${cityId}`,
    });
  } catch (error) {
    console.error("Error processing city request:", error);
    return createResponse(500, {
      error: "Internal Server Error",
      message: "Failed to process city request",
      timestamp,
    });
  }
}

async function getProcessingStatus(
  cityId: string
): Promise<APIGatewayProxyResult> {
  try {
    // Get the latest record for this city
    const result = await dynamodb.send(
      new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          cityId,
          timestamp: "latest", // We'll use a special timestamp for the latest record
        }),
      })
    );

    if (!result.Item) {
      return createResponse(404, {
        error: "Not Found",
        message: `No processing data found for city ID: ${cityId}`,
        timestamp: new Date().toISOString(),
      });
    }

    const data = unmarshall(result.Item) as ProcessingData;

    return createResponse(200, {
      cityId: data.cityId,
      cityName: data.cityName,
      status: data.status,
      timestamp: data.timestamp,
      weatherData: data.weatherData,
      llmDescription: data.llmDescription,
      error: data.error,
    });
  } catch (error) {
    console.error("Error getting processing status:", error);
    return createResponse(500, {
      error: "Internal Server Error",
      message: "Failed to get processing status",
      timestamp: new Date().toISOString(),
    });
  }
}

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
