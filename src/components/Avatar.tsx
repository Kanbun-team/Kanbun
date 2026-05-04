import { cn } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  online?: boolean;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

function colorFor(name?: string | null): string {
  const palette = [
    "#2563eb",
    "#7c3aed",
    "#16a34a",
    "#dc2626",
    "#ea580c",
    "#0891b2",
    "#db2777",
    "#65a30d",
  ];
  if (!name) return palette[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export default function Avatar({
  src,
  name,
  size = 32,
  className,
  online,
}: AvatarProps) {
  const dotSize = Math.max(8, Math.round(size * 0.28));
  return (
    <span
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={{ width: size, height: size }}
    >
      <span
        className="block rounded-full overflow-hidden"
        style={{
          width: size,
          height: size,
          background: src ? "transparent" : colorFor(name),
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name ?? ""}
            width={size}
            height={size}
            className="w-full h-full object-cover"
          />
        ) : (
          <span
            className="w-full h-full flex items-center justify-center text-white font-semibold"
            style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
          >
            {initials(name)}
          </span>
        )}
      </span>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--bg)]",
            online ? "bg-emerald-500" : "bg-slate-400"
          )}
          style={{ width: dotSize, height: dotSize }}
          aria-label={online ? "online" : "offline"}
        />
      )}
    </span>
  );
}
