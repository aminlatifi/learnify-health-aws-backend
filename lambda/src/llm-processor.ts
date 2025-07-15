import { SQSEvent, SQSRecord } from "aws-lambda";
import { SQSClient, DeleteMessageCommand } from "@aws-sdk/client-sqs";
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

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface OpenAIError {
  error: {
    message: string;
  };
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log("LLM processor event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      await processLLMRecord(record);
    } catch (error) {
      console.error("Error processing LLM record:", error);
      // Don't delete the message from the queue so it can be retried
    }
  }
};

async function processLLMRecord(record: SQSRecord): Promise<void> {
  const processingData: ProcessingData = JSON.parse(record.body);

  try {
    console.log("Processing LLM data for:", processingData.cityName);

    // Update status to llm_processing
    await updateProcessingStatus(processingData.cityId, "llm_processing");

    // Generate description using OpenAI
    const llmDescription = await generateWeatherDescription(processingData);

    // Update processing data with LLM description
    const completedData: ProcessingData = {
      ...processingData,
      status: "completed",
      llmDescription,
      timestamp: new Date().toISOString(),
    };

    // Save completed data to DynamoDB
    await dynamodb.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(completedData),
      })
    );

    // Send completion notification
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
        Subject: "Weather Processing Completed",
        Message: JSON.stringify({
          message: "Weather processing completed successfully",
          cityId: processingData.cityId,
          cityName: processingData.cityName,
          weatherData: processingData.weatherData,
          llmDescription,
          timestamp: new Date().toISOString(),
        }),
      })
    );

    // Delete message from queue
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.LLM_QUEUE_URL,
        ReceiptHandle: record.receiptHandle,
      })
    );

    console.log("LLM processing completed for:", processingData.cityName);
  } catch (error) {
    console.error("Error in LLM processing:", error);

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
        Subject: "LLM Processing Failed",
        Message: JSON.stringify({
          message: "LLM processing failed",
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
        QueueUrl: process.env.LLM_QUEUE_URL,
        ReceiptHandle: record.receiptHandle,
      })
    );
  }
}

async function generateWeatherDescription(
  processingData: ProcessingData
): Promise<string> {
  return `Fake description for ${processingData.cityName}\n`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const weatherData = processingData.weatherData;
  if (!weatherData) {
    throw new Error("Weather data not available for LLM processing");
  }

  const prompt = `Generate a short, engaging description (2-3 sentences) about the weather in ${
    processingData.cityName
  }. 
  
Current weather conditions:
- Temperature: ${weatherData.temperature}°C
- Humidity: ${weatherData.humidity}%
- Description: ${weatherData.description}
- Wind Speed: ${weatherData.windSpeed} m/s
- Pressure: ${weatherData.pressure} hPa
- Visibility: ${weatherData.visibility} meters
- Sunrise: ${new Date(weatherData.sunrise).toLocaleTimeString()}
- Sunset: ${new Date(weatherData.sunset).toLocaleTimeString()}

Make it informative and interesting for someone planning to visit or live in this city.`;

  console.log("Generating description with prompt:", prompt);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that provides concise, informative weather descriptions.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 150,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as OpenAIError;
    throw new Error(
      `OpenAI API error: ${response.status} - ${
        errorData.error?.message || "Unknown error"
      }`
    );
  }

  const data = (await response.json()) as OpenAIResponse;
  const description = data.choices[0]?.message?.content?.trim();

  if (!description) {
    throw new Error("No description generated from OpenAI");
  }

  return description;
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
