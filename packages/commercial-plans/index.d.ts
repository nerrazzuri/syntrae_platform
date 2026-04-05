export type PlanCode = 'BASIC' | 'STARTER' | 'GROWTH' | 'PRO' | 'AGENCY';
export type BillingInterval = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE';
export type LimitPeriod = 'DAILY' | 'MONTHLY';
export type UsageMetricCode =
  | 'EVENTS_INGESTED'
  | 'SUGGESTIONS_CREATED'
  | 'AUTOMATION_RUNS_CREATED'
  | 'LEADS_EXPORTED';

export type PlanReasonCode =
  | 'PLATFORM_NOT_INCLUDED'
  | 'FEATURE_NOT_AVAILABLE'
  | 'PLAN_LIMIT_REACHED'
  | 'TEAM_LIMIT_REACHED'
  | 'BRAND_LIMIT_REACHED'
  | 'WORKSPACE_LIMIT_REACHED'
  | 'AUTOMATION_DISABLED'
  | 'ADVANCED_SCORING_DISABLED'
  | 'EXPORT_DISABLED'
  | 'UPGRADE_REQUIRED';

export interface PlanLimits {
  maxPlatforms: number;
  maxBrands: number;
  maxWorkspaces: number;
  maxUsers: number;
  maxCampaigns: number;
  dailyProcessedEvents: number;
  monthlyProcessedEvents: number;
  dailySuggestions: number;
  monthlyLeadExports: number;
  dailyAutomationRuns: number;
}

export interface PlanCapabilities {
  manualWorkflow: boolean;
  automationEnabled: boolean;
  automationRuleReady: boolean;
  exportEnabled: boolean;
  advancedScoringEnabled: boolean;
  priorityProcessingEnabled: boolean;
  assistedReplyDrafts: boolean;
  leadPrioritization: boolean;
  teamMemberInvites: boolean;
  multiBrand: boolean;
  multiClientIsolation: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  displayName: string;
  rank: number;
  availableBillingIntervals: BillingInterval[];
  status: 'ACTIVE' | 'INACTIVE';
  limits: PlanLimits;
  includedPlatforms: string[];
  capabilities: PlanCapabilities;
}

export interface PlanDecision {
  allowed: boolean;
  reasonCode: PlanReasonCode | null;
  message: string | null;
  planCode?: PlanCode;
  platform?: string;
  metric?: UsageMetricCode;
  period?: LimitPeriod;
  limit?: number | null;
  current?: number;
  nextValue?: number;
}

export const PLAN_CODES: Record<PlanCode, PlanCode>;
export const BILLING_INTERVALS: Record<BillingInterval, BillingInterval>;
export const SUBSCRIPTION_STATUSES: Record<SubscriptionStatus, SubscriptionStatus>;
export const LIMIT_PERIODS: Record<LimitPeriod, LimitPeriod>;
export const USAGE_METRICS: Record<UsageMetricCode, UsageMetricCode>;
export const PLAN_REASON_CODES: Record<PlanReasonCode, PlanReasonCode>;
export const LEGACY_PLAN_ALIASES: Record<string, PlanCode>;
export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition>;

export function normalizePlanCode(planCode?: string | null): PlanCode;
export function getPlanDefinition(planCode?: string | null): PlanDefinition;
export function getUsageLimit(planCode: string, metric: UsageMetricCode, period: LimitPeriod): number | null;
export function buildFeatureFlags(planCode?: string | null): PlanCapabilities;
export function canUsePlatform(planCode: string, platform: string): PlanDecision;
export function canCreateAutomationRun(planCode: string): PlanDecision;
export function canAccessAdvancedScoring(planCode: string): PlanDecision;
export function canExportLeads(planCode: string): PlanDecision;
export function canCreateAdditionalBrand(planCode: string, currentBrands: number): PlanDecision;
export function canInviteTeamMember(planCode: string, currentUsers: number): PlanDecision;
export function evaluateUsage(planCode: string, metric: UsageMetricCode, period: LimitPeriod, currentValue: number, increment?: number): PlanDecision;
