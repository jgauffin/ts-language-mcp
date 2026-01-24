import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { ResourceHandler, RESOURCE_URIS } from '../src/resources.js';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-project');

describe('ResourceHandler', () => {
  let handler: ResourceHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(FIXTURE_PATH);
    handler = new ResourceHandler(service);
  });

  describe('RESOURCE_URIS', () => {
    it('should define expected URIs', () => {
      expect(RESOURCE_URIS.PROJECT_FILES).toBe('typescript://project/files');
      expect(RESOURCE_URIS.PROJECT_CONFIG).toBe('typescript://project/config');
      expect(RESOURCE_URIS.FILE_PREFIX).toBe('typescript://file/');
    });
  });

  describe('listResources', () => {
    it('should list project-level resources', () => {
      const resources = handler.listResources();

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain(RESOURCE_URIS.PROJECT_FILES);
      expect(uris).toContain(RESOURCE_URIS.PROJECT_CONFIG);
    });

    it('should list file resources', () => {
      const resources = handler.listResources();

      const fileResources = resources.filter((r) =>
        r.uri.startsWith(RESOURCE_URIS.FILE_PREFIX)
      );
      expect(fileResources.length).toBeGreaterThan(0);
    });

    it('should include descriptions', () => {
      const resources = handler.listResources();

      resources.forEach((r) => {
        expect(r.description).toBeDefined();
        expect(r.description.length).toBeGreaterThan(0);
      });
    });

    it('should include mime types', () => {
      const resources = handler.listResources();

      resources.forEach((r) => {
        expect(r.mimeType).toBeDefined();
      });
    });
  });

  describe('getProjectFiles', () => {
    it('should return file list with URIs', () => {
      const files = handler.getProjectFiles();

      expect(files.length).toBeGreaterThan(0);
      files.forEach((f) => {
        expect(f.uri).toContain('typescript://file/');
        expect(f.name).toBeDefined();
        expect(f.mimeType).toBe('text/typescript');
      });
    });
  });

  describe('getProjectConfig', () => {
    it('should return valid JSON', () => {
      const config = handler.getProjectConfig();

      expect(() => JSON.parse(config)).not.toThrow();
    });

    it('should include compiler options', () => {
      const config = JSON.parse(handler.getProjectConfig());

      // Should have some standard options from fixture tsconfig
      expect(config.strict).toBe(true);
    });
  });

  describe('getFileContent', () => {
    it('should return file content with line count', () => {
      const result = handler.getFileContent('src/services/user-service.ts');

      expect(result).toBeDefined();
      expect(result?.content).toContain('UserService');
      expect(result?.lines).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent file', () => {
      const result = handler.getFileContent('non-existent.ts');

      expect(result).toBeUndefined();
    });
  });

  describe('readResource', () => {
    it('should read project files resource', () => {
      const content = handler.readResource(RESOURCE_URIS.PROJECT_FILES);

      expect(content).toBeDefined();
      const parsed = JSON.parse(content!);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should read project config resource', () => {
      const content = handler.readResource(RESOURCE_URIS.PROJECT_CONFIG);

      expect(content).toBeDefined();
      expect(() => JSON.parse(content!)).not.toThrow();
    });

    it('should read file resource', () => {
      const uri = `${RESOURCE_URIS.FILE_PREFIX}src/services/user-service.ts`;
      const content = handler.readResource(uri);

      expect(content).toBeDefined();
      expect(content).toContain('UserService');
    });

    it('should return undefined for unknown resource', () => {
      const content = handler.readResource('typescript://unknown/resource');

      expect(content).toBeUndefined();
    });
  });
});
