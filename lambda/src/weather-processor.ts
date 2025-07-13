import { SQSEvent, SQSRecord } from "aws-lambda";
import {
  SQSClient,
  SendMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { marshall } from "@aws-sdk/util-dynamodb";

const sqs = new SQSClient({});
const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

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

interface WeatherData {
  temperature: number;
  humidity: number;
  description: string;
  windSpeed: number;
  pressure: number;
  visibility: number;
  sunrise: string;
  sunset: string;
}

interface OpenWeatherResponse {
  main: {
    temp: number;
    humidity: number;
    pressure: number;
  };
  weather: Array<{
    description: string;
  }>;
  wind: {
    speed: number;
  };
  visibility: number;
  sys: {
    sunrise: number;
    sunset: number;
  };
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log("Weather processor event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      await processWeatherRecord(record);
    } catch (error) {
      console.error("Error processing weather record:", error);
      // Don't delete the message from the queue so it can be retried
    }
  }
};

async function processWeatherRecord(record: SQSRecord): Promise<void> {
  const processingData: ProcessingData = JSON.parse(record.body);

  try {
    console.log("Processing weather data for:", processingData.cityName);

    // Update status to weather_processing
    await updateProcessingStatus(processingData.cityId, "weather_processing");

    // Fetch weather data from OpenWeather API
    const weatherData = await fetchWeatherData(
      processingData.cityName,
      processingData.countryCode
    );

    // Update processing data with weather information
    const updatedData: ProcessingData = {
      ...processingData,
      status: "weather_processing",
      weatherData,
      timestamp: new Date().toISOString(),
    };

    // Save updated data to DynamoDB
    await dynamodb.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(updatedData),
      })
    );

    // Send message to LLM processing queue
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.LLM_QUEUE_URL,
        MessageBody: JSON.stringify(updatedData),
        MessageAttributes: {
          cityId: {
            DataType: "String",
            StringValue: processingData.cityId,
          },
          cityName: {
            DataType: "String",
            StringValue: processingData.cityName,
          },
        },
      })
    );

    // Send notification
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
        Subject: "Weather Data Retrieved",
        Message: JSON.stringify({
          message: "Weather data retrieved successfully",
          cityId: processingData.cityId,
          cityName: processingData.cityName,
          weatherData,
          timestamp: new Date().toISOString(),
        }),
      })
    );

    // Delete message from queue
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.WEATHER_QUEUE_URL,
        ReceiptHandle: record.receiptHandle,
      })
    );

    console.log("Weather processing completed for:", processingData.cityName);
  } catch (error) {
    console.error("Error in weather processing:", error);

    // Update status to failed
    await updateProcessingStatus(
      processingData.cityId,
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );

    // Send error notification
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
        Subject: "Weather Processing Failed",
        Message: JSON.stringify({
          message: "Weather processing failed",
          cityId: processingData.cityId,
          cityName: processingData.cityName,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        }),
      })
    );

    // Delete message from queue to prevent infinite retries
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.WEATHER_QUEUE_URL,
        ReceiptHandle: record.receiptHandle,
      })
    );
  }
}

async function fetchWeatherData(
  cityName: string,
  countryCode?: string
): Promise<WeatherData> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("OpenWeather API key not configured");
  }

  const location = countryCode ? `${cityName},${countryCode}` : cityName;
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
    location
  )}&appid=${apiKey}&units=metric`;

  console.log("Fetching weather data from:", url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Weather API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as OpenWeatherResponse;

  return {
    temperature: data.main.temp,
    humidity: data.main.humidity,
    description: data.weather[0].description,
    windSpeed: data.wind.speed,
    pressure: data.main.pressure,
    visibility: data.visibility,
    sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
    sunset: new Date(data.sys.sunset * 1000).toISOString(),
  };
}

async function updateProcessingStatus(
  cityId: string,
  status: string,
  error?: string
): Promise<void> {
  try {
    const updateExpression = error
      ? "SET #status = :status, #error = :error, #timestamp = :timestamp"
      : "SET #status = :status, #timestamp = :timestamp";

    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
      "#timestamp": "timestamp",
    };

    const expressionAttributeValues: Record<string, any> = {
      ":status": { S: status },
      ":timestamp": { S: new Date().toISOString() },
    };

    if (error) {
      expressionAttributeNames["#error"] = "error";
      expressionAttributeValues[":error"] = { S: error };
    }

    await dynamodb.send(
      new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
          cityId,
          timestamp: "latest",
        }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  } catch (error) {
    console.error("Error updating processing status:", error);
  }
}
