import ejs from "ejs";
import path from "path";
import config from "../config";
import { transporter } from "./nodemailer";

export type MailAttachment = {
	filename: string;
	content: Buffer;
	contentType?: string;
};

export const sendTemplateMail = async (
	to: string,
	subject: string,
	template: string,
	data: Record<string, unknown>,
	attachments?: MailAttachment[],
) => {
	// The demo accounts live on .test (RFC 2606), which never delivers.
	if (to.endsWith(".test")) return;

	const templatePath = path.join(
		process.cwd(),
		`src/app/templates/${template}.ejs`,
	);

	const html = await ejs.renderFile(templatePath, data);

	await transporter.sendMail({
		from: config.email_sender,
		to,
		subject,
		html,
		attachments,
	});
};
