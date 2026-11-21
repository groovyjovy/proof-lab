export type BoundaryPosition = 0 | 1 | 2;

export type BoundarySnapshot = {
	neighborId: number;
	neighborVersion: number;
	position: BoundaryPosition;
};

export type BoundaryMove = BoundarySnapshot;

export const isBoundaryPosition = (value: unknown): value is BoundaryPosition =>
	value === 0 || value === 1 || value === 2;
