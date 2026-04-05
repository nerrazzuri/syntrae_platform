"use strict";

const PLAN_CODES = {
  BASIC: "BASIC",
  STARTER: "STARTER",
  GROWTH: "GROWTH",
  PRO: "PRO",
  AGENCY: "AGENCY",
};

const BILLING_INTERVALS = {
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY",
};

const SUBSCRIPTION_STATUSES = {
  TRIALING: "TRIALING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
  INACTIVE: "INACTIVE",
};

const LIMIT_PERIODS = {
  DAILY: "DAILY",
  MONTHLY: "MONTHLY",
};

const USAGE_METRICS = {
  EVENTS_INGESTED: "EVENTS_INGESTED",
  SUGGESTIONS_CREATED: "SUGGESTIONS_CREATED",
  AUTOMATION_RUNS_CREATED: "AUTOMATION_RUNS_CREATED",
  LEADS_EXPORTED: "LEADS_EXPORTED",
};

const PLAN_REASON_CODES = {
  PLATFORM_NOT_INCLUDED: "PLATFORM_NOT_INCLUDED",
  FEATURE_NOT_AVAILABLE: "FEATURE_NOT_AVAILABLE",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  TEAM_LIMIT_REACHED: "TEAM_LIMIT_REACHED",
  BRAND_LIMIT_REACHED: "BRAND_LIMIT_REACHED",
  WORKSPACE_LIMIT_REACHED: "WORKSPACE_LIMIT_REACHED",
  AUTOMATION_DISABLED: "AUTOMATION_DISABLED",
  ADVANCED_SCORING_DISABLED: "ADVANCED_SCORING_DISABLED",
  EXPORT_DISABLED: "EXPORT_DISABLED",
  UPGRADE_REQUIRED: "UPGRADE_REQUIRED",
};

const LEGACY_PLAN_ALIASES = {
  FREE: PLAN_CODES.BASIC,
  BASIC: PLAN_CODES.BASIC,
  MIGRATED_BASIC: PLAN_CODES.GROWTH,
  PRO: PLAN_CODES.PRO,
  BUSINESS: PLAN_CODES.AGENCY,
  ENTERPRISE: PLAN_CODES.AGENCY,
  DEV: PLAN_CODES.PRO,
};

const PLATFORM_ALIASES = {
  xiaohongshu: "rednote",
  xhs: "rednote",
};

const PLAN_DEFINITIONS = {
  [PLAN_CODES.BASIC]: {
    code: PLAN_CODES.BASIC,
    displayName: "Basic",
    rank: 0,
    availableBillingIntervals: [],
    status: "ACTIVE",
    limits: {
      maxPlatforms: 1,
      maxBrands: 1,
      maxWorkspaces: 1,
      maxUsers: 1,
      maxCampaigns: 1,
      dailyProcessedEvents: 10,
      monthlyProcessedEvents: 300,
      dailySuggestions: 5,
      monthlyLeadExports: 0,
      dailyAutomationRuns: 1,
    },
    includedPlatforms: ["rednote"],
    capabilities: {
      manualWorkflow: true,
      automationEnabled: true,
      automationRuleReady: false,
      exportEnabled: false,
      advancedScoringEnabled: false,
      priorityProcessingEnabled: false,
      assistedReplyDrafts: false,
      leadPrioritization: false,
      teamMemberInvites: false,
      multiBrand: false,
      multiClientIsolation: false,
    },
  },
  [PLAN_CODES.STARTER]: {
    code: PLAN_CODES.STARTER,
    displayName: "Starter",
    rank: 1,
    availableBillingIntervals: [BILLING_INTERVALS.MONTHLY, BILLING_INTERVALS.YEARLY],
    status: "ACTIVE",
    limits: {
      maxPlatforms: 1,
      maxBrands: 1,
      maxWorkspaces: 1,
      maxUsers: 1,
      maxCampaigns: 1,
      dailyProcessedEvents: 150,
      monthlyProcessedEvents: 4500,
      dailySuggestions: 20,
      monthlyLeadExports: 0,
      dailyAutomationRuns: 3,
    },
    includedPlatforms: ["tiktok", "rednote"],
    capabilities: {
      manualWorkflow: true,
      automationEnabled: true,
      automationRuleReady: false,
      exportEnabled: false,
      advancedScoringEnabled: false,
      priorityProcessingEnabled: false,
      assistedReplyDrafts: false,
      leadPrioritization: false,
      teamMemberInvites: false,
      multiBrand: false,
      multiClientIsolation: false,
    },
  },
  [PLAN_CODES.GROWTH]: {
    code: PLAN_CODES.GROWTH,
    displayName: "Growth",
    rank: 2,
    availableBillingIntervals: [BILLING_INTERVALS.MONTHLY, BILLING_INTERVALS.YEARLY],
    status: "ACTIVE",
    limits: {
      maxPlatforms: 2,
      maxBrands: 1,
      maxWorkspaces: 1,
      maxUsers: 3,
      maxCampaigns: 3,
      dailyProcessedEvents: 1000,
      monthlyProcessedEvents: 30000,
      dailySuggestions: 150,
      monthlyLeadExports: 1000,
      dailyAutomationRuns: 0,
    },
    includedPlatforms: ["tiktok", "rednote"],
    capabilities: {
      manualWorkflow: true,
      automationEnabled: false,
      automationRuleReady: false,
      exportEnabled: true,
      advancedScoringEnabled: true,
      priorityProcessingEnabled: false,
      assistedReplyDrafts: true,
      leadPrioritization: true,
      teamMemberInvites: false,
      multiBrand: false,
      multiClientIsolation: false,
    },
  },
  [PLAN_CODES.PRO]: {
    code: PLAN_CODES.PRO,
    displayName: "Pro",
    rank: 3,
    availableBillingIntervals: [BILLING_INTERVALS.MONTHLY, BILLING_INTERVALS.YEARLY],
    status: "ACTIVE",
    limits: {
      maxPlatforms: 4,
      maxBrands: 3,
      maxWorkspaces: 1,
      maxUsers: 5,
      maxCampaigns: 10,
      dailyProcessedEvents: 3000,
      monthlyProcessedEvents: 90000,
      dailySuggestions: 400,
      monthlyLeadExports: 5000,
      dailyAutomationRuns: 25,
    },
    includedPlatforms: ["tiktok", "rednote", "instagram", "youtube"],
    capabilities: {
      manualWorkflow: true,
      automationEnabled: true,
      automationRuleReady: true,
      exportEnabled: true,
      advancedScoringEnabled: true,
      priorityProcessingEnabled: true,
      assistedReplyDrafts: true,
      leadPrioritization: true,
      teamMemberInvites: true,
      multiBrand: true,
      multiClientIsolation: false,
    },
  },
  [PLAN_CODES.AGENCY]: {
    code: PLAN_CODES.AGENCY,
    displayName: "Agency",
    rank: 4,
    availableBillingIntervals: [BILLING_INTERVALS.MONTHLY, BILLING_INTERVALS.YEARLY],
    status: "ACTIVE",
    limits: {
      maxPlatforms: 4,
      maxBrands: 30,
      maxWorkspaces: 1,
      maxUsers: 25,
      maxCampaigns: 100,
      dailyProcessedEvents: 15000,
      monthlyProcessedEvents: 450000,
      dailySuggestions: 2000,
      monthlyLeadExports: 25000,
      dailyAutomationRuns: 250,
    },
    includedPlatforms: ["tiktok", "rednote", "instagram", "youtube"],
    capabilities: {
      manualWorkflow: true,
      automationEnabled: true,
      automationRuleReady: true,
      exportEnabled: true,
      advancedScoringEnabled: true,
      priorityProcessingEnabled: true,
      assistedReplyDrafts: true,
      leadPrioritization: true,
      teamMemberInvites: true,
      multiBrand: true,
      multiClientIsolation: true,
    },
  },
};

function normalizePlanCode(planCode) {
  if (!planCode) return PLAN_CODES.BASIC;
  const upper = String(planCode).trim().toUpperCase();
  return PLAN_DEFINITIONS[upper] ? upper : LEGACY_PLAN_ALIASES[upper] || PLAN_CODES.BASIC;
}

function getPlanDefinition(planCode) {
  return PLAN_DEFINITIONS[normalizePlanCode(planCode)];
}

function makeDecision(allowed, code, message, extras) {
  return Object.assign(
    {
      allowed,
      reasonCode: allowed ? null : code,
      message: message || null,
    },
    extras || {}
  );
}

function getUsageLimit(planCode, metric, period) {
  const plan = getPlanDefinition(planCode);
  if (metric === USAGE_METRICS.EVENTS_INGESTED) {
    return period === LIMIT_PERIODS.MONTHLY ? plan.limits.monthlyProcessedEvents : plan.limits.dailyProcessedEvents;
  }
  if (metric === USAGE_METRICS.SUGGESTIONS_CREATED) {
    return period === LIMIT_PERIODS.DAILY ? plan.limits.dailySuggestions : null;
  }
  if (metric === USAGE_METRICS.LEADS_EXPORTED) {
    return period === LIMIT_PERIODS.MONTHLY ? plan.limits.monthlyLeadExports : null;
  }
  if (metric === USAGE_METRICS.AUTOMATION_RUNS_CREATED) {
    return period === LIMIT_PERIODS.DAILY ? plan.limits.dailyAutomationRuns : null;
  }
  return null;
}

function canUsePlatform(planCode, platform) {
  const plan = getPlanDefinition(planCode);
  const raw = String(platform || "").trim().toLowerCase();
  const normalized = PLATFORM_ALIASES[raw] || raw;
  if (!normalized || plan.includedPlatforms.includes(normalized)) {
    return makeDecision(true);
  }
  return makeDecision(
    false,
    PLAN_REASON_CODES.PLATFORM_NOT_INCLUDED,
    `Platform '${normalized}' is not included in the ${plan.displayName} package.`,
    { platform: normalized, planCode: plan.code }
  );
}

function canCreateAutomationRun(planCode) {
  const plan = getPlanDefinition(planCode);
  if (plan.capabilities.automationEnabled) return makeDecision(true);
  return makeDecision(
    false,
    PLAN_REASON_CODES.AUTOMATION_DISABLED,
    `${plan.displayName} does not include automation runs.`,
    { planCode: plan.code }
  );
}

function canAccessAdvancedScoring(planCode) {
  const plan = getPlanDefinition(planCode);
  if (plan.capabilities.advancedScoringEnabled) return makeDecision(true);
  return makeDecision(
    false,
    PLAN_REASON_CODES.ADVANCED_SCORING_DISABLED,
    `${plan.displayName} does not include advanced scoring.`,
    { planCode: plan.code }
  );
}

function canExportLeads(planCode) {
  const plan = getPlanDefinition(planCode);
  if (plan.capabilities.exportEnabled) return makeDecision(true);
  return makeDecision(
    false,
    PLAN_REASON_CODES.EXPORT_DISABLED,
    `${plan.displayName} does not include lead export.`,
    { planCode: plan.code }
  );
}

function canCreateAdditionalBrand(planCode, currentBrands) {
  const plan = getPlanDefinition(planCode);
  if (Number(currentBrands || 0) < plan.limits.maxBrands) return makeDecision(true);
  return makeDecision(
    false,
    PLAN_REASON_CODES.BRAND_LIMIT_REACHED,
    `${plan.displayName} allows up to ${plan.limits.maxBrands} brand${plan.limits.maxBrands === 1 ? "" : "s"}.`,
    { planCode: plan.code, limit: plan.limits.maxBrands, current: Number(currentBrands || 0) }
  );
}

function canInviteTeamMember(planCode, currentUsers) {
  const plan = getPlanDefinition(planCode);
  if (Number(currentUsers || 0) < plan.limits.maxUsers) return makeDecision(true);
  return makeDecision(
    false,
    PLAN_REASON_CODES.TEAM_LIMIT_REACHED,
    `${plan.displayName} allows up to ${plan.limits.maxUsers} team member${plan.limits.maxUsers === 1 ? "" : "s"}.`,
    { planCode: plan.code, limit: plan.limits.maxUsers, current: Number(currentUsers || 0) }
  );
}

function evaluateUsage(planCode, metric, period, currentValue, increment) {
  const plan = getPlanDefinition(planCode);
  const limit = getUsageLimit(plan.code, metric, period);
  if (limit == null) return makeDecision(true, null, null, { limit: null, current: Number(currentValue || 0), nextValue: Number(currentValue || 0) + Number(increment || 0) });

  const current = Number(currentValue || 0);
  const delta = Number(increment || 0);
  const nextValue = current + delta;
  if (nextValue <= limit) {
    return makeDecision(true, null, null, { planCode: plan.code, metric, period, limit, current, nextValue });
  }

  return makeDecision(
    false,
    PLAN_REASON_CODES.PLAN_LIMIT_REACHED,
    `${plan.displayName} reached the ${period.toLowerCase()} ${metric.toLowerCase()} limit of ${limit}.`,
    { planCode: plan.code, metric, period, limit, current, nextValue }
  );
}

function buildFeatureFlags(planCode) {
  return getPlanDefinition(planCode).capabilities;
}

module.exports = {
  PLAN_CODES,
  BILLING_INTERVALS,
  SUBSCRIPTION_STATUSES,
  LIMIT_PERIODS,
  USAGE_METRICS,
  PLAN_REASON_CODES,
  PLAN_DEFINITIONS,
  LEGACY_PLAN_ALIASES,
  normalizePlanCode,
  getPlanDefinition,
  getUsageLimit,
  buildFeatureFlags,
  canUsePlatform,
  canCreateAutomationRun,
  canAccessAdvancedScoring,
  canExportLeads,
  canCreateAdditionalBrand,
  canInviteTeamMember,
  evaluateUsage,
};
