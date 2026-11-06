import { type Household, type Store } from '@provisions/shared';

export type Update = (fn: (prev: Household) => Household) => void;

export const ERROR_TEXT = 'text-[#D98C7A]';

export type StoresUpdate = (fn: (stores: Store[]) => Store[]) => void;
