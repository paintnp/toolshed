"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Navigation } from "@/components/Navigation";
import { Terminal, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

function PlaygroundContent() {
  const searchParams = useSearchParams();
  const serverIdParam = searchParams.get('serverId');
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{type: 'input' | 'output', content: any}>>([]);
  const [serverInfo, setServerInfo] = useState<{
    name: string;
    id: string;
    tools: Array<{name: string, description: string}>
  } | null>(null);
  const [playgroundStatus, setPlaygroundStatus] = useState<{
    isLaunching: boolean;
    taskArn?: string;
    endpoint?: string;
    statusMessage?: string;
    ip?: string;
    port?: string;
  }>({
    isLaunching: false
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const statusCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDone = useRef<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commandHistoryStarted, setCommandHistoryStarted] = useState(false);

  // Function to get stored task info from localStorage
  const getStoredTaskInfo = (serverId: string) => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem(`playground_task_${serverId}`);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (e) {
      console.error('Error retrieving stored task info:', e);
      return null;
    }
  };

  // Function to store task info in localStorage
  const storeTaskInfo = (serverId: string, taskArn: string) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(`playground_task_${serverId}`, JSON.stringify({ 
        taskArn, 
        timestamp: Date.now() 
      }));
    } catch (e) {
      console.error('Error storing task info:', e);
    }
  };

  // Function to clear stored task info
  const clearStoredTaskInfo = (serverId: string) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(`playground_task_${serverId}`);
    } catch (e) {
      console.error('Error clearing stored task info:', e);
    }
  };

  // Fetch server details if provided in URL
  useEffect(() => {
    if (serverIdParam) {
      // First check if we have a stored task
      const storedInfo = getStoredTaskInfo(serverIdParam);
      
      if (storedInfo && storedInfo.taskArn) {
        // We have a stored task ARN, set up from localStorage first
        setPlaygroundStatus({
          isLaunching: true,
          statusMessage: "Checking existing playground...",
          taskArn: storedInfo.taskArn,
        });
      }
      
      // Then fetch full server details
      fetchServerDetails(serverIdParam);
    }
    
    return () => {
      // Clean up interval on unmount
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
        statusCheckInterval.current = null;
      }
    };
  }, [serverIdParam]);

  // Scroll to bottom when history updates
  useEffect(() => {
    scrollToBottom();
  }, [history]);

  // Function to fetch server details
  const fetchServerDetails = async (serverId: string) => {
    try {
      setLoading(true);
      setServerInfo(null);

      // Get the server details
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}`);
          
          if (!response.ok) {
        const error = await response.text();
        console.error(`Error fetching server details: ${error}`);
        toast.error(`Failed to fetch server details: ${error}`);
        setLoading(false);
              return;
            }

      const data = await response.json();
      console.log('Server details:', data);
      
      // Ensure tools array exists
      setServerInfo({
        ...data,
        tools: data.tools || []
      });

      // Check if server is verified and has an image
      if (data.status === 'VERIFIED' && data.imageUri) {
        console.log('Server is verified and has an image');
        
        // First check if we have a stored task for this server
        const storedTaskInfo = getStoredTaskInfo(serverId);
        
        if (storedTaskInfo && storedTaskInfo.taskArn) {
          console.log(`Found stored task ARN: ${storedTaskInfo.taskArn}`);
          
          // Check if the task is still running
          setPlaygroundStatus({
            isLaunching: true,
            statusMessage: "Checking existing playground...",
            taskArn: storedTaskInfo.taskArn,
            ip: null,
            port: null,
          });
          
          // Try to recover the existing task
          checkPlaygroundStatus(serverId, storedTaskInfo.taskArn, true);
        } else if (!initialLoadDone.current) {
          console.log('No stored task found, launching new playground');
          // Only launch playground on initial load, not on refresh
          initialLoadDone.current = true;
          // Launch the playground
          launchPlayground(serverId);
        } else {
          // User refreshed the page but we've already loaded once
          console.log('Page refresh detected. Playground not automatically launched to avoid duplication.');
          setPlaygroundStatus({
            isLaunching: false,
            statusMessage: "Click 'Launch Playground' to start a new session",
            taskArn: null,
            ip: null,
            port: null,
          });
        }
      } else {
        // Server is not ready for playground
        if (data.status !== 'VERIFIED') {
          setPlaygroundStatus({
            isLaunching: false,
            statusMessage: `Server is not verified (status: ${data.status})`,
            taskArn: null,
            ip: null,
            port: null,
          });
        } else if (!data.imageUri) {
          setPlaygroundStatus({
            isLaunching: false,
            statusMessage: "Server is verified but has no image",
            taskArn: null,
            ip: null,
            port: null,
          });
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching server details:', error);
      toast.error((error as Error).message || 'Failed to fetch server details');
      setLoading(false);
    }
  };
  
  // Launch the playground for a server
  const launchPlayground = async (serverId: string) => {
    try {
      setPlaygroundStatus({
        isLaunching: true,
        statusMessage: "Launching playground...",
        taskArn: null,
        ip: null,
        port: null,
      });

      console.log(`Launching playground for server: ${serverId}`);
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/playground`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Error launching playground: ${error}`);
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: `Failed to launch playground: ${error}`,
          taskArn: null,
          ip: null,
          port: null,
        });
        return;
      }

      const data = await response.json();
      console.log('Playground launch response:', data);

      if (data.taskArn) {
        // Store the task ARN in localStorage
        storeTaskInfo(serverId, data.taskArn);
        
        setPlaygroundStatus({
          isLaunching: true,
          statusMessage: "Playground launching, waiting for it to be ready...",
          taskArn: data.taskArn,
          ip: null,
          port: null,
        });

        // Start checking the status
        checkPlaygroundStatus(serverId, data.taskArn);
      } else {
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: "No task ARN returned from launch",
          taskArn: null,
          ip: null,
          port: null,
        });
      }
    } catch (error) {
      console.error('Error launching playground:', error);
      setPlaygroundStatus({
        isLaunching: false,
        statusMessage: `Error launching playground: ${(error as Error).message || 'Unknown error'}`,
        taskArn: null,
        ip: null,
        port: null,
      });
    }
  };
  
  const checkPlaygroundStatus = async (serverId: string, taskArn: string, isRecovery = false) => {
    try {
      if (!commandHistoryStarted) {
        setCommandHistoryStarted(true);
      }

      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/playground/status?taskArn=${encodeURIComponent(taskArn)}`);
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`Error checking playground status: ${error}`);
        
        // If we get a 404 or task not found, clear the stored task info
        if (response.status === 404 || error.includes('task not found')) {
          clearStoredTaskInfo(serverId);
          setPlaygroundStatus({
            isLaunching: false,
            statusMessage: isRecovery ? "Previous playground session not found. Launch a new one." : "Playground task not found",
            taskArn: null,
            ip: null,
            port: null,
          });
          
          // Clear the interval if it exists
          if (statusCheckInterval.current) {
            clearInterval(statusCheckInterval.current);
            statusCheckInterval.current = null;
          }
          return;
        }
        
        // For other errors
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: `Failed to check status: ${error}`,
          taskArn: taskArn, // Keep the ARN for retry
          ip: null,
          port: null,
        });
        return;
      }

      const data = await response.json();
      console.log('Playground status:', data);

      // Process the status
      if (data.status === "RUNNING") {
        // Successfully running
        let ip = null;
        let port = null;
        
        // Extract IP and port from endpoint if available
        if (data.endpoint) {
          try {
            const url = new URL(data.endpoint);
            ip = url.hostname;
            port = url.port || '8000'; // Default to 8000 if no port specified
          } catch (e) {
            console.error('Error parsing endpoint URL:', e);
          }
        }
        
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: "Playground is running",
          taskArn: taskArn,
          endpoint: data.endpoint,
          ip: ip,
          port: port
        });
        
        // If we have an endpoint, try to fetch tools
        if (data.endpoint && serverId) {
          try {
            fetchToolsFromMcp(data.endpoint, serverId);
          } catch (e) {
            console.error('Error fetching tools:', e);
          }
        }
        
        // Start the interval if it's not already started
        if (!statusCheckInterval.current) {
          statusCheckInterval.current = setInterval(() => {
            checkPlaygroundStatus(serverId, taskArn);
          }, 30000); // Check every 30 seconds
        }
      } else if (data.status === "PROVISIONING" || data.status === "PENDING") {
        // Still starting up
        setPlaygroundStatus({
          isLaunching: true,
          statusMessage: `Playground is ${data.status.toLowerCase()}...`,
          taskArn: taskArn,
          ip: null,
          port: null,
        });
        
        // Start checking again in 5 seconds
        setTimeout(() => {
          checkPlaygroundStatus(serverId, taskArn);
        }, 5000);
      } else if (data.status === "STOPPED" || data.status === "FAILED") {
        // Task has ended or failed
        clearStoredTaskInfo(serverId);
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: `Playground ${data.status.toLowerCase()}: ${data.reason || 'Unknown reason'}`,
          taskArn: null,
          ip: null,
          port: null,
        });
        
        // Clear the interval if it exists
        if (statusCheckInterval.current) {
          clearInterval(statusCheckInterval.current);
          statusCheckInterval.current = null;
        }
      } else {
        // Unknown status
        setPlaygroundStatus({
          isLaunching: false,
          statusMessage: `Unknown status: ${data.status}`,
          taskArn: taskArn,
          ip: null,
          port: null,
        });
      }
    } catch (error) {
      console.error('Error checking playground status:', error);
      setPlaygroundStatus({
        isLaunching: false,
        statusMessage: `Error checking status: ${(error as Error).message || 'Unknown error'}`,
        taskArn: taskArn, // Keep the ARN for retry
        ip: null,
        port: null,
      });
    }
  };
  
  // Function to stop the playground
  async function stopPlayground() {
    if (!serverInfo?.id || !playgroundStatus.taskArn) {
      return;
    }
    
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverInfo.id)}/playground/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskArn: playgroundStatus.taskArn }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to stop playground');
      }
      
      // Clear status check interval
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
        statusCheckInterval.current = null;
      }
      
      // Clear task from local storage
      if (serverInfo?.id) {
        clearStoredTaskInfo(serverInfo.id);
      }
      
      setPlaygroundStatus({
        isLaunching: false,
        statusMessage: "Playground is stopping..."
      });
      
      toast({
        title: "Playground Stopped",
        description: "The playground environment is being stopped.",
      });
    } catch (e) {
      console.error('Error stopping playground:', e);
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : 'Failed to stop playground',
        variant: "destructive",
      });
    }
  }

  // Execute command
  async function executeCommand(e: React.FormEvent) {
    e.preventDefault();
    
    if (!input.trim() || !serverInfo) return;
    
    const command = input.trim();
    setInput('');
    
    // Add command to history
    setHistory(prev => [...prev, { type: 'input', content: command }]);
    
    try {
      setLoading(true);
      
      const response = await fetch(`/api/servers/${encodeURIComponent(serverInfo.id)}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command
          // No longer need to pass endpoint - server will use taskArn to find container
        }),
      });
      
      if (!response.ok) {
        throw new Error('Command execution failed');
      }
      
      const result = await response.json();
      
      // Add response to history
      setHistory(prev => [...prev, { 
        type: 'output', 
        content: result.output || 'Command executed successfully with no output.'
      }]);
    } catch (error) {
      setHistory(prev => [...prev, { 
        type: 'output', 
        content: 'Error: Failed to execute command. The server may be unavailable.'
      }]);
    } finally {
      setLoading(false);
    }
  }

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // New function to fetch tools from MCP server with serverId parameter
  async function fetchToolsFromMcp(endpoint: string, serverId: string) {
    console.log(`Attempting to fetch tools from MCP server at ${endpoint}`);
    
    try {
      // First try SSE endpoint
      const sseEndpoint = `${endpoint}/sse`;
      console.log(`Trying SSE endpoint via proxy: ${sseEndpoint}`);
      
      // Use our proxy endpoint - pass serverId explicitly
      const proxyResponse = await fetch(`/api/servers/${encodeURIComponent(serverId)}/mcp-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint: sseEndpoint,
          method: 'POST',
          data: {
            jsonrpc: "2.0",
            id: "list-tools-request",
            method: "list_tools"
          }
        })
      });
      
      if (proxyResponse.ok) {
        const result = await proxyResponse.json();
        console.log("Proxy response for list_tools:", result);
        
        if (result.success && result.data) {
          // Parse the tools data
          let tools = [];
          
          // Handle different response formats
          if (result.data.result && result.data.result.tools) {
            // Standard JSONRPC format
            tools = result.data.result.tools;
          } else if (Array.isArray(result.data)) {
            // Some servers return an array directly
            tools = result.data;
          } else if (typeof result.data === 'object') {
            // Some servers return an object with tool definitions
            tools = Object.keys(result.data).map(name => ({
              name,
              description: result.data[name].description || ''
            }));
          }
          
          if (tools.length > 0) {
            console.log("Found tools:", tools);
            
            // Update UI with tools - we need to fetch serverInfo first
            setServerInfo(prev => {
              if (!prev) return null;
              return {
                ...prev,
                tools: tools
              };
            });
            
            // Update history with tools info
            setHistory(prev => [
              ...prev, 
              { 
                type: 'output',
                content: `Server has ${tools.length} tools available.`
              }
            ]);
            
            return;
          }
        }
      }
      
      // If SSE fails or returns no tools, try the HTTP API endpoints
      console.log("SSE list_tools failed, trying HTTP API endpoints");
      await tryHttpToolsApi(endpoint, serverId);
      
    } catch (e) {
      console.error("Error fetching tools from MCP server:", e);
      
      // Try HTTP API as fallback
      await tryHttpToolsApi(endpoint, serverId);
    }
  }
  
  // Fallback to try HTTP API endpoints
  async function tryHttpToolsApi(endpoint: string, serverId: string) {
    const apiEndpoints = [
      `${endpoint}/api/tools`,
      `${endpoint}/tools`,
      `${endpoint}/v1/tools`,
      `${endpoint}/list_tools`
    ];
    
    for (const apiEndpoint of apiEndpoints) {
      try {
        console.log(`Trying HTTP API endpoint via proxy: ${apiEndpoint}`);
        
        // Use our proxy endpoint
        const proxyResponse = await fetch(`/api/servers/${encodeURIComponent(serverId)}/mcp-proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            endpoint: apiEndpoint,
            method: 'GET'
          })
        });
        
        if (proxyResponse.ok) {
          const result = await proxyResponse.json();
          console.log(`Proxy response for ${apiEndpoint}:`, result);
          
          if (result.success && result.data) {
            let tools = [];
            
            // Try to extract tools from different response formats
            if (result.data.tools) {
              tools = result.data.tools;
            } else if (Array.isArray(result.data)) {
              tools = result.data;
            }
            
            if (tools.length > 0) {
              console.log("Found tools:", tools);
              
              // Update UI with tools - use function form to avoid race condition
              setServerInfo(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  tools: tools
                };
              });
              
              // Update history with tools info
              setHistory(prev => [
                ...prev, 
                { 
                  type: 'output',
                  content: `Server has ${tools.length} tools available.`
                }
              ]);
              
              return; // Success, exit loop
            }
          }
        }
      } catch (e) {
        console.error(`Error with ${apiEndpoint}:`, e);
        // Continue to next endpoint
      }
    }
    
    // If all fail, show error
    setHistory(prev => [
      ...prev, 
      { 
        type: 'output',
        content: 'Warning: Could not fetch tools from MCP server. The server may be running but not responding to tool requests.'
      }
    ]);
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6 flex items-center">
          <Terminal className="mr-2" />
          MCP Server Playground
          {serverInfo && (
            <span className="ml-3 text-xl font-normal text-gray-500 dark:text-gray-400">
              - {serverInfo.name}
            </span>
          )}
        </h1>
        
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-row justify-between items-center">
              <p className="text-gray-600 dark:text-gray-300">
                This playground allows you to interact with MCP servers directly. 
                {!serverInfo && " Connect to a server to get started."}
              </p>
              
              {playgroundStatus.taskArn && (
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={stopPlayground}
                  disabled={!playgroundStatus.taskArn || playgroundStatus.statusMessage?.includes("stopping")}
                >
                  Stop Playground
                </Button>
              )}
            </div>
            
            {playgroundStatus.isLaunching && (
              <div className="mt-4 flex items-center text-amber-600 dark:text-amber-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {playgroundStatus.statusMessage}
              </div>
            )}
            
            {!playgroundStatus.isLaunching && playgroundStatus.endpoint && (
              <div className="mt-4 flex items-center text-green-600 dark:text-green-400">
                {playgroundStatus.statusMessage}
                <span className="ml-2 font-mono text-sm">{playgroundStatus.endpoint}</span>
                <a 
                  href={playgroundStatus.endpoint} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="ml-2 text-blue-600 dark:text-blue-400"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
            )}
            
            {serverInfo && serverInfo.tools && serverInfo.tools.length > 0 && (
              <div className="mt-4">
                <h2 className="text-lg font-semibold mb-2">Available Tools:</h2>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.tools.map((tool: any) => (
                    <div 
                      key={tool.name} 
                      className="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded text-sm"
                      title={tool.description || ""}
                    >
                      {tool.name}
                    </div>
              ))}
            </div>
          </div>
            )}
          </CardContent>
        </Card>
        
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 h-[400px] mb-6 flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 font-mono text-sm">
            {history.length === 0 && !serverInfo && (
              <div className="text-gray-500 dark:text-gray-400 italic p-4 text-center">
                Connect to a server to start interacting
              </div>
            )}
            
            {history.map((item, index) => (
              <div key={index} className={`mb-2 ${item.type === 'input' ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                {item.type === 'input' ? '> ' : ''}
                {typeof item.content === 'string' 
                  ? item.content.split('\n').map((line, i) => <div key={i}>{line}</div>)
                  : JSON.stringify(item.content, null, 2)
                }
              </div>
            ))}
            
            {loading && (
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
                  </div>
                  
        <form onSubmit={executeCommand} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={playgroundStatus.taskArn ? "Enter a command..." : "Wait for playground to start..."}
            disabled={!playgroundStatus.taskArn || loading}
            className="font-mono"
          />
                    <Button 
            type="submit" 
            disabled={!playgroundStatus.taskArn || loading || !input.trim()}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Execute
                    </Button>
        </form>
      </main>
    </div>
  );
}

export default function Playground() {
  return (
    <Suspense fallback={
      <div className="flex flex-col min-h-screen">
        <Navigation />
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
        </div>
      </div>
    }>
      <PlaygroundContent />
    </Suspense>
  );
} 