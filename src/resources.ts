import type { TypeScriptLanguageService } from './language-service.js';

/**
 * Resource URIs exposed via MCP.
 * Resources provide read-only data that AI agents can query.
 */
export const RESOURCE_URIS = {
  PROJECT_FILES: 'typescript://project/files',
  PROJECT_CONFIG: 'typescript://project/config',
  FILE_PREFIX: 'typescript://file/',
} as const;

/**
 * Handles MCP resource requests.
 * Provides project metadata and file content to AI agents.
 *
 * @example
 * const handler = new ResourceHandler(languageService);
 * const files = handler.getProjectFiles();
 */
export class ResourceHandler {
  private languageService: TypeScriptLanguageService;

  constructor(languageService: TypeScriptLanguageService) {
    this.languageService = languageService;
  }

  /**
   * Returns list of all TypeScript files in the project.
   */
  getProjectFiles(): { uri: string; name: string; mimeType: string }[] {
    const files = this.languageService.getProjectFiles();

    return files.map((file) => ({
      uri: `${RESOURCE_URIS.FILE_PREFIX}${file}`,
      name: file,
      mimeType: 'text/typescript',
    }));
  }

  /**
   * Returns compiler options as JSON.
   */
  getProjectConfig(): string {
    const options = this.languageService.getCompilerOptions();

    // Filter out non-serializable properties
    const serializableOptions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      if (typeof value !== 'function' && typeof value !== 'undefined') {
        serializableOptions[key] = value;
      }
    }

    return JSON.stringify(serializableOptions, null, 2);
  }

  /**
   * Returns file content with metadata.
   */
  getFileContent(filePath: string): { content: string; lines: number } | undefined {
    const content = this.languageService.getFileContent(filePath);
    if (!content) return undefined;

    return {
      content,
      lines: content.split('\n').length,
    };
  }

  /**
   * Lists all available resources.
   */
  listResources(): Array<{
    uri: string;
    name: string;
    description: string;
    mimeType?: string;
  }> {
    const resources: Array<{
      uri: string;
      name: string;
      description: string;
      mimeType?: string;
    }> = [
      {
        uri: RESOURCE_URIS.PROJECT_FILES,
        name: 'Project Files',
        description: 'List of all TypeScript/JavaScript files in the project',
        mimeType: 'application/json',
      },
      {
        uri: RESOURCE_URIS.PROJECT_CONFIG,
        name: 'Project Config',
        description: 'TypeScript compiler options from tsconfig.json',
        mimeType: 'application/json',
      },
    ];

    // Add individual file resources
    const files = this.languageService.getProjectFiles();
    for (const file of files) {
      resources.push({
        uri: `${RESOURCE_URIS.FILE_PREFIX}${file}`,
        name: file,
        description: `TypeScript source file: ${file}`,
        mimeType: this.getMimeType(file),
      });
    }

    return resources;
  }

  private getMimeType(filePath: string): string {
    if (filePath.endsWith('.tsx')) return 'text/typescript-jsx';
    if (filePath.endsWith('.ts')) return 'text/typescript';
    if (filePath.endsWith('.jsx')) return 'text/javascript-jsx';
    if (filePath.endsWith('.js')) return 'text/javascript';
    return 'text/plain';
  }

  /**
   * Reads a resource by URI.
   */
  readResource(uri: string): string | undefined {
    if (uri === RESOURCE_URIS.PROJECT_FILES) {
      return JSON.stringify(this.getProjectFiles(), null, 2);
    }

    if (uri === RESOURCE_URIS.PROJECT_CONFIG) {
      return this.getProjectConfig();
    }

    if (uri.startsWith(RESOURCE_URIS.FILE_PREFIX)) {
      const filePath = uri.slice(RESOURCE_URIS.FILE_PREFIX.length);
      const result = this.getFileContent(filePath);
      return result?.content;
    }

    return undefined;
  }
}
