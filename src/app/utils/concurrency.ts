export const mapWithLimit = async <T, R>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
	const results = new Array<PromiseSettledResult<R>>(items.length);

	let next = 0;

	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;

			try {
				results[index] = {
					status: "fulfilled",
					value: await task(items[index]!),
				};
			} catch (reason) {
				results[index] = { status: "rejected", reason };
			}
		}
	};

	const workers = Array.from(
		{ length: Math.max(1, Math.min(limit, items.length)) },
		worker,
	);

	await Promise.all(workers);

	return results;
};
