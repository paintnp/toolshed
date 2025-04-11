#!/bin/bash

# Set region
REGION="us-east-1"

# List of Load Balancer ARNs to delete
LB_ARNS=(
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-mcp-server/2262ea99f6fb1273"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-server-final/5460a5056318c933"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-server-final-2/871435204bc76589"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-server-final-3/b8dff038ad1488fd"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-server-final-4/c78da982b0ad48d4"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/toolshed-alb-test-server-final-5/f6b0a69dd88cc468"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/ts-088230-github-mcp-test/90c2dfc18f7d06fc"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-669379/0d7b7e2271b02dc8"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-737536/2baf54eb55bee508"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-893458/740a525958340432"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-558300/ef69fdd757ec77fe"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-880513/e826155470c493eb"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-554910/ea841edb714f00ff"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-731401/7e194fe6512a33da"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-227438/2cdc43220b1a89ae"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-474329/36c5023110b9f699"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-668984/2a17441e0de4e7d0"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-201626/b29cd2a985741bf7"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:loadbalancer/app/mcp-alb-377383/ce528d2fc1521629"
)

# List of Target Group ARNs to delete
TG_ARNS=(
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-201626/dd0a3d24251d0e92"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-227438/81199024eb88974a"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-377383/5f28030773f83793"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-474329/b71c8c4e520f2653"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-554910/60e005e75fc79176"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-558300/529a0f75ccd24c97"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-668984/c29af46ecf902bb7"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-669379/671fce170602a2c1"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-731401/ff595a485ac11e64"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-737536/8a84d69b010e0d22"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-880513/62d688fdffef70c7"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/mcp-tg-893458/3917e1dd1b0993d8"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/tg-089767-github-mcp-test/2f6a558570da874a"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/toolshed-tg-test-mcp-server/bc6e5c03700a7356"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/toolshed-tg-test-server-final/6f2e55ecd895a8a9"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/toolshed-tg-test-server-final-2/75603578f2e5a395"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/toolshed-tg-test-server-final-4/94c2119283a1df37"
  "arn:aws:elasticloadbalancing:us-east-1:277502524328:targetgroup/toolshed-tg-test-server-final-5/0e756ab382287df1"
)

# Delete Load Balancers
echo "Deleting Load Balancers..."
for lb_arn in "${LB_ARNS[@]}"; do
  echo "Deleting Load Balancer: $lb_arn"
  aws elbv2 delete-load-balancer --load-balancer-arn "$lb_arn" --region "$REGION"
done

# Wait a bit for load balancers to be deleted
echo "Waiting 30 seconds for load balancers to be deleted..."
sleep 30

# Delete Target Groups
echo "Deleting Target Groups..."
for tg_arn in "${TG_ARNS[@]}"; do
  echo "Deleting Target Group: $tg_arn"
  aws elbv2 delete-target-group --target-group-arn "$tg_arn" --region "$REGION"
done

echo "Cleanup complete!" 