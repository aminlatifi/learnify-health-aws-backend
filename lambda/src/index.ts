import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

interface ResponseBody {
  message: string;
  timestamp: string;
  path: string;
  method: string;
  [key: string]: any;
}

interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));
  console.log("Context:", JSON.stringify(context, null, 2));

  try {
    const { httpMethod, path, pathParameters, queryStringParameters, body } =
      event;
    const timestamp = new Date().toISOString();

    // Health check endpoint
    if (path === "/health" && httpMethod === "GET") {
      return createResponse(200, {
        message: "Service is healthy",
        timestamp,
        path,
        method: httpMethod,
        status: "OK",
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
      });
    }

    // API v1 endpoints
    if (path.startsWith("/api/v1")) {
      return handleApiV1(
        httpMethod,
        path,
        pathParameters,
        queryStringParameters,
        body,
        timestamp
      );
    }

    // Default response for unknown paths
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

function handleApiV1(
  httpMethod: string,
  path: string,
  pathParameters: any,
  queryStringParameters: any,
  body: string | null,
  timestamp: string
): APIGatewayProxyResult {
  // Users endpoints
  if (path.startsWith("/api/v1/users")) {
    return handleUsersEndpoint(
      httpMethod,
      path,
      pathParameters,
      queryStringParameters,
      body,
      timestamp
    );
  }

  // Default API v1 response
  return createResponse(404, {
    error: "Not Found",
    message: `API endpoint ${path} not found`,
    timestamp,
    path,
    method: httpMethod,
  });
}

function handleUsersEndpoint(
  httpMethod: string,
  path: string,
  pathParameters: any,
  queryStringParameters: any,
  body: string | null,
  timestamp: string
): APIGatewayProxyResult {
  // GET /api/v1/users - List users
  if (httpMethod === "GET" && path === "/api/v1/users") {
    return createResponse(200, {
      message: "Users retrieved successfully",
      timestamp,
      path,
      method: httpMethod,
      users: [
        { id: "1", name: "John Doe", email: "john@example.com" },
        { id: "2", name: "Jane Smith", email: "jane@example.com" },
      ],
      total: 2,
    });
  }

  // POST /api/v1/users - Create user
  if (httpMethod === "POST" && path === "/api/v1/users") {
    const userData = body ? JSON.parse(body) : {};
    return createResponse(201, {
      message: "User created successfully",
      timestamp,
      path,
      method: httpMethod,
      user: {
        id: Date.now().toString(),
        ...userData,
        createdAt: timestamp,
      },
    });
  }

  // GET /api/v1/users/{id} - Get specific user
  if (httpMethod === "GET" && pathParameters?.id) {
    return createResponse(200, {
      message: "User retrieved successfully",
      timestamp,
      path,
      method: httpMethod,
      user: {
        id: pathParameters.id,
        name: "John Doe",
        email: "john@example.com",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    });
  }

  // PUT /api/v1/users/{id} - Update user
  if (httpMethod === "PUT" && pathParameters?.id) {
    const userData = body ? JSON.parse(body) : {};
    return createResponse(200, {
      message: "User updated successfully",
      timestamp,
      path,
      method: httpMethod,
      user: {
        id: pathParameters.id,
        ...userData,
        updatedAt: timestamp,
      },
    });
  }

  // DELETE /api/v1/users/{id} - Delete user
  if (httpMethod === "DELETE" && pathParameters?.id) {
    return createResponse(200, {
      message: "User deleted successfully",
      timestamp,
      path,
      method: httpMethod,
      deletedUserId: pathParameters.id,
    });
  }

  return createResponse(405, {
    error: "Method Not Allowed",
    message: `Method ${httpMethod} not allowed for ${path}`,
    timestamp,
    path,
    method: httpMethod,
  });
}

function createResponse(
  statusCode: number,
  body: ResponseBody | ErrorResponse
): APIGatewayProxyResult {
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
