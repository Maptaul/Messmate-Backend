import httpStatus from "http-status";
import Stripe from "stripe";
import config from "../config";
import { AppError } from "../utils/AppError";

let client: Stripe | undefined;

// Built on first use so the API still boots (and the tests still run) without
// a key; only a card payment attempt needs one.
export const getStripe = (): Stripe => {
	if (!config.stripe_secret_key) {
		throw new AppError(
			httpStatus.SERVICE_UNAVAILABLE,
			"Card Payments Are Not Configured On This Server",
		);
	}

	client ??= new Stripe(config.stripe_secret_key);

	return client;
};

// Stripe takes BDT in poisha, the smallest unit.
export const toPoisha = (amount: number): number => Math.round(amount * 100);

export interface IStripeSessionFacts {
	payment_status: string;
	currency: string | null;
	amount_total: number | null;
}

// A session settles a bill only when Stripe says it is paid, in BDT, for exactly
// the amount the Payment row was opened for — the same three checks the bKash
// callback makes before it touches a bill.
export const isStripeSessionSettleable = (
	session: IStripeSessionFacts,
	expectedAmount: number,
): boolean =>
	session.payment_status === "paid" &&
	session.currency === "bdt" &&
	session.amount_total === toPoisha(expectedAmount);
