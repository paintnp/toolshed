'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function AddMCPServerDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  
  // New states for the verification flow
  const [isVerifying, setIsVerifying] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  const [executionArn, setExecutionArn] = useState<string | null>(null);

  const extractRepoFromUrl = (url: string): string | null => {
    // Handle different GitHub URL formats
    try {
      const githubRegex = /github\.com\/([^\/]+\/[^\/]+)/;
      const match = url.match(githubRegex);
      if (match && match[1]) {
        // Remove .git suffix if present
        return match[1].replace(/\.git$/, '');
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // Initial validation and confirmation dialog
  const handleInitialValidation = () => {
    const repoFullName = extractRepoFromUrl(repoUrl);
    
    if (!repoFullName) {
      setError("Invalid GitHub URL. Please enter a valid repository URL.");
      return;
    }
    
    // Show confirmation dialog
    setConfirmDialogOpen(true);
  };

  // Start the verification process
  const handleVerifyAndAdd = async () => {
    try {
      setLoading(true);
      setError(null);
      setStatus("Analyzing repository...");
      setConfirmDialogOpen(false);

      const repoFullName = extractRepoFromUrl(repoUrl);
      
      if (!repoFullName) {
        setError("Invalid GitHub URL. Please enter a valid repository URL.");
        setLoading(false);
        return;
      }

      setStatus("Starting verification pipeline...");
      console.log("Sending request to /api/mcp/add");
      
      const res = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName }),
      });
      
      console.log("Response received:", res.status);
      const data = await res.json();
      console.log("Response data:", data);
      
      if (res.ok && data.success) {
        // Store the server ID and execution ARN for polling
        setServerId(data.serverId);
        if (data.executionArn) {
          setExecutionArn(data.executionArn);
        }
        setStatus(`Verification pipeline started: ${data.status || 'BUILDING'}`);
        setIsVerifying(true);
      } else {
        setError(data.message || 'Failed to start verification pipeline.');
      }
    } catch (err) {
      console.error('Error during verification:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Function to poll for status updates
  const checkVerificationStatus = async () => {
    if (!serverId) return;
    
    try {
      const res = await fetch(`/api/mcp/status?serverId=${encodeURIComponent(serverId)}`);
      
      if (!res.ok) {
        console.error('Error checking status:', await res.text());
        // Don't stop polling on temporary errors
        return;
      }
      
      const data = await res.json();
      
      // Update UI based on current status
      if (data.success) {
        const currentStatus = data.status;
        let statusMessage = '';
        
        switch (currentStatus) {
          case 'BUILDING':
            statusMessage = 'Building container image...';
            break;
          case 'VALIDATING':
            statusMessage = 'Running verification tests on container...';
            break;
          case 'VERIFIED':
            statusMessage = `✅ Server verified successfully! ${data.toolCount ? `Tools available: ${data.toolCount}` : ''}`;
            // Stop polling and finish the process
            setIsVerifying(false);
            // Reset and close dialog after a delay
            setTimeout(() => {
              resetAndClose();
              onSuccess();
            }, 3000);
            break;
          case 'FAILED':
            statusMessage = `❌ Verification failed: ${data.error || 'Unknown error'}`;
            setIsVerifying(false);
            setError(data.error || 'Verification failed');
            break;
          default:
            statusMessage = `Status: ${currentStatus}`;
        }
        
        setStatus(statusMessage);
      } else {
        setError(data.message || 'Error checking verification status');
        setIsVerifying(false);
      }
    } catch (err) {
      console.error('Error checking verification status:', err);
      // Don't stop polling on temporary errors, but log the error
    }
  };

  // Poll for status updates when verification is in progress
  useEffect(() => {
    if (isVerifying && serverId) {
      // Initial status check
      checkVerificationStatus();
      
      // Set up polling interval (every 5 seconds)
      const interval = setInterval(checkVerificationStatus, 5000);
      
      // Clean up on unmount or when verification stops
      return () => clearInterval(interval);
    }
  }, [isVerifying, serverId]);

  // Reset the form and close the dialog
  const resetAndClose = () => {
    setOpen(false);
    setRepoUrl('');
    setStatus(null);
    setError(null);
    setLoading(false);
    setIsVerifying(false);
    setServerId(null);
    setExecutionArn(null);
    setConfirmDialogOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>+ Add MCP Server</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogTitle>Add MCP Server via GitHub URL</DialogTitle>
          <DialogDescription>
            Enter a GitHub repository URL to verify and add an MCP server.
          </DialogDescription>
          
          {!isVerifying ? (
            // Input form for entering repo URL
            <div className="my-4">
              <Input
                placeholder="https://github.com/user/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={loading}
                className="mb-4"
              />
              
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleInitialValidation}
                  disabled={loading || !repoUrl.trim()}
                >
                  Verify and Add
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // Status updates during verification
            <div className="my-4">
              <div className="flex items-center justify-center mb-6">
                {loading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : null}
              </div>
              
              <p className="text-center mb-4">{status}</p>
              
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={resetAndClose}
                  disabled={loading}
                >
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogTitle>Confirm verification</DialogTitle>
          <DialogDescription>
            Are you sure you want to verify and add this MCP server?
            <span className="font-medium mt-2 block">{extractRepoFromUrl(repoUrl)}</span>
          </DialogDescription>
          
          <DialogFooter className="gap-2 sm:justify-end">
            <Button 
              variant="outline" 
              onClick={() => setConfirmDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleVerifyAndAdd}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
} 