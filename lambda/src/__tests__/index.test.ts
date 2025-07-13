import { handler } from "../index";
import { APIGatewayProxyEvent, Context } from "aws-lambda";

describe("Lambda Handler", () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test-function",
    logStreamName: "2024/01/01/[$LATEST]test-stream",
    getRemainingTimeInMillis: () => 1000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  it("should return health check response", async () => {
    const event: APIGatewayProxyEvent = {
      httpMethod: "GET",
      path: "/health",
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
      body: null,
      isBase64Encoded: false,
    };

    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      message: "Service is healthy",
      status: "OK",
    });
  });

  it("should return users list", async () => {
    const event: APIGatewayProxyEvent = {
      httpMethod: "GET",
      path: "/api/v1/users",
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
      body: null,
      isBase64Encoded: false,
    };

    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      message: "Users retrieved successfully",
      users: expect.any(Array),
    });
  });

  it("should return 404 for unknown path", async () => {
    const event: APIGatewayProxyEvent = {
      httpMethod: "GET",
      path: "/unknown",
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
      body: null,
      isBase64Encoded: false,
    };

    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toMatchObject({
      error: "Not Found",
    });
  });
});
