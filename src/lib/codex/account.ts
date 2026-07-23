import { codexAppServer } from "./app-server";

export type CodexAccountStatus = {
  connected: boolean;
  requiresOpenaiAuth: boolean;
  account?: Record<string, unknown>;
};

export async function codexAccountStatus(): Promise<CodexAccountStatus> {
  const response = await codexAppServer.request<{
    account: Record<string, unknown> | null;
    requiresOpenaiAuth: boolean;
  }>("account/read", { refreshToken: false });
  return {
    connected: Boolean(response.account),
    requiresOpenaiAuth: response.requiresOpenaiAuth,
    account: response.account ?? undefined,
  };
}

export async function startDeviceLogin(): Promise<{
  loginId: string;
  verificationUrl: string;
  userCode: string;
}> {
  const response = await codexAppServer.request<{
    type: string;
    loginId: string;
    verificationUrl: string;
    userCode: string;
  }>("account/login/start", { type: "chatgptDeviceCode" });
  if (response.type !== "chatgptDeviceCode") throw new Error("Codex did not start device-code login");
  return response;
}
