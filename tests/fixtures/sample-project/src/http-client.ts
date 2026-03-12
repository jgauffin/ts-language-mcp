/**
 * Simple HTTP client interface.
 */
export interface HttpClient {
  get(url: string): Promise<string>;
  post(url: string, body: string): Promise<string>;
}

/**
 * Default HTTP client implementation.
 */
export class DefaultHttpClient implements HttpClient {
  async get(url: string): Promise<string> {
    return '';
  }

  async post(url: string, body: string): Promise<string> {
    return '';
  }
}
