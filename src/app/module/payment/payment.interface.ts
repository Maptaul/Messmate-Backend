export interface ICreatePaymentPayload {
	billId: string;
}

export interface IBkashExecuteResult {
	statusCode?: string;
	transactionStatus?: string;
	paymentID?: string;
	trxID?: string;
	amount?: string;
	currency?: string;
	merchantInvoiceNumber?: string;
}
