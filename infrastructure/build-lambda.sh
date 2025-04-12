#!/bin/bash
set -e

LAMBDA_DIR="cdk/lambda"

# Change to the lambda directory
cd "$(dirname "$0")/$LAMBDA_DIR"

# Install dependencies
echo "Installing Lambda dependencies..."
npm install --production

echo "Lambda dependencies installed successfully." 