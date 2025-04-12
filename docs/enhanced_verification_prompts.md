Implementation Plan for Toolshed Enhanced Workflow
Architecture Overview
Toolshed’s workflow will be extended to build and reuse container images and provide on-demand playground environments. The high-level architecture is as follows:
Verification Pipeline: When a new MCP server is added (pointing to a GitHub repo), a CI/CD pipeline builds a Docker image from the repo and pushes it to Amazon ECR (Elastic Container Registry). The image URI (including repository and tag) is stored in DynamoDB alongside the server’s metadata. This ensures that each server has an associated stored container image​
medium.com
 for later use.
Persistent Image Storage: ECR acts as persistent storage for built images. Once an image is built and pushed, Toolshed can reuse it without rebuilding. DynamoDB serves as the source of truth for the latest image URI/tag for each server.
Playground Environment: When a user launches the Playground for a given server, Toolshed will fetch the stored image URI from DynamoDB and start a short-lived container using AWS ECS Fargate (serverless containers) via RunTask. ECS will pull the image from ECR and run it as a one-off task​
medium.com
. The user can interact with the running container through the Toolshed UI. Once the session is over (or after a timeout), the container task is terminated to free resources.
Manual Re-Verification: The Toolshed UI will offer a “Re-verify” button for each server, allowing the user to manually re-run the verification pipeline. This will rebuild the Docker image (if the source has changed) and update the stored image in ECR and DynamoDB. This is useful to fetch updates from the GitHub repo (e.g., if the code has been updated).
Automated Metadata Generation: After a successful verification (build), Toolshed’s backend will use an LLM (OpenAI API) to infer or generate any missing metadata for the server. For example, it can generate a description of the server, detect the primary programming language, and even produce basic API documentation or endpoint details. This metadata is then stored (either back in DynamoDB or in an S3 document with a reference in Dynamo) for use in the Toolshed UI.
Security & Efficiency: The ECS Fargate tasks for Playground run in an isolated environment with minimal privileges. Each task uses a transient role only to pull the ECR image and send logs to CloudWatch. For warm starts and low latency, the system can optionally reuse images cached by ECS (Fargate automatically caches recent images on underlying hosts when possible) or keep idle containers ready (future enhancement). All tasks are tracked and force-stopped after a fixed duration to avoid runaway costs. Observability is provided via CloudWatch Logs for each container’s output and CloudWatch metrics for resource usage.
Overall, this architecture decouples the build process from the run process. Verification builds and stores the artifact once, and subsequent Playground sessions simply launch containers from the stored image. The diagram below illustrates the flow from code verification to playground launch (pseudocode diagram): 
medium.com
 Figure: Developer pushes code -> Toolshed builds & stores image in ECR -> Playground pulls image from ECR via ECS and runs container. (Toolshed uses DynamoDB to link servers to image URIs, and uses OpenAI for docs generation.)
1. Image Build and Storage During Verification
When a new server is added to Toolshed (or during verification), the system should build a Docker image from the server’s GitHub repository and push it to Amazon ECR. This step ensures the image is persisted for reuse. Currently, the verification pipeline likely builds the server for testing; we will extend it to push the image to ECR and record the image details:
Build and Push to ECR: Integrate an ECR push step in the verification pipeline. After building the Docker image from the repo (using the Dockerfile in the repo), tag the image with an appropriate name and version (for example, the server’s identifier and perhaps the Git commit SHA). Push the tagged image to an Amazon ECR repository. You may create a separate ECR repository for each server or use a common repository with distinct image tags. (For simplicity, a single toolshed/mcp-servers repository can be used with image tags like <server-id>:<commit-sha> or <server-name>:<version>.)
Store Image Metadata in DynamoDB: Once the image is pushed successfully, record its ECR URI (which includes the registry URL, repo name, and tag) in the DynamoDB table that holds server metadata. For example, add attributes imageUri (e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com/toolshed/mcp-server-abc:abcd123) and perhaps imageTag or imageDigest if needed. This ties the server entry to a specific container image. Future processes (like Playground) will look up this info to run the container. Storing a reference instead of the image itself follows best practices (store large binaries in S3/ECR and references in DB)​
dynobase.dev
.
Implementation in Pipeline: Modify the verification pipeline code (likely in lib/verification or a CodeBuild buildspec) to include ECR push. Ensure the build environment has AWS credentials/permissions to push to ECR. This might involve logging in to ECR (aws ecr get-login-password ... | docker login ...) and then docker push. If using AWS CodeBuild/CodePipeline defined in CDK, update the CodeBuild project to have environment variables for ECR repo URI and appropriate IAM role permissions to perform ECR push and DynamoDB update.
DynamoDB Update: Use the AWS SDK in the pipeline (or a post-build Lambda) to update the DynamoDB item for the server. The item can be keyed by server ID or name. Update it with the new imageUri and imageTag fields. Also consider storing the Git commit SHA of the build (lastVerifiedSha) to help with re-verification logic (so we know what commit was last built).
Error Handling: If the image build or push fails, mark verification as failed. If push succeeds but DB update fails, you should handle that (e.g., retry or roll back). Ideally, the pipeline should only mark the server “verified” if all steps (including image storage) succeed.
Integration Points: In the codebase, check lib/verification (perhaps a module like verifyPipeline.js/ts or a CI script). Also update infrastructure via CDK to ensure an ECR repository exists (if not already). For example, add an AWS::ECR::Repository resource in CDK and grant the pipeline’s role permission to push to it. Additionally, in lib/db (which likely wraps DynamoDB calls), extend the server model to include fields for image URI and tag. Cursor Implementation Prompt:
markdown
Copy
**Task:** Integrate Docker image push to ECR in the verification pipeline, and store the image URI in DynamoDB.

1. **In the CI/CD Pipeline (CDK)**: Open the CDK stack file for Toolshed’s pipeline (e.g., `cdk/pipeline-stack.ts`). Add an Amazon ECR Repository resource (e.g., `toolshedRepository`) if not existing. Grant the CodeBuild project’s role permissions to push to this repository and to update DynamoDB (via IAM policies for `ecr:BatchGetImage`, `ecr:PutImage`, `dynamodb:UpdateItem`, etc.). 

2. **In the Verification Code (`lib/verification`):** After building the Docker image from the GitHub repo, add code to push it to ECR:
   - Retrieve the ECR repository URI (could be an environment variable or AWS SDK describe call).
   - Tag the local image with the ECR repo URI (e.g., `docker tag <localImage>:latest <repoUri>:<tag>`).
   - Push the image (e.g., using AWS SDK for ECR or calling Docker CLI if in CodeBuild).
   - On successful push, get the full image URI (e.g., `<account>.dkr.ecr.<region>.amazonaws.com/<repoName>:<tag>`).

3. **DynamoDB Update (`lib/db`):** Use the DynamoDB DocumentClient to update the server’s item:
   - Key: the server’s unique ID.
   - UpdateExpression to set `imageUri = :uri` and `imageTag = :tag` (and optionally `lastVerifiedSha = :sha`).
   - Ensure the DynamoDB table name is read from config and the update uses conditional expressions if needed (optional).

4. **Testing:** Print or log the image URI and DynamoDB update result for debugging. Ensure the pipeline only marks verification success after these steps complete.
Cursor Test Prompt:
markdown
Copy
After implementing the ECR push and metadata storage, simulate adding a new MCP server:
1. **Add a Test Server:** Use a test GitHub repository with a simple Dockerfile. Trigger Toolshed’s verification (e.g., via the existing “Add Server” flow).
2. **Verify ECR Push:** After the pipeline runs, check the AWS ECR console for the new repository/image. The image tag should correspond to the server (e.g., server ID or commit SHA).
3. **Verify DynamoDB Update:** Query the DynamoDB table for the server’s item. Confirm it now contains the `imageUri` (and tag) fields with correct values.
4. **Error Handling:** Intentionally cause a build failure (e.g., bad Dockerfile) to ensure the pipeline reports verification failure and does not store an image URI.
2. Persistent Image Reuse
With images stored in ECR, the Toolshed Playground feature should launch containers using those images instead of rebuilding. This means when a user wants to interact with a server in the Playground, Toolshed will fetch the pre-built image from DynamoDB and start it directly:
Skip Rebuild: Remove or bypass any logic that was previously rebuilding the image for Playground sessions. The assumption now is that the image has already been built during verification. The Playground launch should not trigger a CI build. Instead, it will reference the stored container image.
Fetch Image URI from DB: The backend API handling Playground launch (perhaps an endpoint like POST /servers/{id}/playground) will retrieve the server’s record from DynamoDB to get the imageUri. This URI points to the exact image in ECR that was built earlier.
Launch via ECS RunTask: Use the AWS ECS API to run a new task with the given image. This involves specifying:
The cluster (likely a Fargate cluster prepared for Toolshed Playground tasks).
A task definition or task configuration that uses the image URI. We can register a task definition on the fly with the image, or use a pre-defined task definition and override the image. For simplicity, one approach is to register a new Task Definition for the server’s image (or update an existing one) each time the image is updated, and then just run it here.
Launch type FARGATE with required platform version.
Network configuration: assign the task to the appropriate subnets and security group. Likely, use awsvpc networking so the task gets an ENI and IP. If the Playground needs direct user access, consider assigning a public IP; if the Toolshed backend will proxy requests, keep it private.
Container overrides: set the container’s command or env if needed (for example, ensure it starts the server on the correct port).
No Build Context: Because we are using the existing image, the launch should be fast. ECS will pull the image from ECR (which is typically quick, especially if the image is already cached on an ECS host)​
docs.aws.amazon.com
. The overall latency will include container start time (a few seconds).
Multiple Sessions: Each Playground session can launch a separate task. The system can handle multiple tasks concurrently if users open different servers or multiple sessions. Ensure unique identifiers or task names if needed.
Permissions: The backend service that calls ECS (likely running with an IAM role) must have permission to run tasks (e.g., ecs:RunTask, ecs:DescribeTasks, iam:PassRole for the task execution role).
Integration Points: Modify the Playground launch handler in the backend. This might be in lib/aws (if there is a wrapper for AWS ECS) or a specific controller for playground sessions. If previously Playground was not implemented or was rebuilding, replace that logic with calls to ECS. Also ensure the DynamoDB query (in lib/db) to get image URI is in place. In the infrastructure (CDK), ensure an ECS cluster exists and that a suitable IAM task execution role is available (with access to ECR and CloudWatch logs). The cluster name and other config should be supplied to the backend (via environment variables or config files). Cursor Implementation Prompt:
markdown
Copy
**Task:** Implement Playground container launch using ECS RunTask with the stored ECR image.

1. **Backend API Handler:** Open the file handling the Playground launch request (e.g., `routes/playground.ts` or `lib/handlers/playgroundLaunch.js`). Remove any code that builds a Docker image. Instead:
   - Parse the server ID from the request.
   - Query DynamoDB (using `lib/db`) for that server’s record and retrieve the `imageUri` (and possibly `imageTag`).
   - If no imageUri is found, return an error (the server must be verified first).

2. **ECS Client Setup (`lib/aws/ecs.ts`):** Use AWS SDK (boto3 for Python or AWS SDK for JS in Node, depending on Toolshed’s stack) to run a new ECS task:
   - Configure the ECS cluster name (e.g., from an env var `PLAYGROUND_CLUSTER`).
   - Define task parameters: 
     - `launchType: FARGATE`
     - `taskDefinition`: If you have a pre-registered task definition ARN for this server’s image, use it. Otherwise, create a new Task Definition on the fly:
       * Call `registerTaskDefinition` with a family name like `toolshed-server-<id>` and container definition that uses `imageUri` and the port the server exposes (from metadata or default 80/8080). Set CPU/memory (e.g., 0.25 vCPU, 512MB for a small server, or make it configurable per server).
       * Use an existing ECS task execution role that has `AmazonECSTaskExecutionRolePolicy` (for ECR pull, logs).
       * Enable CloudWatch logging in the container definition (log driver awslogs, create log group if needed).
     - If using an existing task definition, you can optionally override just the image: `runTask` allows overriding container images via `overrides.containerOverrides` (ensure container name matches).
     - `networkConfiguration`: Set `awsvpcConfiguration` with subnets (from config, likely private subnets), security groups (restrict to Toolshed access), and `assignPublicIp` (true if the UI will talk directly to it, false if backend proxies requests).
   - Call `ecs.runTask(params)` and capture the task ARN.

3. **Respond to Client:** Once `RunTask` is called, you can return a response indicating the task is launching. The response could contain an identifier for the session or instructions for the UI on how to connect. (For MVP, you might not need to immediately connect; you could simply indicate success. More advanced: wait for task to be in RUNNING state and then provide the IP/DNS to the UI.)

4. **Task Tracking:** Optionally, store the task ARN in a transient datastore (in-memory or DynamoDB) associated with the user session or server, so you can monitor or terminate it later. This could also be used to prevent multiple concurrent tasks for the same server if desired.

5. **Permissions:** Make sure the backend’s execution environment (e.g., a Lambda or container) has IAM rights: `ecs:RunTask`, `ecs:RegisterTaskDefinition`, `iam:PassRole` (for the ECS task role), and possibly `ecs:DescribeTasks`.

6. **Testing Logs:** Ensure the container’s logs go to CloudWatch (via awslogs driver configured in the task def). Verify that the ECS task uses the expected image by checking the task details in AWS console.
Cursor Test Prompt:
markdown
Copy
Test the Playground launch flow:
1. **Precondition:** Verify that a server has a built image in DynamoDB (from step 1). Use a known server ID that was successfully verified.
2. **API Call:** Call the Playground launch API (e.g., via cURL or through the Toolshed UI) for that server ID. The response should confirm a task is starting (maybe return a session ID or task ID).
3. **Verify ECS Task:** Go to the AWS ECS console or use AWS CLI to list tasks in the Playground cluster. Confirm a new task is in `RUNNING` state for the server. Check that its container image is the ECR URI stored in Dynamo.
4. **Connectivity:** If the Playground UI is supposed to interact directly, attempt to send a test request. For example, if the server is an API, use the returned IP/domain to hit a health endpoint. If Toolshed backend proxies, ensure the proxy call reaches the container (watch logs for activity).
5. **No Rebuild:** Confirm that no build pipeline was triggered during this process (e.g., check build logs or timestamps to ensure it reused the existing image).
6. **Edge Cases:** Try launching Playground for a server ID that has no image (not verified) – the API should handle this gracefully (error message).
3. Manual Re-Verification
To allow users to manually trigger the verification (build) process again, we will add a “Re-verify” capability. This will run the same pipeline as when the server was first added, potentially rebuilding the Docker image if there are new changes:
UI Button: In the Toolshed UI, add a Re-verify button (or link) for each server entry (likely in the server detail view or admin panel). This button will call a backend endpoint (e.g., POST /servers/{id}/verify or /servers/{id}/reverify) to start the verification pipeline for that server again.
Backend Endpoint: Implement a new API route that triggers the verification pipeline:
It should identify the server by ID and invoke the same logic used for initial verification: clone/pull the latest code from GitHub, build the Docker image, push to ECR, update DynamoDB, and refresh metadata.
Optionally, include logic to skip rebuild if not needed: For MVP, it’s acceptable to always rebuild on re-verify. In the future, Toolshed can optimize by checking if the GitHub repo’s latest commit SHA is different from the last verified SHA stored in DynamoDB. If they match, you could decide to skip the build and just return (since nothing changed). This requires storing lastVerifiedSha during verification (as noted in Step 1).
If skipping is implemented: on a re-verify request, first use GitHub API to fetch the latest commit hash of the default branch (or the specific commit if the server is pinned to one). Compare it with the stored hash. If same, you might either (a) do nothing and return a message “No changes to verify” or (b) force rebuild anyway if the user explicitly wants (since user pressed the button, perhaps they expect a rebuild regardless; this is a product decision).
Trigger Pipeline: If proceeding with verification, you can reuse the pipeline mechanism. For example, if using AWS CodePipeline or CodeBuild, you might start a CodeBuild project run programmatically for that repo. Or if verification is done via a custom workflow (perhaps a lambda or container job), trigger that. Ensure that concurrent verifications for the same server are either avoided or handled (maybe disable the button while one is running).
Feedback to UI: The user should get feedback that re-verification started (and possibly when it completes or fails). This could be done via polling the server status or via WebSocket/events if available. At minimum, have the re-verify endpoint return a success acknowledgment and update a “verificationStatus” field (which the UI can display as “Verifying…”).
Update Image and Metadata: On a successful re-verify, the new Docker image should replace the old one:
Push the new image to ECR (could be a new tag, e.g., update the tag to the new commit SHA or increment version).
Update the DynamoDB entry’s imageUri to the new image. If using the same ECR repository and tag name (like always “latest” for that server), the URI might remain the same – but you’d still update any version info and lastVerifiedSha.
Regenerate documentation/metadata via OpenAI again if needed (especially if the code changed significantly).
Possibly mark a timestamp or increment a version counter for how many times verified.
Integration Points: In the frontend code (maybe a React component or similar), add the button and an API call on click. In the backend, create a handler in lib/verification or a controller in routes to handle the POST reverify. This can likely call an existing function (refactor the initial verification logic into a reusable function that can be called for reverify). Also integrate with whatever job system runs the pipeline (could be invoking the same CodeBuild project but with different parameters). Cursor Implementation Prompt:
markdown
Copy
**Task:** Add a manual “Re-verify” capability for servers.

1. **UI Changes:** In the front-end (e.g., React component for server details or management):
   - Add a "Re-verify" button next to each server (only for verified servers, or always available).
   - When clicked, call the backend API (e.g., `POST /api/servers/{serverId}/reverify`). Provide visual feedback (disable the button and show a spinner or status like "Re-verifying...").

2. **Backend Route:** Implement a new API endpoint in the server controller (e.g., add a handler in `pages/api/servers/[id]/reverify.ts` if Next.js API routes, or in Express router):
   - Parse the server ID from the URL.
   - Fetch the server record from DynamoDB to get info like repo URL and lastVerifiedSha.
   - (Optional) Check GitHub for latest commit SHA: Use GitHub API or `git ls-remote` to get the HEAD SHA of the repository. Compare with `lastVerifiedSha`. If they are equal and optimization is desired, you could respond with 304 Not Modified or a message "No new commits to verify." If proceeding or skipping this check, continue.

3. **Trigger Verification Pipeline:** Reuse the existing verification logic:
   - If verification is implemented via an AWS Step Function, Lambda, or direct CodeBuild invocation, call that from here. For example, if there is a function `verifyServer(serverId)` or a CodeBuild project per server, invoke it.
   - Pass necessary parameters (repo URL, ECR repo info, etc.). Ensure the pipeline knows this is a re-verify (if it needs to handle differently; likely it behaves the same as initial verify).
   - Immediately return a response to the UI (status 202 Accepted perhaps) that re-verification has started. You might include a new `verificationStatus` field in DynamoDB set to "pending" or similar.

4. **Post-Verification Update:** The pipeline itself will handle building and updating the image and metadata (as in steps 1 and 4). When it completes:
   - Update `lastVerifiedSha` in DynamoDB (to the new commit).
   - If new image built, update `imageUri` (or if using static tag like "latest", the URI stays but you may update an `imageUpdatedAt` timestamp).
   - Reset `verificationStatus` to "verified" or update any UI-facing status.

5. **UI Feedback:** Optionally implement a way for the UI to know when the process is done. This could be done by periodically refreshing the server info from the DB via an API (`GET server/{id}`) to see if `verificationStatus` changed to "verified" or if `imageUri` updated (indicating completion).

6. **Edge Cases:** Prevent multiple simultaneous re-verifications. If a pipeline is already running for a server, the endpoint should detect that (maybe a flag in DB) and reject or ignore additional requests.
Cursor Test Prompt:
markdown
Copy
Test the manual re-verification process:
1. **Initial Setup:** Use a server that is already verified (from prior tests). Note its current `imageUri` and `lastVerifiedSha` from DynamoDB.
2. **Trigger Re-verify:** Click the "Re-verify" button in the UI (or POST to the endpoint manually). Ensure you receive a confirmation response.
3. **During Verification:** Check that the pipeline/build process starts (e.g., a new CodeBuild build appears, or logs start streaming). The UI should indicate an ongoing verification (if implemented).
4. **After Completion:** Once finished, verify the outcomes:
   - The DynamoDB record for the server should have an updated `imageUri` (perhaps a new tag if you tagged by commit) and updated `lastVerifiedSha` (if code changed).
   - If the code was unchanged and you implemented SHA check to skip rebuild, verify that the pipeline was skipped and the UI perhaps showed "Up-to-date" (depending on implementation).
   - Check ECR: a new image tag (or updated latest tag) should be present if rebuild happened. The repository might show multiple tags (previous and new) if you didn’t overwrite.
   - The generated metadata (description/docs) might have updated if the code changed (check description field or S3 doc).
5. **No Changes Scenario:** Try re-verify on a repo with no new commits (if you didn’t implement skip, it will rebuild the same image). Ensure it still completes successfully and doesn’t create duplicate entries (it might just push a duplicate image or skip push if tag exists).
6. **Error Handling:** Try with an intentionally broken commit (if possible) to see that a failed re-verify doesn’t overwrite the last good image (the pipeline should report failure, and ideally the Dynamo entry remains pointing to the last good image).
4. Documentation and Metadata Inference
To enhance the information available for each server, Toolshed will automatically generate documentation and infer metadata after verification. This uses an LLM (e.g., OpenAI’s GPT-4 or GPT-3.5) to analyze the server’s repository and produce human-readable descriptions and docs:
When to Generate: After a server’s verification pipeline successfully builds and runs the server (meaning the code is valid and container runs), trigger a step to collect data for documentation. This could be done as part of the pipeline (immediately after build) or as an asynchronous post-processing step. Doing it within the pipeline ensures it’s done right away, but doing it asynchronously (e.g., a separate Lambda triggered by a message or Dynamo stream) can decouple it and not slow down the main pipeline.
What to Generate: At minimum, fill in a Description and Language for the server if not already provided by the user:
Description: A few sentences describing what the server does. If the repository has a README or documentation, the LLM can summarize that. Otherwise, it might infer from the code structure (e.g., looking at class names, functions).
Language: Determine the primary programming language (this might be inferred from repository contents or the Dockerfile base image). This could be done via simple logic (e.g., presence of package.json -> JavaScript, requirements.txt -> Python, etc.), but the LLM can also guess (though it's probably easier to do directly).
API Documentation: If the server is an API, attempt to document its endpoints. For example, if it’s a REST API, you might have it list the routes and their purpose. If there's an OpenAPI spec or similar in the repo, that’s ideal to feed in. Otherwise, the LLM can read controller or route definitions in code (if provided) and produce an outline of the API.
Using OpenAI API: Construct prompts to send to the OpenAI API:
Prepare context: possibly provide the content of certain files. For instance, you can send the README, or a list of file names and key code excerpts (like function definitions or route handlers). Keep context size in mind; use GPT-4 for better quality if available.
Example Prompt (for description/language): “Analyze the following repository information and provide: (1) a brief description of the server’s purpose, and (2) the primary programming language used. Repository info: [include relevant info].”
Example Prompt (for API endpoints): “Here is the code for the server’s API routes (or an OpenAPI YAML). Generate a summary of the API endpoints, including their URL paths, methods, and a short description of what each does.”
You might do this in one combined prompt or separate calls. Possibly separate: one for description/language, one for endpoints, to simplify parsing the answer.
Use the OpenAI completion (or chat completion) API with a reasonably large model. Parse the response to extract the needed fields.
Storing Documentation: Once generated, store the results. You can add new fields in DynamoDB for description and language. For more detailed docs (like a full API docs markdown), consider storing in S3:
For example, create an S3 object like docs/<server-id>.md containing the markdown or JSON documentation. In DynamoDB, store a reference URL or an S3 key.
Alternatively, if the docs are short, they could be stored in DynamoDB as strings (keeping in mind Dynamo item size limits if it’s lengthy).
Updating UI: The Toolshed UI can display this metadata. The description and language can be shown in the server listing or detail page. The API documentation link can be provided for users to read more. This makes the Toolshed platform more informative without relying on the user to manually input details.
Error Handling: If the OpenAI API call fails or times out, handle gracefully. The system should not fail the entire verification if docs generation fails. Simply log the error and maybe retry later or mark that docs aren’t available. Since this is supplementary, it can be eventually consistent (you could even show “Documentation is generating...” and fill in later).
Cost Consideration: Generating documentation with an LLM for every verification can be costly, depending on repo size and model used. For MVP, perhaps only do this for new servers or when a description is missing (avoid doing it on every re-verify unless needed). You could also use a cheaper model (GPT-3.5) for a first pass, and maybe GPT-4 for more complex ones.
Integration Points: Modify the backend after verification success. If using CodeBuild, one approach is to have CodeBuild invoke a post-build Lambda (via AWS SDK) or send an SNS message that triggers a Lambda to do the OpenAI call (to avoid keeping CodeBuild running while calling external API). Alternatively, after verification in backend code, just call a function to generate docs. Implement this likely in a new module, e.g., lib/metadata.ts or within lib/verification as a final step. It will use OpenAI API (make sure API keys are configured securely, e.g., stored in AWS Secrets Manager or environment variable). Also ensure network access or VPC endpoints as needed for the API call (if running in a restricted environment). Cursor Implementation Prompt:
markdown
Copy
**Task:** Automatically generate server metadata (description, language, API docs) using OpenAI after verification.

1. **Add Post-Verification Hook:** In the verification pipeline code (after pushing image and updating DynamoDB), add a step to kick off documentation generation. This could be:
   - A direct function call (if the verification runs in a long-lived context).
   - Or an asynchronous trigger (e.g., send a message to an SQS queue or EventBridge, where a separate consumer Lambda will process it).

2. **Implement Metadata Generator (`lib/metadata.ts`):** Create a module to handle calling the OpenAI API:
   - Read the OpenAI API key from a secure location (env var or secret).
   - Prepare the input prompt. For example, gather the repository content. You might do something simple for MVP: use the repository’s README if available (often contains description and usage). If README is not present or not informative, you could send a list of top-level files and any notable code.
   - For language detection: This might be inferred by just checking file extensions (you can implement a quick check before even calling AI). But you can also include a direct question in the prompt, like “This repository contains X, Y, Z files. What programming language is primarily used?”

   Example combined prompt for GPT-4:
You are an AI assistant that summarizes software projects. I will provide information about a project's repository. Please:
Identify the primary programming language.
Provide a 2-3 sentence description of what the project (server) does.
If the project exposes an API, list the API endpoints with brief descriptions. Repository details:
README.md: "<content or summary of readme>"
Key files: app.py (Python Flask app with routes ...), ...
markdown
Copy
(The above is a pseudo-prompt; in implementation, include real content snippets.)

- Call `openai.createChatCompletion` or `openai.Completion` as appropriate with the model (e.g., `gpt-4` or `gpt-3.5-turbo`) and the prompt.
- Parse the response. You may get a text that you need to split into the requested parts. Ideally, ask for a structured format (like JSON) to easily parse: e.g., ask the assistant to output JSON with keys `language`, `description`, `api_endpoints`.
- Handle token limits by trimming input content if necessary (focus on relevant parts).

3. **Store Results:** Once the response is parsed:
- Update the DynamoDB record for the server: set `description` and `language` attributes.
- For `api_endpoints` or detailed docs, if you got a structured or lengthy description, upload it to S3:
  * Use the AWS SDK S3 client to put an object, e.g., `docs/{serverId}.json` or `.md`.
  * The content could be a markdown or JSON documentation. Alternatively, store it in Dynamo if small. But likely API details might be multi-paragraph, better to store in S3.
- Update DynamoDB to set a flag or link, for example `docsUrl = s3://...` or a boolean `docsGenerated = true`.

4. **UI Integration:** Ensure the UI knows to display this info. For instance, if `description` field is now present, show it in the server’s card or page. If `language` is present, maybe show a language tag/badge. If docs are available (S3 link), the UI could show a “View API Docs” button that opens a modal or page with that content (you might need an API to fetch that content from S3 and return to UI, or make S3 objects public if that’s acceptable).

5. **Testing & Debugging:** Because LLM output can be unpredictable, add logging for the prompt and response (perhaps only in debug mode) to fine-tune if results are poor. You can iterate on the prompt design for clarity. Also, guard against the model being hallucinating – cross-check that the language it returns is one of the repository languages (you can compare with your own detection).
Cursor Test Prompt:
markdown
Copy
Validate the metadata generation pipeline:
1. **Trigger Verification:** Use a repository that has a clear purpose (e.g., a sample API server with a README). Verify the server through Toolshed.
2. **Check Logs:** In the backend logs or monitoring, ensure the OpenAI API call was made. Log output might show a prompt was sent.
3. **Post-Verification Data:** After verification completes, inspect the DynamoDB entry for the server:
   - It should now have a `description` (a short text) and `language` (e.g., "Python", "JavaScript") filled in.
   - If an `apiDocs` or S3 reference is used, check that as well (maybe a field like `docsUrl` or `apiSummary`).
4. **UI Display:** Open the Toolshed UI for that server. Confirm that the description text is visible and the language is indicated. If API docs were generated, click the “View API Docs” (or whatever UI element) to see the content. It should list endpoints if the server had any. (For example, if the server was a Flask app with routes, see if those routes are described.)
5. **Content Quality:** Review the generated description and docs to ensure they make sense and are accurate. They should align with the actual project. If something is clearly incorrect (e.g., wrong language or nonsense description), it indicates the prompt may need refinement. This is a chance to adjust the prompt template.
6. **Edge Cases:** Try a server with very minimal documentation in the repo. The LLM might struggle. Ensure that even if the result is “Not enough info,” the system handles it (perhaps leaving description blank or a default message). Also test that repeated verifications update the description if the project changed significantly (though you might decide to not overwrite an existing manual description).
5. Playground Launch Pipeline
Designing the Playground launch as a short-lived container execution involves orchestrating ECS tasks and managing their lifecycle for interactive use. Key considerations are fast startup, low latency interaction, and safe teardown:
On-Demand Task Launch: As described in Step 2, each Playground session spawns a new ECS Fargate task with the server’s container. This task should ideally start quickly. While Fargate startup typically takes tens of seconds, we can improve perceived responsiveness by doing some of the following:
Pre-pulling images: Fargate will automatically cache recently used images on underlying infrastructure​
docs.aws.amazon.com
, so subsequent launches of the same image are faster. There’s no direct control over this, but using the same image tag (like reusing “latest” for a server) increases chance of cache hits.
Resource sizing: Choose appropriate CPU/memory for tasks so they don’t cold-start slowly. Very large images or high memory tasks might schedule slower.
Minimal boot time: Ensure the container’s entrypoint starts the server quickly (maybe avoid long warm-up in the image).
Interactive Access: Once the task is running, the user needs to interact with it. Common approaches:
Direct Access: Assign the task a public IP and open a port. For example, if the server runs on port 80 internally, map it and allow the security group to access it. Then the Toolshed UI could directly call that IP. This is simpler but exposes the container to the internet (though one could restrict the SG to the user’s IP but that’s complex in real-time).
Proxy via Backend: A safer approach is to keep the task in a private subnet (no public IP) and let the Toolshed backend communicate with it (since the backend is within the same VPC). The backend can proxy API calls or provide a web UI (like a terminal or a dedicated UI) to interact. This way, the container isn’t directly exposed, and access can be controlled.
For MVP, direct access with a temporary public IP might be okay if the data isn’t sensitive (maybe easier to implement initially, just need to manage security group).
Teardown and Timeouts: To avoid tasks running forever (and incurring cost), implement a timeout:
Decide a reasonable session duration (e.g., 15 minutes of inactivity or 30 minutes total). After that, the container should be stopped.
Implementation: You can note the start time in a DB or in-memory. A background job or scheduled Lambda can periodically scan for tasks older than the limit and call StopTask on them. Alternatively, when launching via ECS, you can pass an environment variable to the container like TTL=900 and have the container exit itself after that time (if you have control of the container code).
Provide a way for the user to manually terminate the session (e.g., a "Stop" button in UI that triggers the backend to stop the ECS task).
Ensure that even if the user closes the browser, the task will still get cleaned up via the timeout.
Task Reuse (Optional): If a user restarts the Playground for the same server in quick succession, you could reuse an existing running task if one is still healthy (to save startup time). However, this complicates tracking. For MVP, probably start fresh each time, but it's a possible optimization: keep a task running for a short buffer period in case the user reconnects or triggers again.
Observability: Enable CloudWatch Logs for the tasks so developers can debug what happens during Playground sessions. Each task’s stdout/stderr should go to a log group (you can name it per server or a common “Toolshed/Playground” log group). This helps in seeing if the container started successfully and what happened during interaction​
dev.to
. Also, use CloudWatch metrics or ECS event streams to monitor task lifecycle (you can get events when task stopped, etc., possibly integrate with the cleanup logic).
Security Best Practices: Use a specific IAM role for the Playground tasks with least privileges (if the server code needs AWS access, consider that; otherwise, limit it). The security group for tasks should ideally only allow traffic from the Toolshed application or the user. Also ensure no sensitive data persists: tasks are ephemeral, and any data created should be in-memory or temp only. Tasks will be killed, so state won’t persist unless the server writes to some external store (which is outside Playground scope).
Cost Control: Fargate is billed per second of usage, so ensure tasks stop when idle. Consider using smaller task sizes for less resource-intensive servers. For example, many simple servers can run in 0.25 vCPU, 0.5GB RAM which is cheaper. Possibly allow configuring this per server if needed (store in metadata if some need more).
User Experience: The Playground should indicate when the server is starting (since there might be a ~10s delay). Show a loading indicator “Starting server…”. Once running, allow the user to send requests or whatever the UI does. After timeout or stop, inform the user the session ended.
Integration Points: Much of this is an extension of Step 2’s implementation. We may need to add:
A background cleanup process: could be a small Lambda scheduled (via CloudWatch events) to run every N minutes to kill old tasks. We can implement it in lib/aws/ecs.ts as a function to list running tasks with a certain tag (maybe tag tasks with serverId or launchTime via ECS Task Tags). AWS ECS allows adding tags to tasks on run; use that to mark tasks with e.g. toolshedSession=true and serverId=<id>. The cleanup job can filter by these and terminate appropriately.
UI changes: Possibly a “Stop Session” button, and auto timeout front-end countdown.
Logging/Monitoring: ensure the ECS Task Execution Role includes permission to create log streams, etc. (The default ecsTaskExecutionRole has this managed policy).
Cursor Implementation Prompt:
markdown
Copy
**Task:** Finalize the Playground container launch pipeline with proper startup feedback, teardown, and logging.

1. **ECS Task Definition Refinement:** In the ECS runTask call (from Step 2), add:
   - **Tags:** When calling `runTask`, include `tags=[ { key: 'ToolshedSession', value: 'true' }, { key: 'ServerId', value: serverId } ]`. Also tag with a timestamp or unique session ID if desired.
   - **Task Stop Timeout:** In the task definition, you can set the `stopTimeout` (the time given to container to shut down on stop) to a small value if needed (default is 30 seconds). This isn’t the session timeout, but how long to wait after issuing stop before force kill.
   - **EntryPoint/Command:** Ensure that if the container needs any specific command to run (if not already in the image’s CMD) you provide it. Often the Dockerfile’s CMD covers it, so likely no override is needed.

2. **Backend Session Tracking:** In the backend, after launching the task, store the start time. For example, you could store an item in a DynamoDB table `PlaygroundSessions` with `sessionId`, `serverId`, `taskArn`, `startTime`. Or simply note it in memory if the backend is long-running (but a persistent store is safer in case the backend restarts).
   - This will be used for cleanup. Also could be used to query status (UI could ask if task is still running).

3. **Auto-Teardown Lambda:** Use AWS CDK to create a scheduled Lambda (or use an existing cron job mechanism) that runs, say, every 5 minutes:
   - This Lambda will use ECS ListTasks API to find running tasks with the `ToolshedSession` tag. For each, check how long it’s been since `startTime` (you might encode startTime in the task itself via tag or store in Dynamo as above).
   - If a task exceeds the threshold (e.g., > 15 minutes), call `StopTask` for that task ARN.
   - Also, remove its entry from the `PlaygroundSessions` store if you have one.
   - Make sure this Lambda has permissions: `ecs:ListTasks`, `ecs:DescribeTasks`, `ecs:StopTask`, `dynamodb:Scan/DeleteItem` (if Dynamo tracking).

4. **UI Enhancements:** 
   - Show a status when launching Playground: e.g., “Launching container, please wait…”. The backend can immediately respond, but the container may not be ready. You can poll the backend for readiness or use a small delay then allow user to send requests.
   - Provide a “End Session” button for the user to manually stop the container. This would call a backend endpoint like `DELETE /playgroundSession/{id}` which triggers ECS `StopTask` immediately for that session.
   - Possibly show a countdown or message: “Session will terminate after 15 minutes of inactivity.”

5. **CloudWatch Logs:** Verify that each ECS task’s logs are streaming. Each task should create a log stream (e.g., named by task ID). In CDK, create a CloudWatch Log Group for these logs (e.g., `/aws/ecs/toolshed-playground`) with retention as needed. The task definition config from Step 2 should be sending logs here. This allows developers to see output. 
   - (If using the default ECS execution role and you specified logging in task def, this should already work. Just ensure the log group exists or is created automatically.)

6. **Testing Multiple Sessions:** Consider concurrency:
   - Two different users launching the same server should create two separate tasks. This is fine (just more cost). They’ll have distinct session IDs. Both should be cleaned up eventually.
   - One user launching two different servers results in two tasks (should work).
   - One user launching the same server twice in a row quickly: you might end up with two tasks unless you prevented that. For MVP it's okay, but maybe handle by disabling the launch button if a session is active.

7. **Costs Monitoring:** Optionally, add CloudWatch alarms or metrics to monitor cost-related aspects, e.g., alarm if there are too many concurrent playground tasks or if a task runs too long (in case cleanup fails). This helps ensure the feature doesn’t run away in cost.

8. **Documentation for Use:** Finally, update Toolshed documentation to explain that Playground sessions are temporary and will shut down automatically. This sets user expectations.
Cursor Test Prompt:
markdown
Copy
Comprehensive testing of the Playground pipeline:
1. **Startup Timing:** Launch a Playground session for a server and measure the time from clicking "Launch" to being able to hit the server’s endpoint. It should be reasonably short (~10-30 seconds). Check that the UI’s loading state covers this duration.
2. **Functional Interaction:** Once the container is running, use the Playground UI to interact (e.g., send test API calls). Verify you receive responses from the container as expected. (For example, if it’s an echo server, it returns the expected output.)
3. **Manual Stop:** Click the "End Session" button (if implemented). Ensure that the ECS task transitions to `STOPPED` shortly after. In AWS console or via `DescribeTasks`, confirm the task was stopped by the user request. Also ensure UI reflects that the session ended (and perhaps the “Launch” button becomes available again).
4. **Auto Timeout:** Start another session, but this time do not manually stop it. Wait for the configured timeout (e.g., 15 minutes) + a few minutes buffer. Check that the cleanup Lambda (or process) stops the task. In CloudWatch Logs for the cleanup Lambda, you should see it identified and stopped the task. The ECS task should no longer be running after the timeout.
5. **Repeated Launches:** Immediately after a session stops, try launching again for the same server. It should start a new task successfully. (This tests that cleanup of the old one frees the way for new one. If you reused task definitions, make sure they still work for subsequent runs.)
6. **Multiple Concurrent Sessions:** Launch Playground for two different servers (or two different sessions of the same server, if allowed). Ensure both tasks run independently without interfering. Check that both are listed in ECS. Interact with both (maybe open two browser windows) to confirm isolation.
7. **Logging Verification:** Go to CloudWatch Logs and find the log streams for the tasks. Ensure that logs from the container (e.g., startup messages, request logs) are present. For example, if the container prints "Server started on port X", verify that appears in the logs. This confirms observability is working.
8. **Security Check:** If possible, try to access the container’s endpoint from a source that shouldn’t have access (for instance, if configured to only allow proxy, try hitting the public IP directly when it should be internal, or vice versa). Ensure that your security rules are correctly restricting access as designed.
6. Infrastructure and Code Integration
With the above features, several parts of the Toolshed codebase and AWS infrastructure need updates. This section summarizes the integration points and ensures everything works together in harmony:
CDK Infrastructure Updates
ECR Repository: Define an ECR repository for storing server images. In your CDK (Cloud Development Kit) stack (likely where DynamoDB and other resources are defined), add:
new Repository(this, 'ToolshedServerRepo', { repositoryName: 'toolshed/mcp-servers' }) (for example). You might use a naming convention or separate repos per server; for MVP, one repo is fine.
Output the repository URI or name for use in pipeline.
Assign lifecycle rules if desired (e.g., to clean up old images after certain count to save space).
Permissions for CodeBuild/Pipeline: If using CodePipeline/CodeBuild for verification:
The CodeBuild project needs an IAM role. Attach a policy allowing it to do ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability, ecr:PutImage, ecr:CompleteLayerUpload etc (the AmazonEC2ContainerRegistryPowerUser or a similar managed policy can be used). Also allow DynamoDB UpdateItem on the table for server metadata.
These can be set in CDK by adding to the CodeBuild Project definition, e.g., project.addToRolePolicy(new PolicyStatement({...})).
DynamoDB Table: Ensure the table that stores server metadata has the capacity or indexes needed. We are adding new attributes (imageUri, imageTag, description, language, etc) but these don’t require new indexes unless we plan to query by them. Likely not needed to create new indexes now. Just ensure the table’s name is accessible to all components (store it in an env var for Lambdas, etc).
ECS Cluster and Task Role: Set up an ECS Fargate cluster for Playground tasks:
In CDK, new ecs.Cluster(this, 'ToolshedPlaygroundCluster', { vpc }). If Toolshed already has a VPC and subnets, use those. Ensure they have network connectivity (NAT gateway for pulling images if in private subnets).
If not using an existing cluster, this will provision one (which in Fargate case is just a logical grouping).
Define a Fargate task execution IAM role (if not using the default one). AWS provides a managed policy AmazonECSTaskExecutionRolePolicy that covers pulling from ECR and logging to CloudWatch. Use that on the task execution role.
Security Group for tasks: If tasks need to be accessed from the internet (for Playground direct), create an SG that allows inbound on the necessary port (e.g., 80/8080) from the Toolshed web (or 0.0.0.0/0 for simplicity in dev, but lock down in prod). If tasks are only accessed by backend, allow inbound from the backend’s SG or VPC range.
Store cluster name and possibly default task role ARN in configuration (so backend knows what to use).
Cleanup Lambda: As described, add a Lambda Function in CDK for cleanup. Its code can live in the Toolshed repository (perhaps in lib/cleanup.ts). Schedule it using Rule.schedule (EventBridge Cron) to run at intervals. The lambda needs environment variables for cluster name, and maybe the DynamoDB table name (if it reads session info).
Give the Lambda an IAM policy to stop tasks in the cluster and to read/write the Dynamo table if used.
OpenAI API Key Storage: For the metadata generation, store the API key securely:
In CDK, you can use AWS Secrets Manager. Manually create a secret with the OpenAI API key, or store it as a Parameter in SSM Parameter Store.
The lambda or service that calls OpenAI should retrieve this at runtime. You might pass the secret ARN as an env var and use AWS SDK to get it.
Ensure to not hardcode the API key in code or config.
CI/CD Pipeline Adjustments: If Toolshed itself is deployed via CDK pipeline, ensure these new resources (ECR, cluster, lambda) are included so they get provisioned. Also possibly break the deployment into stages:
First deploy infrastructure changes (to create ECR, etc.), then run any code changes. (E.g., you might push images for the cleanup lambda if using container image for it, etc.)
Backend Code Integration
Verification Logic (lib/verification): Refactor this into a function that can be called for both initial add and re-verify. It should accept a server ID or repo info, then coordinate: build -> ECR push -> DB update -> docs generation. This function might orchestrate AWS services or dispatch to CodeBuild. Ensure it’s idempotent and handles errors properly.
DynamoDB Access (lib/db): Update the data models for the server. If using a strongly typed model, add fields for imageUri, imageTag, description, language, etc. Adjust any create/update functions to include these fields when provided. For example, after verification, call db.updateServer(id, { imageUri, imageTag, lastVerifiedSha, description, language }).
AWS Integrations (lib/aws): Add helpers:
lib/aws/ecr.ts – for ECR operations (login, push possibly if not using CodeBuild for that).
lib/aws/ecs.ts – functions to run and stop tasks, perhaps to register task definitions if needed.
lib/aws/github.ts – (if needed) to fetch latest commit SHA for re-verify optimization.
lib/aws/openai.ts – to call OpenAI API (wrap the HTTP calls).
lib/aws/dynamo.ts – if not already, to abstract Dynamo interactions (though lib/db might suffice).
API Routes/Controllers: Add the new endpoints:
POST /servers/{id}/reverify (as implemented in Step 3).
POST /servers/{id}/playground (or POST /playground with body containing serverId) for launching a session.
DELETE /playground/{sessionId} for stopping a session (if implementing manual stop).
Possibly GET /servers/{id}/docs if the UI will fetch docs via the backend (which would retrieve from S3 or DB).
Event Handling: If using asynchronous processes (like the cleanup Lambda or an SNS event after verification), ensure the main application and these functions coordinate. For example, after CodeBuild finishes, you might get a CloudWatch event or CodePipeline webhook; handle that to call the docs generator and update status.
Testing: Write unit tests for the new modules if possible (e.g., test that given a fake repo, the pipeline function calls the expected AWS SDK methods; test that the metadata prompt builder returns expected prompt for a known input). Also consider integration tests using localstack or mocking AWS for critical paths (ECS run, Dynamo update, etc.).
UI Updates
Playground UI: Ensure there is a UI component for the Playground. Possibly it’s a dedicated page where users can send input to the server and get output. Connect this UI to the new backend endpoints:
On “Launch Playground”, call the launch API, then either connect to the server or show an interface when ready.
If the Playground is an API explorer, maybe show a small API console. If it’s more interactive (maybe the servers are like bot engines or something), tailor the UI accordingly.
Provide controls to stop the session.
Server List/Detail UI: Display new metadata:
Show the description (if available) in the server’s detail page, or as a tooltip/expandable section in the list.
Show the programming language (could use an icon or label, e.g., “Language: Python”).
If API documentation is available, include a link or section to display it. Perhaps an expandable panel with the list of endpoints and their descriptions, generated by the LLM.
Add the “Re-verify” button with proper styling and a confirmation (maybe ask “Are you sure? It will rebuild the image.”).
Possibly indicate verification status (if a verification is in progress, show a loading indicator or disable some actions).
Feedback & Errors: Handle error responses from new endpoints gracefully. For instance, if Playground launch returns an error (maybe image not found), show a message like “Please verify the server first.” If re-verify fails, show that it failed.
Loading states: As there are asynchronous actions (verify, re-verify, launching container), ensure the UI informs the user and prevents duplicate actions (e.g., disable buttons while action is running).
Cursor Implementation Prompt:
markdown
Copy
**Task:** Update Toolshed’s infrastructure and integrate code changes for all new features.

*CDK Infrastructure:*
1. Open `cdk/toolshed-stack.ts` (or appropriate file). Add an ECR repository:
   ```ts
   const repo = new ecr.Repository(this, 'McpServerRepo', {
     repositoryName: 'toolshed/mcp-servers'
   });
Optionally, add repo.addLifecycleRule({ maxImageCount: 10 }) to keep only last 10 images per repo. 2. Still in CDK, find where the DynamoDB table for servers is defined (e.g., new dynamodb.Table). No schema changes needed, but note the table name for environment config. 3. Define the ECS cluster:
ts
Copy
const cluster = new ecs.Cluster(this, 'PlaygroundCluster', { vpc });
If you have an existing VPC, ensure to reference it. If not, define one or get from context. Also, create a task execution role:
ts
Copy
const taskExecRole = new iam.Role(this, 'TaskExecRole', {
    assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
});
taskExecRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonECSTaskExecutionRolePolicy'));
This role will allow pulling from ECR and CloudWatch Logs. You may pass this role ARN to the application (to use in runTask requests).
Security Group for Fargate tasks:
ts
Copy
const sg = new ec2.SecurityGroup(this, 'PlaygroundTaskSG', { vpc });
sg.addIngressRule(<allow Toolshed backend SG or public>, ec2.Port.tcp(80));
For now, maybe allow 0.0.0.0/0 on port 80 for testing, but restrict in production.
Cleanup Lambda:
ts
Copy
const cleanupFn = new lambda.Function(this, 'PlaygroundCleanupFn', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'cleanup.handler',
  code: lambda.Code.fromAsset('lambda'), // assuming code is in lambda/cleanup.js
  vpc,
  environment: {
    CLUSTER: cluster.clusterName,
    TABLE_NAME: serverTable.tableName
  }
});
cleanupFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ecs:ListTasks','ecs:DescribeTasks','ecs:StopTask'],
  resources: ['*']  // limit cluster ARNs if possible
}));
serverTable.grantReadWriteData(cleanupFn);
And schedule it:
ts
Copy
new events.Rule(this, 'CleanupSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  targets: [ new targets.LambdaFunction(cleanupFn) ]
});
Make sure lambda/cleanup.js (or .ts) will implement the logic to stop old tasks.
Secrets for OpenAI: If using Secrets Manager:
ts
Copy
const openAiSecret = new secretsmanager.Secret(this, 'OpenAISecret', {
  secretName: 'Toolshed/OpenAIKey',
  description: 'API Key for OpenAI'
});
(You can manually set the value after deployment, or if you have it, set secretStringValue.) Grant access to the function that will call OpenAI: e.g., if using a Lambda for docs generation, grant read; if calling from an existing service, ensure its IAM role has permission to secretsmanager:GetSecretValue on this secret.
Output relevant ARNs/names from CDK to use in app config. For instance:
ECR repository URI (for CodeBuild to know where to push).
Cluster name, SecurityGroup ID (for backend ECS calls).
OpenAI Secret ARN (for retrieval).
Backend Code: 8. Update configuration to include:
AWS region, cluster name, etc., for ECS.
Security group and subnet IDs for launching tasks (you might store these in env or config files).
OpenAI secret or API key env var (pull from AWS Secrets in code on startup if needed).
Implement AWS clients (if not already):
Initialize an ECS client (boto3 or AWS SDK JS) with proper region.
Initialize an ECR client if needed (for any image lookup, though not strictly needed if we have URIs).
DynamoDB client (likely exists).
Secrets Manager client (to retrieve OpenAI key if needed).
OpenAI API client (could use openai npm package or direct HTTP via axios/fetch).
Implement all new logic as per previous steps:
In lib/verification, integrate ECR push and call lib.metadata.generateDocs(serverId, repoInfo) after success.
In lib/metadata (new): implement generateDocs using OpenAI as described.
In lib/aws/ecs, implement startPlaygroundTask(serverId, imageUri) and stopPlaygroundTask(taskArn) wrapping ECS SDK calls.
In lib/aws/github (optional): implement getLatestCommit(repoUrl) if using commit check.
In lib/db, add methods like updateServerMetadata(id, updates) to add description/language, etc., and maybe logPlaygroundSession(sessionId, serverId, taskArn, startTime) if using Dynamo to track sessions.
API Endpoints:
Reverify: perhaps in pages/api/servers/[id]/reverify.ts (Next.js) or in Express router router.post('/servers/:id/reverify'). Call the verification function and return a status. Possibly run it async (if long, you might just trigger and immediately respond).
Playground Launch: router.post('/servers/:id/playground') – calls startPlaygroundTask. If synchronous, wait for taskArn and return it along with maybe an connection info (IP or sessionId). Could also just return a sessionId and have another route to check when it's ready.
Playground Stop: router.delete('/playground/:sessionId') – lookup task by sessionId (from DB or a mapping) and call stopPlaygroundTask.
Docs fetch: If storing docs in S3, set up an endpoint to proxy them (or make them public and just give a URL).
Testing: Ensure to run unit tests for new functions:
Mock ECS client and test that startPlaygroundTask passes correct parameters (image, cluster, network).
Test generateDocs with a stub OpenAI client returning a known string, to see if it parses and stores correctly.
Test that reverify triggers the pipeline (this might be integration tested with a dummy pipeline function).
vbnet
Copy

**Cursor Test Prompt:**

```markdown
Perform an end-to-end integration test in a staging environment:
1. **Deploy Infrastructure:** Deploy the CDK changes. Verify in AWS console:
   - ECR repo exists.
   - ECS cluster exists, with security group and cluster name configured.
   - Cleanup Lambda is scheduled (check CloudWatch Events rules).
   - Secrets Manager has the OpenAI key (set it if not).
2. **Run Backend with New Config:** Start the Toolshed backend (or deploy if it’s serverless). Ensure it has access to new env vars (cluster name, etc.). Confirm it can retrieve the OpenAI API key (for example, a log on startup that it loaded the key or at least not an error).
3. **Add a New Server (Full Flow):** Through the UI or API, add a new server with a GitHub repo URL.
   - The verification pipeline should run: build, push image to ECR, update DynamoDB, call OpenAI for docs.
   - Check ECR: image is there.
   - Check DynamoDB: imageUri, description, etc. are populated.
   - Check UI: the server appears as verified, with description and playground option enabled.
4. **Use Playground:** Launch the Playground for this server from the UI.
   - Confirm the UI indicates it's launching and then ready.
   - Interact with the server (get expected response).
   - After a short while, let it auto-timeout. Verify that the cleanup lambda stops the task (watch logs for the lambda invocation or check ECS tasks list).
5. **Re-verify Server:** Make a change in the server’s repo (e.g., edit a response message) and push to GitHub. In Toolshed, click Re-verify for that server.
   - Ensure the pipeline runs again (maybe via logs or a status indicator).
   - After completion, verify the image in ECR is updated (perhaps a new tag or the same tag updated – if same tag, the image digest will change).
   - DynamoDB `lastVerifiedSha` should update to the new commit.
   - Check that description or docs might update if the change would reflect (in this case maybe not significantly different if it’s a minor code change).
6. **Concurrency & Scaling:** Add another server (repeat step 3 for a second repo). Once both are verified, launch Playground for both simultaneously.
   - Ensure both tasks run and are reachable.
   - This tests that the ECS cluster can handle multiple tasks, and our code properly handles separate sessions.
7. **Negative Test:** Try launching Playground for a server that was never verified or whose imageUri is missing. The backend should respond with an error (and UI should handle it). This ensures we don't attempt to run an undefined image.
8. **Monitor Logs and Metrics:** Throughout, check CloudWatch Logs:
   - Logs from the verification CodeBuild (if available).
   - Logs from our backend (should show calls to ECS and OpenAI).
   - Logs from ECS tasks (to verify container output).
   - Logs from cleanup lambda (should show it running and stopping tasks).
   - Check CloudWatch metrics for ECS CPU/memory if curious, and ensure no alarms fired unexpectedly.
9. **Security Review:** Confirm that no confidential data is logged. The OpenAI prompt or response should not be logged in detail in production (only perhaps in debug), to avoid leaking code. Check that IAM roles are scoped properly (e.g., the backend’s role isn’t overly permissive beyond what’s needed).
10. **User Experience:** Finally, have a user (could be a team member) go through the UI without knowing the internals and see if the features make sense and work intuitively.
7. Testing and Validation
Now that all components are in place, it’s important to thoroughly test and validate the integrated system. We have provided test prompts at each step to guide unit and integration testing. Overall, our testing strategy will cover:
Unit Tests: Validate individual functions (e.g., ECR push logic, OpenAI prompt generation parsing, ECS runTask parameter formation) using mocks for AWS services and the OpenAI API. This ensures our code behaves correctly in isolation.
Integration Tests: Use a staging environment to run end-to-end scenarios:
Adding a new server and verifying that all downstream effects occur (image in ECR, data in DynamoDB, metadata generated).
Launching the Playground and ensuring the container actually runs and is accessible, then auto-stops.
Re-verifying and confirming updates propagate.
Testing error paths (build fails, OpenAI fails, etc.) to see that the system handles them gracefully without crashing other parts.
Performance Tests: Measure how long verification and launch processes take to ensure they meet user expectations. If verification is slow, consider it’s an offline process (user might not mind waiting a bit or can be notified when done). Playground launch should be relatively quick; if not, consider improvements as noted.
Observability Checks: Use the CloudWatch Logs and perhaps X-Ray (if enabled) to trace the flows. Ensure we can debug issues by examining logs (for example, if a Playground container failed to start, the logs should show why).
Security Validation: Double-check that temporary resources (ECR images, ECS tasks) are only accessible as intended. DynamoDB should not have excessive privileges open. Also verify that the OpenAI integration does not expose code or secrets unintentionally (prompts should avoid including sensitive info like AWS keys, etc., which they shouldn’t anyway).
By following this implementation plan and using the provided Cursor prompts for each component, the Toolshed platform will gain robust new capabilities. It will build and manage Docker images efficiently, provide on-demand sandbox environments for each server, keep metadata up-to-date with AI assistance, and maintain a clean, cost-effective operation through automatic teardown and reuse of resources. This enhances the developer experience on Toolshed and streamlines the workflow from code to cloud deployment.