# ToolShed

A platform for managing and using various AI tools and agents.

## Features

### MCP Server Discovery and Verification

ToolShed includes a comprehensive system for discovering, cataloging, and verifying MCP (Model Context Protocol) servers:

1. **GitHub Crawler**
   - Automatically discovers MCP server repositories on GitHub
   - Searches by topics, repository names, and descriptions
   - Extracts metadata like language, stars, and topics
   - [Learn more about the crawler](lib/github/README.md)

2. **Server Verification**
   - Verifies discovered MCP servers by checking their functionality
   - Lists and catalogs available tools from each server
   - Runs sample tools to confirm they work correctly
   - Supports both public endpoints and container-based verification
   - [Learn more about verification](lib/verification/README.md)

3. **AWS Fargate Integration**
   - Runs MCP servers in isolated containers for testing
   - Supports both public and private subnet configurations
   - Provides options for direct access or load balancer routing
   - [Learn more about Fargate integration](#aws-fargate-integration)

4. **DynamoDB Integration**
   - Persistent storage for MCP server metadata
   - Tracks verification status and tool information
   - Enables searching and filtering of servers
   - [Learn more about the database](lib/db/README.md)

## Setup

### AWS Configuration

1. Set up AWS credentials with permissions for ECS, ELB, and DynamoDB
2. Create a `.env.local` file based on `.env.template`:

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
# Additional configuration...
```

### DynamoDB Initialization

Initialize the DynamoDB tables needed for the application:

```bash
# Create the DynamoDB table for MCP servers
npx ts-node -P scripts/tsconfig.json scripts/init-dynamodb.ts
```

## Workflow

1. **Discover MCP Servers**
   ```bash
   # Crawl GitHub for MCP servers and store in DynamoDB
   npx ts-node -P scripts/tsconfig.json scripts/crawl-mcp-servers.ts "topic:mcp" 10
   ```

2. **Verify Servers**
   ```bash
   # Verify discovered servers and update metadata
   npx ts-node -P scripts/tsconfig.json scripts/verify-mcp-servers.ts "topic:mcp" 5
   ```

3. **Run the Application**
   ```bash
   # Start the development server
   npm run dev
   ```

## AWS Fargate Integration

The application includes integration with AWS Fargate for running MCP servers in isolated containers. These containers can be made accessible in two ways:

### 1. Direct Public IP Access (Requires Public Subnets)

If your AWS subnets are configured with "Auto-assign public IPv4 address" enabled, Fargate tasks will get public IPs and be directly accessible.

### 2. Application Load Balancer (Recommended for Production)

For a more robust setup, use an Application Load Balancer to expose the containers:

1. Set the following environment variables in `.env.local`:
   ```
   AWS_VPC_ID=vpc-xxxxxxxxxxxxxxxxx
   AWS_SUBNETS=subnet-xxxxxxxxxxxxxxxxx,subnet-yyyyyyyyyyyyyyyyy
   AWS_SECURITY_GROUPS=sg-xxxxxxxxxxxxxxxxx
   AWS_LOAD_BALANCER_NAME=mcp-server-lb
   AWS_TARGET_GROUP_NAME=mcp-server-targets
   AWS_EXECUTION_ROLE_ARN=arn:aws:iam::xxxxxxxxxxxx:role/YourExecutionRole
   ```

2. Run the load balancer test:
   ```
   npx ts-node -P scripts/tsconfig.json scripts/test-load-balancer.ts
   ```

3. Access your MCP server at the load balancer's DNS name.

The load balancer will automatically route traffic to your Fargate containers even if they only have private IP addresses.

## Required AWS IAM Permissions

The execution role requires these permissions:
- `ecs:RunTask`
- `ecs:DescribeTasks`  
- `ecs:StopTask`
- `ecs:RegisterTaskDefinition`
- `logs:CreateLogGroup`
- `logs:CreateLogStream`
- `logs:PutLogEvents`
- `elasticloadbalancing:*` (for ALB integration)
- `dynamodb:*` (for DynamoDB integration)

## Networking Requirements

- For direct public access: Public subnets with auto-assign public IP enabled
- For ALB access: Private subnets are sufficient, but ALB needs to be in public subnets

## Development

```bash
npm run dev
```

## Features

- Search for MCP servers
- View detailed information about servers and their tools
- Execute tools securely in AWS Fargate containers
- API access for programmatic interaction

## License

MIT

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
