import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// GitHub API client configuration
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'ToolShed-MCP-Crawler',
});

// Repository metadata interface
interface MCPRepository {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  url: string;
  stars: number;
  forks: number;
  topics: string[];
  lastUpdated: string;
  discoveredAt: number;
  verified: boolean;
}

/**
 * Search GitHub repositories based on search criteria
 * 
 * @param {string} query - Search query (e.g., 'topic:mcp')
 * @param {number} [maxResults=100] - Maximum number of results to return
 * @returns {Promise<MCPRepository[]>} Array of repository metadata
 */
export async function searchMCPRepositories(
  query: string = 'topic:mcp',
  maxResults: number = 100
): Promise<MCPRepository[]> {
  console.log(`Searching GitHub for repositories with query: ${query}`);
  
  const repositories: MCPRepository[] = [];
  const seenRepos = new Set<string>();
  let page = 1;
  let hasMoreResults = true;
  
  // Handle pagination - GitHub API returns max 100 results per page
  while (hasMoreResults && repositories.length < maxResults) {
    try {
      const response = await octokit.search.repos({
        q: query,
        sort: 'updated',
        order: 'desc',
        per_page: 100,
        page,
      });
      
      console.log(`Page ${page}: Found ${response.data.items.length} repositories (Total count: ${response.data.total_count})`);
      
      // Process each repository result
      for (const repo of response.data.items) {
        // Skip if we already processed this repo
        if (seenRepos.has(repo.full_name)) {
          continue;
        }
        
        seenRepos.add(repo.full_name);
        
        // Create repository metadata
        const repoData: MCPRepository = {
          id: repo.full_name,  // Using full_name as a unique ID
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          language: repo.language,
          url: repo.html_url,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          topics: repo.topics || [],
          lastUpdated: repo.updated_at,
          discoveredAt: Date.now(),
          verified: false,  // Initially all repos are unverified
        };
        
        // Apply filters if needed
        if (filterRepository(repoData)) {
          repositories.push(repoData);
        }
        
        // Stop if we reached the maximum results
        if (repositories.length >= maxResults) {
          break;
        }
      }
      
      // Check if there are more pages
      if (response.data.items.length === 0 || page * 100 >= response.data.total_count) {
        hasMoreResults = false;
      } else {
        page++;
      }
    } catch (error) {
      console.error('Error searching GitHub repositories:', error);
      hasMoreResults = false;
    }
  }
  
  return repositories;
}

/**
 * Filter repositories to exclude non-server repositories
 * This is a simple filter; more complex filtering would be implemented
 * in the actual verification process
 * 
 * @param {MCPRepository} repo - Repository metadata
 * @returns {boolean} True if the repository passes filters
 */
function filterRepository(repo: MCPRepository): boolean {
  // Skip repositories without descriptions or with minimal stars (example criteria)
  if (!repo.description) {
    return false;
  }
  
  // Additional filtering criteria could be added here
  // For example, checking if the description or name contains keywords
  const serverKeywords = ['server', 'mcp', 'api', 'service', 'backend'];
  const hasServerKeyword = serverKeywords.some(keyword => 
    repo.description?.toLowerCase().includes(keyword) || 
    repo.name.toLowerCase().includes(keyword)
  );
  
  return hasServerKeyword;
}

/**
 * Crawl GitHub for MCP server repositories and return structured results
 * 
 * @param {string} [query] - Custom search query (default: 'topic:mcp')
 * @param {number} [maxResults] - Maximum number of results (default: 100)
 * @returns {Promise<{found: number, repositories: MCPRepository[]}>}
 */
export async function crawlMCPServers(
  query?: string,
  maxResults?: number
): Promise<{found: number, repositories: MCPRepository[]}> {
  // Define search queries
  const defaultQueries = [
    'topic:mcp', 
    'mcp server in:name,description',
    'model context protocol in:description',
  ];
  const searchQuery = query || defaultQueries.join(' OR ');
  
  // Search repositories
  const repositories = await searchMCPRepositories(searchQuery, maxResults);
  
  return {
    found: repositories.length,
    repositories,
  };
}

/**
 * Search repositories that appear in the awesome-mcp-servers list
 * This is an optional enhancement to discover curated repositories
 * 
 * @returns {Promise<MCPRepository[]>} Array of repository metadata
 */
export async function crawlAwesomeMCPList(): Promise<MCPRepository[]> {
  try {
    // This would fetch and parse the awesome-mcp-servers README
    // For now, we'll just return an empty array
    console.log('Awesome MCP list crawler not yet implemented');
    return [];
    
    // Example implementation would look like:
    // 1. Fetch the README from the awesome-mcp-servers repository
    // 2. Parse the markdown to extract repository links
    // 3. For each link, fetch repository metadata
    // 4. Return the structured data
  } catch (error) {
    console.error('Error crawling awesome-mcp list:', error);
    return [];
  }
}

/**
 * Log crawler results to console (for testing)
 * 
 * @param {Object} results - Crawler results
 */
export function logCrawlerResults(results: {found: number, repositories: MCPRepository[]}) {
  console.log(`Found ${results.found} MCP server repositories:\n`);
  
  results.repositories.forEach((repo, index) => {
    console.log(`${index + 1}. ${repo.fullName}`);
    console.log(`   Description: ${repo.description || 'None'}`);
    console.log(`   Language: ${repo.language || 'Unknown'}`);
    console.log(`   URL: ${repo.url}`);
    console.log(`   Stars: ${repo.stars}, Forks: ${repo.forks}`);
    console.log(`   Topics: ${repo.topics.join(', ') || 'None'}`);
    console.log(`   Last Updated: ${repo.lastUpdated}`);
    console.log(`   Verified: ${repo.verified ? 'Yes' : 'No'}\n`);
  });
} 