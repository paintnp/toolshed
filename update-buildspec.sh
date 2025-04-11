#!/bin/bash
BUILDSPEC=$(cat new-buildspec.json | jq -c .)
aws codebuild update-project --name ToolShed-MCP-Server-Build --source type=NO_SOURCE,buildspec="$BUILDSPEC" 