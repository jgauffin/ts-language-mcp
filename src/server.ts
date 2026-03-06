import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { normalizePath } from './tools.js';

export interface ServerOptions {
  name?: string;
  description?: string;
}

/**
 * Creates and configures the MCP server.
 * Exposes TypeScript language intelligence to AI agents.
 *
 * @param projectRoot - Root directory of the TypeScript project to analyze
 * @param options - Optional server name and description overrides
 *
 * @example
 * const server = createServer('/path/to/project', { name: 'my-ts-server' });
 * await server.connect(transport);
 */
export function createServer(projectRoot?: string, options?: ServerOptions): McpServer {
  const resolvedRoot = projectRoot ?? process.cwd();
  const normalizedRoot = normalizePath(resolvedRoot);
  const languageService = new TypeScriptLanguageService(resolvedRoot);
  const astFinder = new AstFinder(languageService);
  const toolHandler = new ToolHandler(languageService, astFinder);
  const resourceHandler = new ResourceHandler(languageService);
  const serverInfo = {
    name: options?.name ?? 'ts-language-mcp',
    version: '1.0.0',
    ...(options?.description ? { description: options.description } : {}),
  };

  const instructions =
    `This server provides TypeScript and JavaScript language intelligence for the project at: ${normalizedRoot}\n` +
    `Supported file types: .ts, .tsx, .js, .jsx\n` +
    `All "file" parameters must be relative paths from this project root, using forward slashes.\n` +
    `Reading "node_modules" is not supported. Hidden directories (starting with .) are automatically skipped.\n` +
    `Example: "src/index.ts", "src/utils.js", "tests/utils.test.ts"\n` +
    `Do NOT use absolute paths. Use the "get_workspace_symbols" tool or the "typescript://project/files" resource to discover available file paths.`;

  const mcpServer = new McpServer(serverInfo, {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions,
  });

  // Register tool handlers on the underlying server (uses JSON Schema, not Zod)
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await toolHandler.handleTool(name, args ?? {});
    } catch (error) {
      // Catch-all so an unhandled throw never crashes the request batch
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  });

  // Register resource handlers on the underlying server
  mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = resourceHandler.listResources();
    return { resources };
  });

  mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

  return mcpServer;
}

/**
 * Starts the MCP server with stdio transport.
 * This is the main entry point for CLI usage.
 */
export async function startServer(projectRoot?: string, options?: ServerOptions): Promise<void> {
  const resolvedRoot = projectRoot ?? process.cwd();
  const mcpServer = createServer(resolvedRoot, options);
  const transport = new StdioServerTransport();

  await mcpServer.connect(transport);

  // Log to stderr to avoid interfering with stdio transport
  console.error(`ts-language-mcp server started for: ${resolvedRoot}`);
}
