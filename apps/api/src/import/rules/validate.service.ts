import { Finding, RuleContext, RULES } from './rule-registry';

/** Run every rule over the staged data and return the flat list of findings. */
export function runRules(ctx: RuleContext): Finding[] {
  return RULES.flatMap((r) => r.run(ctx));
}

/** Group findings by ruleId (for the review-screen summary). */
export function countByRule(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.ruleId] = (out[f.ruleId] ?? 0) + 1;
  return out;
}
