import { SSMClient, GetParameterCommand, GetParametersCommand } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Define configuration interfaces
export interface PlaygroundConfig {
  cluster: string;
  subnets: string[];
  securityGroupId: string;
  executionRoleArn: string;
}

export interface ValidationConfig {
  clusterArn: string;
  ecrRepository: string;
  ecrRepositoryUri: string;
  stateMachineArn: string;
  ecsClusterName: string;
}

export interface NetworkConfig {
  subnets: string[];
  securityGroupId: string;
  vpcId?: string;
}

export interface DatabaseConfig {
  tableName: string;
}

// Cache for configurations to minimize SSM calls
const configCache: {
  playground?: PlaygroundConfig;
  validation?: ValidationConfig;
  network?: NetworkConfig;
  database?: DatabaseConfig;
} = {};

/**
 * Centralized function to get parameters from SSM
 * 
 * @param {string[]} parameterNames - Array of parameter paths to retrieve
 * @returns {Promise<Record<string, string>>} - Object mapping parameter names to values
 */
async function getSSMParameters(parameterNames: string[]): Promise<Record<string, string>> {
  try {
    const response = await ssmClient.send(new GetParametersCommand({
      Names: parameterNames,
      WithDecryption: true
    }));
    
    const result: Record<string, string> = {};
    
    // Process successful parameters
    response.Parameters?.forEach(param => {
      if (param.Name && param.Value) {
        // Strip the path prefix to get a simple key
        const key = param.Name.split('/').pop() || param.Name;
        result[key] = param.Value;
      }
    });
    
    // Log which parameters were not found
    if (response.InvalidParameters && response.InvalidParameters.length > 0) {
      console.warn('The following SSM parameters were not found:', response.InvalidParameters);
    }
    
    return result;
  } catch (error) {
    console.error('Error retrieving parameters from SSM:', error);
    return {};
  }
}

/**
 * Get the playground configuration from SSM Parameter Store
 * Falls back to environment variables only if SSM fails
 * 
 * @returns {Promise<PlaygroundConfig>} The playground configuration
 */
export async function getPlaygroundConfig(): Promise<PlaygroundConfig> {
  // Return cached config if available
  if (configCache.playground) return configCache.playground;
  
  try {
    console.log('Loading playground config from SSM Parameter Store');
    
    // Get all required parameters at once
    const params = await getSSMParameters([
      '/toolshed/playground/cluster',
      '/toolshed/playground/subnets',
      '/toolshed/playground/securityGroup',
      '/toolshed/playground/executionRoleArn'
    ]);
    
    // Determine if we got all values from SSM
    const allSSMValuesPresent = 
      params['cluster'] && 
      params['subnets'] && 
      params['securityGroup'] && 
      params['executionRoleArn'];
    
    if (allSSMValuesPresent) {
      const config: PlaygroundConfig = {
        cluster: params['cluster'],
        subnets: params['subnets'].split(','),
        securityGroupId: params['securityGroup'],
        executionRoleArn: params['executionRoleArn']
      };
      
      // Cache the config
      configCache.playground = config;
      return config;
    }
    
    console.warn('Some playground config values missing from SSM, falling back to environment variables');
  } catch (error) {
    console.error('Error loading playground config from SSM:', error);
  }
  
  // Fallback to environment variables (only as a last resort)
  console.log('Using environment variables for playground config');
  
  const config: PlaygroundConfig = {
    cluster: process.env.AWS_PLAYGROUND_CLUSTER || process.env.AWS_ECS_CLUSTER_NAME || process.env.AWS_ECS_CLUSTER || 'ToolShed-Validation-Cluster',
    subnets: process.env.AWS_PLAYGROUND_SUBNETS?.split(',') || process.env.AWS_SUBNETS?.split(',') || [],
    securityGroupId: process.env.AWS_PLAYGROUND_SECURITY_GROUP || process.env.AWS_SECURITY_GROUP_ID || '',
    executionRoleArn: process.env.AWS_EXECUTION_ROLE_ARN || ''
  };
  
  // Log a warning if we're missing values
  if (!config.subnets.length || !config.securityGroupId || !config.executionRoleArn) {
    console.warn('Missing required playground config values in environment variables.');
    console.warn('- Subnets is ' + (config.subnets.length ? 'set' : 'missing'));
    console.warn('- Security Group ID is ' + (config.securityGroupId ? 'set' : 'missing'));
    console.warn('- Execution Role ARN is ' + (config.executionRoleArn ? 'set' : 'missing'));
  }
  
  return config;
}

/**
 * Get validation pipeline configuration from SSM Parameter Store
 * Falls back to environment variables only if SSM fails
 * 
 * @returns {Promise<ValidationConfig>} The validation pipeline configuration
 */
export async function getValidationConfig(): Promise<ValidationConfig> {
  // Return cached config if available
  if (configCache.validation) return configCache.validation;
  
  try {
    console.log('Loading validation config from SSM Parameter Store');
    
    // Get all required parameters at once
    const params = await getSSMParameters([
      '/toolshed/validation/clusterArn',
      '/toolshed/validation/ecrRepository',
      '/toolshed/validation/ecrRepositoryUri',
      '/toolshed/validation/stateMachineArn',
      '/toolshed/validation/ecsClusterName'
    ]);
    
    // Determine if we got all values from SSM
    const allSSMValuesPresent = 
      params['clusterArn'] && 
      params['ecrRepository'] && 
      params['ecrRepositoryUri'] && 
      params['stateMachineArn'] &&
      params['ecsClusterName'];
    
    if (allSSMValuesPresent) {
      const config: ValidationConfig = {
        clusterArn: params['clusterArn'],
        ecrRepository: params['ecrRepository'],
        ecrRepositoryUri: params['ecrRepositoryUri'],
        stateMachineArn: params['stateMachineArn'],
        ecsClusterName: params['ecsClusterName']
      };
      
      // Cache the config
      configCache.validation = config;
      return config;
    }
    
    console.warn('Some validation config values missing from SSM, falling back to environment variables');
  } catch (error) {
    console.error('Error loading validation config from SSM:', error);
  }
  
  // Fallback to environment variables (only as a last resort)
  console.log('Using environment variables for validation config');
  
  const config: ValidationConfig = {
    clusterArn: process.env.AWS_CLUSTER_ARN || '',
    ecrRepository: process.env.AWS_ECR_REPOSITORY || 'toolshed-mcp-servers-v2',
    ecrRepositoryUri: process.env.AWS_ECR_REPOSITORY_URI || '',
    stateMachineArn: process.env.AWS_STATE_MACHINE_ARN || process.env.VALIDATION_STATE_MACHINE_ARN || '',
    ecsClusterName: process.env.AWS_ECS_CLUSTER || 'ToolShed-Validation-Cluster'
  };
  
  // Log a warning if we're missing values
  if (!config.clusterArn || !config.ecrRepositoryUri || !config.stateMachineArn) {
    console.warn('Missing required validation config values in environment variables.');
    console.warn('- Cluster ARN is ' + (config.clusterArn ? 'set' : 'missing'));
    console.warn('- ECR Repository URI is ' + (config.ecrRepositoryUri ? 'set' : 'missing'));
    console.warn('- State Machine ARN is ' + (config.stateMachineArn ? 'set' : 'missing'));
  }
  
  return config;
}

/**
 * Get network configuration from SSM Parameter Store
 * Falls back to environment variables only if SSM fails
 * 
 * @returns {Promise<NetworkConfig>} The network configuration
 */
export async function getNetworkConfig(): Promise<NetworkConfig> {
  // Return cached config if available
  if (configCache.network) return configCache.network;
  
  try {
    console.log('Loading network config from SSM Parameter Store');
    
    // Get all required parameters at once
    const params = await getSSMParameters([
      '/toolshed/playground/subnets',
      '/toolshed/playground/securityGroup',
      '/toolshed/network/vpcId'
    ]);
    
    // For network config, we only need subnets and security group to be valid
    if (params['subnets'] && params['securityGroup']) {
      const config: NetworkConfig = {
        subnets: params['subnets'].split(','),
        securityGroupId: params['securityGroup'],
        vpcId: params['vpcId'] || undefined
      };
      
      // Cache the config
      configCache.network = config;
      return config;
    }
    
    console.warn('Some network config values missing from SSM, falling back to environment variables');
  } catch (error) {
    console.error('Error loading network config from SSM:', error);
  }
  
  // Fallback to environment variables
  console.log('Using environment variables for network config');
  
  const config: NetworkConfig = {
    subnets: process.env.AWS_SUBNETS?.split(',') || [],
    securityGroupId: process.env.AWS_SECURITY_GROUP_ID || '',
    vpcId: process.env.AWS_VPC_ID
  };
  
  // Log a warning if we're missing values
  if (!config.subnets.length || !config.securityGroupId) {
    console.warn('Missing required network config values in environment variables.');
    console.warn('- Subnets is ' + (config.subnets.length ? 'set' : 'missing'));
    console.warn('- Security Group ID is ' + (config.securityGroupId ? 'set' : 'missing'));
  }
  
  return config;
}

/**
 * Get database configuration from SSM Parameter Store
 * Falls back to environment variables only if SSM fails
 * 
 * @returns {Promise<DatabaseConfig>} The database configuration
 */
export async function getDatabaseConfig(): Promise<DatabaseConfig> {
  // Return cached config if available
  if (configCache.database) return configCache.database;
  
  try {
    console.log('Loading database config from SSM Parameter Store');
    
    // Get table name parameter
    const params = await getSSMParameters([
      '/toolshed/dynamodb/tableName'
    ]);
    
    if (params['tableName']) {
      const config: DatabaseConfig = {
        tableName: params['tableName']
      };
      
      // Cache the config
      configCache.database = config;
      return config;
    }
    
    console.warn('Database config value missing from SSM, falling back to environment variable');
  } catch (error) {
    console.error('Error loading database config from SSM:', error);
  }
  
  // Fallback to environment variable
  console.log('Using environment variable for database config');
  
  const config: DatabaseConfig = {
    tableName: process.env.DYNAMODB_TABLE_NAME || 'ToolShedServers'
  };
  
  return config;
}

/**
 * Clear the configuration cache to force fresh values to be loaded
 * Useful for testing or when configuration changes are expected
 */
export function clearConfigCache(): void {
  configCache.playground = undefined;
  configCache.validation = undefined;
  configCache.network = undefined;
  configCache.database = undefined;
  console.log('Configuration cache cleared');
} 