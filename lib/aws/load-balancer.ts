import {
  ElasticLoadBalancingV2Client,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  CreateListenerCommand,
  RegisterTargetsCommand,
  DescribeTargetHealthCommand,
  LoadBalancerTypeEnum,
  ProtocolEnum,
  TargetTypeEnum
} from "@aws-sdk/client-elastic-load-balancing-v2";

// Default configuration for the Application Load Balancer
const DEFAULT_CONFIG = {
  region: process.env.AWS_REGION || 'us-east-1',
  vpcId: process.env.AWS_VPC_ID,
  subnets: (process.env.AWS_SUBNETS || '').split(',').filter(Boolean),
  securityGroups: process.env.AWS_SECURITY_GROUP_ID ? [process.env.AWS_SECURITY_GROUP_ID] : [],
  lbName: process.env.AWS_LOAD_BALANCER_NAME || 'mcp-server-lb',
  targetGroupName: process.env.AWS_TARGET_GROUP_NAME || 'mcp-server-targets',
};

// Create ELB client
const elbClient = new ElasticLoadBalancingV2Client({ region: DEFAULT_CONFIG.region });

/**
 * Create an Application Load Balancer if it doesn't exist
 * 
 * @returns {Promise<{success: boolean, loadBalancerArn?: string, error?: string}>}
 */
export async function ensureLoadBalancer(): Promise<{
  success: boolean;
  loadBalancerArn?: string;
  error?: string;
  dnsName?: string;
}> {
  try {
    // Validate required configuration
    if (!DEFAULT_CONFIG.subnets.length || !DEFAULT_CONFIG.securityGroups.length) {
      console.log('Missing configuration:');
      console.log(`Subnets: ${JSON.stringify(DEFAULT_CONFIG.subnets)}`);
      console.log(`Security Groups: ${JSON.stringify(DEFAULT_CONFIG.securityGroups)}`);
      console.log(`Environment vars: AWS_SUBNETS=${process.env.AWS_SUBNETS}, AWS_SECURITY_GROUP_ID=${process.env.AWS_SECURITY_GROUP_ID}`);
      
      return {
        success: false,
        error: "Missing required AWS configuration: subnets or security groups not defined"
      };
    }

    // First, check if load balancer exists (implementation not shown, would need ListLoadBalancers)
    // For this sample, we'll assume we need to create it

    // Create the load balancer
    console.log(`Creating load balancer ${DEFAULT_CONFIG.lbName}...`);
    const createLbCommand = new CreateLoadBalancerCommand({
      Name: DEFAULT_CONFIG.lbName,
      Subnets: DEFAULT_CONFIG.subnets,
      SecurityGroups: DEFAULT_CONFIG.securityGroups,
      Type: LoadBalancerTypeEnum.APPLICATION,
      IpAddressType: 'ipv4',
    });

    const lbResponse = await elbClient.send(createLbCommand);
    
    if (!lbResponse.LoadBalancers || lbResponse.LoadBalancers.length === 0) {
      return {
        success: false,
        error: "Failed to create load balancer"
      };
    }

    const loadBalancerArn = lbResponse.LoadBalancers[0].LoadBalancerArn;
    const dnsName = lbResponse.LoadBalancers[0].DNSName;
    
    console.log(`Load balancer created with ARN: ${loadBalancerArn}`);
    
    return {
      success: true,
      loadBalancerArn,
      dnsName
    };
  } catch (error) {
    console.error('Error creating load balancer:', error);
    return {
      success: false,
      error: `Error creating load balancer: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Create a target group for the load balancer
 * 
 * @param {object} options - Target group options
 * @param {string} options.vpcId - VPC ID
 * @param {number} options.port - Port to forward traffic to
 * @returns {Promise<{success: boolean, targetGroupArn?: string, error?: string}>}
 */
export async function createTargetGroup(options: {
  vpcId: string;
  port: number;
}): Promise<{
  success: boolean;
  targetGroupArn?: string;
  error?: string;
}> {
  try {
    const createTgCommand = new CreateTargetGroupCommand({
      Name: DEFAULT_CONFIG.targetGroupName,
      Protocol: ProtocolEnum.HTTP,
      Port: options.port,
      VpcId: options.vpcId,
      TargetType: TargetTypeEnum.IP,
      HealthCheckPath: '/',
      HealthCheckProtocol: ProtocolEnum.HTTP,
    });

    const tgResponse = await elbClient.send(createTgCommand);
    
    if (!tgResponse.TargetGroups || tgResponse.TargetGroups.length === 0) {
      return {
        success: false,
        error: "Failed to create target group"
      };
    }

    const targetGroupArn = tgResponse.TargetGroups[0].TargetGroupArn;
    console.log(`Target group created with ARN: ${targetGroupArn}`);
    
    return {
      success: true,
      targetGroupArn
    };
  } catch (error) {
    console.error('Error creating target group:', error);
    return {
      success: false,
      error: `Error creating target group: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Create a listener for the load balancer
 * 
 * @param {object} options - Listener options
 * @param {string} options.loadBalancerArn - Load balancer ARN
 * @param {string} options.targetGroupArn - Target group ARN
 * @param {number} options.port - Port to listen on
 * @returns {Promise<{success: boolean, listenerArn?: string, error?: string}>}
 */
export async function createListener(options: {
  loadBalancerArn: string;
  targetGroupArn: string;
  port: number;
}): Promise<{
  success: boolean;
  listenerArn?: string;
  error?: string;
}> {
  try {
    const createListenerCommand = new CreateListenerCommand({
      LoadBalancerArn: options.loadBalancerArn,
      Protocol: ProtocolEnum.HTTP,
      Port: options.port,
      DefaultActions: [
        {
          Type: 'forward',
          TargetGroupArn: options.targetGroupArn
        }
      ]
    });

    const listenerResponse = await elbClient.send(createListenerCommand);
    
    if (!listenerResponse.Listeners || listenerResponse.Listeners.length === 0) {
      return {
        success: false,
        error: "Failed to create listener"
      };
    }

    const listenerArn = listenerResponse.Listeners[0].ListenerArn;
    console.log(`Listener created with ARN: ${listenerArn}`);
    
    return {
      success: true,
      listenerArn
    };
  } catch (error) {
    console.error('Error creating listener:', error);
    return {
      success: false,
      error: `Error creating listener: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Register a Fargate task with the target group
 * 
 * @param {object} options - Registration options
 * @param {string} options.targetGroupArn - Target group ARN
 * @param {string} options.privateIp - Private IP of the Fargate task
 * @param {number} options.port - Port the container is listening on
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function registerTarget(options: {
  targetGroupArn: string;
  privateIp: string;
  port: number;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const registerTargetsCommand = new RegisterTargetsCommand({
      TargetGroupArn: options.targetGroupArn,
      Targets: [
        {
          Id: options.privateIp,
          Port: options.port
        }
      ]
    });

    await elbClient.send(registerTargetsCommand);
    console.log(`Registered target ${options.privateIp}:${options.port} with target group ${options.targetGroupArn}`);
    
    return { success: true };
  } catch (error) {
    console.error('Error registering target:', error);
    return {
      success: false,
      error: `Error registering target: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Check the health of a target
 * 
 * @param {object} options - Health check options
 * @param {string} options.targetGroupArn - Target group ARN
 * @param {string} options.privateIp - Private IP of the Fargate task
 * @param {number} options.port - Port the container is listening on
 * @returns {Promise<{success: boolean, healthy?: boolean, error?: string}>}
 */
export async function checkTargetHealth(options: {
  targetGroupArn: string;
  privateIp: string;
  port: number;
}): Promise<{
  success: boolean;
  healthy?: boolean;
  error?: string;
}> {
  try {
    const healthCommand = new DescribeTargetHealthCommand({
      TargetGroupArn: options.targetGroupArn,
      Targets: [
        {
          Id: options.privateIp,
          Port: options.port
        }
      ]
    });

    const healthResponse = await elbClient.send(healthCommand);
    
    if (!healthResponse.TargetHealthDescriptions || healthResponse.TargetHealthDescriptions.length === 0) {
      return {
        success: false,
        error: "No health information available"
      };
    }

    const health = healthResponse.TargetHealthDescriptions[0].TargetHealth;
    const healthy = health?.State === 'healthy';
    
    console.log(`Target ${options.privateIp}:${options.port} health: ${health?.State}`);
    
    return {
      success: true,
      healthy
    };
  } catch (error) {
    console.error('Error checking target health:', error);
    return {
      success: false,
      error: `Error checking target health: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 