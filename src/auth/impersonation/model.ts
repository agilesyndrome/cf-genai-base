export interface ImpersonationEnvironment {
  AUTH_SESSION_SECRET?: string;
}

export interface ImpersonationTokenPayload {
  adminUserId: string;
  targetUserId: string;
  exp: number;
}

export interface ImpersonationTokenOptions {
  ttlSeconds?: number;
}
