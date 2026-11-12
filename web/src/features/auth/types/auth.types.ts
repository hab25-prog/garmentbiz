export type MembershipRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "ACCOUNTANT"
  | "INVENTORY_MANAGER"
  | "PRODUCTION_MANAGER"
  | "EMPLOYEE";

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  email: string;
}

export interface BusinessMembership {
  role: MembershipRole;
  business: {
    id: string;
    name: string;
  };
}

export interface AuthenticatedProfile {
  user: AuthenticatedUser;
  membership: BusinessMembership;
}

export interface AuthenticatedSession extends AuthenticatedProfile {
  accessToken: string;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  businessName: string;
}

export interface LoginInput {
  email: string;
  password: string;
  businessId?: string;
}

export interface CsrfTokenResponse {
  csrfToken: string;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
}
