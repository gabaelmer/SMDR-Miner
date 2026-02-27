// Type augmentation for Express Request
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        username: string;
        role: string;
      };
    }
  }
}

export {};
