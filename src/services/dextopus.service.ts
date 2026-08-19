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

export interface GetDepositSourcesParams {
  destinationAssetId?: string;
  destinationAddress?: string;
  destinationChainId?: number;
  supportsStaticAddress?: boolean;
}

export interface DextopusDepositSource {
  currency?: string;
  symbol?: string;
  blockchain?: string;
  sourceChainId?: number;
  chainId?: number;
  decimals?: number;
  addressKind?: string | null;
  address?: string;
  supportsStaticAddress?: boolean;
}

export interface DextopusDepositSourceChain {
  blockchain?: string;
  chainId?: number;
  addressKind?: string | null;
  count?: number;
  supportsStaticAddress?: boolean;
}

export interface DextopusDepositSourcesResponse {
  success?: boolean;
  destinationAssetId?: string;
  destinationAddress?: string;
  destinationAddressKind?: string | null;
  sources?: DextopusDepositSource[];
  sourceChains?: DextopusDepositSourceChain[];
  count?: number;
}

export interface ValidateDepositAddressPayload {
  chainType: string;
  address: string;
}

export interface DextopusValidateAddressResponse {
  success?: boolean;
  valid?: boolean;
  reason?: string;
}

export class DextopusService {
  private static async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (env.DEXTOPUS_API_KEY) {
      headers["X-API-Key"] = env.DEXTOPUS_API_KEY;
    }
    if (init?.headers) {
      Object.assign(headers, init.headers);
    }

    const response = await fetch(`${env.DEXTOPUS_BASE_URL}${path}`, {
      ...init,
      headers,
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

  static async getDepositSources(
    params: GetDepositSourcesParams
  ): Promise<DextopusDepositSourcesResponse> {
    const query = new URLSearchParams();
    if (params.destinationAssetId) {
      query.set("destinationAssetId", params.destinationAssetId);
    }
    if (params.destinationAddress) {
      query.set("destinationAddress", params.destinationAddress);
    }
    if (typeof params.destinationChainId === "number") {
      query.set("destinationChainId", String(params.destinationChainId));
    }
    if (typeof params.supportsStaticAddress === "boolean") {
      query.set("supportsStaticAddress", String(params.supportsStaticAddress));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request<DextopusDepositSourcesResponse>(
      `/api/deposit/sources${suffix}`
    );
  }

  static async validateDepositAddress(
    payload: ValidateDepositAddressPayload
  ): Promise<DextopusValidateAddressResponse> {
    return this.request<DextopusValidateAddressResponse>(
      "/api/deposit/validate-address",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }
}
