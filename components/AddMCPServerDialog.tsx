'use client';

import { useState } from 'react';
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

  const handleVerifyAndAdd = async () => {
    setLoading(true);
    setError(null);
    setStatus("Analyzing repository...");

    const repoFullName = extractRepoFromUrl(repoUrl);
    
    if (!repoFullName) {
      setError("Invalid GitHub URL. Please enter a valid repository URL.");
      setLoading(false);
      return;
    }

    try {
      setStatus("Starting verification pipeline...");
      const res = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        if (data.verified) {
          setStatus("✅ MCP Server verified and added successfully!");
          // Reset state and close dialog after successful verification
          setTimeout(() => {
            setOpen(false);
            setRepoUrl('');
            setStatus(null);
            onSuccess();
          }, 1500);
        } else {
          setError(data.message || 'Verification failed: No MCP tools found.');
        }
      } else {
        setError(data.message || 'Failed to process the request.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Add MCP Server</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add MCP Server via GitHub URL</DialogTitle>
        <DialogDescription>
          Enter a GitHub repository URL to verify and add an MCP server.
        </DialogDescription>
        
        <div className="my-4">
          <Input
            placeholder="https://github.com/user/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            disabled={loading}
            className="mb-4"
          />
          
          {status && !error && (
            <Alert className="mb-4">
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
          
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleVerifyAndAdd} disabled={loading || !repoUrl}>
            {loading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
            Verify & Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 