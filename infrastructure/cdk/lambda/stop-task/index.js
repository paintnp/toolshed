const { ECSClient, StopTaskCommand } = require("@aws-sdk/client-ecs");

exports.handler = async (event) => {
  const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
  
  try {
    const stopTaskCommand = new StopTaskCommand({
      cluster: process.env.CLUSTER_ARN || 'ToolShed-Validation-Cluster',
      task: event.taskArn,
      reason: 'Stopped by Step Functions'
    });
    
    await ecsClient.send(stopTaskCommand);
    
    return { 
      success: true, 
      taskArn: event.taskArn 
    };
  } catch (error) {
    console.error('Error stopping task:', error);
    throw error;
  }
} 