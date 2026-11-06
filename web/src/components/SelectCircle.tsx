import { CheckIcon } from './Icons';

/**
 * The choose-mode mark in a card's top-right corner: an empty ring when the meal is not picked, a filled herb circle
 * with a check when it is. Decorative (aria-hidden): the card's button carries the state with aria-pressed and the
 * visually hidden "Select" or "Selected" text.
 */
export function SelectCircle({ chosen }: { chosen: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
        chosen ? 'border-herb bg-herb text-ink' : 'border-edge bg-transparent'
      }`}
    >
      {chosen && <CheckIcon size={12} />}
    </span>
  );
}
