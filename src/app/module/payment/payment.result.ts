type ResultKind = "success" | "failure" | "cancel";

const outcomes: Record<ResultKind, { title: string; detail: string }> = {
	success: {
		title: "Payment received",
		detail:
			"Your bill has been updated. You can close this page and check My Bills in MessMate.",
	},
	failure: {
		title: "Payment did not go through",
		detail:
			"Nothing was charged. Open MessMate and try the payment again from your bill.",
	},
	cancel: {
		title: "Payment cancelled",
		detail:
			"You cancelled before paying, so nothing was charged. Your bill is unchanged.",
	},
};

export const renderPaymentResult = (status: string) => {
	const kind: ResultKind =
		status === "success" || status === "cancel" ? status : "failure";

	const { title, detail } = outcomes[kind];

	const accent = kind === "success" ? "#137a4b" : "#8a1f2b";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - MessMate</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f6f6f4; color: #1c1c1a; padding: 24px; }
main { max-width: 26rem; background: #fff; border: 1px solid #e4e4e0;
  border-radius: 12px; padding: 32px; text-align: center; }
h1 { margin: 0 0 12px; font-size: 1.35rem; color: ${accent}; }
p { margin: 0; color: #55554f; }
small { display: block; margin-top: 24px; color: #90908a; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${detail}</p>
<small>MessMate</small>
</main>
</body>
</html>`;
};
