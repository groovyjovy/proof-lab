import fc from 'fast-check';
import { seed } from '../seed.ts';

fc.configureGlobal({ seed });
