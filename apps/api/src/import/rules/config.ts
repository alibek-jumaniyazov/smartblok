/** The 6 owner-tunable knobs (stored under AppSetting key `importRules`). Every
 *  other rule's severity/params live in code — the owner never needs to touch them. */
export const IMPORT_RULES_SETTING_KEY = 'importRules';

export interface ImportRulesConfig {
  ustamaChegarasi: { minPct: number; maxPct: number }; // sale vs cost margin band
  sanaOgishiKun: { days: number }; // date this far from the cluster → flag
  yaxlitlashChegarasi: { uzs: number }; // residual below this → written off
  moshinaSigimi: { pallets: number }; // default truck pallet capacity
  poddonNisbati: { m3PerPallet: number; bySize: Record<string, number>; tolerance: number };
  ogohlantirishlar: { enabled: boolean }; // show WARN-level issues at all
}

export const DEFAULT_RULES_CONFIG: ImportRulesConfig = {
  ustamaChegarasi: { minPct: 10, maxPct: 60 },
  sanaOgishiKun: { days: 30 },
  yaxlitlashChegarasi: { uzs: 1000 },
  moshinaSigimi: { pallets: 19 },
  poddonNisbati: { m3PerPallet: 1.728, bySize: { '600x300x250': 1.8 }, tolerance: 0.5 },
  ogohlantirishlar: { enabled: true },
};

/** Merge a partial owner override (from AppSetting) onto the defaults. */
export function resolveRulesConfig(override?: Partial<ImportRulesConfig> | null): ImportRulesConfig {
  const o = override ?? {};
  return {
    ustamaChegarasi: { ...DEFAULT_RULES_CONFIG.ustamaChegarasi, ...o.ustamaChegarasi },
    sanaOgishiKun: { ...DEFAULT_RULES_CONFIG.sanaOgishiKun, ...o.sanaOgishiKun },
    yaxlitlashChegarasi: { ...DEFAULT_RULES_CONFIG.yaxlitlashChegarasi, ...o.yaxlitlashChegarasi },
    moshinaSigimi: { ...DEFAULT_RULES_CONFIG.moshinaSigimi, ...o.moshinaSigimi },
    poddonNisbati: { ...DEFAULT_RULES_CONFIG.poddonNisbati, ...o.poddonNisbati },
    ogohlantirishlar: { ...DEFAULT_RULES_CONFIG.ogohlantirishlar, ...o.ogohlantirishlar },
  };
}
