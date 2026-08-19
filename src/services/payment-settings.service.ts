import PaymentSettings, {
  IPaymentSettings,
  PAYMENT_SETTINGS_KEY,
} from "../models/payment-settings.model";
import { env } from "../config/env";
import { DextopusService } from "./dextopus.service";
import { BachsService } from "./bachs.service";

export type PaymentRail = "paystack" | "dextopus" | "bachs";

export interface RailStatus {
  enabled: boolean;
  configured: boolean;
  label: string;
}

export type PaymentMethods = Record<PaymentRail, RailStatus>;

const RAIL_LABELS: Record<PaymentRail, string> = {
  paystack: "Card / bank (Paystack)",
  dextopus: "Crypto wallet (Dextopus)",
  bachs: "Crypto checkout (Bachs)",
};

export class PaymentSettingsService {
  static isConfigured(rail: PaymentRail): boolean {
    switch (rail) {
      case "paystack":
        return Boolean(env.PAYSTACK_SECRET_KEY);
      case "dextopus":
        return DextopusService.isDepositConfigured();
      case "bachs":
        return BachsService.isConfigured();
    }
  }

  static async getDocument(): Promise<IPaymentSettings> {
    const existing = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY });
    if (existing) return existing;

    const created = await PaymentSettings.findOneAndUpdate(
      { key: PAYMENT_SETTINGS_KEY },
      {
        $setOnInsert: {
          key: PAYMENT_SETTINGS_KEY,
          paystackEnabled: true,
          dextopusEnabled: this.isConfigured("dextopus"),
          bachsEnabled: this.isConfigured("bachs"),
        },
      },
      { new: true, upsert: true },
    );
    if (!created) {
      throw new Error("Could not load payment settings");
    }
    return created;
  }

  static async getMethods(): Promise<PaymentMethods> {
    const doc = await this.getDocument();
    return {
      paystack: this.railStatus("paystack", doc.paystackEnabled),
      dextopus: this.railStatus("dextopus", doc.dextopusEnabled),
      bachs: this.railStatus("bachs", doc.bachsEnabled),
    };
  }

  static async isEnabled(rail: PaymentRail): Promise<boolean> {
    const methods = await this.getMethods();
    return methods[rail].enabled;
  }

  static async update(patch: {
    paystack?: boolean;
    dextopus?: boolean;
    bachs?: boolean;
  }): Promise<PaymentMethods> {
    const updates: Partial<{
      paystackEnabled: boolean;
      dextopusEnabled: boolean;
      bachsEnabled: boolean;
    }> = {};

    if (patch.paystack !== undefined) {
      this.assertCanEnable("paystack", patch.paystack);
      updates.paystackEnabled = patch.paystack;
    }
    if (patch.dextopus !== undefined) {
      this.assertCanEnable("dextopus", patch.dextopus);
      updates.dextopusEnabled = patch.dextopus;
    }
    if (patch.bachs !== undefined) {
      this.assertCanEnable("bachs", patch.bachs);
      updates.bachsEnabled = patch.bachs;
    }

    await this.getDocument();
    if (Object.keys(updates).length > 0) {
      await PaymentSettings.updateOne(
        { key: PAYMENT_SETTINGS_KEY },
        { $set: updates },
      );
    }
    return this.getMethods();
  }

  private static railStatus(rail: PaymentRail, storedEnabled: boolean): RailStatus {
    const configured = this.isConfigured(rail);
    return {
      configured,
      enabled: Boolean(storedEnabled && configured),
      label: RAIL_LABELS[rail],
    };
  }

  private static assertCanEnable(rail: PaymentRail, enabled: boolean): void {
    if (enabled && !this.isConfigured(rail)) {
      throw new Error(
        `${RAIL_LABELS[rail]} is not configured and cannot be enabled`,
      );
    }
  }
}
