#!/bin/bash
set -e

echo "===== Starting AWS resources update script ====="
echo "This script will update the CodeBuild project and Step Functions state machine"

# 1. Export current CodeBuild project configuration
echo "Exporting current CodeBuild project configuration..."
aws codebuild batch-get-projects --names ToolShed-MCP-Server-Build --output json > codebuild-project.json

# 2. Create a new buildspec file
echo "Creating new buildspec with originalRepositoryName support..."
cat > new-buildspec.json << 'EOF'
{
  "version": "0.2",
  "phases": {
    "pre_build": {
      "commands": [
        "echo Logging in to Amazon ECR...",
        "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI",
        "REPO_URL=$(echo $CODEBUILD_INITIATOR | cut -d/ -f2)",
        "REPO_NAME=$(echo $REPO_URL | cut -d@ -f1)",
        "IMAGE_TAG=${REPOSITORY_NAME}:${CODEBUILD_RESOLVED_SOURCE_VERSION}"
      ]
    },
    "build": {
      "commands": [
        "echo Cloning repository...",
        "echo 'Using repository: $ORIGINAL_REPOSITORY_NAME'",
        "git clone https://$GITHUB_TOKEN@github.com/$ORIGINAL_REPOSITORY_NAME.git repo",
        "cd repo",
        "echo Building the Docker image...",
        "docker build -t $REPOSITORY_URI:$IMAGE_TAG .",
        "docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest"
      ]
    },
    "post_build": {
      "commands": [
        "echo Pushing the Docker image...",
        "docker push $REPOSITORY_URI:$IMAGE_TAG",
        "docker push $REPOSITORY_URI:latest",
        "echo Writing image definition file...",
        "echo \"{\\\"imageUri\\\":\\\"$REPOSITORY_URI:$IMAGE_TAG\\\"}\" > imageDefinition.json"
      ]
    }
  },
  "artifacts": {
    "files": [
      "imageDefinition.json"
    ]
  }
}
EOF

# 3. Update CodeBuild project with new buildspec
echo "Updating CodeBuild project with new buildspec..."
# First convert the buildspec to a single line with escaped quotes
BUILDSPEC=$(cat new-buildspec.json | tr -d '\n' | sed 's/"/\\"/g')
# Now update the project with the inline buildspec
aws codebuild update-project --name ToolShed-MCP-Server-Build --source "type=NO_SOURCE,buildspec=$BUILDSPEC"

# 4. Get the current Step Functions state machine definition
echo "Getting current Step Functions state machine definition..."
aws stepfunctions describe-state-machine \
  --state-machine-arn arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline \
  > state-machine.json

# 5. Extract the definition into a separate file
echo "Extracting and modifying state machine definition..."
jq -r '.definition' state-machine.json > definition.json

# 6. Parse and modify the definition - add ORIGINAL_REPOSITORY_NAME
cat definition.json | \
python3 -c '
import json
import sys

# Parse the JSON
data = json.load(sys.stdin)

# Find the CodeBuild task
for state_name, state in data["States"].items():
    if state.get("Type") == "Task" and "codebuild" in state.get("Resource", ""):
        if "Parameters" in state and "EnvironmentVariablesOverride" in state["Parameters"]:
            # Check if ORIGINAL_REPOSITORY_NAME already exists
            exists = False
            for env_var in state["Parameters"]["EnvironmentVariablesOverride"]:
                if env_var.get("Name") == "ORIGINAL_REPOSITORY_NAME":
                    exists = True
                    break
            
            # Add if it doesn't exist
            if not exists:
                state["Parameters"]["EnvironmentVariablesOverride"].append({
                    "Name": "ORIGINAL_REPOSITORY_NAME",
                    "Type": "PLAINTEXT",
                    "Value.$": "$.originalRepositoryName"
                })

# Output the modified JSON
print(json.dumps(data, indent=2))
' > updated-definition.json

# 7. Update the state machine with the modified definition
echo "Updating Step Functions state machine..."
aws stepfunctions update-state-machine \
  --state-machine-arn arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline \
  --definition file://updated-definition.json

echo "===== Update completed successfully! ====="
echo "The following files were created:"
echo "- codebuild-project.json (original CodeBuild project configuration)"
echo "- new-buildspec.json (updated buildspec with originalRepositoryName support)"
echo "- state-machine.json (original state machine configuration)"
echo "- definition.json (extracted state machine definition)"
echo "- updated-definition.json (modified state machine definition)" 