import { env } from "../config/env";

export class AellaService {
  private static readonly BASE_URL = "https://api.aellaapp.com";

  private static getHeaders() {
    if (!env.AELLA_SECRET_KEY) {
      throw new Error("Missing AELLA_SECRET_KEY in environment variables");
    }
    return {
      "Authorization": `Bearer ${env.AELLA_SECRET_KEY}`,
      "Content-Type": "application/json"
    };
  }

  /**
   * Creates a dynamic virtual account suitable for a one-time payment.
   * @param accountName - Name of the account (e.g. "Pro Upgrade")
   * @param amount - The exact amount to accept (e.g. 2000)
   * @param expiryTimeInMinutes - Maximum 60 allowed by Aella
   * @returns details of the newly created virtual account
   */
  static async createDynamicVirtualAccount(
    accountName: string,
    amount: number,
    expiryTimeInMinutes: number = 60
  ) {
    const url = `${this.BASE_URL}/wallets/virtual/dynamic`;
    const payload = {
      accountName,
      amount,
      expiryTimeInMinutes
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Aella createDynamicVirtualAccount Error:", errorText);
        throw new Error(`Aella API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }
}
