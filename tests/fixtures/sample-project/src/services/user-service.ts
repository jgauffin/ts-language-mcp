/**
 * User service interface for data access.
 */
export interface UserService {
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

/**
 * User entity with profile information.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

/**
 * Data transfer object for creating users.
 */
export interface CreateUserDto {
  name: string;
  email: string;
}

/**
 * User roles for authorization.
 */
export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

/**
 * Type alias for user ID.
 */
export type UserId = string;

/**
 * Internal helper - not exported.
 */
function validateEmail(email: string): boolean {
  return email.includes('@');
}

/**
 * Default user service implementation.
 */
export class DefaultUserService implements UserService {
  private users: Map<string, User> = new Map();

  async getUser(id: string): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    return user;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    if (!validateEmail(data.email)) {
      throw new Error('Invalid email');
    }

    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }
}

/**
 * Factory function to create user service.
 */
export const createUserService = (): UserService => {
  return new DefaultUserService();
};

/**
 * Configuration constant.
 */
export const MAX_USERS = 1000;

/**
 * Internal variable.
 */
let userCount = 0;
