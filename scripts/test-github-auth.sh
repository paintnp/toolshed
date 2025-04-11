#!/bin/bash

# Test script to verify GitHub Container Registry authentication
# Usage: ./scripts/test-github-auth.sh [github_token]

# Get GitHub token from argument or from .env.local
if [ -n "$1" ]; then
  TOKEN="$1"
else
  # Extract token from .env.local
  if [ -f ".env.local" ]; then
    TOKEN=$(grep GITHUB_TOKEN .env.local | cut -d '=' -f2)
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "Error: GitHub token not provided and not found in .env.local"
  exit 1
fi

echo "Testing GitHub Container Registry authentication..."
echo "Token: ${TOKEN:0:10}... (truncated for security)"

# Try to authenticate with GitHub Container Registry
echo "Authenticating with ghcr.io..."
echo "$TOKEN" | docker login ghcr.io -u x-access-token --password-stdin

if [ $? -eq 0 ]; then
  echo "Authentication successful!"
  
  # Try to pull the MCP server image
  echo -e "\nAttempting to pull GitHub MCP server image..."
  docker pull ghcr.io/github/mcp-server:latest
  
  if [ $? -eq 0 ]; then
    echo -e "\nSuccess! Was able to pull the GitHub MCP server image."
    echo "This confirms your token has the correct permissions."
  else
    echo -e "\nFailed to pull the image. Your token may not have access to this repository."
    echo "Make sure your token has the 'read:packages' scope."
  fi
else
  echo "Authentication failed. Check that your token is valid and has the correct permissions."
fi

# Logout for security
echo -e "\nLogging out from ghcr.io..."
docker logout ghcr.io 