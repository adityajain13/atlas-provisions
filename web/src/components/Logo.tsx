type LogoProps = {
  /** Width and height in pixels. */
  size?: number;
  className?: string;
  /** The accessible name. The mark is drawn in currentColor, so set the herb text colour on it or on a parent. */
  title?: string;
};

/** The Atlas Provisions mark, a bowl with steam. A stroke icon: its colour is the current text colour. */
export function Logo({ size = 20, className, title = 'Atlas Provisions' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={title}
    >
      <path d="M3 11h18a9 9 0 0 1-18 0z" />
      <path d="M12 11v9" />
      <path d="M7.6 11c.5 3.8 2.1 6.8 4.4 9" />
      <path d="M16.4 11c-.5 3.8-2.1 6.8-4.4 9" />
      <path d="M4.4 15.6h15.2" />
      <path d="M9 8c-.8-1 .8-2 0-3.2" />
      <path d="M12 8c-.8-1 .8-2 0-3.2" />
      <path d="M15 8c-.8-1 .8-2 0-3.2" />
    </svg>
  );
}
