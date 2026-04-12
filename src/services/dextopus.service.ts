import { env } from "../config/env";

export interface DextopusPartnerFee {
  recipient: string;
  fee: number;
}

export interface CreateDepositRequestPayload {
  originChainId: number;
  destinationChainId: number;
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
  user?: string;
  slippageBps?: number;
  dry?: boolean;
  partnerFees?: DextopusPartnerFee[];
}

export interface DextopusDepositQuoteResponse {
  success: boolean;
  depositRequestId: string;
  depositAddress: string;
  upstreamRequestId?: string;
  upstreamQuoteId?: string;
  amountOut?: string;
  minAmountOut?: string;
  status?: string;
  sentAppFees?: DextopusPartnerFee[];
  effectiveUpstreamAppFees?: DextopusPartnerFee[];
  expiresInSeconds?: number;
}

export interface GetDepositStatusParams {
  depositRequestId?: string;
  depositAddress?: string;
  requestId?: string;
}

export interface DextopusDepositStatusResponse {
  success: boolean;
  depositRequestId?: string;
  depositAddress?: string;
  upstreamRequestId?: string;
  status?: string;
  executionStatus?: string;
  sentAppFees?: DextopusPartnerFee[];
  effectiveUpstreamAppFees?: DextopusPartnerFee[];
  originTransactionHashes?: string[];
  destinationTransactionHashes?: string[];
  raw?: Record<string, unknown>;
}

export interface SubmitDepositPayload {
  depositRequestId: string;
  depositAddress: string;
  txHash: string;
}

export class DextopusService {
  private static async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${env.DEXTOPUS_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Dextopus API error for ${path}:`, errorText);
      throw new Error(`Dextopus API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  static isDepositConfigured(): boolean {
    return Boolean(
      env.DEXTOPUS_TREASURY_RECIPIENT &&
        env.DEXTOPUS_DESTINATION_CHAIN_ID &&
        env.DEXTOPUS_DESTINATION_ASSET
    );
  }

  static getConfiguredDestination() {
    if (!this.isDepositConfigured()) {
      throw new Error(
        "Dextopus deposit configuration is incomplete. Set DEXTOPUS_TREASURY_RECIPIENT, DEXTOPUS_DESTINATION_CHAIN_ID, and DEXTOPUS_DESTINATION_ASSET."
      );
    }

    return {
      recipient: env.DEXTOPUS_TREASURY_RECIPIENT!,
      destinationChainId: env.DEXTOPUS_DESTINATION_CHAIN_ID!,
      destinationAsset: env.DEXTOPUS_DESTINATION_ASSET!,
    };
  }

  static getPartnerFees(): DextopusPartnerFee[] | undefined {
    if (!env.DEXTOPUS_PARTNER_FEE_RECIPIENT || !env.DEXTOPUS_PARTNER_FEE_BPS) {
      return undefined;
    }

    return [
      {
        recipient: env.DEXTOPUS_PARTNER_FEE_RECIPIENT,
        fee: env.DEXTOPUS_PARTNER_FEE_BPS,
      },
    ];
  }

  static async createDepositRequest(
    payload: CreateDepositRequestPayload
  ): Promise<DextopusDepositQuoteResponse> {
    return this.request<DextopusDepositQuoteResponse>("/api/deposit/quote", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  static async getDepositStatus(
    params: GetDepositStatusParams
  ): Promise<DextopusDepositStatusResponse> {
    const query = new URLSearchParams();
    if (params.depositRequestId) query.set("depositRequestId", params.depositRequestId);
    if (params.depositAddress) query.set("depositAddress", params.depositAddress);
    if (params.requestId) query.set("requestId", params.requestId);

    return this.request<DextopusDepositStatusResponse>(
      `/api/deposit/status?${query.toString()}`
    );
  }

  static async submitDepositTransaction(
    payload: SubmitDepositPayload
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/deposit/submit", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}
