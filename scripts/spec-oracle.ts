import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

export function buildSpec() {
	const result = spawnSync('lake', ['build'], {
		cwd: 'spec',
		stdio: ['ignore', 'inherit', 'inherit']
	});
	if (result.error)
		throw new Error(
			'lake が見つからない。Lean を入れる: brew install elan-init(README の「動かし方」)'
		);
	if (result.status !== 0)
		throw new Error('spec/ の証明か仕様が通らなかった(cd spec && lake build)');
}

export type Oracle = { ask: (request: unknown) => Promise<unknown>; close: () => void };

export function startOracle(): Oracle {
	const child = spawn('spec/.lake/build/bin/oracle', [], { stdio: ['pipe', 'pipe', 'inherit'] });
	const waiting: ((line: string) => void)[] = [];
	createInterface({ input: child.stdout }).on('line', (line) => waiting.shift()?.(line));
	return {
		ask: (request) =>
			new Promise((resolve, reject) => {
				waiting.push((line) => {
					const answer = JSON.parse(line);
					if (answer && typeof answer === 'object' && 'error' in answer)
						reject(new Error(`仕様の窓口が答えられなかった: ${answer.error}`));
					else resolve(answer);
				});
				child.stdin.write(`${JSON.stringify(request)}\n`);
			}),
		close: () => child.stdin.end()
	};
}
