export interface ICreatePaymentPayload {
	billId: string;
}

/**
 * The fields of a bKash execute response we actually act on. The whole raw body
 * still gets stored in `Payment.gatewayResponse` - this is only what settlement
 * reads, so a shape change at bKash breaks in one obvious place.
 */
export interface IBkashExecuteResult {
	statusCode?: string;
	transactionStatus?: string;
	paymentID?: string;
	trxID?: string;
	amount?: string;
	currency?: string;
	merchantInvoiceNumber?: string;
}
