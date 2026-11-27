import { apiClient } from "../../../lib/api-client";

export interface AcceptEmployeeInvitationResponse {
  success: true;
  message: string;
  data: { accepted: true };
}

export function acceptEmployeeInvitation(input: {
  token: string;
  password: string;
}): Promise<AcceptEmployeeInvitationResponse> {
  return apiClient.post<AcceptEmployeeInvitationResponse>(
    "/api/employees/invitations/accept",
    input,
    { authenticated: false, responseFormat: "envelope" },
  );
}
