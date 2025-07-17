import * as core from "@actions/core";
import type { ActionOutputs, Logger } from "./interfaces";

export class LoggerImpl implements Logger {
	startGroup(name: string): void {
		core.startGroup(name);
	}

	endGroup(): void {
		core.endGroup();
	}

	info(message: string): void {
		core.info(message);
	}

	debug(message: string): void {
		core.debug(message);
	}

	error(message: string): void {
		core.error(message);
	}

	warning(message: string): void {
		core.warning(message);
	}
}

export class ActionOutputsImpl implements ActionOutputs {
	setOutput(name: string, value: string): void {
		core.setOutput(name, value);
	}

	setFailed(message: string): void {
		core.setFailed(message);
	}

	async addSummary(
		heading: string,
		table: Array<[string, string]>,
	): Promise<void> {
		const tableData = [
			[
				{ data: "Field", header: true },
				{ data: "Value", header: true },
			],
			...table.map(([field, value]) => [field, value]),
		];

		await core.summary.addHeading(heading).addTable(tableData).write();
	}
}
