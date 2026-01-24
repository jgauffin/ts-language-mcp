import { UserService, User, CreateUserDto } from './services/user-service.js';

/**
 * HTTP request handler type.
 */
export type RequestHandler = (req: Request) => Promise<Response>;

/**
 * Handler context with services.
 */
export interface HandlerContext {
  userService: UserService;
}

/**
 * Creates a handler for getting users.
 */
export function createGetUserHandler(ctx: HandlerContext): RequestHandler {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response('Missing id', { status: 400 });
    }

    try {
      const user = await ctx.userService.getUser(id);
      return Response.json(user);
    } catch (error) {
      return new Response('User not found', { status: 404 });
    }
  };
}

/**
 * Creates a handler for creating users.
 */
export function createPostUserHandler(ctx: HandlerContext): RequestHandler {
  return async (req: Request): Promise<Response> => {
    const data: CreateUserDto = await req.json();
    const user = await ctx.userService.createUser(data);
    return Response.json(user, { status: 201 });
  };
}

/**
 * Handler for health checks.
 */
export const healthHandler: RequestHandler = async () => {
  return new Response('OK');
};
