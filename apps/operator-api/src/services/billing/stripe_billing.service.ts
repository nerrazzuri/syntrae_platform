import Stripe from 'stripe';
import { Prisma } from '@syntrae/prisma-schema';
import {
    BILLING_INTERVALS,
    PLAN_CODES,
    PLAN_DEFINITIONS,
    SUBSCRIPTION_STATUSES,
    getPlanDefinition,
    normalizePlanCode,
    type BillingInterval,
    type PlanCode,
} from '@syntrae/commercial-plans';
import { prisma } from '../../db';

type StripeSubscriptionLike = Stripe.Subscription | Stripe.Invoice | Stripe.Checkout.Session;

interface CheckoutSessionInput {
    workspaceId: string;
    userEmail: string;
    userId: string;
    planCode: string;
    billingInterval?: BillingInterval;
    voucherCode?: string;
}

interface PortalSessionInput {
    workspaceId: string;
}

export class StripeBillingError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, message: string, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

const CHECKOUT_PLAN_CODES: PlanCode[] = [PLAN_CODES.STARTER, PLAN_CODES.GROWTH, PLAN_CODES.PRO, PLAN_CODES.AGENCY];
type PriceEntry = { planCode: PlanCode; billingInterval: BillingInterval; priceId: string };

export class StripeBillingService {
    private static stripeClient: Stripe | null = null;

    private static normalizeVoucherCode(value: unknown) {
        return String(value || '').trim().toUpperCase();
    }

    private static jsonObject(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
    }

    static isConfigured() {
        return Boolean(process.env.STRIPE_SECRET_KEY);
    }

    static isWebhookConfigured() {
        return this.isConfigured() && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    }

    static manualPlanChangesAllowed() {
        const env = (process.env.NODE_ENV || 'development').toLowerCase();
        return process.env.BILLING_MANUAL_PLAN_CHANGES === '1' || env === 'local' || env === 'test' || !this.isConfigured();
    }

    static getPlanCatalog() {
        return (Object.values(PLAN_DEFINITIONS) as Array<(typeof PLAN_DEFINITIONS)[PlanCode]>)
            .sort((left, right) => left.rank - right.rank)
            .map((plan) => ({
                plan_code: plan.code,
                display_name: plan.displayName,
                billing_intervals: plan.availableBillingIntervals,
                checkout_enabled: CHECKOUT_PLAN_CODES.includes(plan.code) && plan.availableBillingIntervals.some((interval) => Boolean(this.getConfiguredPriceId(plan.code, interval))),
            }));
    }

    static isPortalAvailable(subscription?: { stripe_customer_id?: string | null } | null) {
        return this.isConfigured() && Boolean(subscription?.stripe_customer_id);
    }

    static async createCheckoutSession(input: CheckoutSessionInput) {
        const planCode = normalizePlanCode(input.planCode);
        const billingInterval = input.billingInterval || BILLING_INTERVALS.MONTHLY;
        const priceId = this.getRequiredPriceId(planCode, billingInterval);
        const stripe = this.getStripe();
        const promoVoucher = await this.findRedeemablePromoVoucher(input.voucherCode);

        const workspace = await prisma.account.findUnique({
            where: { id: input.workspaceId },
            include: { subscription: true },
        });
        if (!workspace) {
            throw new StripeBillingError('WORKSPACE_NOT_FOUND', 'Workspace not found', 404);
        }
        const normalizedWorkspacePlan = normalizePlanCode(workspace.subscription?.plan_code || workspace.plan_id);
        const workspacePlan = getPlanDefinition(normalizedWorkspacePlan);

        await prisma.workspaceSubscription.upsert({
            where: { workspace_id: input.workspaceId },
            update: {
                plan_code: workspacePlan.code,
                display_name: workspacePlan.displayName,
                billing_provider: 'STRIPE',
            },
            create: {
                workspace_id: input.workspaceId,
                plan_code: workspacePlan.code,
                display_name: workspacePlan.displayName,
                billing_provider: 'STRIPE',
                status: SUBSCRIPTION_STATUSES.ACTIVE,
                billing_interval: billingInterval,
            },
        });

        const customerId = await this.ensureCustomer({
            workspaceId: input.workspaceId,
            workspaceName: workspace.name,
            userEmail: input.userEmail,
            existingCustomerId: workspace.subscription?.stripe_customer_id || null,
        });

        const successUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL || `${this.getAppBaseUrl()}/billing?checkout=success`;
        const cancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL || `${this.getAppBaseUrl()}/billing?checkout=canceled`;

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            client_reference_id: input.workspaceId,
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            metadata: {
                workspace_id: input.workspaceId,
                user_id: input.userId,
                plan_code: planCode,
                billing_interval: billingInterval,
                promo_voucher_id: promoVoucher?.id || '',
                promo_voucher_code: promoVoucher?.code || '',
            },
            subscription_data: {
                ...(promoVoucher ? { trial_period_days: Math.max(1, promoVoucher.duration_days) } : {}),
                metadata: {
                    workspace_id: input.workspaceId,
                    plan_code: planCode,
                    billing_interval: billingInterval,
                    promo_voucher_id: promoVoucher?.id || '',
                    promo_voucher_code: promoVoucher?.code || '',
                },
            },
        });

        if (!session.url) {
            throw new StripeBillingError('CHECKOUT_URL_MISSING', 'Stripe Checkout session did not return a URL', 502);
        }

        await prisma.workspaceSubscription.updateMany({
            where: { workspace_id: input.workspaceId },
            data: {
                billing_provider: 'STRIPE',
                stripe_customer_id: customerId,
                metadata: {
                    checkout_session_id: session.id,
                },
            },
        });

        return {
            url: session.url,
            session_id: session.id,
            applied_voucher: promoVoucher
                ? {
                    code: promoVoucher.code,
                    duration_days: promoVoucher.duration_days,
                    plan_code: promoVoucher.plan_code,
                    billing_interval: promoVoucher.billing_interval,
                }
                : null,
        };
    }

    static async createPortalSession(input: PortalSessionInput) {
        const stripe = this.getStripe();
        const subscription = await prisma.workspaceSubscription.findUnique({
            where: { workspace_id: input.workspaceId },
        });

        if (!subscription?.stripe_customer_id) {
            throw new StripeBillingError('STRIPE_CUSTOMER_NOT_LINKED', 'No Stripe customer linked to this workspace yet', 409);
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: subscription.stripe_customer_id,
            return_url: process.env.STRIPE_PORTAL_RETURN_URL || `${this.getAppBaseUrl()}/billing`,
        });

        return { url: session.url };
    }

    static async handleWebhook(payload: Buffer, signature?: string) {
        if (!this.isWebhookConfigured()) {
            throw new StripeBillingError('STRIPE_WEBHOOK_NOT_CONFIGURED', 'Stripe webhook handling is not configured', 503);
        }
        if (!signature) {
            throw new StripeBillingError('STRIPE_SIGNATURE_MISSING', 'Stripe signature header is missing');
        }

        const event = this.getStripe().webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!);

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                await this.handleCheckoutCompleted(session);
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                await this.syncFromStripeSubscription(subscription);
                break;
            }
            case 'invoice.paid':
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                await this.handleInvoiceEvent(invoice);
                break;
            }
            default:
                break;
        }

        return { received: true };
    }

    private static async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
        const workspaceId = session.metadata?.workspace_id || session.client_reference_id;
        if (!workspaceId) return;

        await prisma.workspaceSubscription.updateMany({
            where: { workspace_id: workspaceId },
            data: {
                billing_provider: 'STRIPE',
                stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
            },
        });

        const subscriptionId =
            typeof session.subscription === 'string'
                ? session.subscription
                : session.subscription?.id;

        if (subscriptionId) {
            const subscription = await this.getStripe().subscriptions.retrieve(subscriptionId, {
                expand: ['items.data.price.product'],
            });
            await this.syncFromStripeSubscription(subscription);
        }
    }

    private static async handleInvoiceEvent(invoice: Stripe.Invoice) {
        const stripeInvoice = invoice as Stripe.Invoice & {
            subscription?: string | Stripe.Subscription | null;
        };
        const subscriptionId =
            typeof stripeInvoice.subscription === 'string'
                ? stripeInvoice.subscription
                : stripeInvoice.subscription?.id;
        if (!subscriptionId) return;

        const subscription = await this.getStripe().subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price.product'],
        });
        await this.syncFromStripeSubscription(subscription);
    }

    private static async syncFromStripeSubscription(subscription: Stripe.Subscription) {
        const workspaceId = await this.resolveWorkspaceId(subscription);
        if (!workspaceId) {
            throw new StripeBillingError('STRIPE_WORKSPACE_NOT_FOUND', `Unable to resolve workspace for Stripe subscription ${subscription.id}`, 404);
        }

        const billingInterval = this.mapStripeInterval(subscription);
        const priceId = subscription.items.data[0]?.price?.id || null;
        const product = subscription.items.data[0]?.price?.product;
        const productId = typeof product === 'string' ? product : product?.id || null;
        const mappedPlanCode = this.resolvePlanCodeFromStripeSubscription(subscription, priceId);
        const mappedStatus = this.mapStripeStatus(subscription.status);

        const targetPlanCode =
            mappedStatus === SUBSCRIPTION_STATUSES.CANCELED || mappedStatus === SUBSCRIPTION_STATUSES.INACTIVE
                ? PLAN_CODES.STARTER
                : mappedPlanCode;
        const targetPlan = getPlanDefinition(targetPlanCode);
        const stripeSubscription = subscription as Stripe.Subscription & {
            current_period_start?: number | null;
            current_period_end?: number | null;
        };
        const currentPeriodStart = stripeSubscription.current_period_start ? new Date(stripeSubscription.current_period_start * 1000) : null;
        const currentPeriodEnd = stripeSubscription.current_period_end ? new Date(stripeSubscription.current_period_end * 1000) : null;
        const promoVoucherId = subscription.metadata?.promo_voucher_id || null;
        const promoVoucherCode = subscription.metadata?.promo_voucher_code || null;

        await prisma.$transaction(async (tx) => {
            const existingSubscription = await tx.workspaceSubscription.findUnique({
                where: { workspace_id: workspaceId },
            });
            const currentMetadata = this.jsonObject(existingSubscription?.metadata);
            const nextMetadata: Record<string, unknown> = {
                ...currentMetadata,
                stripe_status: subscription.status,
            };

            if (promoVoucherId && promoVoucherCode) {
                const history = Array.isArray(currentMetadata.promo_redemptions)
                    ? currentMetadata.promo_redemptions as Array<Record<string, unknown>>
                    : [];
                const alreadyRecorded = history.some((entry) => String(entry?.code || '') === promoVoucherCode);

                if (!alreadyRecorded) {
                    const voucher = await tx.promoVoucher.findUnique({ where: { id: promoVoucherId } });
                    if (voucher) {
                        history.unshift({
                            code: voucher.code,
                            label: voucher.label || null,
                            redeemed_at: new Date().toISOString(),
                            duration_days: voucher.duration_days,
                            plan_code: voucher.plan_code,
                            billing_interval: voucher.billing_interval,
                            note: voucher.note || null,
                            source: 'STRIPE_CHECKOUT',
                        });
                        nextMetadata.promo_redemptions = history.slice(0, 25);
                        nextMetadata.access_override = {
                            type: 'PROMO_VOUCHER',
                            code: voucher.code,
                            active: subscription.status === 'trialing' || subscription.status === 'active',
                            starts_at: currentPeriodStart ? currentPeriodStart.toISOString() : new Date().toISOString(),
                            ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
                            note: voucher.note || null,
                        };

                        if (voucher.max_redemptions === null || voucher.redemptions_count < voucher.max_redemptions) {
                            await tx.promoVoucher.update({
                                where: { id: voucher.id },
                                data: {
                                    redemptions_count: { increment: 1 },
                                    last_redeemed_at: new Date(),
                                },
                            });
                        }
                    }
                }
            }

            await tx.account.update({
                where: { id: workspaceId },
                data: {
                    plan_id: targetPlan.code,
                    status: targetPlan.code === PLAN_CODES.STARTER && mappedStatus === SUBSCRIPTION_STATUSES.CANCELED ? 'ACTIVE' : 'ACTIVE',
                },
            });

            await tx.workspaceSubscription.upsert({
                where: { workspace_id: workspaceId },
                update: {
                    plan_code: targetPlan.code,
                    display_name: targetPlan.displayName,
                    billing_provider: 'STRIPE',
                    status: mappedStatus,
                    billing_interval: billingInterval,
                    is_trial: subscription.status === 'trialing',
                    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
                    current_period_start: currentPeriodStart,
                    current_period_end: currentPeriodEnd,
                    cancel_at_period_end: subscription.cancel_at_period_end,
                    scheduled_plan_code: subscription.cancel_at_period_end ? PLAN_CODES.STARTER : null,
                    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
                    stripe_subscription_id: subscription.id,
                    stripe_price_id: priceId,
                    stripe_product_id: productId,
                    metadata: nextMetadata as Prisma.InputJsonValue,
                },
                create: {
                    workspace_id: workspaceId,
                    plan_code: targetPlan.code,
                    display_name: targetPlan.displayName,
                    billing_provider: 'STRIPE',
                    status: mappedStatus,
                    billing_interval: billingInterval,
                    is_trial: subscription.status === 'trialing',
                    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
                    current_period_start: currentPeriodStart,
                    current_period_end: currentPeriodEnd,
                    cancel_at_period_end: subscription.cancel_at_period_end,
                    scheduled_plan_code: subscription.cancel_at_period_end ? PLAN_CODES.STARTER : null,
                    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
                    stripe_subscription_id: subscription.id,
                    stripe_price_id: priceId,
                    stripe_product_id: productId,
                    metadata: nextMetadata as Prisma.InputJsonValue,
                },
            });
        });
    }

    private static async findRedeemablePromoVoucher(code?: string | null) {
        const normalizedCode = this.normalizeVoucherCode(code);
        if (!normalizedCode) return null;

        const voucher = await prisma.promoVoucher.findUnique({
            where: { code: normalizedCode },
        });
        if (!voucher) {
            throw new StripeBillingError('PROMO_VOUCHER_NOT_FOUND', 'Promo voucher not found', 404);
        }

        const now = new Date();
        if (voucher.status !== 'ACTIVE') {
            throw new StripeBillingError('PROMO_VOUCHER_INACTIVE', 'Promo voucher is inactive');
        }
        if (voucher.starts_at && voucher.starts_at > now) {
            throw new StripeBillingError('PROMO_VOUCHER_NOT_STARTED', 'Promo voucher is not active yet');
        }
        if (voucher.ends_at && voucher.ends_at < now) {
            throw new StripeBillingError('PROMO_VOUCHER_EXPIRED', 'Promo voucher has expired');
        }
        if (voucher.max_redemptions !== null && voucher.redemptions_count >= voucher.max_redemptions) {
            throw new StripeBillingError('PROMO_VOUCHER_EXHAUSTED', 'Promo voucher is fully redeemed');
        }

        return voucher;
    }

    private static async resolveWorkspaceId(resource: StripeSubscriptionLike) {
        const metadataWorkspaceId = resource.metadata?.workspace_id;
        if (metadataWorkspaceId) return metadataWorkspaceId;

        const subscriptionId = 'id' in resource && 'object' in resource && resource.object === 'subscription' ? resource.id : null;
        if (subscriptionId) {
            const bySubscription = await prisma.workspaceSubscription.findFirst({
                where: { stripe_subscription_id: subscriptionId },
                select: { workspace_id: true },
            });
            if (bySubscription?.workspace_id) return bySubscription.workspace_id;
        }

        const customerId = this.getCustomerId(resource);
        if (customerId) {
            const byCustomer = await prisma.workspaceSubscription.findFirst({
                where: { stripe_customer_id: customerId },
                select: { workspace_id: true },
            });
            if (byCustomer?.workspace_id) return byCustomer.workspace_id;

            const customer = await this.getStripe().customers.retrieve(customerId);
            if (!customer.deleted && customer.metadata?.workspace_id) {
                return customer.metadata.workspace_id;
            }
        }

        return null;
    }

    private static getCustomerId(resource: StripeSubscriptionLike) {
        if ('customer' in resource) {
            const customer = resource.customer;
            return typeof customer === 'string' ? customer : customer?.id || null;
        }
        return null;
    }

    private static resolvePlanCodeFromStripeSubscription(subscription: Stripe.Subscription, priceId: string | null): PlanCode {
        const metadataPlan = subscription.metadata?.plan_code;
        if (metadataPlan) return normalizePlanCode(metadataPlan);
        if (!priceId) return PLAN_CODES.STARTER;

        const matchedEntry = this.getConfiguredPriceEntries().find((entry) => entry.priceId === priceId);
        if (matchedEntry) return matchedEntry.planCode;

        return PLAN_CODES.STARTER;
    }

    private static mapStripeInterval(subscription: Stripe.Subscription): BillingInterval {
        const interval = subscription.items.data[0]?.price?.recurring?.interval;
        return interval === 'year' ? BILLING_INTERVALS.YEARLY : BILLING_INTERVALS.MONTHLY;
    }

    private static mapStripeStatus(status: Stripe.Subscription.Status) {
        if (status === 'trialing') return SUBSCRIPTION_STATUSES.TRIALING;
        if (status === 'active') return SUBSCRIPTION_STATUSES.ACTIVE;
        if (status === 'past_due') return SUBSCRIPTION_STATUSES.PAST_DUE;
        if (status === 'canceled') return SUBSCRIPTION_STATUSES.CANCELED;
        return SUBSCRIPTION_STATUSES.INACTIVE;
    }

    private static async ensureCustomer(input: {
        workspaceId: string;
        workspaceName: string;
        userEmail: string;
        existingCustomerId?: string | null;
    }) {
        if (input.existingCustomerId) return input.existingCustomerId;

        const customer = await this.getStripe().customers.create({
            email: input.userEmail,
            name: input.workspaceName,
            metadata: {
                workspace_id: input.workspaceId,
            },
        });

        await prisma.workspaceSubscription.updateMany({
            where: { workspace_id: input.workspaceId },
            data: {
                billing_provider: 'STRIPE',
                stripe_customer_id: customer.id,
            },
        });

        return customer.id;
    }

    private static getConfiguredPriceEntries() {
        return (Object.values(PLAN_DEFINITIONS) as Array<(typeof PLAN_DEFINITIONS)[PlanCode]>).flatMap((plan) =>
            plan.availableBillingIntervals
                .map((interval) => ({
                    planCode: plan.code,
                    billingInterval: interval,
                    priceId: this.getConfiguredPriceId(plan.code, interval),
                }))
                .filter((entry): entry is PriceEntry => Boolean(entry.priceId))
        );
    }

    private static getConfiguredPriceId(planCode: PlanCode, billingInterval: BillingInterval) {
        const suffix = billingInterval === BILLING_INTERVALS.YEARLY ? 'YEARLY' : 'MONTHLY';
        return process.env[`STRIPE_PRICE_${planCode}_${suffix}`];
    }

    private static getRequiredPriceId(planCode: PlanCode, billingInterval: BillingInterval) {
        if (!CHECKOUT_PLAN_CODES.includes(planCode)) {
            throw new StripeBillingError('PLAN_NOT_CHECKOUT_ELIGIBLE', `${getPlanDefinition(planCode).displayName} does not use Stripe Checkout`, 400);
        }

        const priceId = this.getConfiguredPriceId(planCode, billingInterval);
        if (!priceId) {
            throw new StripeBillingError(
                'STRIPE_PRICE_NOT_CONFIGURED',
                `Stripe price is not configured for ${planCode} ${billingInterval.toLowerCase()}`,
                503
            );
        }
        return priceId;
    }

    private static getAppBaseUrl() {
        return process.env.APP_BASE_URL || process.env.OPERATOR_UI_BASE_URL || 'https://app.syntraeai.com';
    }

    private static getStripe() {
        if (this.stripeClient) return this.stripeClient;
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new StripeBillingError('STRIPE_NOT_CONFIGURED', 'Stripe secret key is not configured', 503);
        }

        this.stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
        return this.stripeClient;
    }
}
