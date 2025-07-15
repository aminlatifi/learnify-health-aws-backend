#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Warning: .env file not found. Make sure to set environment variables manually."
fi

# Check if required environment variables are set
if [ -z "$OPENWEATHER_API_KEY" ]; then
    echo "Error: OPENWEATHER_API_KEY is not set. Please add it to your .env file."
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "Warning: OPENAI_API_KEY is not set. LLM processing will not work."
fi

echo "Building Lambda functions..."
bun run lambda:build

echo "Deploying to AWS..."
bun run deploy

echo "Deployment completed!" 