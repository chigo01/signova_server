import PaymentSettings, {
  IPaymentSettings,
  PAYMENT_SETTINGS_KEY,
} from "../models/payment-settings.model";
import { DextopusService } from "./dextopus.service";
import { BachsService } from "./bachs.service";
import { AellaService } from "./aella.service";

export type PaymentRail = "dextopus" | "bachs" | "aella";

export interface RailStatus {
  enabled: boolean;
  configured: boolean;
  label: string;
}

export type PaymentMethods = Record<PaymentRail, RailStatus>;

/** Stored admin intent defaults to on. Customer `enabled` still requires keys. */
export const PAYMENT_SETTINGS_REVISION = 2;

const RAIL_LABELS: Record<PaymentRail, string> = {
  dextopus: "Crypto wallet (Dextopus)",
  bachs: "Card, Naira & crypto (Bachs)",
  aella: "NGN bank transfer (Aella)",
};

export function nextPaymentSettingsBackfill(doc: {
  bachsEnabled: boolean;
  aellaEnabled?: boolean;
  settingsRevision?: number;
}): {
  bachsEnabled: boolean;
  aellaEnabled: boolean;
  settingsRevision: number;
} | null {
  if ((doc.settingsRevision ?? 0) >= PAYMENT_SETTINGS_REVISION) {
    return null;
  }
  return {
    bachsEnabled:
      (doc.settingsRevision ?? 0) >= 1 ? doc.bachsEnabled : true,
    aellaEnabled: true,
    settingsRevision: PAYMENT_SETTINGS_REVISION,
  };
}

export class PaymentSettingsService {
  static isConfigured(rail: PaymentRail): boolean {
    switch (rail) {
      case "dextopus":
        return DextopusService.isDepositConfigured();
      case "bachs":
        return BachsService.isConfigured();
      case "aella":
        return AellaService.isConfigured();
    }
  }

  static async getDocument(): Promise<IPaymentSettings> {
    const existing = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY });
    if (existing) {
      const backfill = nextPaymentSettingsBackfill(existing);
      if (backfill) {
        existing.bachsEnabled = backfill.bachsEnabled;
        existing.aellaEnabled = backfill.aellaEnabled;
        existing.settingsRevision = backfill.settingsRevision;
        await existing.save();
      }
      return existing;
    }

    const created = await PaymentSettings.findOneAndUpdate(
      { key: PAYMENT_SETTINGS_KEY },
      {
        $setOnInsert: {
          key: PAYMENT_SETTINGS_KEY,
          dextopusEnabled: true,
          bachsEnabled: true,
          aellaEnabled: true,
          settingsRevision: PAYMENT_SETTINGS_REVISION,
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
      dextopus: this.railStatus("dextopus", doc.dextopusEnabled),
      bachs: this.railStatus("bachs", doc.bachsEnabled),
      aella: this.railStatus("aella", doc.aellaEnabled),
    };
  }

  static async isEnabled(rail: PaymentRail): Promise<boolean> {
    const methods = await this.getMethods();
    return methods[rail].enabled;
  }

  static async update(patch: {
    dextopus?: boolean;
    bachs?: boolean;
    aella?: boolean;
  }): Promise<PaymentMethods> {
    const updates: Partial<{
      dextopusEnabled: boolean;
      bachsEnabled: boolean;
      aellaEnabled: boolean;
    }> = {};

    if (patch.dextopus !== undefined) {
      this.assertCanEnable("dextopus", patch.dextopus);
      updates.dextopusEnabled = patch.dextopus;
    }
    if (patch.bachs !== undefined) {
      this.assertCanEnable("bachs", patch.bachs);
      updates.bachsEnabled = patch.bachs;
    }
    if (patch.aella !== undefined) {
      this.assertCanEnable("aella", patch.aella);
      updates.aellaEnabled = patch.aella;
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
