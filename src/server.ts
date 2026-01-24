import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TypeScriptLanguageService } from './language-service.js';
import { AstFinder } from './ast-finder.js';
import { ToolHandler, TOOL_DEFINITIONS } from './tools.js';
import { ResourceHandler } from './resources.js';

/**
 * Creates and configures the MCP server.
 * Exposes TypeScript language intelligence to AI agents.
 *
 * @param projectRoot - Root directory of the TypeScript project to analyze
 *
 * @example
 * const server = createServer('/path/to/project');
 * await server.connect(transport);
 */
export function createServer(projectRoot: string): Server {
  const languageService = new TypeScriptLanguageService(projectRoot);
  const astFinder = new AstFinder(languageService);
  const toolHandler = new ToolHandler(languageService, astFinder);
  const resourceHandler = new ResourceHandler(languageService);

  const server = new Server(
    {
      name: 'ts-language-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return toolHandler.handleTool(name, args ?? {});
  });

  // Register resource listing handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = resourceHandler.listResources();
    return { resources };
  });

  // Register resource reading handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const content = resourceHandler.readResource(uri);

    if (!content) {
      throw new Error(`Resource not found: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: content,
        },
      ],
    };
  });

  return server;
}

/**
 * Starts the MCP server with stdio transport.
 * This is the main entry point for CLI usage.
 */
export async function startServer(projectRoot: string): Promise<void> {
  const server = createServer(projectRoot);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr to avoid interfering with stdio transport
  console.error(`ts-language-mcp server started for: ${projectRoot}`);
}
