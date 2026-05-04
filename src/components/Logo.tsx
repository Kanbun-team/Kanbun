export default function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#2563eb" />
      <rect x="6" y="6" width="6" height="14" rx="1.5" fill="#ffffff" />
      <rect x="14" y="6" width="6" height="20" rx="1.5" fill="#bfdbfe" />
      <rect x="22" y="6" width="6" height="10" rx="1.5" fill="#dbeafe" />
    </svg>
  );
}
