export const monthName = (month: number) =>
	new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

export const taka = (amount: { toString(): string }) =>
	Number(amount.toString()).toLocaleString("en-BD", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
