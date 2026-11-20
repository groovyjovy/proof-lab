declare global {
	namespace App {
		interface Locals {
			actor: { id: string; name: string } | null;
		}
	}
}

export {};
